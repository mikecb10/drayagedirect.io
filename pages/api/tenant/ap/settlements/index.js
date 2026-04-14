import { requireTenantUser, requirePermission, getServiceClient } from '../../../../../lib/tenant-api';
import { logTenantAction, getClientIp } from '../../../../../lib/tenant-audit';
import { PERMISSIONS } from '../../../../../lib/permissions';

/**
 * /api/tenant/ap/settlements
 *
 * GET  — list settlements with filters
 * POST — generate settlements for a date range (creates one per driver with approved pay lines)
 */
export default async function handler(req, res) {
  const ctx = await requireTenantUser(req, res);
  if (!ctx) return;
  if (!requirePermission(ctx, [PERMISSIONS.ACCOUNTS_PAYABLE, PERMISSIONS.ALL], res)) return;
  const svc = getServiceClient();

  if (req.method === 'GET') {
    const { status, driver_id, period_start, period_end, settlement_period_id } = req.query;

    let query = svc
      .from('driver_settlements')
      .select(`
        *,
        driver:drivers(id, name, first_name, last_name, truck_number),
        group:driver_groups(id, name),
        period:settlement_periods(id, name, duration_type),
        lines:driver_settlement_lines(id, driver_pay_line_id),
        deductions:driver_settlement_deductions(id, amount_cents, status, description,
          deduction_type:deduction_types(id, name)
        )
      `)
      .eq('tenant_id', ctx.tenantId)
      .order('created_at', { ascending: false });

    if (status) query = query.eq('status', status);
    if (driver_id) query = query.eq('driver_id', driver_id);
    if (settlement_period_id) query = query.eq('settlement_period_id', settlement_period_id);
    if (period_start) query = query.gte('period_start', period_start);
    if (period_end) query = query.lte('period_end', period_end);

    const { data, error } = await query;
    if (error) return res.status(500).json({ error: error.message });

    const settlements = data || [];
    const stats = {
      pending: settlements.filter((s) => s.status === 'pending').length,
      reviewed: settlements.filter((s) => s.status === 'reviewed').length,
      finalized: settlements.filter((s) => s.status === 'finalized').length,
      total: settlements.length,
    };

    return res.status(200).json({ settlements, stats });
  }

  if (req.method === 'POST') {
    const { period_start, period_end, settlement_period_id, driver_group_id } = req.body || {};
    if (!period_start || !period_end) {
      return res.status(400).json({ error: 'Period start and end dates are required' });
    }

    // Find approved/reviewed pay lines in the date range not yet in a settlement
    let payQuery = svc
      .from('order_driver_pay_lines')
      .select('id, driver_id, amount_cents, worked_at')
      .eq('tenant_id', ctx.tenantId)
      .in('status', ['approved', 'reviewed', 'finalized'])
      .gte('worked_at', period_start)
      .lte('worked_at', period_end + 'T23:59:59');

    const { data: payLines } = await payQuery;

    // Filter out lines already in a settlement
    const { data: existingLines } = await svc
      .from('driver_settlement_lines')
      .select('driver_pay_line_id')
      .eq('tenant_id', ctx.tenantId);
    const usedLineIds = new Set((existingLines || []).map((r) => r.driver_pay_line_id));
    const availableLines = (payLines || []).filter((l) => !usedLineIds.has(l.id));

    // Group by driver
    const byDriver = {};
    for (const line of availableLines) {
      if (!byDriver[line.driver_id]) byDriver[line.driver_id] = [];
      byDriver[line.driver_id].push(line);
    }

    // If driver_group_id is provided, filter to only drivers in that group
    if (driver_group_id) {
      const { data: members } = await svc
        .from('driver_group_members')
        .select('driver_id')
        .eq('driver_group_id', driver_group_id)
        .eq('tenant_id', ctx.tenantId);
      const memberSet = new Set((members || []).map((m) => m.driver_id));
      for (const did of Object.keys(byDriver)) {
        if (!memberSet.has(did)) delete byDriver[did];
      }
    }

    // Generate settlement number prefix
    const { count: existingCount } = await svc
      .from('driver_settlements')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', ctx.tenantId);
    let seq = (existingCount || 0) + 1;

    const created = [];
    for (const [driverId, lines] of Object.entries(byDriver)) {
      if (lines.length === 0) continue;

      const driverPayCents = lines.reduce((s, l) => s + (l.amount_cents || 0), 0);

      // Get recurring deductions for this driver
      const { data: recurringDeds } = await svc
        .from('driver_deductions')
        .select('*, deduction_type:deduction_types(id, name)')
        .eq('driver_id', driverId)
        .eq('tenant_id', ctx.tenantId)
        .eq('is_enabled', true)
        .eq('is_recurring', true)
        .is('deleted_at', null);

      const deductionCents = (recurringDeds || []).reduce((s, d) => s + (d.amount_cents || 0), 0);

      const settlementNumber = `STL-${String(seq++).padStart(6, '0')}`;

      // Create settlement
      const { data: settlement, error: settError } = await svc
        .from('driver_settlements')
        .insert({
          tenant_id: ctx.tenantId,
          settlement_number: settlementNumber,
          driver_id: driverId,
          driver_group_id: driver_group_id || null,
          settlement_period_id: settlement_period_id || null,
          period_start,
          period_end,
          driver_pay_cents: driverPayCents,
          deduction_cents: deductionCents,
          net_pay_cents: driverPayCents - deductionCents,
          status: 'pending',
        })
        .select().single();

      if (settError) continue;

      // Link pay lines
      await svc.from('driver_settlement_lines').insert(
        lines.map((l) => ({
          tenant_id: ctx.tenantId,
          settlement_id: settlement.id,
          driver_pay_line_id: l.id,
        }))
      );

      // Create applied deductions from recurring configs
      if (recurringDeds?.length) {
        await svc.from('driver_settlement_deductions').insert(
          recurringDeds.map((d) => ({
            tenant_id: ctx.tenantId,
            settlement_id: settlement.id,
            deduction_type_id: d.deduction_type_id,
            driver_deduction_id: d.id,
            description: d.deduction_type?.name || d.description || 'Deduction',
            amount_cents: d.amount_cents,
            status: 'unapproved',
          }))
        );
      }

      created.push(settlement);
    }

    await logTenantAction(svc, {
      tenantId: ctx.tenantId, userId: ctx.userId,
      action: 'settlement.generate', entityType: 'settlement',
      newValues: { count: created.length, period_start, period_end },
      ipAddress: getClientIp(req),
    });

    return res.status(201).json({ settlements: created, count: created.length });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
