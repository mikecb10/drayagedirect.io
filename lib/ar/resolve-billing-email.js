/**
 * 4-step fallback chain for resolving a customer's billing email.
 *
 * Used by both bulk invoice and bulk rate-con flows. The "correct" slot
 * is `customer_billing_emails` with a matching `email_type` enum value.
 * For tenants who never set a dedicated rate_confirmation email we fall
 * back to the invoice-typed email (most tenants set one or the other,
 * not both). Final fallback is the legacy `customers.billing_email`
 * column.
 *
 * @param {SupabaseClient} svc service-role client
 * @param {string} tenantId
 * @param {string} customerId
 * @param {'invoice' | 'rate_confirmation' | 'statement'} emailType
 * @returns {Promise<string | null>}
 */
export async function resolveBillingEmail(svc, tenantId, customerId, emailType) {
  // Step 1: type-specific billing email
  const { data: typed } = await svc
    .from('customer_billing_emails')
    .select('email')
    .eq('tenant_id', tenantId)
    .eq('customer_id', customerId)
    .eq('email_type', emailType)
    .maybeSingle();
  if (typed?.email) return typed.email;

  // Step 2: fallback to invoice-typed email (unless emailType was already 'invoice')
  if (emailType !== 'invoice') {
    const { data: fallback } = await svc
      .from('customer_billing_emails')
      .select('email')
      .eq('tenant_id', tenantId)
      .eq('customer_id', customerId)
      .eq('email_type', 'invoice')
      .maybeSingle();
    if (fallback?.email) return fallback.email;
  }

  // Step 3: legacy customers.billing_email column
  const { data: customer } = await svc
    .from('customers')
    .select('billing_email')
    .eq('tenant_id', tenantId)
    .eq('id', customerId)
    .maybeSingle();
  if (customer?.billing_email) return customer.billing_email;

  // Step 4: nothing resolvable
  return null;
}
