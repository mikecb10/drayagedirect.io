import {
  requireTenantUser,
  requirePermission,
  getServiceClient,
} from '../../../../../../lib/tenant-api';
import { logTenantAction, getClientIp } from '../../../../../../lib/tenant-audit';
import { PERMISSIONS } from '../../../../../../lib/permissions';

const VALID_STATUSES = ['drafted', 'unapproved', 'approved', 'reviewed', 'finalized'];
const EDITABLE_FIELDS = [
  'driver_id',
  'line_type',
  'description',
  'from_location',
  'to_location',
  'amount_cents',
  'hours',
  'miles',
  'worked_at',
  'notes',
  'status',
];

export default async function handler(req, res) {
  const ctx = await requireTenantUser(req, res);
  if (!ctx) return;

  const { id, lineId } = req.query;
  const svc = getServiceClient();

  if (req.method === 'PUT') {
    if (
      !requirePermission(
        ctx,
        [PERMISSIONS.DISPATCHING, PERMISSIONS.ACCOUNTS_PAYABLE, PERMISSIONS.ALL],
        res
      )
    )
      return;

    // Fetch old values for audit diff
    const { data: oldLine } = await svc
      .from('order_driver_pay_lines')
      .select('*')
      .eq('id', lineId)
      .maybeSingle();

    const updates = {};
    for (const f of EDITABLE_FIELDS) {
      if (req.body[f] !== undefined) updates[f] = req.body[f];
    }
    if (updates.status && !VALID_STATUSES.includes(updates.status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }

    const { data, error } = await svc
      .from('order_driver_pay_lines')
      .update(updates)
      .eq('tenant_id', ctx.tenantId)
      .eq('order_id', id)
      .eq('id', lineId)
      .select(`*, driver:drivers(id, first_name, last_name, name)`)
      .single();

    if (error) return res.status(500).json({ error: error.message });

    await logTenantAction(svc, {
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      action: 'load.driver_pay_update',
      entityType: 'order',
      entityId: id,
      oldValues: oldLine,
      newValues: { ...updates, line_type: data.line_type, amount_cents: data.amount_cents },
      ipAddress: getClientIp(req),
    });

    return res.status(200).json({ line: data });
  }

  if (req.method === 'DELETE') {
    if (
      !requirePermission(
        ctx,
        [PERMISSIONS.DISPATCHING, PERMISSIONS.ACCOUNTS_PAYABLE, PERMISSIONS.ALL],
        res
      )
    )
      return;

    // Fetch for audit before deleting
    const { data: oldLine } = await svc
      .from('order_driver_pay_lines')
      .select('line_type, amount_cents, description')
      .eq('id', lineId)
      .maybeSingle();

    const { error } = await svc
      .from('order_driver_pay_lines')
      .delete()
      .eq('tenant_id', ctx.tenantId)
      .eq('order_id', id)
      .eq('id', lineId);

    if (error) return res.status(500).json({ error: error.message });

    await logTenantAction(svc, {
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      action: 'load.driver_pay_delete',
      entityType: 'order',
      entityId: id,
      newValues: oldLine || { line_id: lineId },
      ipAddress: getClientIp(req),
    });

    return res.status(200).json({ success: true });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
