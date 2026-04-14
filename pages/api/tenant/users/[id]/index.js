import { requireTenantUser, requirePermission, getServiceClient } from '../../../../../lib/tenant-api';
import { logTenantAction, getClientIp } from '../../../../../lib/tenant-audit';
import { PERMISSIONS } from '../../../../../lib/permissions';

const SELF_EDITABLE = ['name', 'first_name', 'last_name', 'phone', 'avatar_url'];
const ADMIN_EDITABLE = ['name', 'first_name', 'last_name', 'phone', 'age', 'hire_date', 'role', 'system_role', 'granular_permissions', 'status', 'avatar_url'];

export default async function handler(req, res) {
  const ctx = await requireTenantUser(req, res);
  if (!ctx) return;

  const { id } = req.query;
  const svc = getServiceClient();

  const isSelf = id === ctx.userId;
  const canManage = ctx.role === 'super_admin' || ctx.permissions.includes('all') || ctx.permissions.includes('settings');

  if (req.method === 'GET') {
    if (!isSelf && !canManage) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }

    const { data: user, error } = await svc
      .from('users')
      .select('id, email, name, first_name, last_name, phone, age, hire_date, role, system_role, granular_permissions, status, avatar_url, password_change_required, last_login_at, created_at')
      .eq('tenant_id', ctx.tenantId)
      .eq('id', id)
      .is('deleted_at', null)
      .single();

    if (error || !user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const { data: permRows } = await svc
      .from('user_permissions')
      .select('permission_type')
      .eq('tenant_id', ctx.tenantId)
      .eq('user_id', id);

    return res.status(200).json({
      user: { ...user, permissions: (permRows || []).map((p) => p.permission_type) },
    });
  }

  if (req.method === 'PUT') {
    if (!isSelf && !canManage) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }

    // Self-edit: limited fields. Admin edit: full fields.
    const allowedFields = isSelf && !canManage ? SELF_EDITABLE : ADMIN_EDITABLE;

    const updates = {};
    for (const field of allowedFields) {
      if (req.body[field] !== undefined) {
        updates[field] = req.body[field];
      }
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: 'No valid fields to update' });
    }

    // Prevent self-demotion from super_admin
    if (isSelf && updates.role && updates.role !== 'super_admin' && ctx.role === 'super_admin') {
      delete updates.role;
    }

    const { data: oldUser } = await svc
      .from('users')
      .select('*')
      .eq('tenant_id', ctx.tenantId)
      .eq('id', id)
      .single();

    if (!oldUser) {
      return res.status(404).json({ error: 'User not found' });
    }

    const { data: updated, error } = await svc
      .from('users')
      .update(updates)
      .eq('tenant_id', ctx.tenantId)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    await logTenantAction(svc, {
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      action: 'user.update',
      entityType: 'user',
      entityId: id,
      oldValues: oldUser,
      newValues: updated,
      ipAddress: getClientIp(req),
    });

    return res.status(200).json({ user: updated });
  }

  if (req.method === 'DELETE') {
    if (!requirePermission(ctx, [PERMISSIONS.SETTINGS, PERMISSIONS.ALL], res)) return;
    if (isSelf) {
      return res.status(400).json({ error: "You can't delete your own account" });
    }

    const { error } = await svc
      .from('users')
      .update({ deleted_at: new Date().toISOString(), status: 'disabled' })
      .eq('tenant_id', ctx.tenantId)
      .eq('id', id);

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    await logTenantAction(svc, {
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      action: 'user.delete',
      entityType: 'user',
      entityId: id,
      ipAddress: getClientIp(req),
    });

    return res.status(200).json({ success: true });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
