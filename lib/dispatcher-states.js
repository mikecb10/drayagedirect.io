/**
 * Dispatcher States — fine-grained operational states for loads.
 *
 * Derived client-side from a load's order status + its current routing event
 * (next incomplete event) + the event's arrived_at / departed_at timestamps.
 *
 * Tenants can override the default colors via /settings/dispatcher-colors.
 */

// ============================================================
// State definitions
// ============================================================

export const DISPATCHER_STATES = [
  // Pre-dispatch
  {
    key: 'pending',
    label: 'Pending',
    group: 'Pre-dispatch',
    defaultColor: '#f9fafb',
    textColor: '#374151',
  },
  {
    key: 'dispatched',
    label: 'Dispatched',
    group: 'Pre-dispatch',
    defaultColor: '#dbeafe',
    textColor: '#1e40af',
  },

  // Pickup / pull phase (getting the container)
  {
    key: 'enroute_pull',
    label: 'Enroute To Pick Container',
    group: 'Pickup',
    defaultColor: '#fef3c7',
    textColor: '#92400e',
  },
  {
    key: 'arrived_pull',
    label: 'Arrived At Pick Container',
    group: 'Pickup',
    defaultColor: '#fde68a',
    textColor: '#92400e',
  },
  {
    key: 'enroute_pickup',
    label: 'Enroute To Pickup',
    group: 'Pickup',
    defaultColor: '#fef3c7',
    textColor: '#92400e',
  },
  {
    key: 'arrived_pickup',
    label: 'Arrived At Pickup',
    group: 'Pickup',
    defaultColor: '#fde68a',
    textColor: '#92400e',
  },

  // Drop / hook phase (intermediate moves)
  {
    key: 'enroute_drop',
    label: 'Enroute To Drop Container',
    group: 'Drop & Hook',
    defaultColor: '#ddd6fe',
    textColor: '#5b21b6',
  },
  {
    key: 'arrived_drop',
    label: 'Dropped',
    group: 'Drop & Hook',
    defaultColor: '#c4b5fd',
    textColor: '#5b21b6',
  },
  {
    key: 'enroute_hook',
    label: 'Enroute To Hook Container',
    group: 'Drop & Hook',
    defaultColor: '#e0e7ff',
    textColor: '#3730a3',
  },
  {
    key: 'arrived_hook',
    label: 'Arrived To Hook Container',
    group: 'Drop & Hook',
    defaultColor: '#c7d2fe',
    textColor: '#3730a3',
  },

  // Deliver phase
  {
    key: 'enroute_deliver',
    label: 'Enroute To Deliver Load',
    group: 'Delivery',
    defaultColor: '#bfdbfe',
    textColor: '#1e40af',
  },
  {
    key: 'arrived_deliver',
    label: 'Arrived At Deliver Load',
    group: 'Delivery',
    defaultColor: '#93c5fd',
    textColor: '#1e40af',
  },

  // Return phase
  {
    key: 'enroute_return',
    label: 'Enroute To Return Empty',
    group: 'Return',
    defaultColor: '#bbf7d0',
    textColor: '#166534',
  },
  {
    key: 'arrived_return',
    label: 'Arrived At Return Empty',
    group: 'Return',
    defaultColor: '#86efac',
    textColor: '#166534',
  },

  // Terminal
  {
    key: 'delivered',
    label: 'Delivered',
    group: 'Terminal',
    defaultColor: '#d1fae5',
    textColor: '#065f46',
  },
  {
    key: 'pending_completion',
    label: 'Pending Completion',
    group: 'Terminal',
    defaultColor: '#bbf7d0',
    textColor: '#166534',
  },
  {
    key: 'completed',
    label: 'Completed',
    group: 'Terminal',
    defaultColor: '#dcfce7',
    textColor: '#14532d',
  },
  {
    key: 'cancelled',
    label: 'Cancelled',
    group: 'Terminal',
    defaultColor: '#fee2e2',
    textColor: '#991b1b',
  },
];

export const STATE_BY_KEY = DISPATCHER_STATES.reduce((acc, s) => {
  acc[s.key] = s;
  return acc;
}, {});

