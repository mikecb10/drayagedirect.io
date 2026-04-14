import { requireTenantUser, requirePermission, getServiceClient } from '../../../../../lib/tenant-api';
import { logTenantAction, getClientIp } from '../../../../../lib/tenant-audit';
import { PERMISSIONS } from '../../../../../lib/permissions';

export default async function handler(req, res) {
  const ctx = await requireTenantUser(req, res);
  if (!ctx) return;
  if (!requirePermission(ctx, [PERMISSIONS.ACCOUNTS_PAYABLE, PERMISSIONS.ALL], res)) return;
  const svc = getServiceClient();

  if (req.method === 'GET') {
    const { data, error } = await svc
      .from('driver_groups')
      .select(`
        *,
        settlement_period:settlement_periods(id, name, duration_type),
        members:driver_group_members(id, driver_id, driver:drivers(id, name, first_name, last_name))
      `)
      .eq('tenant_id', ctx.tenantId)
      .is('deleted_at', null)
      .order('name');
    if (error) return res.status(500).json({ error: error.message });

    const groups = (data || []).map((g) => ({
      ...g,
      member_count: (g.members || []).length,
      drivers: (g.members || []).map((m) => m.driver).filter(Boolean),
    }));
    return res.status(200).json({ driver_groups: groups });
  }

  if (req.method === 'POST') {
    const { name, settlement_period_id, member_ids = [] } = req.body || {};
    if (!name) return res.status(400).json({ error: 'Group name is required' });

    const { data, error } = await svc
      .from('driver_groups')
      .insert({
        tenant_id: ctx.tenantId,
        name,
        settlement_period_id: settlement_period_id || null,
      })
      .select().single();
    if (error) return res.status(500).json({ error: error.message });

    // Add members
    if (member_ids.length > 0) {
      await svc.from('driver_group_members').insert(
        member_ids.map((did) => ({
          tenant_id: ctx.tenantId,
          driver_group_id: data.id,
          driver_id: did,
        }))
      );
    }

    await logTenantAction(svc, {
      tenantId: ctx.tenantId, userId: ctx.userId,
      action: 'driver_group.create', entityType: 'driver_group', entityId: data.id,
      newValues: { name, member_count: member_ids.length }, ipAddress: getClientIp(req),
    });
    return res.status(201).json({ driver_group: data });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
