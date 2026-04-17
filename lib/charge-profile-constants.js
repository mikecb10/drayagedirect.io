/**
 * Charge Profile Constants — Complete field-level specification.
 * Single source of truth for all dropdowns, calculation modes, and event mappings.
 */

// ============================================================
// CHARGE NAMES (shown on invoices as line item name)
// ============================================================
export const CHARGE_NAMES = [
  { value: 'LINE_HAUL', label: 'Line Haul' },
  { value: 'BASE_PRICE', label: 'Base Price' },
  { value: 'FUEL', label: 'Fuel Surcharge' },
  { value: 'CHASSIS', label: 'Chassis' },
  { value: 'CHASSIS_SPLIT', label: 'Chassis Split' },
  { value: 'DETENTION', label: 'Detention' },
  { value: 'STORAGE', label: 'Storage' },
  { value: 'WAITING_TIME', label: 'Waiting Time' },
  { value: 'OVER_WEIGHT', label: 'Over Weight' },
  { value: 'HAZMAT', label: 'Hazmat' },
  { value: 'PREPULL', label: 'Pre Pull' },
  { value: 'TRI_AXLE', label: 'Tri Axle' },
  { value: 'STOP_OFF', label: 'Stop Off' },
  { value: 'WASHOUT_CONTAINER', label: 'Washout / Container Cleaning' },
  { value: 'PER_DIEM', label: 'Per Diem' },
  { value: 'TOLL', label: 'Toll' },
  { value: 'REEFER', label: 'Reefer' },
  { value: 'OVERHEIGHT', label: 'Overheight' },
  { value: 'CONGESTION', label: 'Congestion' },
  { value: 'SCALE', label: 'Scale' },
  { value: 'GENSET', label: 'Genset' },
  { value: 'BOBTAIL', label: 'Bobtail' },
];

// ============================================================
// UNITS OF MEASURE
// ============================================================
export const UNITS_OF_MEASURE = [
  { value: 'fixed', label: 'Fixed' },
  { value: 'percentage', label: 'Percentage' },
  { value: 'per_day', label: 'Per Day' },
  { value: 'per_hour', label: 'Per Hour' },
  { value: 'per_15min', label: 'Per 15 Minutes' },
  { value: 'per_30min', label: 'Per 30 Minutes' },
  { value: 'per_45min', label: 'Per 45 Minutes' },
  { value: 'per_pounds', label: 'Per Pounds' },
  { value: 'per_miles', label: 'Per Miles' },
  { value: 'per_road_toll_miles', label: 'Per Road Toll Miles' },
  { value: 'radius_rate', label: 'Radius Rate' },
];

// ============================================================
// WHICH CALCULATION MODES ARE AVAILABLE PER UOM
// ============================================================
export const UOM_MODES = {
  fixed:               ['by_lane', 'by_event', 'by_move'],
  // Percentage is a scalar (e.g. "15% of LINE_HAUL") that applies whenever
  // the matching base charge fires. The by_event/by_move modes are
  // conceptually meaningless for percentages — there's no event/move-
  // specific rate to vary by — and historically caused profiles to
  // silently bill $0 when the gating event hadn't occurred yet (see the
  // engine fix in lib/pricing-tier-resolver.js for the corresponding
  // backstop). By Lane with no location filters is the canonical "always
  // apply" config.
  percentage:          ['by_lane'],
  per_day:             ['between_statuses', 'by_event', 'by_move'],
  per_hour:            ['between_statuses', 'by_event', 'by_move'],
  per_15min:           ['between_statuses', 'by_event', 'by_move'],
  per_30min:           ['between_statuses', 'by_event', 'by_move'],
  per_45min:           ['between_statuses', 'by_event', 'by_move'],
  per_pounds:          ['between_statuses', 'by_event', 'by_move'],
  per_miles:           ['between_statuses', 'by_event', 'by_move'],
  per_road_toll_miles: ['between_statuses', 'by_event', 'by_move'],
  radius_rate:         ['between_statuses', 'by_event', 'by_move'],
};

export const CALCULATION_MODES = [
  { value: 'by_lane', label: 'By Lane' },
  { value: 'between_statuses', label: 'Between Statuses' },
  { value: 'by_event', label: 'By Event' },
  { value: 'by_move', label: 'By Move' },
];

