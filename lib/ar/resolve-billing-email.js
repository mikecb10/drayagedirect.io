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

  // Step 0: default organization group for this email purpose.
  // If the organization has a group marked is_default_for_purpose=true
  // with members having emails, those members are the recipients.
  // Falls through to the legacy chain if the group doesn't exist or
  // has no members with emails.
  const purposeByEmailType = {
    invoice: 'billing',
    rate_confirmation: 'rate_confirmation',
    statement: 'billing',  // statements use the billing group (no separate purpose)
  };
  const groupPurpose = purposeByEmailType[emailType];

  if (groupPurpose) {
    const { data: defaultGroup } = await svc
      .from('organization_groups')
      .select('id, members:organization_group_members(contact:organization_contacts(email, is_active))')
      .eq('tenant_id', tenantId)
      .eq('organization_id', customerId)
      .eq('purpose', groupPurpose)
      .eq('is_default_for_purpose', true)
      .maybeSingle();

    if (defaultGroup?.members?.length > 0) {
      const emails = defaultGroup.members
        .map((m) => m.contact?.email)
        .filter((e) => typeof e === 'string' && e.length > 0);
      if (emails.length > 0) {
        return { to: emails, source: 'organization_groups' };
      }
    }
  }

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
