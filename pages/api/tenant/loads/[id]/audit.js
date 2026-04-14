import {
  requireTenantUser,
  requirePermission,
  getServiceClient,
} from '../../../../../lib/tenant-api';
import { PERMISSIONS } from '../../../../../lib/permissions';

export default async function handler(req, res) {
  const ctx = await requireTenantUser(req, res);
  if (!ctx) return;

  const { id } = req.query;
  const svc = getServiceClient();

  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  if (
    !requirePermission(
      ctx,
      [PERMISSIONS.DISPATCHING, PERMISSIONS.ORDER_ENTRY, PERMISSIONS.ALL],
      res
    )
  )
    return;

  const { data, error } = await svc
    .from('tenant_audit_log')
    .select('*, user:users(id, name, email)')
    .eq('tenant_id', ctx.tenantId)
    .eq('entity_type', 'order')
    .eq('entity_id', id)
    .order('created_at', { ascending: false })
    .limit(200);

  if (error) return res.status(500).json({ error: error.message });

  return res.status(200).json({ events: data || [] });
}
