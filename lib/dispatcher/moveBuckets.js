// Pure bucket-derivation util for the Driver Planner right-rail.
// Used by both server (initial payload bucketing) and client
// (realtime delta re-bucketing). See
// docs/superpowers/specs/2026-04-22-driver-planner-design.md §8

const VALID_MOVE_TYPES = new Set([
  'pickup',
  'delivery',
  'return',
  'chassis_reposition',
  'street_turn',
]);

/**
 * Determine which right-rail bucket an unassigned move belongs to.
 *
 * @param {object} move  An order_container_moves row plus `events`
 *                       (order_routing_events rows belonging to the move).
 * @param {object} orderFlags  { lfd, container_at_port, empty_ready_for_return_at }
 *                             from the parent orders row.
 * @returns {'atPort' | 'deliveries' | 'return' | 'other' | null}
 *          Returns null if the move is assigned (driver_id is not null).
 */
export function getBucket(move, orderFlags) {
  if (!move) throw new Error('getBucket: move is required');
  if (move.driver_id != null) return null;

  // Real-world move_type values include free-form routing-template names
  // like "Prepull + Live Unload" alongside the canonical lowercase values.
  // Unknown types fall through to 'other' rather than throwing — see Task 20
  // live-verification notes. VALID_MOVE_TYPES is kept here as documentation
  // of the canonical enum, but is no longer enforced.
  void VALID_MOVE_TYPES;

  const events = Array.isArray(move.events) ? move.events : [];
  const hasEventWithAppt = (type) =>
    events.some((e) => e != null && e.event_type === type && e.scheduled_at != null);

  if (
    move.move_type === 'pickup' &&
    orderFlags?.container_at_port === true &&
    (orderFlags?.lfd != null || hasEventWithAppt('pickup'))
  ) {
    return 'atPort';
  }

  if (move.move_type === 'delivery' && hasEventWithAppt('deliver')) {
    return 'deliveries';
  }

  if (move.move_type === 'return' && orderFlags?.empty_ready_for_return_at != null) {
    return 'return';
  }

  return 'other';
}

/**
 * Group an array of unassigned moves into the four buckets.
 *
 * @param {Array<{move, orderFlags}>} items
 * @returns {{ atPort: Array, deliveries: Array, return: Array, other: Array }}
 */
export function bucketize(items) {
  const out = { atPort: [], deliveries: [], return: [], other: [] };
  for (const { move, orderFlags } of items) {
    const b = getBucket(move, orderFlags);
    if (b == null) continue; // assigned, skip
    out[b].push(move);
  }
  return out;
}
