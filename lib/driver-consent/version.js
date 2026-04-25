// lib/driver-consent/version.js
/**
 * Bumped manually whenever the consent text in text.js changes materially.
 * On bump, all drivers re-prompt at next app open.
 */
export const CURRENT_CONSENT_VERSION = 1;

/**
 * @param {{ tracking_consented_at: string|null, tracking_revoked_at: string|null, tracking_consent_version: number|null }} driver
 * @returns {boolean}
 */
export function isConsentValid(driver) {
  if (!driver?.tracking_consented_at) return false;
  if (driver.tracking_consent_version !== CURRENT_CONSENT_VERSION) return false;
  if (
    driver.tracking_revoked_at &&
    new Date(driver.tracking_revoked_at) >= new Date(driver.tracking_consented_at)
  ) {
    return false;
  }
  return true;
}
