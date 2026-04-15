/**
 * Pricing Duration Helper
 *
 * Given a (from_status, to_status) pair from a charge profile tier and a
 * load's routing events, compute the elapsed seconds between the two
 * operational milestones. Used by `between_statuses` calculation mode to
 * multiply a per_hour / per_day / per_15min rate by real duration.
 *
 * Returns 0 when either endpoint is missing (event hasn't fired yet) or
 * when both statuses resolve to the same timestamp. Callers should treat
 * 0-duration as "charge does not apply yet" and fall back to the tier's
 * minimum_amount_cents if configured.
 *
 * Status codes are the values from STATUS_OPTIONS in charge-profile-constants.js
 * (AR) and DISPATCHER_STATE_OPTIONS in driver-charge-profile-constants.js (AP).
 * This map normalizes both shapes to order_routing_events rows.
 */

// Each status maps to a (event_type, timestamp_field) pair on order_routing_events.
// `event_type` is the routing event type (pull/deliver/return/drop/stop/hook/etc.).
// `field` is either 'arrived_at' or 'departed_at'.
//
// Some statuses resolve to a dispatcher-level timestamp on the orders row
// (e.g. PICKUP_APT → load.pickup_apt_from). Those use kind:'load_field'.
export const STATUS_TO_EVENT = {
  // AR-style UPPER_SNAKE_CASE
  ENROUTE_TO_CHASSIS:          { kind: 'event', event_type: 'hook_chassis', field: 'departed_at' },
  ARRIVED_TO_CHASSIS:          { kind: 'event', event_type: 'hook_chassis', field: 'arrived_at' },
  ENROUTE_TO_PICK_CONTAINER:   { kind: 'event', event_type: ['pull', 'pickup'], field: 'departed_at_previous' },
  ARRIVED_AT_PICK_CONTAINER:   { kind: 'event', event_type: ['pull', 'pickup'], field: 'arrived_at' },
  ENROUTE_TO_DELIVER_LOAD:     { kind: 'event', event_type: ['pull', 'pickup'], field: 'departed_at' },
  ARRIVED_AT_DELIVER_LOAD:     { kind: 'event', event_type: 'deliver',      field: 'arrived_at' },
  ENROUTE_TO_DROP_CONTAINER:   { kind: 'event', event_type: 'drop',         field: 'departed_at_previous' },
  DROPPED:                     { kind: 'event', event_type: 'drop',         field: 'arrived_at' },
  ENROUTE_TO_STOP_OFF:         { kind: 'event', event_type: 'stop_off',     field: 'departed_at_previous' },
  ARRIVED_AT_STOP_OFF:         { kind: 'event', event_type: 'stop_off',     field: 'arrived_at' },
  ENROUTE_TO_HOOK_CONTAINER:   { kind: 'event', event_type: 'hook',         field: 'departed_at_previous' },
  ARRIVED_AT_HOOK_CONTAINER:   { kind: 'event', event_type: 'hook',         field: 'arrived_at' },
  ENROUTE_TO_RETURN_LOAD:      { kind: 'event', event_type: 'deliver',      field: 'departed_at' },
  ARRIVED_AT_RETURN_LOAD:      { kind: 'event', event_type: 'return',       field: 'arrived_at' },
  ENROUTE_TO_RETURN_CHASSIS:   { kind: 'event', event_type: 'return',       field: 'departed_at' },
  ARRIVED_TO_RETURN_CHASSIS:   { kind: 'event', event_type: 'terminate',    field: 'arrived_at' },
  COMPLETED:                   { kind: 'load_field', field: 'actual_delivery_at' },
  PICKUP_APT:                  { kind: 'load_field', field: 'pickup_apt_from' },
  DELIVERY_APT:                { kind: 'load_field', field: 'delivery_apt_from' },
  RETURN_APT:                  { kind: 'load_field', field: 'return_apt_from' },
  READY_TO_RETURN:             { kind: 'load_field', field: 'ready_to_return_date' },
  POD_IN:                      { kind: 'load_field', field: 'pod_received_at' },
  POD_OUT:                     { kind: 'load_field', field: 'pod_approved_at' },

  // AP-style lower_snake_case (DISPATCHER_STATE_OPTIONS). Map through to
  // the same resolution so a driver profile using either shape works.
  enroute_pull:       { kind: 'event', event_type: 'hook_chassis', field: 'departed_at' },
  arrived_pull:       { kind: 'event', event_type: 'hook_chassis', field: 'arrived_at' },
  enroute_pickup:     { kind: 'event', event_type: ['pull', 'pickup'], field: 'departed_at_previous' },
  arrived_pickup:     { kind: 'event', event_type: ['pull', 'pickup'], field: 'arrived_at' },
  enroute_drop:       { kind: 'event', event_type: 'drop',         field: 'departed_at_previous' },
  arrived_drop:       { kind: 'event', event_type: 'drop',         field: 'arrived_at' },
  enroute_hook:       { kind: 'event', event_type: 'hook',         field: 'departed_at_previous' },
  arrived_hook:       { kind: 'event', event_type: 'hook',         field: 'arrived_at' },
  enroute_deliver:    { kind: 'event', event_type: 'deliver',      field: 'departed_at_previous' },
  arrived_deliver:    { kind: 'event', event_type: 'deliver',      field: 'arrived_at' },
  enroute_return:     { kind: 'event', event_type: 'return',       field: 'departed_at_previous' },
  arrived_return:     { kind: 'event', event_type: 'return',       field: 'arrived_at' },
  delivered:          { kind: 'event', event_type: 'deliver',      field: 'departed_at' },
  pending_completion: { kind: 'load_field', field: 'actual_delivery_at' },
  completed:          { kind: 'load_field', field: 'actual_delivery_at' },

  // NOTE (Plan A scope): When a load has multiple moves (e.g. a double-drop
  // or multi-container trip), this helper returns the FIRST matching event by
  // sequence. Between_statuses tiers on move-2+ will read move-1 timestamps.
  // Multi-move scoping (via an optional moveId parameter) is deferred to
  // Plan B's location-aware matching work.
};

