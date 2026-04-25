import {
  requireTenantUser, requirePermission, getServiceClient,
} from '../../../../../lib/tenant-api.js';
import { PERMISSIONS } from '../../../../../lib/permissions.js';
import { logTenantAction, getClientIp } from '../../../../../lib/tenant-audit.js';
import { hashPassword, generateTempPassword } from '../../../../../lib/driver-auth/utils.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'method_not_allowed' });
  }
  const ctx = await requireTenantUser(req, res);
  if (!ctx) return;
  if (!requirePermission(ctx, [PERMISSIONS.DISPATCHING, PERMISSIONS.ALL], res)) return;

  const { id } = req.query;
  const tempPassword = req.body?.temp_password ?? generateTempPassword();

  const svc = getServiceClient();
  const hash = await hashPassword(tempPassword);

  const { error } = await svc
    .from('drivers')
    .update({
      password_hash: hash,
      password_set_at: new Date().toISOString(),
      password_must_change: true,
      session_min_iat: new Date().toISOString(),
    })
    .eq('id', id)
    .eq('tenant_id', ctx.tenantId)
    .is('deleted_at', null);
  if (error) return res.status(500).json({ error: error.message });

  await logTenantAction(svc, {
    tenantId: ctx.tenantId,
    userId: ctx.userId,
    action: 'driver.password_reset',
    entityType: 'driver',
    entityId: id,
    actorType: 'human',
    ipAddress: getClientIp(req),
  });

  return res.status(200).json({ temp_password: tempPassword });
}
