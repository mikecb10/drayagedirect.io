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
    const { name, settlement_period_id, member_ids } = req.body || {};
    const updates = {};
    if ('name' in req.body) updates.name = name;
    if ('settlement_period_id' in req.body) updates.settlement_period_id = settlement_period_id || null;

    if (Object.keys(updates).length > 0) {
      const { error } = await svc.from('driver_groups').update(updates)
        .eq('id', id).eq('tenant_id', ctx.tenantId);
      if (error) return res.status(500).json({ error: error.message });
    }

    // Sync members if provided
    if (Array.isArray(member_ids)) {
      await svc.from('driver_group_members').delete()
        .eq('driver_group_id', id).eq('tenant_id', ctx.tenantId);
      if (member_ids.length > 0) {
        await svc.from('driver_group_members').insert(
          member_ids.map((did) => ({
            tenant_id: ctx.tenantId,
            driver_group_id: id,
            driver_id: did,
          }))
        );
      }
    }

    await logTenantAction(svc, {
      tenantId: ctx.tenantId, userId: ctx.userId,
      action: 'driver_group.update', entityType: 'driver_group', entityId: id,
      newValues: { ...updates, member_ids }, ipAddress: getClientIp(req),
    });
    return res.status(200).json({ success: true });
  }

  if (req.method === 'DELETE') {
    await svc.from('driver_group_members').delete().eq('driver_group_id', id).eq('tenant_id', ctx.tenantId);
    await svc.from('driver_groups').update({ deleted_at: new Date().toISOString() })
      .eq('id', id).eq('tenant_id', ctx.tenantId);
    return res.status(200).json({ success: true });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
