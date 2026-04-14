import { requireTenantUser, requirePermission, getServiceClient } from '../../../../../lib/tenant-api';
import { logTenantAction, getClientIp } from '../../../../../lib/tenant-audit';
import { PERMISSIONS } from '../../../../../lib/permissions';

export default async function handler(req, res) {
  const ctx = await requireTenantUser(req, res);
  if (!ctx) return;
  if (!requirePermission(ctx, [PERMISSIONS.ACCOUNTS_PAYABLE, PERMISSIONS.ALL], res)) return;
  const { id } = req.query;
  const svc = getServiceClient();

  if (req.method === 'PUT') {
    const body = req.body || {};
    const updates = {};
    if ('name' in body) updates.name = body.name;
    if ('duration_type' in body) updates.duration_type = body.duration_type;
    if ('start_day_of_week' in body) updates.start_day_of_week = body.start_day_of_week;
    if ('is_active' in body) updates.is_active = body.is_active;

    const { data, error } = await svc.from('settlement_periods').update(updates)
      .eq('id', id).eq('tenant_id', ctx.tenantId).select().single();
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ settlement_period: data });
  }

  if (req.method === 'DELETE') {
    await svc.from('settlement_periods').update({ deleted_at: new Date().toISOString() })
      .eq('id', id).eq('tenant_id', ctx.tenantId);
    return res.status(200).json({ success: true });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
