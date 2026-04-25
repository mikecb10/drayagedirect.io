// lib/driver-auth/tracking-gates.js
/**
 * Three-gate check applied before any driver tracking action or ping:
 *   1. Tenant feature flag (move_tracking) on?
 *   2. Per-driver location_tracking_enabled?
 *   3. Driver consent currently valid?
 *
 * Returns null on pass; { status, error } object on fail.
 * Caller writes the failure response.
 */

import { isConsentValid } from '../driver-consent/version.js';

export async function checkTrackingGates({ supabase, tenantId, driver }) {
  // 1. Tenant feature flag
  const { data: tff } = await supabase
    .from('tenant_feature_flags')
    .select('enabled, feature_flag:feature_flags!inner(name)')
    .eq('tenant_id', tenantId)
    .eq('feature_flag.name', 'move_tracking')
    .maybeSingle();
  if (!tff?.enabled) return { status: 403, error: 'feature_disabled' };

  // 2. Per-driver toggle
  if (!driver.location_tracking_enabled) return { status: 403, error: 'tracking_disabled' };

  // 3. Consent
  if (!isConsentValid(driver)) return { status: 403, error: 'consent_required' };

  return null;
}
