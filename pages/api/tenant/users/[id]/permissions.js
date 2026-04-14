import { requireTenantUser, requirePermission, getServiceClient } from '../../../../../lib/tenant-api';
import { logTenantAction, getClientIp } from '../../../../../lib/tenant-audit';
import { PERMISSIONS } from '../../../../../lib/permissions';

const VALID_PERMISSIONS = [
  'order_entry',
  'dispatching',
  'accounts_payable',
  'accounts_receivable',
  'reporting',
  'settings',
  'all',
];

export default async function handler(req, res) {
  const ctx = await requireTenantUser(req, res);
  if (!ctx) return;

  const { id } = req.query;
  const svc = getServiceClient();

  if (req.method === 'GET') {
    const { data, error } = await svc
      .from('user_permissions')
      .select('permission_type')
      .eq('tenant_id', ctx.tenantId)
      .eq('user_id', id);

    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ permissions: (data || []).map((r) => r.permission_type) });
  }

  if (req.method === 'PUT') {
    if (!requirePermission(ctx, [PERMISSIONS.SETTINGS, PERMISSIONS.ALL], res)) return;

    const { permissions = [] } = req.body;

    const filtered = permissions.filter((p) => VALID_PERMISSIONS.includes(p));

    // Verify the target user exists in this tenant
    const { data: targetUser } = await svc
      .from('users')
      .select('id')
      .eq('tenant_id', ctx.tenantId)
      .eq('id', id)
      .is('deleted_at', null)
      .single();

    if (!targetUser) {
      return res.status(404).json({ error: 'User not found' });
    }

    const { data: oldPerms } = await svc
      .from('user_permissions')
      .select('permission_type')
      .eq('tenant_id', ctx.tenantId)
      .eq('user_id', id);

    // Replace permissions: delete all, reinsert
    await svc
      .from('user_permissions')
      .delete()
      .eq('tenant_id', ctx.tenantId)
      .eq('user_id', id);

    if (filtered.length > 0) {
      const rows = filtered.map((p) => ({
        tenant_id: ctx.tenantId,
        user_id: id,
        permission_type: p,
        granted_by: ctx.userId,
      }));
      const { error: insertError } = await svc.from('user_permissions').insert(rows);
      if (insertError) {
        return res.status(500).json({ error: insertError.message });
      }
    }

    await logTenantAction(svc, {
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      action: 'user.permissions.update',
      entityType: 'user',
      entityId: id,
      oldValues: { permissions: (oldPerms || []).map((p) => p.permission_type) },
      newValues: { permissions: filtered },
      ipAddress: getClientIp(req),
    });

    return res.status(200).json({ permissions: filtered });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
