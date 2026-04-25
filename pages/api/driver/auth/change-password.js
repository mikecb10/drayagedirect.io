// pages/api/driver/auth/change-password.js
/**
 * POST /api/driver/auth/change-password
 * Body: { old_password, new_password }
 * Auth: requireDriver
 * Returns: 204
 *
 * Sets password_set_at, clears password_must_change, bumps session_min_iat
 * (invalidates the current JWT — client must log in again with new pwd).
 */

import { requireDriver } from '../../../../lib/driver-auth/middleware.js';
import { getServiceClient } from '../../../../lib/tenant-api.js';
import { verifyPassword, hashPassword } from '../../../../lib/driver-auth/utils.js';
import { logTenantAction, getClientIp } from '../../../../lib/tenant-audit.js';

const MIN_LENGTH = 8;

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'method_not_allowed' });
  }
  const ctx = await requireDriver(req, res);
  if (!ctx) return;

  const { old_password, new_password } = req.body || {};
  if (!old_password || !new_password) {
    return res.status(400).json({ error: 'old_and_new_required' });
  }
  if (new_password.length < MIN_LENGTH) {
    return res.status(400).json({ error: 'password_too_short', detail: `min ${MIN_LENGTH} chars` });
  }
  if (old_password === new_password) {
    return res.status(400).json({ error: 'password_unchanged' });
  }

  const svc = getServiceClient();

  // Re-fetch the password_hash since requireDriver doesn't include it in
  // the SELECT (out of caution — middleware ctx shouldn't carry secrets).
  const { data: driverWithHash } = await svc
    .from('drivers')
    .select('password_hash')
    .eq('id', ctx.driverId)
    .eq('tenant_id', ctx.tenantId)
    .maybeSingle();

  const ok = await verifyPassword(old_password, driverWithHash?.password_hash);
  if (!ok) {
    return res.status(401).json({ error: 'old_password_incorrect' });
  }

  const hash = await hashPassword(new_password);
  const { error } = await svc
    .from('drivers')
    .update({
      password_hash: hash,
      password_set_at: new Date().toISOString(),
      password_must_change: false,
      session_min_iat: new Date().toISOString(),
    })
    .eq('id', ctx.driverId)
    .eq('tenant_id', ctx.tenantId);
  if (error) return res.status(500).json({ error: error.message });

  await logTenantAction(svc, {
    tenantId: ctx.tenantId,
    userId: null,  // driver action, not tenant-user action
    action: 'driver.password_changed',
    entityType: 'driver',
    entityId: ctx.driverId,
    actorType: 'human',
    agentMetadata: { source: 'driver_app', driver_id: ctx.driverId },
    ipAddress: getClientIp(req),
  });

  return res.status(204).end();
}