// ============================================================
// CALCULATE FROM / TO STATUSES (Between Statuses mode)
// ============================================================
export const STATUS_OPTIONS = [
  { value: 'ENROUTE_TO_CHASSIS', label: 'Enroute to Chassis' },
  { value: 'ARRIVED_TO_CHASSIS', label: 'Arrived to Chassis' },
  { value: 'ENROUTE_TO_PICK_CONTAINER', label: 'Enroute to Pick Container' },
  { value: 'ARRIVED_AT_PICK_CONTAINER', label: 'Arrived at Pick Container' },
  { value: 'ENROUTE_TO_DELIVER_LOAD', label: 'Enroute to Deliver Load' },
  { value: 'ARRIVED_AT_DELIVER_LOAD', label: 'Arrived at Delivery Load' },
  { value: 'ENROUTE_TO_DROP_CONTAINER', label: 'Enroute to Drop Container' },
  { value: 'DROPPED', label: 'Dropped' },
  { value: 'ENROUTE_TO_STOP_OFF', label: 'Enroute to Stop Off' },
  { value: 'ARRIVED_AT_STOP_OFF', label: 'Arrived at Stop Off' },
  { value: 'ENROUTE_TO_HOOK_CONTAINER', label: 'Enroute to Hook Container' },
  { value: 'ARRIVED_AT_HOOK_CONTAINER', label: 'Arrived at Hook Container' },
  { value: 'ENROUTE_TO_RETURN_LOAD', label: 'Enroute to Return Load' },
  { value: 'ARRIVED_AT_RETURN_LOAD', label: 'Arrived at Return Load' },
  { value: 'ENROUTE_TO_RETURN_CHASSIS', label: 'Enroute to Return Chassis' },
  { value: 'ARRIVED_TO_RETURN_CHASSIS', label: 'Arrived to Return Chassis' },
  { value: 'COMPLETED', label: 'Completed' },
  { value: 'PICKUP_APT', label: 'Pickup Apt' },
  { value: 'DELIVERY_APT', label: 'Delivery Apt' },
  { value: 'RETURN_APT', label: 'Return Apt' },
  { value: 'READY_TO_RETURN', label: 'Ready to Return' },
  { value: 'POD_IN', label: 'POD In' },
  { value: 'POD_OUT', label: 'POD Out' },
  { value: 'ENROUTE_TO_LIFT_OFF', label: 'Enroute to Lift Off' },
  { value: 'GROUNDED', label: 'Grounded' },
  { value: 'ENROUTE_TO_LIFT_ON', label: 'Enroute to Lift On' },
  { value: 'ARRIVED_TO_LIFT_ON', label: 'Arrived to Lift On' },
];

// ============================================================
// IF EVENT (By Event / By Move modes)
// ============================================================
export const EVENT_TYPES = [
  { value: 'PICK_UP_CONTAINER', label: 'Pick Up Container' },
  { value: 'DELIVER_CONTAINER', label: 'Deliver Container' },
  { value: 'RETURN_CONTAINER', label: 'Return Container' },
  { value: 'DROP_CONTAINER', label: 'Drop Container' },
  { value: 'STOP_OFF', label: 'Stop Off' },
  { value: 'TERMINATE_CHASSIS', label: 'Terminate Chassis' },
  { value: 'COMPLETED', label: 'Completed' },
  { value: 'HOOK_CONTAINER', label: 'Hook Container' },
  { value: 'HOOK_CHASSIS', label: 'Hook Chassis' },
  { value: 'LIFT_OFF', label: 'Lift Off' },
  { value: 'LIFT_ON', label: 'Lift On' },
];

// ============================================================
// EVENT TIME (By Move — when to start/stop calculating)
// ============================================================
export const EVENT_TIME_OPTIONS = [
  { value: 'arrived', label: 'Arrived' },
  { value: 'departed', label: 'Departed' },
];

// ============================================================
// BY MOVE — Calculate From/To options
// ============================================================
export const MOVE_CALC_FROM = [
  { value: 'first_event_arrived', label: 'First Event — Arrived' },
  { value: 'first_event_departed', label: 'First Event — Departed' },
];

export const MOVE_CALC_TO = [
  { value: 'last_event_arrived', label: 'Last Event — Arrived' },
  { value: 'last_event_departed', label: 'Last Event — Departed' },
  { value: 'last_event_completed', label: 'Last Event — Completed' },
];

