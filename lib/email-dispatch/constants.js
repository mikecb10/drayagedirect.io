/**
 * The platform-owned SendGrid-authenticated subdomain that every tenant
 * sends from on the default tier. Overridable via env var so staging can
 * use a separate subdomain.
 */
export const PLATFORM_SENDER_DOMAIN =
  process.env.SENDGRID_PLATFORM_SENDER_DOMAIN || 'drayagedirect.io';

/**
 * Platform fallback From: used only when a tenant has zero
 * email_configurations (should never happen post-migration, but the
 * floor of the precedence chain needs a sane default).
 */
export const PLATFORM_FALLBACK_FROM_NAME = 'DrayageDirect Notifications';
export const PLATFORM_FALLBACK_FROM_ADDRESS = `noreply@${PLATFORM_SENDER_DOMAIN}`;
