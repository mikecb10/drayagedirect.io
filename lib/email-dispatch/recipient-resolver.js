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

/**
 * Bulk variant of resolveBillingRecipients for charge-sets.
 *
 * Mirrors resolveBulkBillingRecipients, but charge-sets don't have a
 * direct customer_id column — customer comes through the parent order
 * (order_charge_sets.order_id → orders.customer_id).
 *
 * Asserts that all chargeSetIds belong to `customerId` within `tenantId`
 * (defense against grouping bugs that would otherwise leak one customer's
 * rate-cons to another customer's inbox).
 *
 * Delegates recipient resolution to resolveBillingRecipients.
 *
 * NOTE: order_charge_sets has no `deleted_at` column today (verified
 * against migration 003_phase5b1_loads.sql), so we omit the soft-delete
 * filter that resolveBulkBillingRecipients applies to invoices.
 *
 * @param {SupabaseClient} svc
 * @param {string} customerId
 * @param {string} tenantId
 * @param {'rate_confirmation' | 'invoice'} emailType - currently callers pass 'rate_confirmation'
 * @param {string[]} chargeSetIds
 * @returns {Promise<{ to: string[], source: string, verifiedChargeSetCount: number }>}
 */
export async function resolveBulkChargeSetRecipients(
  svc, customerId, tenantId, emailType, chargeSetIds
) {
  if (!Array.isArray(chargeSetIds) || chargeSetIds.length === 0) {
    throw new Error('resolveBulkChargeSetRecipients: chargeSetIds must be non-empty array');
  }

  if (!customerId) {
    throw new Error('resolveBulkChargeSetRecipients: customerId is required');
  }

  // Cross-check: every charge-set must map to customerId via its parent order.
  // The customer_id lives on `orders`, not `order_charge_sets`, so we embed
  // the order relationship. If any row is missing the order link or the
  // order's customer_id differs, we throw and refuse to send.
  //
  // Embed syntax `order:order_id(customer_id)` matches the pattern used in
  // pages/api/tenant/ar/charge-sets/[id]/send-rate-con-email.js.
  const { data: rows, error } = await svc
    .from('order_charge_sets')
    .select('id, order:order_id(customer_id)')
    .eq('tenant_id', tenantId)
    .in('id', chargeSetIds);

  if (error) {
    throw new Error(`bulk charge-set recipient verification failed: ${error.message}`);
  }

  if (!rows || rows.length !== chargeSetIds.length) {
    throw new Error(
      `bulk charge-set recipient verification failed: expected ${chargeSetIds.length} charge-sets, found ${rows?.length ?? 0}`
    );
  }

  const mismatched = rows.filter((r) => r.order?.customer_id !== customerId);
  if (mismatched.length > 0) {
    throw new Error(
      `bulk charge-set recipient verification failed: ${mismatched.length} charge-set(s) have a different customer_id than group customer`
    );
  }

  const { to, source } = await resolveBillingRecipients(
    svc, customerId, tenantId, emailType
  );

  return { to, source, verifiedChargeSetCount: rows.length };
}
