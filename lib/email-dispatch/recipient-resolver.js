import { resolveBillingEmails } from '../ar/resolve-billing-email.js';

/**
 * Resolves the default recipient list for AR emails.
 *
 * Thin adapter over resolveBillingEmails that preserves the
 * historical (svc, customerId, tenantId, emailType) parameter
 * order used by existing call sites.
 *
 * @param {SupabaseClient} svc
 * @param {string} customerId
 * @param {string} tenantId
 * @param {'invoice' | 'rate_confirmation'} emailType
 * @returns {Promise<{ to: string[], source: string }>}
 */
export async function resolveBillingRecipients(svc, customerId, tenantId, emailType) {
  // Delegate to the shared helper. Note the parameter-order swap:
  // our public contract is (svc, customerId, tenantId, emailType) while
  // the helper's is (svc, tenantId, customerId, emailType). That's a
  // historical inconsistency we preserve to keep all existing callers
  // (invoice bulk-send, single-invoice email-defaults, etc.) working
  // without modification.
  return resolveBillingEmails(svc, tenantId, customerId, emailType);
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