export const DEFAULT_STATE_COLORS = DISPATCHER_STATES.reduce((acc, s) => {
  acc[s.key] = s.defaultColor;
  return acc;
}, {});

export const STATE_GROUPS = [
  'Pre-dispatch',
  'Pickup',
  'Drop & Hook',
  'Delivery',
  'Return',
  'Terminal',
];

// ============================================================
// State derivation
// ============================================================

/**
 * Derive the fine-grained dispatcher state for a load.
 *
 * Looks at order status + current routing event + timestamps, with specific
 * handling for the difference between "dispatched" (driver assigned but
 * hasn't started working) and "enroute" (driver is actively driving to a
 * location).
 *
 * Expects the load to carry nested move info on its routing events:
 *   load.current_event.move?.started_at  — "did this move begin"
 * OR at minimum the full events array with sequence/arrived_at/departed_at
 * so we can check whether any prior event has been completed.
 */
export function deriveState(load) {
  if (!load) return 'pending';

  const status = load.status;

  // Terminal states trump everything (only truly sticky states here).
  // pending_completion is NOT terminal — it's derived from events being
  // all-departed, so if events are cleared it should revert naturally.
  if (status === 'cancelled') return 'cancelled';
  if (status === 'completed') return 'completed';
  if (status === 'delivered') return 'delivered';

  // Pending / Available = not actively working
  if (status === 'pending') return 'pending';
  if (status === 'available') return 'pending';

  // Dropped: the container is physically sitting at a drop location
  // waiting for the next driver. This covers the window between a Drop
  // event's departed_at being set and the next Hook event being started.
  // The map label we want is "Dropped" which lives under the arrived_drop
  // key in DISPATCHER_STATES.
  if (status === 'dropped') return 'arrived_drop';

  // Before checking the current event, detect if ALL routing events are
  // fully completed (departed). This catches the case where the DB status
  // is stale ('dispatched') but the events clearly show the load is done.
  // The banner component passes routing_events on the load object.
  const routeEvents = load.routing_events || [];
  if (routeEvents.length > 0 && routeEvents.every((e) => !!e.departed_at)) {
    const sortedRE = [...routeEvents].sort(
      (a, b) => (a.sequence ?? 0) - (b.sequence ?? 0)
    );
    const lastType = sortedRE[sortedRE.length - 1]?.event_type;
    if (lastType === 'return') return 'pending_completion';
    if (lastType === 'deliver') return 'delivered';
  }

  // From here on: status is 'dispatched' or 'in_transit'
  const event = load.current_event;
  if (!event) {
    return 'dispatched';
  }

  const type = event.event_type || 'pickup';

  // Arrived phase: arrived_at set, departed_at not set
  if (event.arrived_at && !event.departed_at) {
    return `arrived_${type}`;
  }

  // Enroute phase: the driver is heading toward this event's location.
  // CRITICAL: we only return "enroute" if the driver has ACTIVELY started
  // working the move. Just being dispatched (driver notified, assigned,
  // has NOT clicked Start Move or accepted on their mobile app) is NOT
  // "enroute" — the load should still display as "Dispatched".
  //
  // "Actively started" means one of:
  //   1. The current event's move has started_at set — the dispatcher
  //      clicked Start Move OR the driver accepted via mobile.
  //   2. Some prior event already has a departed_at — the driver finished
  //      an earlier leg and is now provably driving to the next one.
  const moveStarted = !!event.move?.started_at;

  const allEvents = load.routing_events || [];
  const sortedEvents = [...allEvents].sort(
    (a, b) => (a.sequence ?? 0) - (b.sequence ?? 0)
  );
  const currentIdx = sortedEvents.findIndex((e) => e.id === event.id);
  const anyPriorDeparted =
    currentIdx > 0 &&
    sortedEvents.slice(0, currentIdx).some((e) => !!e.departed_at);

  if (moveStarted || anyPriorDeparted) {
    return `enroute_${type}`;
  }

  // Driver is assigned but hasn't actively started working yet.
  return 'dispatched';
}

