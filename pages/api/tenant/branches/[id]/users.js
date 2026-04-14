import {
  requireTenantUser,
  getServiceClient,
} from '../../../../../lib/tenant-api';
import { logTenantAction, getClientIp } from '../../../../../lib/tenant-audit';
import { hasGranularPermission } from '../../../../../lib/rbac';

/**
 * /api/tenant/branches/[id]/users
 *
 * GET — list users assigned to this branch
 * PUT — replace user assignments { user_ids: [...] }
 */
export default async function handler(req, res) {
  const ctx = await requireTenantUser(req, res);
  if (!ctx) return;

  const { id: branchId } = req.query;
  const svc = getServiceClient();

  // Verify branch exists
  const { data: branch } = await svc
    .from('branches')
    .select('id')
    .eq('id', branchId)
    .eq('tenant_id', ctx.tenantId)
    .is('deleted_at', null)
    .single();

  if (!branch) return res.status(404).json({ error: 'Branch not found' });

  // ── LIST ──
  if (req.method === 'GET') {
    const { data, error } = await svc
      .from('user_branches')
      .select('id, user_id, user:users(id, name, email, role, status)')
      .eq('branch_id', branchId)
      .eq('tenant_id', ctx.tenantId);

    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ users: (data || []).map((r) => r.user).filter(Boolean) });
  }

  // ── REPLACE ASSIGNMENTS (super_admin only) ──
  if (req.method === 'PUT') {
    if (ctx.role !== 'super_admin' && !hasGranularPermission(ctx, 'branches.assign')) {
      return res.status(403).json({ error: 'You do not have permission to assign users to branches' });
    }

    const { user_ids = [] } = req.body || {};

    // Get current assignments for audit
    const { data: existing } = await svc
      .from('user_branches')
      .select('user_id')
      .eq('branch_id', branchId)
      .eq('tenant_id', ctx.tenantId);
    const oldIds = (existing || []).map((r) => r.user_id);

    // Delete current, insert new
    await svc
      .from('user_branches')
      .delete()
      .eq('branch_id', branchId)
      .eq('tenant_id', ctx.tenantId);

    if (user_ids.length > 0) {
      const rows = user_ids.map((uid) => ({
        tenant_id: ctx.tenantId,
        user_id: uid,
        branch_id: branchId,
      }));
      const { error } = await svc.from('user_branches').insert(rows);
      if (error) return res.status(500).json({ error: error.message });
    }

    await logTenantAction(svc, {
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      action: 'branch.assign_users',
      entityType: 'branch',
      entityId: branchId,
      oldValues: { user_ids: oldIds },
      newValues: { user_ids },
      ipAddress: getClientIp(req),
    });

    return res.status(200).json({ success: true, user_ids });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
