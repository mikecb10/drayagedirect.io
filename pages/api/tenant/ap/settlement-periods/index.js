import { requireTenantUser, requirePermission, getServiceClient } from '../../../../../lib/tenant-api';
import { logTenantAction, getClientIp } from '../../../../../lib/tenant-audit';
import { PERMISSIONS } from '../../../../../lib/permissions';

const DURATION_TYPES = ['daily', 'weekly', 'biweekly', 'bimonthly', 'monthly', 'custom'];

export default async function handler(req, res) {
  const ctx = await requireTenantUser(req, res);
  if (!ctx) return;
  if (!requirePermission(ctx, [PERMISSIONS.ACCOUNTS_PAYABLE, PERMISSIONS.ALL], res)) return;
  const svc = getServiceClient();

  if (req.method === 'GET') {
    const { data, error } = await svc
      .from('settlement_periods')
      .select('*')
      .eq('tenant_id', ctx.tenantId)
      .is('deleted_at', null)
      .order('name');
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ settlement_periods: data || [] });
  }

  if (req.method === 'POST') {
    const { name, duration_type, start_day_of_week } = req.body || {};
    if (!name) return res.status(400).json({ error: 'Name is required' });
    if (!DURATION_TYPES.includes(duration_type)) return res.status(400).json({ error: 'Invalid duration type' });

    const { data, error } = await svc
      .from('settlement_periods')
      .insert({
        tenant_id: ctx.tenantId,
        name,
        duration_type,
        start_day_of_week: start_day_of_week ?? 0,
      })
      .select()
      .single();
    if (error) return res.status(500).json({ error: error.message });

    await logTenantAction(svc, {
      tenantId: ctx.tenantId, userId: ctx.userId,
      action: 'settlement_period.create', entityType: 'settlement_period', entityId: data.id,
      newValues: data, ipAddress: getClientIp(req),
    });
    return res.status(201).json({ settlement_period: data });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
