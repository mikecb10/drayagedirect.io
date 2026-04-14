/**
 * Charge set naming helper — keeps the convention consistent between the
 * manual "New Charge Set" button and the tariff engine's auto-create path.
 *
 * Convention:
 *   - 1st charge set on a load (PRIMARY) → `CS_ORD_M000005`
 *   - 2nd charge set                     → `CS_ORD_M000005_1`
 *   - 3rd charge set                     → `CS_ORD_M000005_2`
 *   - etc.
 *
 * The suffix number reflects how many charge sets already exist for the load,
 * so dispatchers can tell the primary from additionals at a glance.
 *
 * @param {object} svc — Supabase service client
 * @param {string} tenantId
 * @param {string} loadId — the order's id
 * @returns {Promise<string>} — charge set number
 */
export async function generateChargeSetNumber(svc, tenantId, loadId) {
  // Fetch the load's human-readable order number (e.g., "ORD-M000005")
  const { data: load } = await svc
    .from('orders')
    .select('order_number')
    .eq('tenant_id', tenantId)
    .eq('id', loadId)
    .single();

  const orderNumber = load?.order_number;

  // Fallback if load not found (shouldn't happen — keeps us safe from crashes)
  if (!orderNumber) {
    const fallback = `CS_${loadId.slice(0, 8).toUpperCase()}`;
    return fallback;
  }

  // Count how many charge sets this load already has.
  // No suffix for the primary (first) charge set; _1, _2, _3 for the rest.
  const { count } = await svc
    .from('order_charge_sets')
    .select('id', { count: 'exact', head: true })
    .eq('tenant_id', tenantId)
    .eq('order_id', loadId);

  // Normalize separators: ORD-M000005 → ORD_M000005
  const base = `CS_${orderNumber.replace(/-/g, '_')}`;
  if (!count || count === 0) return base;
  return `${base}_${count}`;
}
