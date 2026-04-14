/**
 * KPI Engine — computes dispatcher board card counts from a load set.
 *
 * Each KPI card has a filter function that determines which loads belong
 * to it. The engine runs every load through all 7 cards and returns
 * counts + sub-card breakdowns.
 *
 * The universal date filter controls which loads are considered:
 *   - 'all'      → no date filter (all active loads)
 *   - 'past_due' → dates before today that aren't complete
 *   - 'today'    → dates matching today
 *   - '+N'       → dates matching today + N days
 */

import { deriveState } from './dispatcher-states';

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/**
 * Build the date filter presets based on the current day.
 * Returns an array of { key, label, shortLabel } for the filter bar.
 */
export function buildDatePresets() {
  const today = new Date();
  const presets = [
    { key: 'all', label: 'All Days', shortLabel: 'All' },
    { key: 'past_due', label: 'Past Due', shortLabel: 'Past Due' },
    { key: 'today_and_past', label: 'Today + Past Due', shortLabel: 'Today+Past' },
    { key: 'today', label: 'Today', shortLabel: 'Today' },
  ];

  for (let i = 1; i <= 7; i++) {
    const d = new Date(today);
    d.setDate(d.getDate() + i);
    const dayName = DAY_NAMES[d.getDay()];
    presets.push({
      key: `+${i}`,
      label: i === 1 ? `Tomorrow (${dayName.slice(0, 3)})` : `${dayName} (+${i})`,
      shortLabel: i === 1 ? 'Tomorrow' : `+${i}`,
    });
  }

  return presets;
}

// ============================================================
// Date helpers
// ============================================================

// Format a Date object to YYYY-MM-DD in LOCAL time (not UTC).
// Using UTC causes timezone bugs — e.g. 8pm CDT on Apr 13 is
// Apr 14 in UTC, making "today" off by a day for US users.
function localDateStr(d) {
  const yr = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, '0');
  const dy = String(d.getDate()).padStart(2, '0');
  return `${yr}-${mo}-${dy}`;
}

function toDateStr(d) {
  if (!d) return null;
  // Date-only strings like "2026-04-13" parse as UTC midnight in JS,
  // so extract the YYYY-MM-DD directly if the string is already a date.
  if (typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d)) return d;
  if (typeof d === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(d)) return d.slice(0, 10);
  return localDateStr(new Date(d));
}

function addDays(dateStr, n) {
  const d = new Date(dateStr + 'T12:00:00');
  d.setDate(d.getDate() + n);
  return localDateStr(d);
}

export function isInDateRange(date, filter) {
  if (!date) return false;
  if (filter === 'all') return true;

  const d = toDateStr(date);
  if (!d) return false;
  const today = localDateStr(new Date());

  if (filter === 'past_due') return d < today;
  if (filter === 'today') return d === today;
  if (filter === 'today_and_past') return d <= today;
  if (filter.startsWith('+')) {
    const n = parseInt(filter.slice(1));
    return d === addDays(today, n);
  }
  return true;
}

// ============================================================
// Window helpers — match if EITHER end of an apt window is in range
// ============================================================

function pickupAptInRange(load, filter) {
  return (
    isInDateRange(load.pickup_apt_from, filter) ||
    isInDateRange(load.pickup_apt_to, filter)
  );
}

function deliveryAptInRange(load, filter) {
  return (
    isInDateRange(load.delivery_apt_from, filter) ||
    isInDateRange(load.delivery_apt_to, filter)
  );
}

function returnAptInRange(load, filter) {
  return (
    isInDateRange(load.return_apt_from, filter) ||
    isInDateRange(load.return_apt_to, filter)
  );
}

/**
 * Refined date check for the Dispatched Loads card — only the 6 specific
 * date types from the canonical spec. Excludes vessel_eta and per_diem_free_day.
 */
