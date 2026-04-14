/**
 * Routing Event Ordering Rules
 *
 * Enforces drayage business logic on what events can follow what.
 * Used by the EventPalette to gray out invalid options, and by the
 * drop handler to reject invalid drops.
 *
 * The key insight: a drayage move follows a physical flow. You can't
 * hook a chassis after you've already picked up a container, and you
 * can't deliver before you've picked up.
 *
 * Event types and their semantics:
 *   hook_chassis   — Hook an empty chassis (before pulling a container)
 *   pull / pickup  — Pick up a container from terminal/port
 *   deliver        — Live unload at destination
 *   drop           — Drop a loaded/empty container (leave it)
 *   hook           — Hook a container that was previously dropped
 *   return         — Return empty container to terminal/depot
 *   terminate      — Terminate/drop off chassis (often different location)
 *   lift_off       — Lift container off chassis
 *   wait           — Wait at location (can happen anywhere)
 *   scale          — Stop at scale (can happen anywhere)
 *   complete       — Mark the routing as complete
 */

// What event types are allowed AFTER a given event type.
// 'any' means the event can appear after anything (like wait/scale).
const ALLOWED_AFTER = {
  // Starting events (no predecessor) — what can be the FIRST event
  _start: ['hook_chassis', 'pull', 'pickup', 'hook'],

  // After hooking chassis → pick up the container
  hook_chassis: ['pull', 'pickup', 'hook', 'wait', 'scale'],

  // After pulling/picking up → deliver, drop, scale, wait
  pull: ['deliver', 'drop', 'return', 'scale', 'wait'],
  pickup: ['deliver', 'drop', 'return', 'scale', 'wait'],

  // After delivering → return empty, drop (triggers split), terminate
  deliver: ['return', 'drop', 'terminate', 'lift_off', 'scale', 'wait', 'complete'],

  // After dropping → hook another, return, terminate, complete
  drop: ['hook', 'return', 'terminate', 'scale', 'wait', 'complete'],

  // After hooking (a previously dropped container) → deliver, drop, return, yard moves
  hook: ['deliver', 'drop', 'return', 'pull', 'scale', 'wait'],

  // After returning empty → terminate chassis, complete
  return: ['terminate', 'complete'],

  // After terminating chassis → complete (nothing else makes sense)
  terminate: ['complete'],

  // After lift off → terminate chassis, complete
  lift_off: ['terminate', 'return', 'complete'],

  // Wait and scale can be followed by anything that their predecessor could
  wait: null,   // inherits from previous non-wait event
  scale: null,  // inherits from previous non-scale event

  // Complete is terminal — nothing after it
  complete: [],
};

/**
 * Given the current list of events in a move, return which event types
 * are valid to add next.
 *
 * @param {Array} events — ordered list of events already in the move
 * @returns {string[]} — array of valid event type keys
 */
export function getValidNextEvents(events) {
  if (!events || events.length === 0) {
    return ALLOWED_AFTER._start;
  }

  // Walk backward to find the last "meaningful" event (skip wait/scale)
  let lastType = null;
  for (let i = events.length - 1; i >= 0; i--) {
    const t = events[i].event_type;
    if (t !== 'wait' && t !== 'scale') {
      lastType = t;
      break;
    }
  }

  if (!lastType) return ALLOWED_AFTER._start;

  const allowed = ALLOWED_AFTER[lastType];
  if (!allowed) return ALLOWED_AFTER._start;
  return allowed;
}

/**
 * Check if a specific event type can be added to a move at the end.
 */
export function canAddEvent(events, eventType) {
  const valid = getValidNextEvents(events);
  return valid.includes(eventType);
}

/**
 * Given ALL events across ALL moves, determine if adding a new move
 * makes sense. After a Return Container, only a Terminate Chassis move
 * is logical (for street turns where the chassis goes to a different location).
 *
 * @param {Array} allEvents — all events across all moves, sorted by sequence
 * @returns {{ allowed: boolean, reason?: string, allowedTypes?: string[] }}
 */