/**
 * Resolve a status code to a concrete ISO timestamp string (or null).
 *
 * - kind:'event' looks up the first matching event by event_type and reads
 *   the named timestamp field.
 * - kind:'event' with field:'departed_at_previous' walks to the event
 *   immediately BEFORE the named type in `sequence` order and reads its
 *   departed_at (models "enroute" = just left the prior stop).
 * - kind:'load_field' reads directly from the load/orders row.
 */
export function resolveStatusTimestamp(statusCode, load, routingEvents) {
  const spec = STATUS_TO_EVENT[statusCode];
  if (!spec) return null;

  if (spec.kind === 'load_field') {
    return load?.[spec.field] || null;
  }

  const events = Array.isArray(routingEvents) ? routingEvents : [];
  const sorted = [...events].sort((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0));

  // event_type can be a string OR an array of strings. We match the first
  // event whose type is in the acceptable set. Arrays let a single status
  // code match multiple operational event types (e.g. pickup containers
  // stored as either 'pull' or 'pickup').
  const acceptedTypes = Array.isArray(spec.event_type) ? spec.event_type : [spec.event_type];
  const matches = (eventType) => acceptedTypes.includes(eventType);

  if (spec.field === 'departed_at_previous') {
    const idx = sorted.findIndex((e) => matches(e.event_type));
    if (idx <= 0) return null; // no event of that type, or it's the first
    return sorted[idx - 1].departed_at || null;
  }

  const match = sorted.find((e) => matches(e.event_type));
  return match ? match[spec.field] || null : null;
}

/**
 * Compute elapsed seconds between two statuses. Returns 0 when either
 * endpoint isn't resolved, or when `to` is before `from` (clock skew
 * or out-of-order edits).
 */
export function computeDurationSeconds(fromStatus, toStatus, load, routingEvents) {
  const fromIso = resolveStatusTimestamp(fromStatus, load, routingEvents);
  const toIso   = resolveStatusTimestamp(toStatus,   load, routingEvents);
  if (!fromIso || !toIso) return 0;
  const fromMs = new Date(fromIso).getTime();
  const toMs   = new Date(toIso).getTime();
  if (!Number.isFinite(fromMs) || !Number.isFinite(toMs)) return 0;
  const delta = Math.floor((toMs - fromMs) / 1000);
  return delta > 0 ? delta : 0;
}