function hasAnyDispatchDateInRange(load, filter) {
  return (
    isInDateRange(load.last_free_day, filter) ||
    pickupAptInRange(load, filter) ||
    deliveryAptInRange(load, filter) ||
    returnAptInRange(load, filter) ||
    isInDateRange(load.cutoff_date, filter) ||
    isInDateRange(load.ready_to_return_date, filter)
  );
}

// ============================================================
// Routing event helpers
// ============================================================

/**
 * Check if the load's deliver event has a driver assigned to it.
 * Driver is stored on the parent move (order_container_moves.driver_id),
 * embedded into each event via `event.move.driver_id`.
 */
function deliverEventHasDriver(load) {
  const events = load.routing_events || [];
  const deliverEvent = events.find((e) => e.event_type === 'deliver');
  if (!deliverEvent) return false;
  return !!deliverEvent.move?.driver_id;
}

/**
 * Get the customer_types[] of the active drop event's location.
 * "Active drop" = the LAST drop event (by sequence) that has departed_at set,
 * meaning the driver dropped the container and left it sitting.
 *
 * Returns [] if no active drop or no embedded location data.
 */
function getActiveDropOrgTypes(load) {
  const events = (load.routing_events || [])
    .slice()
    .sort((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0));

  let activeDrop = null;
  for (const e of events) {
    if (e.event_type === 'drop' && e.departed_at) activeDrop = e;
  }
  return activeDrop?.location?.customer_types || [];
}

function isDroppedInYard(load) {
  if (load.status !== 'dropped') return false;
  const types = getActiveDropOrgTypes(load);
  // Yard wins over warehouse if both are tagged
  return types.includes('yard');
}

function isDroppedAtCustomer(load) {
  if (load.status !== 'dropped') return false;
  const types = getActiveDropOrgTypes(load);
  // If marked as yard, it's NOT at customer
  if (types.includes('yard')) return false;
  // Otherwise warehouse, customer, or final_destination → at customer
  return (
    types.includes('warehouse') ||
    types.includes('customer') ||
    types.includes('final_destination')
  );
}

// ============================================================
// "At Port" status / dispatcher state helper
// ============================================================
//
// Per the canonical spec, "At Port" sub-card includes loads in any of these
// statuses or fine-grained dispatcher states:
//   - status: pending, available, dispatched
//   - dispatcher state: enroute_pull, arrived_pull, enroute_pickup, arrived_pickup
//
// We include both pull and pickup phases since both mean "container is still
// at the terminal/port, waiting to be picked up".

const AT_PORT_DISPATCHER_STATES = new Set([
  'enroute_pull',
  'arrived_pull',
  'enroute_pickup',
  'arrived_pickup',
]);

function isAtPortStatus(load) {
  if (['pending', 'available', 'dispatched'].includes(load.status)) return true;
  return AT_PORT_DISPATCHER_STATES.has(deriveState(load));
}

// ============================================================
// Hold helpers
// ============================================================

function getHoldFlags(load) {
  const customHold = (load.holds || []).find((h) => h.hold_type === 'custom');
  const freightHold = (load.holds || []).find((h) => h.hold_type === 'freight');
  const bothReleased =
    (customHold?.status === 'released' || !customHold) &&
    (freightHold?.status === 'released' || !freightHold);
  const anyOnHold =
    customHold?.status === 'hold' || freightHold?.status === 'hold';
  return { bothReleased, anyOnHold };
}

// ============================================================
// Card 1 — Container Arriving On Vessel
// ============================================================

function arrivingOnVessel(load, filter) {
  return (
    load.status === 'pending' &&
    isInDateRange(load.vessel_eta, filter) &&
    !load.last_free_day &&
    !load.pickup_apt_from
  );
}

// ============================================================
// Card 3 — Need To Be Delivered helpers
// ============================================================

const NEED_DELIVERY_STATUSES = new Set([
  'pending',
  'available',
  'dispatched',
  'in_transit',
  'dropped',
]);

