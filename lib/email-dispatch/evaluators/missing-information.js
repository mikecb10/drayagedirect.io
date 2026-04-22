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
// mismatches to the real columns before we embed them into a SELECT.
//
// NOTE: This covers `reference_number` only — same aliasing pattern used
// by the AR filter endpoints. The full catalog has ~20 other mismatched
// values (erd, cutoff, master_bill_of_lading, house_bill_of_lading, gray_*
// size/type/owner, etc.) that silently break triggers touching those
// fields. A broader audit is tracked as a separate follow-up.
const COLUMN_ALIAS = Object.freeze({
  reference_number: 'customer_reference',
});

function resolveColumn(field) {
  return COLUMN_ALIAS[field] || field;
}

export async function evaluate(svc, tenantId, trigger) {
  const cond = trigger.conditions || {};
  const requiredStatus = cond.load_status;
  const notifyAfterMs = durationToMs(cond.notify_after);
  const applicableFields = Array.isArray(cond.applicable_fields)
    ? cond.applicable_fields.filter((f) => typeof f === 'string' && f.length > 0)
    : [];

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
      return v == null || v === '';
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
