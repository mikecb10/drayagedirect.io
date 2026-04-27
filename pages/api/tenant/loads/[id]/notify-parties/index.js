import {
  requireTenantUser,
  requirePermission,
  getServiceClient,
} from '../../../../../../lib/tenant-api';
import { logTenantAction, getClientIp } from '../../../../../../lib/tenant-audit';
import { PERMISSIONS } from '../../../../../../lib/permissions';
import { listLoadNotifyParties, addLoadNotifyParty } from '../../../../../../lib/load-notify-parties-hydrator';

// Re-export the pure helpers so tests can import them from this module
export { listLoadNotifyParties, addLoadNotifyParty };

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

  if (req.method === 'POST') {
    if (!requirePermission(ctx, [PERMISSIONS.ORDER_ENTRY, PERMISSIONS.ALL], res)) return;
    try {
      const result = await addLoadNotifyParty(svc, ctx, loadId, req.body, getClientIp(req), logTenantAction);
      return res.status(201).json(result);
    } catch (e) {
      return res.status(e.statusCode || 500).json({ error: e.message });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
