import {
  requireTenantUser, requirePermission, getServiceClient,
} from '../../../../../lib/tenant-api.js';
import { PERMISSIONS } from '../../../../../lib/permissions.js';
import { logTenantAction, getClientIp } from '../../../../../lib/tenant-audit.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'method_not_allowed' });
  }
  const ctx = await requireTenantUser(req, res);
  if (!ctx) return;
  if (!requirePermission(ctx, [PERMISSIONS.DISPATCHING, PERMISSIONS.ALL], res)) return;

  const { id } = req.query;
  const svc = getServiceClient();

  const { error } = await svc
    .from('drivers')
    .update({ session_min_iat: new Date().toISOString() })
    .eq('id', id)
    .eq('tenant_id', ctx.tenantId)
    .is('deleted_at', null);
  if (error) return res.status(500).json({ error: error.message });

  await logTenantAction(svc, {
    tenantId: ctx.tenantId,
    userId: ctx.userId,
    action: 'driver.session_killed',
    entityType: 'driver',
    entityId: id,
    actorType: 'human',
    ipAddress: getClientIp(req),
  });

  return res.status(204).end();
}
