import { findMatchingCharges, applyChargesToLoad } from './tariff-engine';

/**
 * Load fields that affect AR tariff matching. Mirrors the conditions
 * checked by matchesTariff in lib/tariff-engine.js. When a PUT to
 * /api/tenant/loads/[id] changes any of these, the auto-recalc trigger
 * fires on the first DRAFT charge set.
 *
 * NOT included (explicitly — these don't affect matching):
 *  - Reference numbers (BOL, booking, container_number, etc.)
 *  - Driver assignment (AP engine is separate)
 *  - Notes, comments, weight, dates, status lifecycle
 *  - Routing events (separate endpoint; out of scope for this pass)
 */
export const MATCHING_FIELDS = [
  'customer_id', 'pickup_location_id', 'delivery_location_id', 'return_location_id',
  'container_type', 'container_size', 'container_type_id', 'container_size_id',
  'container_owner_id', 'chassis_type', 'chassis_size', 'chassis_owner',
  'is_hazmat', 'is_overweight', 'is_overheight', 'is_hot', 'is_genset',
  'is_scale', 'is_ev', 'is_street_turn', 'is_oog', 'is_bonded',
  'is_double', 'is_tanker', 'is_liquor', 'load_type', 'branch_id',
];

export function fieldChanged(oldLoad, newLoad, fields) {
  return fields.some((f) => oldLoad?.[f] !== newLoad?.[f]);
}

/**
 * If the load update changed any matching-relevant field AND the load's
 * first charge set is draft, re-run the tariff engine and apply the
 * new charges. Best-effort: swallows errors internally via the caller's
 * try/catch. Returns a structured result for logging.
 *
 * @param {object} svc — Supabase service client (through resilience wrapper)
 * @param {string} tenantId
 * @param {object} oldLoad — pre-update load row
 * @param {object} newLoad — post-update load row (same id, new field values)
 * @returns {Promise<{ ran: boolean, reason?: string, applied?: number }>}
 */
export async function maybeRecalcOnLoadChange(svc, tenantId, oldLoad, newLoad) {
  if (!fieldChanged(oldLoad, newLoad, MATCHING_FIELDS)) {
    return { ran: false, reason: 'no_match_fields_changed' };
  }

  const { data: firstSet } = await svc
    .from('order_charge_sets')
    .select('id, status')
    .eq('order_id', newLoad.id)
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();

  if (!firstSet) return { ran: false, reason: 'no_charge_sets' };
  if (firstSet.status !== 'draft') return { ran: false, reason: 'first_set_not_draft' };

  const charges = await findMatchingCharges(svc, newLoad, tenantId);
  await applyChargesToLoad(svc, newLoad.id, tenantId, charges);
  return { ran: true, applied: charges.length };
}
