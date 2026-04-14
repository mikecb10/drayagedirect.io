import { requireTenantUser, requirePermission, getServiceClient } from '../../../../../../lib/tenant-api';
import { logTenantAction, getClientIp } from '../../../../../../lib/tenant-audit';
import { PERMISSIONS } from '../../../../../../lib/permissions';

/**
 * /api/tenant/ap/settlements/[id]
 *
 * GET — single settlement with lines + deductions
 * PUT — update status (pending→reviewed→finalized)
 */
export default async function handler(req, res) {
  const ctx = await requireTenantUser(req, res);
  if (!ctx) return;
  if (!requirePermission(ctx, [PERMISSIONS.ACCOUNTS_PAYABLE, PERMISSIONS.ALL], res)) return;
  const { id } = req.query;
  const svc = getServiceClient();

  if (req.method === 'GET') {
    const { data, error } = await svc
      .from('driver_settlements')
      .select(`
        *,
        driver:drivers(id, name, first_name, last_name, truck_number),
        lines:driver_settlement_lines(id,
          pay_line:order_driver_pay_lines(id, line_type, description, amount_cents, from_location, to_location, worked_at, status,
            order:orders(id, order_number, container_number)
          )
        ),
        deductions:driver_settlement_deductions(id, amount_cents, description, status,
          deduction_type:deduction_types(id, name)
        )
      `)
      .eq('id', id)
      .eq('tenant_id', ctx.tenantId)
      .single();

    if (error || !data) return res.status(404).json({ error: 'Settlement not found' });
    return res.status(200).json({ settlement: data });
  }

  if (req.method === 'PUT') {
    const { status } = req.body || {};

    const { data: existing } = await svc
      .from('driver_settlements')
      .select('*')
      .eq('id', id).eq('tenant_id', ctx.tenantId).single();
    if (!existing) return res.status(404).json({ error: 'Settlement not found' });

    if (existing.status === 'finalized') {
      return res.status(400).json({ error: 'Cannot modify a finalized settlement' });
    }

    const updates = {};
    if (status === 'reviewed') {
      updates.status = 'reviewed';
    } else if (status === 'finalized') {
      // Recompute totals before finalizing
      const { data: lines } = await svc
        .from('driver_settlement_lines')
        .select('pay_line:order_driver_pay_lines(amount_cents)')
        .eq('settlement_id', id).eq('tenant_id', ctx.tenantId);
      const payTotal = (lines || []).reduce((s, l) => s + (l.pay_line?.amount_cents || 0), 0);

      const { data: deds } = await svc
        .from('driver_settlement_deductions')
        .select('amount_cents')
        .eq('settlement_id', id).eq('tenant_id', ctx.tenantId);
      const dedTotal = (deds || []).reduce((s, d) => s + (d.amount_cents || 0), 0);

      updates.status = 'finalized';
      updates.driver_pay_cents = payTotal;
      updates.deduction_cents = dedTotal;
      updates.net_pay_cents = payTotal - dedTotal;
      updates.finalized_at = new Date().toISOString();
      updates.finalized_by = ctx.userId;

      // Also finalize all deductions in this settlement
      await svc.from('driver_settlement_deductions')
        .update({ status: 'finalized' })
        .eq('settlement_id', id).eq('tenant_id', ctx.tenantId);
    } else {
      return res.status(400).json({ error: 'Invalid status. Use "reviewed" or "finalized".' });
    }

    const { data, error } = await svc.from('driver_settlements')
      .update(updates).eq('id', id).eq('tenant_id', ctx.tenantId)
      .select().single();
    if (error) return res.status(500).json({ error: error.message });

    await logTenantAction(svc, {
      tenantId: ctx.tenantId, userId: ctx.userId,
      action: `settlement.${status}`, entityType: 'settlement', entityId: id,
      oldValues: { status: existing.status }, newValues: { status },
      ipAddress: getClientIp(req),
    });

    return res.status(200).json({ settlement: data });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