/**
 * Get the full state object (with label, colors, etc.) for a given load.
 */
export function getStateForLoad(load) {
  const key = deriveState(load);
  return STATE_BY_KEY[key] || STATE_BY_KEY.pending;
}

// ============================================================
// Order status derivation (coarse buckets for KPI engine)
// ============================================================

/**
 * Compute the canonical `orders.status` bucket from the full routing event
 * set. This is the source of truth for the dispatcher board KPI cards at
 * the top of the page (Arriving On Vessel, Need Pickup, Need Delivery,
 * Containers Dropped, Dispatched Loads, etc).
 *
 * Valid return values: 'pending' | 'available' | 'dispatched' | 'in_transit' |
 *                      'dropped' | 'delivered' | 'completed' | 'cancelled'
 *
 * Transition rules (applied in order, first match wins):
 *   1. Terminal statuses stick — cancelled/completed never auto-regress
 *   2. No events → leave current status (pending/available/dispatched)
 *   3. No events touched (no arrived_at anywhere) →
 *        - keep pending / available / dispatched as-is
 *        - anything else → 'dispatched'
 *   4. Every event fully departed →
 *        - if last event is 'return' → 'completed'
 *        - if last event is 'deliver' → 'delivered'
 *        - else → 'in_transit' (shouldn't really happen)
 *   5. Last touched event is a Drop that has departed AND there's an
 *      incomplete Hook after it → 'dropped' (container parked, waiting)
 *   6. Otherwise driver is actively working a leg → 'in_transit'
 *
 * IMPORTANT: terminal statuses (cancelled, completed) are sticky. If a user
 * rolls back a load, they must explicitly call uncomplete_load to reopen it.
 *
 * @param {Array} events  — full list of routing events (any shape with
 *                          { sequence, event_type, arrived_at, departed_at })
 * @param {string} currentStatus — the load's current orders.status value
 * @returns {string} the new canonical status bucket
 */
export function deriveOrderStatusFromEvents(events, currentStatus) {
  // Rule 1: terminal states are sticky (completed + cancelled require
  // explicit user action to revert). pending_completion is NOT sticky —
  // if a routing event is un-done, the derivation naturally re-evaluates.
  if (currentStatus === 'cancelled') return 'cancelled';
  if (currentStatus === 'completed') return 'completed';

  const sorted = [...(events || [])].sort(
    (a, b) => (a.sequence ?? 0) - (b.sequence ?? 0)
  );

  // Rule 2: no events → don't change anything
  if (sorted.length === 0) return currentStatus || 'pending';

  // Rule 3: nothing started yet
  const anyProgress = sorted.some((e) => e.arrived_at || e.departed_at);
  if (!anyProgress) {
    if (['pending', 'available', 'dispatched'].includes(currentStatus)) {
      return currentStatus;
    }
    return 'dispatched';
  }

  // Rule 4: everything completed — all events have departed_at set
  const allDeparted = sorted.every((e) => !!e.departed_at);
  if (allDeparted) {
    const last = sorted[sorted.length - 1];
    const type = last.event_type || '';
    // When the last event is 'return' and all events are done, the load
    // goes to 'pending_completion' — NOT 'completed'. The dispatcher must
    // manually click "Complete Load" to finalize it. This gives them a
    // chance to verify PODs, charges, and driver pay before closing.
    if (type === 'return') return 'pending_completion';
    if (type === 'deliver') return 'delivered';
    return 'in_transit';
  }

  // Rule 5: find the latest touched event and check for dropped state
  const lastTouchedIdx = [...sorted]
    .map((e, i) => ({ e, i }))
    .reverse()
    .find(({ e }) => e.arrived_at || e.departed_at)?.i;

  if (lastTouchedIdx != null) {
    const lastTouched = sorted[lastTouchedIdx];
    const futureEvents = sorted.slice(lastTouchedIdx + 1);

    if (lastTouched.event_type === 'drop' && lastTouched.departed_at) {
      // Container was dropped — check if anyone is coming back for it
      const hasIncompleteHook = futureEvents.some(
        (e) => e.event_type === 'hook' && !e.arrived_at
      );
      // Dropped if there IS a pending hook (driver handoff) OR if the drop
      // is the last touched event with no further activity in future events
      // (container is just sitting there, driver left)
      const hasAnyFutureProgress = futureEvents.some(
        (e) => e.arrived_at || e.departed_at
      );
      if (hasIncompleteHook || !hasAnyFutureProgress) {
        return 'dropped';
      }
    }
  }

  // Rule 6: driver is actively working
  return 'in_transit';
}

