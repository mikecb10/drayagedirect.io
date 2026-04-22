/**
 * Composite event evaluator: missing_information
 *
 * Fires for loads that are in a specific status AND have been there for
 * at least `notify_after` duration AND still have one or more of the
 * specified applicable_fields empty (null or empty string).
 *
 * Conditions shape (from TriggerModal.js):
 *   {
 *     load_status: 'dispatched' | 'in_transit' | ...,
 *     notify_after: { days, hours, minutes },
 *     applicable_fields: ['container_number', 'bill_of_lading', ...]
 *   }
 */

function durationToMs(d) {
  if (!d || typeof d !== 'object') return 0;
  const days = Number(d.days) || 0;
  const hours = Number(d.hours) || 0;
  const minutes = Number(d.minutes) || 0;
  return (days * 86400 + hours * 3600 + minutes * 60) * 1000;
}

// Public alias → real orders column mapping. Catalog values in
// MISSING_INFO_APPLICABLE_FIELDS are the user-facing names; some of them
// don't match the schema column exactly. This map resolves the known
// mismatches to real columns before we embed them into a SELECT.
//
// Full audit done 2026-04-24 against every migration that alters orders.
// Each alias below corresponds to an actual column on orders — verified
// in supabase/migrations/*.sql. Changes here MUST stay in sync with
// MISSING_INFO_APPLICABLE_FIELDS in lib/email-trigger-events.js.
export const COLUMN_ALIAS = Object.freeze({
  reference_number: 'customer_reference',     // 001 orders.customer_reference
  discharged_date: 'discharge_date',          // 003:22
  cutoff: 'cutoff_date',                      // 001:453
  voyage: 'voyage_number',                    // 003:57
  master_bill_of_lading: 'bill_of_lading',    // 001 orders.bill_of_lading
  house_bill_of_lading: 'house_bol',          // 003:55
  purchase_order_number: 'po_numbers',        // 001 — TEXT[] array
  temperature: 'genset_temperature',          // 003:36 NUMERIC
  scac: 'steamship_line_scac',                // 003:31
  return_location: 'return_location_id',      // 003:18 UUID
  hook_chassis_location: 'hook_chassis_location_id',           // 065:14
  terminate_chassis_location: 'terminate_chassis_location_id', // 065:15
  trailer: 'trailer_id',                      // 004:9 UUID
});

// Catalog values that have NO corresponding orders column and no
// reasonable alias. If a saved trigger references one of these, we
// silently drop it from the SELECT so the query doesn't 400 on an
// unknown column. A console.warn surfaces it for debugging.
//
// These were removed from MISSING_INFO_APPLICABLE_FIELDS in the same
// change, but old trigger rows in the DB may still reference them
// (validateTriggerPayload strips unknown values on save, but existing
// rows keep their payload until the next save).
export const REMOVED_FIELDS = new Set([
  'erd',                  // no such column
  'freight_hold',         // no such column (no is_freight_hold either)
  'customs_hold',         // no such column
  'return_date',          // ready_to_return_date exists but is a different concept
  'trailer_type',         // only on equipment_trailers, not orders
  'trailer_size',         // only on equipment_trailers, not orders
  'gray_container_size',  // gray_container_number exists, _size does not
  'gray_container_type',
  'gray_chassis_size',    // gray_chassis_number exists, _size/_type/_owner do not
  'gray_chassis_type',
  'gray_chassis_owner',
]);

export function resolveColumn(field) {
  return COLUMN_ALIAS[field] || field;
}

// Array-aware emptiness check. Needed because po_numbers is TEXT[] —
// an empty array `[]` is truthy but represents "no POs" / missing info.
export function isFieldEmpty(v) {
  if (Array.isArray(v)) return v.length === 0;
  return v == null || v === '';
}

export async function evaluate(svc, tenantId, trigger) {
  const cond = trigger.conditions || {};
  const requiredStatus = cond.load_status;
  const notifyAfterMs = durationToMs(cond.notify_after);
  const rawFields = Array.isArray(cond.applicable_fields)
    ? cond.applicable_fields.filter((f) => typeof f === 'string' && f.length > 0)
    : [];

  // Drop fields that no longer map to a real orders column. Log the
  // drop so a broken trigger doesn't silently succeed at evaluating a
  // smaller field set than the operator configured.
  const applicableFields = rawFields.filter((f) => {
    if (REMOVED_FIELDS.has(f)) {
      console.warn(
        `missing_information: dropping removed field '${f}' on trigger ${trigger.id || '(unknown)'}. Update the trigger condition.`
      );
      return false;
    }
    return true;
  });

  if (!requiredStatus || applicableFields.length === 0) return [];

  const cutoff = new Date(Date.now() - notifyAfterMs).toISOString();

  // Find all order_status_history rows where the load entered the
  // target status at or before cutoff, and the load is still in that
  // status. We dedupe per load_id to the latest transition.
  const { data: history, error: hErr } = await svc
    .from('order_status_history')
    .select('order_id, created_at')
    .eq('tenant_id', tenantId)
    .eq('new_status', requiredStatus)
    .lte('created_at', cutoff);

  if (hErr) {
    console.error('missing_information history fetch:', hErr.message);
    return [];
  }
  if (!history || history.length === 0) return [];

  // Dedupe per load to the latest entry
  const latestByLoad = new Map();
  for (const row of history) {
    const prev = latestByLoad.get(row.order_id);
    if (!prev || new Date(row.created_at) > new Date(prev.created_at)) {
      latestByLoad.set(row.order_id, row);
    }
  }

  const candidateLoadIds = Array.from(latestByLoad.keys());
  if (candidateLoadIds.length === 0) return [];

  // Fetch those candidates' current status + the applicable fields
  // (we validate that they're STILL in the target status and check
  // emptiness). Resolve column aliases so the SELECT hits real columns.
  const resolvedCols = applicableFields.map(resolveColumn);
  const fields = ['id', 'status', 'deleted_at', ...resolvedCols];
  const { data: loads, error: lErr } = await svc
    .from('orders')
    .select(fields.join(','))
    .in('id', candidateLoadIds)
    .eq('tenant_id', tenantId);

  if (lErr) {
    console.error('missing_information load fetch:', lErr.message);
    return [];
  }

  const matches = [];
  for (const load of loads || []) {
    if (load.deleted_at) continue;
    if (load.status !== requiredStatus) continue;
    // Use the user-facing field name in the `reason` message (so operators
    // see "missing: reference_number" in the trigger log, matching the
    // field they picked in the UI). Read from the resolved column for the
    // actual emptiness check.
    const empty = applicableFields.filter((f) => {
      const v = load[resolveColumn(f)];
      return isFieldEmpty(v);
    });
    if (empty.length > 0) {
      matches.push({
        load_id: load.id,
        reason: `missing: ${empty.join(', ')}`,
      });
    }
  }
  return matches;
}
