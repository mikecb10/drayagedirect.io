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
      .from('deduction_types')
      .select('*')
      .eq('tenant_id', ctx.tenantId)
      .is('deleted_at', null)
      .order('name');
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ deduction_types: data || [] });
  }

  if (req.method === 'POST') {
    const { name, description } = req.body || {};
    if (!name) return res.status(400).json({ error: 'Name is required' });

    const { data, error } = await svc
      .from('deduction_types')
      .insert({ tenant_id: ctx.tenantId, name, description: description || null })
      .select().single();
    if (error) return res.status(500).json({ error: error.message });

    await logTenantAction(svc, {
      tenantId: ctx.tenantId, userId: ctx.userId,
      action: 'deduction_type.create', entityType: 'deduction_type', entityId: data.id,
      newValues: data, ipAddress: getClientIp(req),
    });
    return res.status(201).json({ deduction_type: data });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
