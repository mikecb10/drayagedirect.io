/**
 * Advanced Route Matcher — shared pure logic used by both the AR
 * tariff engine (lib/tariff-engine.js) and the AP driver tariff
 * engine (lib/driver-tariff-engine.js).
 *
 * A tariff with matching_mode === 'advanced_route' carries a route
 * template (moves JSONB) that describes a specific lane. This matcher
 * decides whether a load's order_routing_events align with that
 * template, exactly (after stripping operational events).
 *
 * See docs/superpowers/specs/2026-04-17-advanced-route-matching-design.md.
 */

// Event types that affect matching. These are lane-defining — they
// describe where the container physically is. Mirrors
// PALETTE_EVENT_TYPES in lib/routing-rules.js but excludes the
// operational types below.
export const LANE_DEFINING_EVENT_TYPES = [
  'pull', 'pickup', 'drop', 'hook', 'deliver', 'return',
  'hook_chassis', 'lift_off', 'terminate',
];

// Event types stripped before structural compare. These happen
// mid-execution and don't change the physical lane — a scale stop
// or a wait shouldn't de-price a load.
const OPERATIONAL_EVENT_TYPES = new Set([
  'scale', 'wait', 'complete', 'notes',
]);

/**
 * Normalize a load's routing into a move-grouped, sequence-ordered
 * tree with operational events stripped. Result:
 *   [{ events: [{ event_type, location_id, city, state, zip }, ...] }, ...]
 *
 * Empty moves (those whose events were all operational) are dropped
 * so they don't inflate the move count during structural compare.
 *
 * @param {Array} routingEvents — flat list of order_routing_events rows
 * @param {Array} containerMoves — flat list of order_container_moves rows (for ordering)
 * @returns {Array<{ events: Array }>}
 */
export function normalizeLoadRouting(routingEvents, containerMoves) {
  if (!Array.isArray(routingEvents) || routingEvents.length === 0) return [];

  const sortedMoves = [...(containerMoves || [])]
    .sort((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0));

  const result = [];
  for (const move of sortedMoves) {
    const events = routingEvents
      .filter((e) => e.move_id === move.id)
      .filter((e) => !OPERATIONAL_EVENT_TYPES.has(e.event_type))
      .sort((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0))
      .map((e) => ({
        event_type: e.event_type,
        location_id: e.location_id || null,
        city: e.city || null,
        state: e.state || null,
        zip: e.zip || null,
      }));
    if (events.length > 0) {
      result.push({ events });
    }
  }
  return result;
}

/**
 * Compare one load event's location against one template event's
 * location_match specifier.
 *
 * @param {object} loadEvent — normalized { location_id, city, state, zip }
 * @param {object} match — template { mode, org_id, city, state, zip }
 * @returns {boolean}
 */
export function matchLocation(loadEvent, match) {
  if (!match || !match.mode) return false;
  switch (match.mode) {
    case 'specific':
      if (!match.org_id || !loadEvent.location_id) return false;
      return loadEvent.location_id === match.org_id;

    case 'city_state': {
      if (!match.city || !match.state) return false;
      if (!loadEvent.city || !loadEvent.state) return false;
      const cityEq = loadEvent.city.trim().toLowerCase() === match.city.trim().toLowerCase();
      const stateEq = loadEvent.state.toUpperCase() === match.state.toUpperCase();
      return cityEq && stateEq;
    }

    case 'state':
      if (!match.state) return false;
      if (!loadEvent.state) return false;
      return loadEvent.state.toUpperCase() === match.state.toUpperCase();

    case 'zip':
      if (!match.zip || !loadEvent.zip) return false;
      return loadEvent.zip === match.zip;

    default:
      return false;
  }
}
