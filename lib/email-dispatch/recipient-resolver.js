/**
 * Resolves the default recipient list for AR emails.
 *
 * Looks up per-type billing recipients first (customer_billing_emails
 * filtered by email_type) and falls back to the single-text
 * customers.billing_email column if no per-type rows exist.
 *
 * Used by the popup pre-fill endpoints (email-defaults) to populate
 * the To field when the slide-over opens.
 */

/**
 * @param {SupabaseClient} svc - service-role client
 * @param {string} customerId
 * @param {string} tenantId
 * @param {'invoice' | 'rate_confirmation'} emailType
 * @returns {Promise<{ to: string[], source: 'customer_billing_emails' | 'customer.billing_email' | 'none' }>}
 */
export async function resolveBillingRecipients(svc, customerId, tenantId, emailType) {
  if (!customerId) {
    return { to: [], source: 'none' };
  }

  // 1. Per-type rows
  const { data: typed, error: typedErr } = await svc
    .from('customer_billing_emails')
    .select('email')
    .eq('tenant_id', tenantId)
    .eq('customer_id', customerId)
    .eq('email_type', emailType)
    .eq('is_active', true);

  if (typedErr) {
    throw new Error(`customer_billing_emails lookup failed: ${typedErr.message}`);
  }

  if (typed && typed.length > 0) {
    return {
      to: typed.map((r) => r.email).filter(Boolean),
      source: 'customer_billing_emails',
    };
  }

  // 2. Fallback to single-text column
  const { data: customer, error: custErr } = await svc
    .from('customers')
    .select('billing_email')
    .eq('id', customerId)
    .eq('tenant_id', tenantId)
    .maybeSingle();

  if (custErr) {
    throw new Error(`customer fallback lookup failed: ${custErr.message}`);
  }

  if (customer?.billing_email) {
    return { to: [customer.billing_email], source: 'customer.billing_email' };
  }

  return { to: [], source: 'none' };
}