function isNeedDeliveryParent(load, filter) {
  return (
    NEED_DELIVERY_STATUSES.has(load.status) &&
    deliveryAptInRange(load, filter) &&
    !deliverEventHasDriver(load)
  );
}

// ============================================================
// Card 4 — Need To Be Returned helpers
// ============================================================

function isNeedReturnParent(load, filter) {
  if (load.status !== 'dropped') return false;
  return (
    isInDateRange(load.cutoff_date, filter) ||
    isInDateRange(load.ready_to_return_date, filter) ||
    returnAptInRange(load, filter)
  );
}

// ============================================================
// Card 6 — Dispatched Loads helpers
// ============================================================

function isDispatchedLoadParent(load, filter) {
  const statusOk =
    ['dispatched', 'in_transit'].includes(load.status) ||
    (load.status === 'dropped' && !!load.driver_id);
  if (!statusOk) return false;
  if (filter === 'all') return true;
  return hasAnyDispatchDateInRange(load, filter);
}

// ============================================================
// Card 7 — Finished Today helpers
// ============================================================

function isFinishedToday(load) {
  const today = new Date().toISOString().slice(0, 10);
  // Spec distinguishes "Load Completed Date" vs "Load Delivered Date" but
  // our schema uses one timestamp (actual_delivery_at) for both transitions.
  if (load.status === 'completed' && toDateStr(load.actual_delivery_at) === today) {
    return true;
  }
  if (load.status === 'dropped' && toDateStr(load.actual_delivery_at) === today) {
    return true;
  }
  return false;
}

// ============================================================
// Compute all stats from the loads array
// ============================================================

/**
 * Compute all KPI stats from a set of loads.
 *
 * @param {Array} loads — full load objects with holds and routing_events
 *                       (events must include nested move + location)
 * @param {string} dateFilter — the active date filter key
 * @returns {object} — stats with counts for all 7 cards + sub-cards
 */
export function computeKpiStats(loads, dateFilter = 'all') {
  const stats = {
    // Card 1: Arriving On Vessel
    arriving_on_vessel: 0,
    arriving_released: 0,
    arriving_on_hold: 0,

    // Card 2: Need To Be Picked Up
    need_pickup: 0,
    need_pickup_lfd: 0,
    need_pickup_apt: 0,

    // Card 3: Need To Be Delivered
    need_delivery: 0,
    need_delivery_at_port: 0,
    need_delivery_in_yard: 0,

    // Card 4: Need To Be Returned
    need_return: 0,
    need_return_ready: 0,
    need_return_not_ready: 0,

    // Card 5: Containers Dropped
    containers_dropped: 0,
    dropped_in_yard: 0,
    dropped_at_customer: 0,

    // Card 6: Dispatched Loads
    dispatched_loads: 0,

    // Card 7: Finished Today
    finished_today: 0,
  };

  for (const load of loads) {
    // ── Card 1: Arriving On Vessel ──
    if (arrivingOnVessel(load, dateFilter)) {
      stats.arriving_on_vessel++;
      const { bothReleased, anyOnHold } = getHoldFlags(load);
      if (bothReleased) stats.arriving_released++;
      if (anyOnHold) stats.arriving_on_hold++;
    }

    // ── Card 2: Need To Be Picked Up ──
    if (['pending', 'available'].includes(load.status)) {
      const lfdMatch = isInDateRange(load.last_free_day, dateFilter);
      const aptMatch = pickupAptInRange(load, dateFilter);
      if (lfdMatch || aptMatch) stats.need_pickup++;
      if (lfdMatch) stats.need_pickup_lfd++;
      if (aptMatch) stats.need_pickup_apt++;
    }

    // ── Card 3: Need To Be Delivered ──
    if (isNeedDeliveryParent(load, dateFilter)) {
      stats.need_delivery++;
      // At Port: pre-delivery operational statuses + pickup-phase dispatcher states
      if (isAtPortStatus(load)) {
        stats.need_delivery_at_port++;
      }
      // In Yard: container is currently dropped at a yard waiting for delivery
      if (load.status === 'dropped') {
        stats.need_delivery_in_yard++;
      }
    }

    // ── Card 4: Need To Be Returned ──
    if (isNeedReturnParent(load, dateFilter)) {
      stats.need_return++;
      if (load.ready_to_return_date) {
        stats.need_return_ready++;
      } else {
        stats.need_return_not_ready++;
      }
    }

    // ── Card 5: Containers Dropped ──
    if (load.status === 'dropped') {
      stats.containers_dropped++;
      if (isDroppedInYard(load)) {
        stats.dropped_in_yard++;
      } else if (isDroppedAtCustomer(load)) {
        stats.dropped_at_customer++;
      } else {
        // Unknown / no org type — default to in_yard (safer assumption)
        stats.dropped_in_yard++;
      }
    }

    // ── Card 6: Dispatched Loads ──
    if (isDispatchedLoadParent(load, dateFilter)) {
      stats.dispatched_loads++;
    }

    // ── Card 7: Finished Today ──
    if (isFinishedToday(load)) {
      stats.finished_today++;
    }
  }

  return stats;
}

