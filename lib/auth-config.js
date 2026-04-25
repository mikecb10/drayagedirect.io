/**
 * Centralized auth policy constants.
 *
 * Lockout policy applies to BOTH the tenant login flow
 * (`pages/api/auth/login.js`) and the admin login flow
 * (`pages/api/admin/auth/login.js`). Previously these constants
 * were duplicated literally in each file — extracted here per
 * FU-060 so tweaks land in one place.
 *
 * Future stretch (FU-060 notes): tenant_settings could override
 * MAX_ATTEMPTS and LOCKOUT_MINUTES so enterprise tenants can pick
 * stricter thresholds. Until then, these are the platform defaults.
 */

export const MAX_ATTEMPTS = 5;
export const LOCKOUT_MINUTES = 30;
