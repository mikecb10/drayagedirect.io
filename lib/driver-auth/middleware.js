/**
 * requireDriver — JWT-based middleware for /api/driver/* endpoints.
 * Validates token, looks up driver, checks status + session_min_iat.
 * On success: returns { driverId, tenantId, driver }.
 * On failure: writes 401 to res and returns null.
 *
 * Spec: docs/superpowers/specs/2026-04-24-driver-move-tracking-design.md §4
 */

import { verifyDriverJWT } from './utils.js';

let _serviceClient = null;
export function __setServiceClientForTesting(svc) {
  _serviceClient = svc;
}

async function svcClient() {
  if (_serviceClient) return _serviceClient;
  // Lazy import so tests can inject a mock without loading the Supabase stack.
  const { getServiceClient } = await import('../tenant-api.js');
  return getServiceClient();
}

export async function requireDriver(req, res) {
  const auth = req.headers?.authorization;
  if (!auth || !auth.startsWith('Bearer ')) {
    res.status(401).json({ error: 'auth_required' });
    return null;
  }
  const token = auth.slice('Bearer '.length).trim();

  let claims;
  try {
    claims = verifyDriverJWT(token);
  } catch (e) {
    res.status(401).json({ error: 'auth_invalid', detail: e.message });
    return null;
  }

  const svc = await svcClient();
  const { data: driver, error } = await svc
    .from('drivers')
    .select('id, tenant_id, name, username, status, session_min_iat, location_tracking_enabled, password_must_change, tracking_consented_at, tracking_consent_version, tracking_revoked_at')
    .eq('id', claims.driverId)
    .eq('tenant_id', claims.tenantId)
    .is('deleted_at', null)
    .maybeSingle();

  if (error || !driver) {
    res.status(401).json({ error: 'driver_not_found' });
    return null;
  }

  if (driver.status !== 'active') {
    res.status(401).json({ error: 'driver_inactive' });
    return null;
  }

  // session_min_iat: any token issued before this is invalid (revocation pivot).
  // claims.iat is in seconds; session_min_iat is ISO string.
  const minIatMs = new Date(driver.session_min_iat).getTime();
  const tokenIatMs = (claims.iat ?? 0) * 1000;
  if (tokenIatMs < minIatMs) {
    res.status(401).json({ error: 'auth_revoked' });
    return null;
  }

  return {
    driverId: driver.id,
    tenantId: driver.tenant_id,
    driver,
  };
}
