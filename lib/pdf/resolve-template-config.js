/**
 * Resolve the section_config to apply for a given load + document type.
 *
 * Cascade:
 *   1. customer-specific template  (customer_id = bill_to_customer_id)
 *   2. tenant default              (customer_id IS NULL)
 *   3. system default              (returns undefined; composer uses
 *                                   the section registry's defaults)
 *
 * Single round-trip: fetches up to 2 rows (customer-specific +
 * tenant default) and picks via the pure helper.
 */

/**
 * Pure cascade picker. Exported separately so the cascade decision
 * is unit-testable without a Supabase client.
 *
 * @param {Array<{customer_id: string|null, section_config: object}>} templates
 * @param {string|null} customerId
 * @returns {object|undefined}
 */
export function pickTemplate(templates, customerId) {
  if (!Array.isArray(templates) || templates.length === 0) return undefined;
  if (customerId) {
    const customerSpecific = templates.find((t) => t.customer_id === customerId);
    if (customerSpecific) return customerSpecific.section_config;
  }
  const tenantDefault = templates.find(
    (t) => t.customer_id === null || t.customer_id === undefined
  );
  return tenantDefault?.section_config;
}

/**
 * @param {SupabaseClient} svc - service-role client
 * @param {string} tenantId
 * @param {string|null} customerId - bill-to customer for the load (null/undefined ok)
 * @param {string} documentType - e.g. 'delivery_order_full'
 * @returns {Promise<object|undefined>} section_config or undefined
 */
export async function resolveTemplateConfig(svc, tenantId, customerId, documentType) {
  // Build the OR clause: always include the tenant default; include the
  // customer-specific only when customerId is truthy.
  let query = svc
    .from('document_templates')
    .select('customer_id, section_config')
    .eq('tenant_id', tenantId)
    .eq('document_type', documentType);

  if (customerId) {
    // Match either the customer-specific row OR the tenant default
    query = query.or(`customer_id.is.null,customer_id.eq.${customerId}`);
  } else {
    query = query.is('customer_id', null);
  }

  const { data, error } = await query;
  if (error) {
    console.error('resolveTemplateConfig query failed:', error.message);
    return undefined; // fall back to system default rather than crashing the renderer
  }
  return pickTemplate(data || [], customerId || null);
}
