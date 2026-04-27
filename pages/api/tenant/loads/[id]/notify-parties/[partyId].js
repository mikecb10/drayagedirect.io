import {
  requireTenantUser,
  requirePermission,
  getServiceClient,
} from '../../../../../../lib/tenant-api';
import { logTenantAction, getClientIp } from '../../../../../../lib/tenant-audit';
import { PERMISSIONS } from '../../../../../../lib/permissions';
import { removeLoadNotifyParty } from '../../../../../../lib/load-notify-parties-hydrator';

export { removeLoadNotifyParty };

export default async function handler(req, res) {
  const ctx = await requireTenantUser(req, res);
  if (!ctx) return;

  const svc = getServiceClient();
  const loadId = req.query.id;
  const partyId = req.query.partyId;

  // Verify load exists, belongs to tenant, and is not soft-deleted
  const { data: load } = await svc
    .from('orders')
    .select('id')
    .eq('id', loadId)
    .eq('tenant_id', ctx.tenantId)
    .is('deleted_at', null)
    .maybeSingle();
  if (!load) return res.status(404).json({ error: 'Load not found' });

  if (req.method === 'DELETE') {
    if (!requirePermission(ctx, [PERMISSIONS.ORDER_ENTRY, PERMISSIONS.ALL], res)) return;
    try {
      const result = await removeLoadNotifyParty(svc, ctx, loadId, partyId, getClientIp(req), logTenantAction);
      return res.status(200).json(result);
    } catch (e) {
      return res.status(e.statusCode || 500).json({ error: e.message });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