// ============================================================
// Container loaded/empty derivation
// ============================================================

/**
 * Derive whether the container is currently "loaded" or "empty" based on
 * where the driver is in the routing sequence + the load type.
 *
 * Import / Inbound workflow:
 *   pull (loaded out of terminal) → deliver (unloaded at warehouse) →
 *   return (empty back to terminal). So:
 *     - Before pull completes → no container
 *     - Between pull and deliver → Loaded
 *     - Between deliver and return → Empty
 *     - After return → done
 *
 * Export / Outbound workflow:
 *   pickup (empty from yard/terminal) → delivery (loaded at warehouse) →
 *   return (deliver loaded container to terminal). So:
 *     - Before pickup → no container
 *     - Between pickup and delivery → Empty
 *     - Between delivery and return → Loaded
 *     - After return → done
 *
 * For domestic / road / bill_only we return null (unknown).
 *
 * @param {object} load   — load with load_type
 * @param {Array} events  — full routing events
 * @returns {'loaded' | 'empty' | null}
 */
export function deriveContainerLoadedState(load, events) {
  if (!load || !events || events.length === 0) return null;
  const loadType = load.load_type || 'import';
  if (loadType === 'bill_only' || loadType === 'road') return null;

  const sorted = [...events].sort(
    (a, b) => (a.sequence ?? 0) - (b.sequence ?? 0)
  );

  // Find the most recent "state-changing" event that has departed
  // (pull/pickup = takes ownership, deliver = unloads, return = gives back)
  let state = null; // 'loaded' | 'empty' | null

  const isImportFlow = ['import', 'inbound'].includes(loadType);
  const isExportFlow = ['export', 'outbound'].includes(loadType);

  for (const e of sorted) {
    const type = e.event_type;
    const fullyDone = !!e.departed_at;
    const started = !!e.arrived_at;

    if (isImportFlow) {
      // pull departed → now loaded; deliver departed → now empty; return departed → done
      if (type === 'pull' && fullyDone) state = 'loaded';
      else if (type === 'deliver' && fullyDone) state = 'empty';
      else if (type === 'return' && fullyDone) state = null;
    } else if (isExportFlow) {
      // pickup departed → now empty (with empty container); delivery departed → now loaded
      if (type === 'pickup' && fullyDone) state = 'empty';
      else if (type === 'delivery' && fullyDone) state = 'loaded';
      else if (type === 'return' && fullyDone) state = null;
    }

    // Drop + hook don't change loaded/empty — they just park or resume
    // whatever state the container was already in
  }

  return state;
}

/**
 * Derive the current location the container is physically at (or being
 * driven toward). Returns the location name of the "active" event.
 */
export function deriveCurrentLocationName(load, events) {
  if (!load || !events || events.length === 0) return null;
  const sorted = [...events].sort(
    (a, b) => (a.sequence ?? 0) - (b.sequence ?? 0)
  );

  // If all events done, point at the last event
  const allDone = sorted.every((e) => !!e.departed_at);
  if (allDone) {
    return sorted[sorted.length - 1]?.location_name || null;
  }

  // Find the first incomplete event (the "current" target)
  const current = sorted.find((e) => !e.departed_at);
  if (!current) return null;

  // Special case: if we're sitting at a Drop event that's fully departed,
  // the container is physically AT that drop location
  const lastDeparted = [...sorted].reverse().find((e) => !!e.departed_at);
  if (
    lastDeparted &&
    lastDeparted.event_type === 'drop' &&
    !current.arrived_at
  ) {
    return lastDeparted.location_name || null;
  }

  return current.location_name || null;
}
