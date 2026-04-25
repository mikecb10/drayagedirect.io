/**
 * POST /api/driver/auth/login
 * Body: { username, password }
 * Returns: { token, driver: { id, name, username, must_change_password } }
 *
 * Throttle: 5 fails / 30min per username via driver_auth_attempts table.
 */

import { getServiceClient } from '../../../../lib/tenant-api.js';
import { verifyPassword, signDriverJWT } from '../../../../lib/driver-auth/utils.js';

const MAX_ATTEMPTS = 5;
const LOCKOUT_MINUTES = 30;

function clientIp(req) {
  return (
    req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
    req.socket?.remoteAddress ||
    null
  );
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: 'username_and_password_required' });
  }

  const svc = getServiceClient();
  const ip = clientIp(req);
  const since = new Date(Date.now() - LOCKOUT_MINUTES * 60 * 1000).toISOString();

  // 1. Throttle check — count failed attempts for this username in window
  const { data: recentFails } = await svc
    .from('driver_auth_attempts')
    .select('id')
    .eq('username', username)
    .eq('succeeded', false)
    .gte('attempted_at', since);

  if ((recentFails?.length ?? 0) >= MAX_ATTEMPTS) {
    await svc.from('driver_auth_attempts').insert({
      username, ip_address: ip, succeeded: false,
    });
    return res.status(429).json({
      error: 'lockout',
      detail: `Too many attempts. Try again in ${LOCKOUT_MINUTES} minutes.`,
    });
  }

  // 2. Look up driver
  const { data: driver } = await svc
    .from('drivers')
    .select('id, tenant_id, name, username, status, password_hash, password_must_change')
    .eq('username', username)
    .is('deleted_at', null)
    .maybeSingle();

  if (!driver || driver.status !== 'active') {
    await svc.from('driver_auth_attempts').insert({
      tenant_id: driver?.tenant_id ?? null, username, ip_address: ip, succeeded: false,
    });
    return res.status(401).json({ error: 'invalid_credentials' });
  }

  // 3. Verify password
  const ok = await verifyPassword(password, driver.password_hash);
  if (!ok) {
    await svc.from('driver_auth_attempts').insert({
      tenant_id: driver.tenant_id, username, ip_address: ip, succeeded: false,
    });
    return res.status(401).json({ error: 'invalid_credentials' });
  }

  // 4. Sign token
  const token = signDriverJWT({ driverId: driver.id, tenantId: driver.tenant_id });

  // 5. Record success
  await svc.from('driver_auth_attempts').insert({
    tenant_id: driver.tenant_id, username, ip_address: ip, succeeded: true,
  });

  return res.status(200).json({
    token,
    driver: {
      id: driver.id,
      name: driver.name,
      username: driver.username,
      must_change_password: driver.password_must_change,
    },
  });
}
