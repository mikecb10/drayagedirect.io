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

// Each *AptInRange helper checks the appointment window (from/to) FIRST.
// If those are empty, it falls back to the corresponding base date field
// (pickup_date, delivery_date, ready_to_return_date). This keeps the KPI
// cards consistent with the board-level date filter (applyDateFilter in
// pages/dispatcher/index.js) which checks the 6 canonical date fields.
//
// Without the fallback, a load with e.g. delivery_date=today but no
// appointment window would be counted by some cards and not others, and
// clicking a KPI card would show an empty board — the bug fixed here.

export function pickupAptInRange(load, filter) {
  if (isInDateRange(load.pickup_apt_from, filter)) return true;
  if (isInDateRange(load.pickup_apt_to, filter)) return true;
  // Fallback: no apt window set → use pickup_date
  if (!load.pickup_apt_from && !load.pickup_apt_to) {
    return isInDateRange(load.pickup_date, filter);
  }
  return false;
}

export function deliveryAptInRange(load, filter) {
  if (isInDateRange(load.delivery_apt_from, filter)) return true;
  if (isInDateRange(load.delivery_apt_to, filter)) return true;
  // Fallback: no apt window set → use delivery_date
  if (!load.delivery_apt_from && !load.delivery_apt_to) {
    return isInDateRange(load.delivery_date, filter);
  }
  return false;
}

