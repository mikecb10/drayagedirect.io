import {
  requireTenantUser,
  getServiceClient,
} from '../../../../../lib/tenant-api';
import { logTenantAction, getClientIp } from '../../../../../lib/tenant-audit';
import { hasGranularPermission } from '../../../../../lib/rbac';

/**
 * /api/tenant/branches/[id]/customers
 *
 * GET — list customers assigned to this branch
 * PUT — replace customer assignments { customer_ids: [...] }
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
      .from('customer_branches')
      .select('id, customer_id, customer:customers(id, name, customer_types, city, state, status)')
      .eq('branch_id', branchId)
      .eq('tenant_id', ctx.tenantId);

    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ customers: (data || []).map((r) => r.customer).filter(Boolean) });
  }

  // ── REPLACE ASSIGNMENTS (super_admin only) ──
  if (req.method === 'PUT') {
    if (ctx.role !== 'super_admin' && !hasGranularPermission(ctx, 'branches.assign')) {
      return res.status(403).json({ error: 'You do not have permission to assign customers to branches' });
    }

    const { customer_ids = [] } = req.body || {};

    // Get current for audit
    const { data: existing } = await svc
      .from('customer_branches')
      .select('customer_id')
      .eq('branch_id', branchId)
      .eq('tenant_id', ctx.tenantId);
    const oldIds = (existing || []).map((r) => r.customer_id);

    // Delete current, insert new
    await svc
      .from('customer_branches')
      .delete()
      .eq('branch_id', branchId)
      .eq('tenant_id', ctx.tenantId);

    if (customer_ids.length > 0) {
      const rows = customer_ids.map((cid) => ({
        tenant_id: ctx.tenantId,
        customer_id: cid,
        branch_id: branchId,
      }));
      const { error } = await svc.from('customer_branches').insert(rows);
      if (error) return res.status(500).json({ error: error.message });
    }

    await logTenantAction(svc, {
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      action: 'branch.assign_customers',
      entityType: 'branch',
      entityId: branchId,
      oldValues: { customer_ids: oldIds },
      newValues: { customer_ids },
      ipAddress: getClientIp(req),
    });

    return res.status(200).json({ success: true, customer_ids });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
