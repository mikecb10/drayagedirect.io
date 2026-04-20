/**
 * Resolve the Reply-To header value.
 *
 * Precedence chain:
 *   1. config.reply_to_email (+ reply_to_name)
 *   2. tenant.email (name = null)
 *   3. null (= do not set Reply-To header)
 *
 * We deliberately do NOT fall through to noreply@drayagedirect.io,
 * because that would route customer replies into a black hole. Better to
 * let replies bounce back to the From: address with a clear SendGrid error.
 *
 * @param config { reply_to_email?: string|null, reply_to_name?: string|null } | null
 * @param tenant { email?: string|null } | null
 * @returns { email: string, name: string|null } | null
 */
export function resolveReplyTo(config, tenant) {
  const configEmail = (config?.reply_to_email || '').trim();
  if (configEmail) {
    return {
      email: configEmail,
      name: (config?.reply_to_name || '').trim() || null,
    };
  }

  const tenantEmail = (tenant?.email || '').trim();
  if (tenantEmail) {
    return { email: tenantEmail, name: null };
  }

  return null;
}