export function returnAptInRange(load, filter) {
  if (isInDateRange(load.return_apt_from, filter)) return true;
  if (isInDateRange(load.return_apt_to, filter)) return true;
  // Fallback: no apt window set → use ready_to_return_date
  if (!load.return_apt_from && !load.return_apt_to) {
    return isInDateRange(load.ready_to_return_date, filter);
  }
  return false;
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

/**
 * Get the customer_types[] of the NEXT stop — the first routing event (by
 * sequence) that hasn't been departed yet. Used for In Transit card to
 * determine whether the driver is heading to a yard (drop off) or a
 * customer/warehouse (direct delivery).
 *
 * Returns [] if no next stop or no embedded location data.
 */
function getNextStopOrgTypes(load) {
  const events = (load.routing_events || [])
    .slice()
    .sort((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0));
  const nextStop = events.find((e) => !e.departed_at);
  return nextStop?.location?.customer_types || [];
}

function isInTransitToYard(load) {
  if (load.status !== 'in_transit') return false;
  return getNextStopOrgTypes(load).includes('yard');
}

function isInTransitToCustomer(load) {
  if (load.status !== 'in_transit') return false;
  const types = getNextStopOrgTypes(load);
  if (types.includes('yard')) return false; // yard wins
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
// Card 1 — Container Arriving On Vessel / Rail
// ============================================================
//
// Parent trigger: load is pending, has an expected arrival in range
// (vessel_eta for marine, container_eta as fallback for rail / inbound),
// and doesn't yet have LFD or pickup appointment set. Once LFD/APT
// appear, the load graduates to Card 2 (Need To Be Picked Up).
//
// Sub-cards are a mutually-exclusive workflow progression:
//   1. No Arrival Yet       — still en route (discharge/deramp hasn't happened)
//   2. Arrived - On Hold    — physically arrived, terminal holds still blocking
//   3. Released             — arrived + all holds released → actionable
//
// "Arrived" is detected by the earliest of: discharge_date in past (vessel
// discharge or rail deramp — same field), container_eta in past (safety net
// so a stale ETA surfaces the load for investigation), or an explicit
// 'arrived' routing event with arrived_at set.

function arrivingOnVessel(load, filter) {
  return (
    load.status === 'pending' &&
    (isInDateRange(load.vessel_eta, filter) ||
      isInDateRange(load.container_eta, filter)) &&
    !load.last_free_day &&
    !load.pickup_apt_from
  );
}

function hasArrived(load) {
  const today = localDateStr(new Date());
  if (load.discharge_date && toDateStr(load.discharge_date) <= today) return true;
  if (load.container_eta && toDateStr(load.container_eta) <= today) return true;
  const arrivedEvent = (load.routing_events || []).find(
    (e) => e.event_type === 'arrived' && e.arrived_at
  );
  if (arrivedEvent) return true;
  return false;
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
    // Card 1: Arriving On Vessel / Rail
    arriving_on_vessel: 0,
    arriving_no_arrival_yet: 0,
    arriving_arrived_on_hold: 0,
    arriving_released: 0,
    // Legacy key kept (now always 0) for any stale consumers referencing it.
    arriving_on_hold: 0,

    // Card 2: Need To Be Picked Up
    need_pickup: 0,
    need_pickup_lfd: 0,
    need_pickup_apt: 0,

    // Card 3: Need To Be Delivered
    need_delivery: 0,
    need_delivery_at_port: 0,
    need_delivery_in_yard: 0,

    // Card 3.5: In Transit (between Need Delivery and Need Return)
    in_transit: 0,
    in_transit_to_yard: 0,
    in_transit_to_customer: 0,

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
    // ── Card 1: Arriving On Vessel / Rail ──
    // Workflow-progression sub-cards:
    //   1. No Arrival Yet       — hasn't arrived yet
    //   2. Arrived - On Hold    — arrived but holds blocking
    //   3. Released             — arrived and all holds released (actionable)
    // Sum of sub-cards = parent (mutually exclusive).
    if (arrivingOnVessel(load, dateFilter)) {
      stats.arriving_on_vessel++;
      const { bothReleased } = getHoldFlags(load);
      const arrived = hasArrived(load);
      if (!arrived) {
        stats.arriving_no_arrival_yet++;
      } else if (bothReleased) {
        stats.arriving_released++;
      } else {
        stats.arriving_arrived_on_hold++;
      }
    }

    // ── Card 2: Need To Be Picked Up ──
    // Status gate: include 'dispatched' + 'in_transit' in addition to
    // pending/available. Rationale: a load with LFD today but already
    // dispatched is still time-sensitive (dispatcher needs to ensure the
    // driver gets it before demurrage hits). Applies to all load types —
    // INBOUND containers with LFD set should also surface here. Excludes
    // dropped/completed loads (those are handled by other cards).
    const NEED_PICKUP_STATUSES = ['pending', 'available', 'dispatched', 'in_transit'];
    if (NEED_PICKUP_STATUSES.includes(load.status)) {
      const lfdMatch = isInDateRange(load.last_free_day, dateFilter);
      const aptMatch = pickupAptInRange(load, dateFilter);
      if (lfdMatch || aptMatch) stats.need_pickup++;
      // Sub-cards are mutually exclusive — workflow progression, not
      // overlapping categories. APT supersedes LFD: once a pickup
      // appointment is scheduled, the next dispatcher action is the
      // appointment itself (the LFD urgency is absorbed into the APT).
      // This makes LFD + APT totals equal the parent count.
      if (aptMatch) {
        stats.need_pickup_apt++;
      } else if (lfdMatch) {
        stats.need_pickup_lfd++;
      }
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

    // ── Card 3.5: In Transit ──
    // Driver has the container and is en route. Sub-cards split on the NEXT
    // stop's org type — yard vs customer/warehouse — revealing whether the
    // move ends with a drop (yard) or a live delivery (customer).
    // Mutually exclusive: sum = parent.
    if (
      load.status === 'in_transit' &&
      (dateFilter === 'all' || hasAnyDispatchDateInRange(load, dateFilter))
    ) {
      stats.in_transit++;
      if (isInTransitToYard(load)) {
        stats.in_transit_to_yard++;
      } else if (isInTransitToCustomer(load)) {
        stats.in_transit_to_customer++;
      } else {
        // Unknown next-stop type — default to customer (live delivery is
        // the more common drayage path; yards need explicit tagging).
        stats.in_transit_to_customer++;
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
    // Respect the universal date filter — a dropped container is "relevant
    // today" only if it has a key date today (cutoff, ready_to_return, apt
    // windows, LFD). Without this gate, stale dropped loads inflate the
    // counter but the click-filter would find none on the board because
    // applyDateFilter strips them.
    if (
      load.status === 'dropped' &&
      (dateFilter === 'all' || hasAnyDispatchDateInRange(load, dateFilter))
    ) {
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
    // Card 1 — sub-cards are workflow progression (mutually exclusive):
    //   1. arriving_no_arrival_yet — not yet arrived
    //   2. arriving_arrived_on_hold — arrived but holds blocking
    //   3. arriving_released — arrived + all holds released
    // Sum of sub-cards equals parent count.
    arriving_on_vessel: (l) => arrivingOnVessel(l, dateFilter),
    arriving_no_arrival_yet: (l) => {
      if (!arrivingOnVessel(l, dateFilter)) return false;
      return !hasArrived(l);
    },
    arriving_arrived_on_hold: (l) => {
      if (!arrivingOnVessel(l, dateFilter)) return false;
      if (!hasArrived(l)) return false;
      const { bothReleased } = getHoldFlags(l);
      return !bothReleased;
    },
    arriving_released: (l) => {
      if (!arrivingOnVessel(l, dateFilter)) return false;
      if (!hasArrived(l)) return false;
      const { bothReleased } = getHoldFlags(l);
      return bothReleased;
    },
    // Legacy key — kept as a no-op passthrough for any stale links, but
    // should never match since we no longer emit it in stats.
    arriving_on_hold: () => false,

    // Card 2 — status set must match NEED_PICKUP_STATUSES in computeKpiStats.
    // LFD and APT sub-cards are mutually exclusive workflow buckets:
    //   - APT: has a pickup appointment in range (regardless of LFD)
    //   - LFD: has LFD in range but NO appointment in range yet
    // So LFD + APT totals always equal the parent count.
    need_pickup: (l) =>
      ['pending', 'available', 'dispatched', 'in_transit'].includes(l.status) &&
      (isInDateRange(l.last_free_day, dateFilter) || pickupAptInRange(l, dateFilter)),
    need_pickup_lfd: (l) =>
      ['pending', 'available', 'dispatched', 'in_transit'].includes(l.status) &&
      isInDateRange(l.last_free_day, dateFilter) &&
      !pickupAptInRange(l, dateFilter),
    need_pickup_apt: (l) =>
      ['pending', 'available', 'dispatched', 'in_transit'].includes(l.status) &&
      pickupAptInRange(l, dateFilter),

    // Card 3
    need_delivery: (l) => isNeedDeliveryParent(l, dateFilter),
    need_delivery_at_port: (l) => isNeedDeliveryParent(l, dateFilter) && isAtPortStatus(l),
    need_delivery_in_yard: (l) => isNeedDeliveryParent(l, dateFilter) && l.status === 'dropped',

    // Card 3.5 — In Transit. Sub-cards mutually exclusive by next-stop org
    // type. Gated by date filter same as Containers Dropped and Dispatched
    // Loads so counter and click-filter agree.
    in_transit: (l) =>
      l.status === 'in_transit' &&
      (dateFilter === 'all' || hasAnyDispatchDateInRange(l, dateFilter)),
    in_transit_to_yard: (l) => {
      if (l.status !== 'in_transit') return false;
      if (dateFilter !== 'all' && !hasAnyDispatchDateInRange(l, dateFilter)) return false;
      return isInTransitToYard(l);
    },
    in_transit_to_customer: (l) => {
      if (l.status !== 'in_transit') return false;
      if (dateFilter !== 'all' && !hasAnyDispatchDateInRange(l, dateFilter)) return false;
      // Mirror engine fallback: if neither yard nor customer tagged, default
      // to customer so the load is click-retrievable from the card.
      if (isInTransitToYard(l)) return false;
      if (isInTransitToCustomer(l)) return true;
      return true; // unknown → customer
    },

    // Card 4
    need_return: (l) => isNeedReturnParent(l, dateFilter),
    need_return_ready: (l) => isNeedReturnParent(l, dateFilter) && !!l.ready_to_return_date,
    need_return_not_ready: (l) => isNeedReturnParent(l, dateFilter) && !l.ready_to_return_date,

    // Card 5 — gate by date filter to match the counter in computeKpiStats.
    containers_dropped: (l) =>
      l.status === 'dropped' &&
      (dateFilter === 'all' || hasAnyDispatchDateInRange(l, dateFilter)),
    dropped_in_yard: (l) => {
      if (l.status !== 'dropped') return false;
      if (dateFilter !== 'all' && !hasAnyDispatchDateInRange(l, dateFilter)) return false;
      // Mirror the engine: explicit yard OR fallback to "unknown → in_yard"
      if (isDroppedInYard(l)) return true;
      if (isDroppedAtCustomer(l)) return false;
      return true; // unknown defaults to in_yard
    },
    dropped_at_customer: (l) =>
      isDroppedAtCustomer(l) &&
      (dateFilter === 'all' || hasAnyDispatchDateInRange(l, dateFilter)),

    // Card 6
    dispatched_loads: (l) => isDispatchedLoadParent(l, dateFilter),

    // Card 7
    finished_today: (l) => isFinishedToday(l),
  };

  return fns[cardKey] || (() => true);
}
