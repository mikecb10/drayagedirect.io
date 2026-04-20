/**
 * 4-step fallback chain for resolving a customer's active billing emails.
 *
 * Used by both bulk invoice and bulk rate-con flows. The "correct" slot
 * is `customer_billing_emails` with a matching `email_type` enum value
 * (and `is_active=true`). For tenants who never set a dedicated
 * rate_confirmation email we fall back to the invoice-typed email
 * (most tenants set one or the other, not both). Final fallback is
 * the legacy `customers.billing_email` column.
 *
 * Strict superset of lib/email-dispatch/recipient-resolver.js's
 * resolveBillingRecipients — returns all active emails (not just one),
 * filters by is_active=true, and throws on query errors.
 *
 * Step 1: customer_billing_emails rows matching (tenant, customer, emailType)
 *         where is_active=true. Returns all matching active emails as an array.
 * Step 2: If emailType !== 'invoice', fall back to emailType='invoice' rows
 *         (is_active=true). Rationale: most tenants set one billing email
 *         shared across invoice/rate_con/statement purposes. Source is still
 *         'customer_billing_emails' — the invoice-type fallback is just
 *         another path to the same source.
 * Step 3: Legacy customers.billing_email single-text column.
 * Step 4: Empty — returns { to: [], source: 'none' }.
 *
 * Throws on any query error with a contextual message.
 *
 * @param {SupabaseClient} svc service-role client
 * @param {string} tenantId
 * @param {string} customerId
 * @param {'invoice' | 'rate_confirmation' | 'statement'} emailType
 * @returns {Promise<{ to: string[], source: 'customer_billing_emails' | 'customer.billing_email' | 'none' }>}
 */
export async function resolveBillingEmails(svc, tenantId, customerId, emailType) {
  if (!customerId) return { to: [], source: 'none' };

  // Step 1: type-specific active billing emails (array)
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

  // Step 2: fallback to invoice-typed active emails (unless already 'invoice')
  if (emailType !== 'invoice') {
    const { data: fallback, error: fallbackErr } = await svc
      .from('customer_billing_emails')
      .select('email')
      .eq('tenant_id', tenantId)
      .eq('customer_id', customerId)
      .eq('email_type', 'invoice')
      .eq('is_active', true);
    if (fallbackErr) {
      throw new Error(
        `customer_billing_emails invoice-fallback lookup failed: ${fallbackErr.message}`,
      );
    }
    if (fallback && fallback.length > 0) {
      return {
        to: fallback.map((r) => r.email).filter(Boolean),
        source: 'customer_billing_emails',
      };
    }
  }

  // Step 3: legacy customers.billing_email single-text column
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

  // Step 4: nothing resolvable
  return { to: [], source: 'none' };
}
