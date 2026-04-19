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

/**
 * Bulk variant of resolveBillingRecipients — used by /invoices/bulk-send.
 *
 * Asserts that all invoiceIds belong to customerId (defense against
 * grouping bugs that would otherwise leak invoices across customers).
 * Delegates recipient resolution to resolveBillingRecipients.
 *
 * NOTE: The invoices table uses `customer_id` as the bill-to FK column
 * (not `bill_to_id` — the spec used that alias but the real schema column
 * is `customer_id`).
 *
 * @param {SupabaseClient} svc
 * @param {string} customerId
 * @param {string} tenantId
 * @param {'invoice' | 'rate_confirmation'} emailType
 * @param {string[]} invoiceIds
 * @returns {Promise<{ to: string[], source: string, verifiedInvoiceCount: number }>}
 */
export async function resolveBulkBillingRecipients(
  svc, customerId, tenantId, emailType, invoiceIds
) {
  if (!Array.isArray(invoiceIds) || invoiceIds.length === 0) {
    throw new Error('resolveBulkBillingRecipients: invoiceIds must be non-empty array');
  }

  if (!customerId) {
    throw new Error('resolveBulkBillingRecipients: customerId is required');
  }

  // Cross-check: every invoice in the group must belong to customerId within tenantId.
  const { data: rows, error } = await svc
    .from('invoices')
    .select('id, customer_id')
    .eq('tenant_id', tenantId)
    .is('deleted_at', null)
    .in('id', invoiceIds);

  if (error) {
    throw new Error(`bulk recipient verification failed: ${error.message}`);
  }

  if (!rows || rows.length !== invoiceIds.length) {
    throw new Error(
      `bulk recipient verification failed: expected ${invoiceIds.length} invoices, found ${rows?.length ?? 0}`
    );
  }

  const mismatched = rows.filter((r) => r.customer_id !== customerId);
  if (mismatched.length > 0) {
    throw new Error(
      `bulk recipient verification failed: ${mismatched.length} invoice(s) have a different customer_id than group customer`
    );
  }

  const { to, source } = await resolveBillingRecipients(
    svc, customerId, tenantId, emailType
  );

  return { to, source, verifiedInvoiceCount: rows.length };
}
