import { requireTenantUser, requirePermission, getServiceClient } from '../../../../../../../lib/tenant-api';
import { PERMISSIONS } from '../../../../../../../lib/permissions';

export default async function handler(req, res) {
  const ctx = await requireTenantUser(req, res);
  if (!ctx) return;
  if (!requirePermission(ctx, [PERMISSIONS.ORDER_ENTRY, PERMISSIONS.ALL], res)) return;

  const { id, groupId } = req.query;
  const svc = getServiceClient();

  if (req.method === 'PUT') {
    const { name, description } = req.body || {};
    const updates = {};
    if (name !== undefined) updates.name = name;
    if (description !== undefined) updates.description = description;
    updates.updated_at = new Date().toISOString();

    const { data, error } = await svc.from('organization_groups').update(updates)
      .eq('tenant_id', ctx.tenantId).eq('organization_id', id).eq('id', groupId).select().single();
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ group: data });
  }

  if (req.method === 'DELETE') {
    const { error } = await svc.from('organization_groups').delete()
      .eq('tenant_id', ctx.tenantId).eq('organization_id', id).eq('id', groupId);
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ success: true });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