// ============================================================
// RADIUS RATE — Rate Type options
// ============================================================
export const RADIUS_RATE_TYPES = [
  { value: 'fixed', label: 'Fixed' },
  { value: 'per_unit', label: 'Per Unit' },
  { value: 'percentage', label: 'Percentage' },
];

// ============================================================
// EFFECTIVE DATE BASED ON
// ============================================================
export const EFFECTIVE_DATE_OPTIONS = [
  { value: 'CURRENT_DATE', label: 'Current Date' },
  { value: 'CREATED_AT', label: 'Created At' },
  { value: 'MOVE_START_DATE', label: 'Move Start Date' },
  { value: 'ENROUTE_TO_CHASSIS', label: 'Enroute to Chassis' },
  { value: 'ARRIVED_TO_CHASSIS', label: 'Arrived to Chassis' },
  { value: 'ENROUTE_TO_PICK_CONTAINER', label: 'Enroute to Pick Container' },
  { value: 'ARRIVED_AT_PICK_CONTAINER', label: 'Arrived at Pick Container' },
  { value: 'ENROUTE_TO_DELIVER_LOAD', label: 'Enroute to Deliver Load' },
  { value: 'ARRIVED_AT_DELIVER_LOAD', label: 'Arrived at Deliver Load' },
  { value: 'ENROUTE_TO_DROP_CONTAINER', label: 'Enroute to Drop Container' },
  { value: 'DROPPED', label: 'Dropped' },
  { value: 'ENROUTE_TO_HOOK_CONTAINER', label: 'Enroute to Hook Container' },
  { value: 'ARRIVED_TO_HOOK_CONTAINER', label: 'Arrived to Hook Container' },
  { value: 'ENROUTE_TO_RETURN_LOAD', label: 'Enroute to Return Load' },
  { value: 'ARRIVED_AT_RETURN_LOAD', label: 'Arrived at Return Load' },
  { value: 'ENROUTE_TO_RETURN_CHASSIS', label: 'Enroute to Return Chassis' },
  { value: 'ARRIVED_TO_RETURN_CHASSIS', label: 'Arrived to Return Chassis' },
  { value: 'ENROUTE_TO_STOP_OFF', label: 'Enroute to Stop Off' },
  { value: 'ARRIVED_AT_STOP_OFF', label: 'Arrived at Stop Off' },
  { value: 'COMPLETED', label: 'Completed' },
  { value: 'DELIVERY_APT', label: 'Delivery Apt' },
  { value: 'RETURN_APT', label: 'Return Apt' },
];

// ============================================================
// MATCH RESOLUTION
// ============================================================
export const MATCH_RESOLUTION_OPTIONS = [
  { value: 'first_match_wins', label: 'First Match Wins', description: 'Stop at the first condition that matches' },
  { value: 'highest_rate', label: 'Highest Rate', description: 'Calculate all matching rates, use highest' },
  { value: 'lowest_rate', label: 'Lowest Rate', description: 'Calculate all matching rates, use lowest' },
  { value: 'stack_combine', label: 'Stack / Combine', description: 'Add all matching charges together' },
];

// ============================================================
// TARIFF STATUSES
// ============================================================
export const TARIFF_STATUSES = [
  { value: 'active', label: 'Active', color: 'emerald' },
  { value: 'pending', label: 'Pending', color: 'amber' },
  { value: 'draft', label: 'Draft', color: 'gray' },
  { value: 'expired', label: 'Expired', color: 'red' },
];

// ============================================================
// HELPERS
// ============================================================
export function formatCents(cents) {
  if (cents == null) return '$0.00';
  return `$${(cents / 100).toFixed(2)}`;
}

export function chargeNameLabel(code) {
  return CHARGE_NAMES.find((c) => c.value === code)?.label || code;
}

export function unitLabel(code) {
  return UNITS_OF_MEASURE.find((u) => u.value === code)?.label || code;
}

/**
 * Get available calculation modes for a given UOM.
 */
export function getModesForUOM(uom) {
  const modes = UOM_MODES[uom] || ['by_lane', 'between_statuses', 'by_event', 'by_move'];
  return CALCULATION_MODES.filter((m) => modes.includes(m.value));
}

/**
 * Check if a UOM requires "Percentage Based On" field.
 */
export function requiresPercentageBase(uom) {
  return uom === 'percentage';
}

/**
 * Check if a radius rate type requires "Percentage Based On" field.
 */
export function radiusRequiresPercentageBase(rateType) {
  return rateType === 'percentage';
}
