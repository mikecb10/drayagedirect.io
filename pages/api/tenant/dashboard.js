import { requireTenantUser, getServiceClient } from '../../../lib/tenant-api';
import { applyBranchFilter } from '../../../lib/branch-filter';

/**
 * /api/tenant/dashboard
 *
 * GET — compute all dashboard stats in a single request.
 * Returns: todaysOps, revenue, openAR, alerts, loadVolume, driverUtil, recentActivity
 */
export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const ctx = await requireTenantUser(req, res);
  if (!ctx) return;

  const svc = getServiceClient();
  const today = new Date().toISOString().split('T')[0];

  try {
    // ── 1. Today's Ops ──
    let opsQuery = svc
      .from('orders')
      .select('id, status, pickup_date, delivery_date, ready_to_return_date, driver_id')
      .eq('tenant_id', ctx.tenantId)
      .is('deleted_at', null)
      .not('status', 'in', '(completed,cancelled)');
    opsQuery = applyBranchFilter(opsQuery, ctx);
    const { data: opsLoads } = await opsQuery;

    const allOps = opsLoads || [];
    const todaysOps = {
      picking_up: allOps.filter((l) => l.pickup_date === today).length,
      delivering: allOps.filter((l) => l.delivery_date === today).length,
      returning: allOps.filter((l) => l.ready_to_return_date === today).length,
      total_active: allOps.filter((l) => !['completed', 'cancelled', 'pending'].includes(l.status)).length,
    };

    // ── 2. Revenue (invoiced charge sets) ──
    const { data: revData } = await svc
      .from('order_charge_sets')
      .select('total_cents, invoiced_at')
      .eq('tenant_id', ctx.tenantId)
      .eq('status', 'invoiced')
      .not('invoiced_at', 'is', null);

    const now = new Date();
    const weekStart = new Date(now);
    weekStart.setDate(now.getDate() - now.getDay());
    weekStart.setHours(0, 0, 0, 0);
    const lastWeekStart = new Date(weekStart);
    lastWeekStart.setDate(lastWeekStart.getDate() - 7);
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const lastMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0);

    let thisWeek = 0, lastWeek = 0, thisMonth = 0, lastMonth = 0;
    for (const r of revData || []) {
      const d = new Date(r.invoiced_at);
      const cents = r.total_cents || 0;
      if (d >= weekStart) thisWeek += cents;
      else if (d >= lastWeekStart && d < weekStart) lastWeek += cents;
      if (d >= monthStart) thisMonth += cents;
      else if (d >= lastMonthStart && d <= lastMonthEnd) lastMonth += cents;
    }

    const revenue = { thisWeek, lastWeek, thisMonth, lastMonth };

    // ── 3. Open AR ──
    const { data: arData } = await svc
      .from('invoices')
      .select('id, balance_due_cents, due_date, status')
      .eq('tenant_id', ctx.tenantId)
      .in('status', ['sent', 'overdue'])
      .is('deleted_at', null)
      .gt('balance_due_cents', 0);

    let totalOutstanding = 0, totalOverdue = 0;
    for (const inv of arData || []) {
      totalOutstanding += inv.balance_due_cents || 0;
      if (inv.due_date && new Date(inv.due_date) < new Date(today)) {
        totalOverdue += inv.balance_due_cents || 0;
      }
    }
    const openAR = { totalOutstanding, totalOverdue, count: (arData || []).length };

    // ── 4. Alerts ──
    const thirtyDays = new Date();
    thirtyDays.setDate(thirtyDays.getDate() + 30);
    const twoDays = new Date();
    twoDays.setDate(twoDays.getDate() + 2);

    const [driverRes, lfdRes, overdueRes, pendingDocRes] = await Promise.all([
      // Expiring driver docs (within 30 days)
      svc.from('drivers')
        .select('id, name, license_expiry, medical_exp, twic_exp')
        .eq('tenant_id', ctx.tenantId)
        .eq('status', 'active')
        .is('deleted_at', null)
        .or(`license_expiry.lte.${thirtyDays.toISOString().split('T')[0]},medical_exp.lte.${thirtyDays.toISOString().split('T')[0]},twic_exp.lte.${thirtyDays.toISOString().split('T')[0]}`),
      // Approaching LFD (within 2 days)
      svc.from('orders')
        .select('id, order_number, last_free_day')
        .eq('tenant_id', ctx.tenantId)
        .is('deleted_at', null)
        .not('status', 'in', '(completed,cancelled)')
        .lte('last_free_day', twoDays.toISOString().split('T')[0])
        .not('last_free_day', 'is', null),
      // Past-due invoices
      svc.from('invoices')
        .select('id, invoice_number, balance_due_cents, due_date')
        .eq('tenant_id', ctx.tenantId)
        .eq('status', 'sent')
        .is('deleted_at', null)
        .lt('due_date', today),
      // Pending doc validations
      svc.from('document_submissions')
        .select('id', { count: 'exact', head: true })
        .eq('tenant_id', ctx.tenantId)
        .eq('status', 'received'),
    ]);

    const alerts = {
      expiring_docs: (driverRes.data || []).length,
      approaching_lfd: (lfdRes.data || []).length,
      past_due_invoices: (overdueRes.data || []).length,
      pending_docs: pendingDocRes.count || 0,
      details: {
        drivers: (driverRes.data || []).slice(0, 5),
        lfd_loads: (lfdRes.data || []).slice(0, 5),
        overdue_invoices: (overdueRes.data || []).slice(0, 5),
      },
    };

    // ── 5. Load Volume Trend (last 8 weeks) ──
    const eightWeeksAgo = new Date();
    eightWeeksAgo.setDate(eightWeeksAgo.getDate() - 56);
    const { data: volumeData } = await svc
      .from('orders')
      .select('id, created_at')
      .eq('tenant_id', ctx.tenantId)
      .is('deleted_at', null)
      .gte('created_at', eightWeeksAgo.toISOString());

    // Group by week
    const weekBuckets = {};
    for (const order of volumeData || []) {
      const d = new Date(order.created_at);
      const weekStart = new Date(d);
      weekStart.setDate(d.getDate() - d.getDay());
      const key = weekStart.toISOString().split('T')[0];
      weekBuckets[key] = (weekBuckets[key] || 0) + 1;
    }
    const loadVolume = Object.entries(weekBuckets)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([week, count]) => ({
        week: new Date(week).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
        count,
      }));

    // ── 6. Driver Utilization ──
    const { data: drivers } = await svc
      .from('drivers')
      .select('id, status')
      .eq('tenant_id', ctx.tenantId)
      .is('deleted_at', null);

    const driverUtil = {
      active: (drivers || []).filter((d) => d.status === 'active').length,
      inactive: (drivers || []).filter((d) => d.status === 'inactive').length,
      on_leave: (drivers || []).filter((d) => d.status === 'on_leave').length,
      total: (drivers || []).length,
    };

    // ── 7. Recent Activity ──
    const { data: activity } = await svc
      .from('tenant_audit_log')
      .select('id, action, entity_type, entity_id, created_at, user:users!user_id(name)')
      .eq('tenant_id', ctx.tenantId)
      .order('created_at', { ascending: false })
      .limit(10);

    return res.status(200).json({
      todaysOps,
      revenue,
      openAR,
      alerts,
      loadVolume,
      driverUtil,
      recentActivity: activity || [],
    });
  } catch (err) {
    console.error('Dashboard API error:', err);
    return res.status(500).json({ error: 'Failed to load dashboard data' });
  }
}
