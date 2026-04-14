import {
  requireTenantUser,
  requirePermission,
  getServiceClient,
} from '../../../../lib/tenant-api';
import { PERMISSIONS } from '../../../../lib/permissions';

/**
 * /api/tenant/ar/aging
 *
 * GET — compute AR aging report: 0-30, 31-60, 61-90, 90+ grouped by customer
 */
export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const ctx = await requireTenantUser(req, res);
  if (!ctx) return;
  if (!requirePermission(ctx, [PERMISSIONS.ACCOUNTS_RECEIVABLE, PERMISSIONS.ALL], res)) return;

  const svc = getServiceClient();

  // Fetch all open invoices (sent or overdue, not deleted)
  const { data: invoices, error } = await svc
    .from('invoices')
    .select('id, invoice_number, customer_id, due_date, balance_due_cents, total_amount_cents, status, created_at')
    .eq('tenant_id', ctx.tenantId)
    .in('status', ['sent', 'overdue'])
    .is('deleted_at', null)
    .gt('balance_due_cents', 0)
    .order('due_date', { ascending: true });

  if (error) return res.status(500).json({ error: error.message });

  // Fetch customer names
  const customerIds = [...new Set((invoices || []).map((i) => i.customer_id))];
  let customerMap = {};
  if (customerIds.length > 0) {
    const { data: customers } = await svc
      .from('customers')
      .select('id, name')
      .in('id', customerIds);
    for (const c of customers || []) {
      customerMap[c.id] = c.name;
    }
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // Compute buckets per customer
  const byCustomer = {};
  const totals = { current: 0, '1_30': 0, '31_60': 0, '61_90': 0, '90_plus': 0, total: 0 };

  for (const inv of invoices || []) {
    const due = new Date(inv.due_date);
    due.setHours(0, 0, 0, 0);
    const daysOverdue = Math.floor((today - due) / (1000 * 60 * 60 * 24));
    const balance = inv.balance_due_cents || 0;

    let bucket;
    if (daysOverdue <= 0) bucket = 'current';
    else if (daysOverdue <= 30) bucket = '1_30';
    else if (daysOverdue <= 60) bucket = '31_60';
    else if (daysOverdue <= 90) bucket = '61_90';
    else bucket = '90_plus';

    // Customer grouping
    if (!byCustomer[inv.customer_id]) {
      byCustomer[inv.customer_id] = {
        customer_id: inv.customer_id,
        customer_name: customerMap[inv.customer_id] || 'Unknown',
        current: 0,
        '1_30': 0,
        '31_60': 0,
        '61_90': 0,
        '90_plus': 0,
        total: 0,
        invoices: [],
      };
    }

    byCustomer[inv.customer_id][bucket] += balance;
    byCustomer[inv.customer_id].total += balance;
    byCustomer[inv.customer_id].invoices.push({
      id: inv.id,
      invoice_number: inv.invoice_number,
      due_date: inv.due_date,
      balance_due_cents: balance,
      total_amount_cents: inv.total_amount_cents,
      days_overdue: Math.max(0, daysOverdue),
      bucket,
    });

    totals[bucket] += balance;
    totals.total += balance;
  }

  // Sort by total descending
  const customers = Object.values(byCustomer).sort((a, b) => b.total - a.total);

  return res.status(200).json({ customers, totals });
}
