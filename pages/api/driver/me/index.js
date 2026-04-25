import { requireDriver } from '../../../../lib/driver-auth/middleware.js';
import { getServiceClient } from '../../../../lib/tenant-api.js';
import { isConsentValid, CURRENT_CONSENT_VERSION } from '../../../../lib/driver-consent/version.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' });
  const ctx = await requireDriver(req, res);
  if (!ctx) return;

  const svc = getServiceClient();

  // Look up tenant feature flag via the existing feature_flags + tenant_feature_flags pattern.
  // Schema: feature_flags(id, name, ...), tenant_feature_flags(tenant_id, feature_flag_id, enabled)
  const { data: tff } = await svc
    .from('tenant_feature_flags')
    .select('enabled, feature_flag:feature_flags!inner(name)')
    .eq('tenant_id', ctx.tenantId)
    .eq('feature_flag.name', 'move_tracking')
    .maybeSingle();
  const tenantFeatureEnabled = !!tff?.enabled;

  const consentValid = isConsentValid(ctx.driver);
  const trackingEligible =
    tenantFeatureEnabled &&
    ctx.driver.location_tracking_enabled &&
    consentValid;

  return res.status(200).json({
    driver: {
      id: ctx.driver.id,
      name: ctx.driver.name,
      username: ctx.driver.username,
      must_change_password: ctx.driver.password_must_change,
    },
    consent: {
      valid: consentValid,
      consented_at: ctx.driver.tracking_consented_at,
      revoked_at: ctx.driver.tracking_revoked_at,
      version: ctx.driver.tracking_consent_version,
      current_version: CURRENT_CONSENT_VERSION,
    },
    tracking: {
      tenant_feature_enabled: tenantFeatureEnabled,
      driver_toggle_enabled: ctx.driver.location_tracking_enabled,
      eligible: trackingEligible,
    },
  });
}
