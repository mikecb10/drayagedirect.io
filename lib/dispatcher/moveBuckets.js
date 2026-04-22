// Pure bucket-derivation util for the Driver Planner right-rail.
// Classifies unassigned moves by inspecting their routing events
// (event_type: pull / deliver / pickup / drop / hook / return) instead
// of the denormalized move_type name or order-level state flags.
//
// See docs/superpowers/specs/2026-04-22-driver-planner-bucket-classification-design.md
// for the full rationale — in brief, move_type is a free-form
// routing-template name ("Pick and Run + Drop & Hook") that does not
// match the original spec's strict enum, and order flags
// (container_at_port, empty_ready_for_return_at) + event.scheduled_at
// are not populated in practice.

/**
 * Determine which right-rail bucket an unassigned move belongs to.
 *
 * Priority (first match wins):
 *   pull            → 'atPort'     port pickup (LFD/demurrage urgency)
 *   deliver|pickup  → 'deliveries' delivery leg (pickup = One Way Move template)
 *   return          → 'return'     empty/loaded return to port
 *   else            → 'other'      chassis-only, street-turn, bobtail
 *
 * @param {object} move  order_container_moves row plus an `events` array
 *                       (order_routing_events rows belonging to the move).
 * @returns {'atPort' | 'deliveries' | 'return' | 'other' | null}
 *          null if the move is assigned (driver_id != null).
 */
export function getBucket(move) {
  if (!move) throw new Error('getBucket: move is required');
  if (move.driver_id != null) return null;

  const events = Array.isArray(move.events) ? move.events : [];
  const has = (type) => events.some((e) => e?.event_type === type);

  if (has('pull')) return 'atPort';
  if (has('deliver') || has('pickup')) return 'deliveries';
  if (has('return')) return 'return';
  return 'other';
}

/**
 * Group an array of unassigned moves into the four right-rail buckets.
 * Assigned moves (driver_id != null) are skipped.
 *
 * @param {Array<object>} moves  array of move rows (each with `events`).
 * @returns {{ atPort: Array, deliveries: Array, return: Array, other: Array }}
 */
export function bucketize(moves) {
  const out = { atPort: [], deliveries: [], return: [], other: [] };
  for (const move of moves) {
    const b = getBucket(move);
    if (b == null) continue; // assigned, skip
    out[b].push(move);
  }
  return out;
}