// ============================================================
// Client-side filter functions for clicking a card → filter the board
// ============================================================

/**
 * Given a KPI card key, return a predicate that filters loads to just
 * those matching that card's conditions. Mirrors the logic in computeKpiStats
 * exactly so the count and the visible filtered set always agree.
 */
export function getKpiFilterFn(cardKey, dateFilter = 'all') {
  const fns = {
    // Card 1
    arriving_on_vessel: (l) => arrivingOnVessel(l, dateFilter),
    arriving_released: (l) => {
      if (!arrivingOnVessel(l, dateFilter)) return false;
      const { bothReleased } = getHoldFlags(l);
      return bothReleased;
    },
    arriving_on_hold: (l) => {
      if (!arrivingOnVessel(l, dateFilter)) return false;
      const { anyOnHold } = getHoldFlags(l);
      return anyOnHold;
    },

    // Card 2
    need_pickup: (l) =>
      ['pending', 'available'].includes(l.status) &&
      (isInDateRange(l.last_free_day, dateFilter) || pickupAptInRange(l, dateFilter)),
    need_pickup_lfd: (l) =>
      ['pending', 'available'].includes(l.status) && isInDateRange(l.last_free_day, dateFilter),
    need_pickup_apt: (l) =>
      ['pending', 'available'].includes(l.status) && pickupAptInRange(l, dateFilter),

    // Card 3
    need_delivery: (l) => isNeedDeliveryParent(l, dateFilter),
    need_delivery_at_port: (l) => isNeedDeliveryParent(l, dateFilter) && isAtPortStatus(l),
    need_delivery_in_yard: (l) => isNeedDeliveryParent(l, dateFilter) && l.status === 'dropped',

    // Card 4
    need_return: (l) => isNeedReturnParent(l, dateFilter),
    need_return_ready: (l) => isNeedReturnParent(l, dateFilter) && !!l.ready_to_return_date,
    need_return_not_ready: (l) => isNeedReturnParent(l, dateFilter) && !l.ready_to_return_date,

    // Card 5
    containers_dropped: (l) => l.status === 'dropped',
    dropped_in_yard: (l) => {
      if (l.status !== 'dropped') return false;
      // Mirror the engine: explicit yard OR fallback to "unknown → in_yard"
      if (isDroppedInYard(l)) return true;
      if (isDroppedAtCustomer(l)) return false;
      return true; // unknown defaults to in_yard
    },
    dropped_at_customer: (l) => isDroppedAtCustomer(l),

    // Card 6
    dispatched_loads: (l) => isDispatchedLoadParent(l, dateFilter),

    // Card 7
    finished_today: (l) => isFinishedToday(l),
  };

  return fns[cardKey] || (() => true);
}
