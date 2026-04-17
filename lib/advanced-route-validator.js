/**
 * Server-side validation of a tariff's advanced_route payload before
 * upsert. Shared by AR (tariffs) and AP (driver_tariffs) endpoints.
 *
 * Accepts the { moves, routing_template_id } shape emitted by the
 * AdvancedRouteBuilder component. Returns { ok: true } or
 * { ok: false, error: string }.
 *
 * Rules mirror the spec § Save-time validation:
 *   - At least one move
 *   - At least 2 events total across all moves
 *   - Each event's event_type ∈ LANE_DEFINING_EVENT_TYPES
 *   - Each event's location_match.mode ∈ MODES
 *   - Required fields per mode are non-null
 */

import { LANE_DEFINING_EVENT_TYPES } from './advanced-route-matcher';

const MODES = ['specific', 'city_state', 'state', 'zip'];

export function validateAdvancedRoute(advancedRoute) {
  if (!advancedRoute) return { ok: true };

  const moves = Array.isArray(advancedRoute.moves) ? advancedRoute.moves : null;
  if (!moves || moves.length === 0) {
    return { ok: false, error: 'Advanced route must have at least one move' };
  }

  let totalEvents = 0;
  for (let mi = 0; mi < moves.length; mi++) {
    const m = moves[mi];
    const events = Array.isArray(m.events) ? m.events : [];
    for (let ei = 0; ei < events.length; ei++) {
      const e = events[ei];
      if (!LANE_DEFINING_EVENT_TYPES.includes(e.event_type)) {
        return { ok: false, error: `Move ${mi + 1} event ${ei + 1}: invalid event_type "${e.event_type}"` };
      }
      const lm = e.location_match || {};
      if (!MODES.includes(lm.mode)) {
        return { ok: false, error: `Move ${mi + 1} event ${ei + 1}: invalid location_match mode "${lm.mode}"` };
      }
      if (lm.mode === 'specific' && !lm.org_id) {
        return { ok: false, error: `Move ${mi + 1} event ${ei + 1}: specific mode requires org_id` };
      }
      if (lm.mode === 'city_state' && (!lm.city || !lm.state)) {
        return { ok: false, error: `Move ${mi + 1} event ${ei + 1}: city_state mode requires city + state` };
      }
      if (lm.mode === 'state' && !lm.state) {
        return { ok: false, error: `Move ${mi + 1} event ${ei + 1}: state mode requires state` };
      }
      if (lm.mode === 'zip' && !lm.zip) {
        return { ok: false, error: `Move ${mi + 1} event ${ei + 1}: zip mode requires zip` };
      }
      totalEvents += 1;
    }
  }

  if (totalEvents < 2) {
    return { ok: false, error: 'Advanced route must have at least 2 events total' };
  }

  return { ok: true };
}