export function canAddMove(allEvents) {
  if (!allEvents || allEvents.length === 0) {
    return { allowed: true };
  }

  // Find the last meaningful event across all moves
  let lastType = null;
  for (let i = allEvents.length - 1; i >= 0; i--) {
    const t = allEvents[i].event_type;
    if (t !== 'wait' && t !== 'scale') {
      lastType = t;
      break;
    }
  }

  if (lastType === 'complete') {
    return { allowed: false, reason: 'Routing is marked as complete' };
  }

  if (lastType === 'terminate') {
    return { allowed: false, reason: 'Chassis has been terminated — no further moves needed' };
  }

  if (lastType === 'return') {
    return {
      allowed: true,
      reason: 'After return, only a Terminate Chassis event can be added (e.g., for a street turn)',
      allowedTypes: ['terminate', 'complete'],
    };
  }

  return { allowed: true };
}

/**
 * Palette display config — labels and descriptions for the event palette.
 * Items that aren't in the valid list get grayed out.
 */
export const PALETTE_EVENT_TYPES = [
  { type: 'hook_chassis', label: 'Hook Chassis', description: 'Hook an empty chassis' },
  { type: 'pickup', label: 'Pickup Container', description: 'Pick up container from location' },
  { type: 'pull', label: 'Pull from Terminal', description: 'Pull container from terminal/port' },
  { type: 'deliver', label: 'Deliver Container', description: 'Live unload at destination' },
  { type: 'return', label: 'Return Container', description: 'Return empty to terminal/depot' },
  { type: 'drop', label: 'Drop Container', description: 'Drop loaded/empty container' },
  { type: 'hook', label: 'Hook Container', description: 'Hook a previously dropped container' },
  { type: 'lift_off', label: 'Lift Off', description: 'Lift container off chassis' },
  { type: 'terminate', label: 'Terminate Chassis', description: 'Drop off chassis at location' },
  { type: 'scale', label: 'Scale', description: 'Stop at weigh station' },
  { type: 'wait', label: 'Wait', description: 'Wait at current location' },
  { type: 'complete', label: 'Completed', description: 'Mark routing as complete' },
];

/**
 * Determine if inserting an event at a position in a move should trigger
 * an auto-restructure (split the move into two).
 *
 * The key rule: inserting a "Drop" means the driver is leaving the container.
 * Everything after the drop needs a "Hook" to pick it back up → new move.
 *
 * @param {string} eventType — the event being inserted
 * @param {Array} moveEvents — existing events in the move
 * @param {number} insertIndex — where in the move the event is being inserted
 * @returns {{ shouldSplit: boolean, splitAfterIndex?: number, newMoveEvents?: Array }}
 */
/**
 * Check if inserting an event triggers an auto-restructure.
 *
 * Core rule: A "Drop" means the driver is leaving the container.
 * Everything AFTER the drop in this move needs a new driver to pick it
 * back up → splits into a new move with a Hook prepended.
 *
 * Validation: Drop can only be inserted AFTER a pull/pickup/deliver/hook
 * (you must have the container to drop it!).
 *
 * @param {string} eventType — the event being inserted
 * @param {Array} moveEvents — existing events in the move (sorted by sequence)
 * @param {number} insertIndex — position in the move where the event is being inserted
 */
export function checkAutoRestructure(eventType, moveEvents, insertIndex) {
  if (eventType !== 'drop') {
    return { shouldSplit: false };
  }

  // Validate: can't drop before picking up
  const eventsBefore = moveEvents.slice(0, insertIndex);
  const hasContainer = eventsBefore.some((e) =>
    ['pull', 'pickup', 'hook', 'deliver'].includes(e.event_type)
  );
  if (!hasContainer) {
    return { shouldSplit: false, invalid: true, reason: 'Cannot drop before picking up a container' };
  }

  // Validate: can't drop after returning — container is already gone
  const hasReturned = eventsBefore.some((e) => e.event_type === 'return');
  if (hasReturned) {
    return { shouldSplit: false, invalid: true, reason: 'Cannot drop after returning — the container has already been returned' };
  }

  // Everything AFTER the insert point gets moved to a new move
  const eventsAfterDrop = moveEvents.slice(insertIndex);

  if (eventsAfterDrop.length === 0) {
    // Drop at the end — no split needed
    return { shouldSplit: false };
  }

  return {
    shouldSplit: true,
    splitAfterIndex: insertIndex,
    eventsToMove: eventsAfterDrop,
    prependHook: true,
  };
}

export { ALLOWED_AFTER };
