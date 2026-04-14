/**
 * Driver Charge Profile Constants — AP pricing engine.
 *
 * Mirrors lib/charge-profile-constants.js (AR) but with
 * AP-specific additions: driver group scoping, By Leg calculation,
 * and driver-specific percentage-based-on options.
 */

// ── AP Charge Codes ──────────────────────────────────────────
export const DRIVER_CHARGE_NAMES = [
  { value: 'LINE_HAUL', label: 'Line Haul' },
  { value: 'BASE_PRICE', label: 'Base Price' },
  { value: 'FUEL', label: 'Fuel Surcharge' },
  { value: 'CHASSIS', label: 'Chassis' },
  { value: 'CHASSIS_SPLIT', label: 'Chassis Split' },
  { value: 'DETENTION', label: 'Detention' },
  { value: 'WAITING_TIME', label: 'Waiting Time' },
  { value: 'LAYOVER', label: 'Layover' },
  { value: 'STOP_OFF', label: 'Stop Off' },
  { value: 'BONUS', label: 'Bonus' },
  { value: 'SCALE', label: 'Scale' },
  { value: 'WASHOUT', label: 'Washout / Container Clean' },
  { value: 'HAZMAT', label: 'Hazmat' },
  { value: 'OVERWEIGHT', label: 'Overweight' },
  { value: 'OVERHEIGHT', label: 'Overheight' },
  { value: 'PER_DIEM', label: 'Per Diem' },
  { value: 'TOLL', label: 'Toll' },
  { value: 'BOBTAIL', label: 'Bobtail' },
  { value: 'TRI_AXLE', label: 'Tri-Axle' },
  { value: 'PREPULL', label: 'Pre-Pull' },
  { value: 'REEFER', label: 'Reefer' },
  { value: 'GENSET', label: 'Genset' },
  { value: 'CONGESTION', label: 'Congestion' },
  { value: 'OTHER', label: 'Other' },
];

// ── Units of Measure ─────────────────────────────────────────
export const DRIVER_UNITS_OF_MEASURE = [
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
  { value: 'radius_rate', label: 'Radius Rate (distance tiers)' },
];

// ── Percentage "Based On" ────────────────────────────────────
export const PERCENTAGE_BASED_ON = [
  { value: 'driver_pay', label: 'Driver Pay (base pay on this load)' },
  { value: 'ar_invoice', label: 'Invoice / AR Line Items (customer charge)' },
  { value: 'oo_benchmark', label: 'Expected O/O Pay (route benchmark)' },
];

// ── Calculation Modes ────────────────────────────────────────
export const DRIVER_CALCULATION_MODES = [
  { value: 'by_event', label: 'By Event' },
  { value: 'by_move', label: 'By Move' },
  { value: 'by_leg', label: 'By Leg' },
];

// ── Leg Options (for By Leg calculation) ─────────────────────
export const LEG_OPTIONS = [
  { value: 'pick_up_container', label: 'Pick Up Container' },
  { value: 'deliver_container', label: 'Deliver Container' },
  { value: 'return_container', label: 'Return Container' },
  { value: 'drop_container', label: 'Drop Container' },
  { value: 'stop_off', label: 'Stop Off' },
  { value: 'terminate_chassis', label: 'Terminate Chassis' },
  { value: 'completed', label: 'Completed' },
  { value: 'hook_container', label: 'Hook Container' },
  { value: 'hook_chassis', label: 'Hook Chassis' },
  { value: 'lift_off', label: 'Lift Off' },
  { value: 'lift_on', label: 'Lift On' },
  { value: 'deliver_load_drop_hook', label: 'Deliver Load - Drop & Hook' },
  { value: 'drop_chassis', label: 'Drop Chassis' },
];

// ── Location Type Options (for event/leg location matching) ──
export const LOCATION_TYPE_OPTIONS = [
  { value: 'org', label: 'Organization / Profile' },
  { value: 'city_state', label: 'City / State' },
  { value: 'zip', label: 'Zip Code' },
  { value: 'profile_group', label: 'Profile Group' },
];

// ── Event Types (for By Event calculation) ───────────────────
// Reused from AR but listed here for AP reference
export const DRIVER_EVENT_TYPES = [
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

// ── Event Time Options ───────────────────────────────────────
export const EVENT_TIME_OPTIONS = [
  { value: 'arrived', label: 'Arrived' },
  { value: 'departed', label: 'Departed' },
];

// ── Move Calculation Options ─────────────────────────────────
export const MOVE_CALC_FROM = [
  { value: 'first_event_arrived', label: 'First Event Arrived' },
  { value: 'first_event_departed', label: 'First Event Departed' },
];

export const MOVE_CALC_TO = [
  { value: 'last_event_arrived', label: 'Last Event Arrived' },
  { value: 'last_event_departed', label: 'Last Event Departed' },
  { value: 'last_event_completed', label: 'Last Event Completed' },
];

// ── Effective Date Options ───────────────────────────────────
export const EFFECTIVE_DATE_OPTIONS = [
  { value: 'CURRENT_DATE', label: 'Current Date' },
  { value: 'CREATED_AT', label: 'Load Created Date' },
  { value: 'DISPATCHED_AT', label: 'Dispatched Date' },
  { value: 'PICKUP_DATE', label: 'Pickup Date' },
  { value: 'DELIVERY_DATE', label: 'Delivery Date' },
  { value: 'MOVE_START_DATE', label: 'Move Start Date' },
];

// ── Match Resolution ─────────────────────────────────────────
export const MATCH_RESOLUTION_OPTIONS = [
  { value: 'first_match_wins', label: 'First Match Wins' },
  { value: 'highest_rate', label: 'Highest Rate' },
  { value: 'lowest_rate', label: 'Lowest Rate' },
  { value: 'stack_combine', label: 'Stack / Combine All' },
];

// ── Radius Rate Types ────────────────────────────────────────
export const RADIUS_RATE_TYPES = [
  { value: 'fixed', label: 'Fixed Amount' },
  { value: 'per_unit', label: 'Per Unit (per mile)' },
  { value: 'percentage', label: 'Percentage' },
];

// ── Helpers ──────────────────────────────────────────────────
export function chargeNameLabel(code) {
  return DRIVER_CHARGE_NAMES.find((c) => c.value === code)?.label || code;
}

export function unitLabel(code) {
  return DRIVER_UNITS_OF_MEASURE.find((u) => u.value === code)?.label || code;
}

export function legLabel(code) {
  return LEG_OPTIONS.find((l) => l.value === code)?.label || code;
}

export function requiresPercentageBase(uom) {
  return uom === 'percentage';
}

export function isTimeBased(uom) {
  return ['per_day', 'per_hour', 'per_15min', 'per_30min', 'per_45min'].includes(uom);
}
