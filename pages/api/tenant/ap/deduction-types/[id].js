import { requireTenantUser, requirePermission, getServiceClient } from '../../../../../lib/tenant-api';
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
    if ('description' in body) updates.description = body.description;
    if ('is_active' in body) updates.is_active = body.is_active;

    const { data, error } = await svc.from('deduction_types').update(updates)
      .eq('id', id).eq('tenant_id', ctx.tenantId).select().single();
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ deduction_type: data });
  }

  if (req.method === 'DELETE') {
    await svc.from('deduction_types').update({ deleted_at: new Date().toISOString() })
      .eq('id', id).eq('tenant_id', ctx.tenantId);
    return res.status(200).json({ success: true });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
