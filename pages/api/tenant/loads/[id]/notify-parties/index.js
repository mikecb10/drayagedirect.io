import {
  requireTenantUser,
  requirePermission,
  getServiceClient,
} from '../../../../../../lib/tenant-api';
import { PERMISSIONS } from '../../../../../../lib/permissions';
import { listLoadNotifyParties } from '../../../../../../lib/load-notify-parties-hydrator';

// Re-export the pure helper so tests can import it from this module
export { listLoadNotifyParties };

export default async function handler(req, res) {
  const ctx = await requireTenantUser(req, res);
  if (!ctx) return;
  if (!requirePermission(ctx, [PERMISSIONS.DISPATCHING, PERMISSIONS.ORDER_ENTRY, PERMISSIONS.ALL], res)) return;

  const svc = getServiceClient();
  const loadId = req.query.id;

  // Verify load exists and belongs to tenant
  const { data: load } = await svc
    .from('orders')
    .select('id')
    .eq('id', loadId)
    .eq('tenant_id', ctx.tenantId)
    .is('deleted_at', null)
    .maybeSingle();
  if (!load) return res.status(404).json({ error: 'Load not found' });

  if (req.method === 'GET') {
    const result = await listLoadNotifyParties(svc, ctx, loadId);
    return res.status(200).json(result);
  }

  // POST handler comes in Task 4

  return res.status(405).json({ error: 'Method not allowed' });
}
