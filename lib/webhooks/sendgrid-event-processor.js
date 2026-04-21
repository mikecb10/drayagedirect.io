/**
 * Pure functions for processing a SendGrid webhook event.
 *
 * Kept free of DB/env/IO so the handler in pages/api/webhooks/sendgrid.js
 * stays a thin orchestrator and the logic is unit-testable.
 */

/**
 * Severity ranking for delivery_status transitions.
 * Higher number = more severe. A new event only bumps delivery_status
 * if its severity exceeds (or equals, for idempotency) the current value.
 *
 * Precedence per spec: bounced > dropped > spam_reported > delivered > deferred > null
 */
const SEVERITY = Object.freeze({
  bounced:       5,
  dropped:       4,
  spam_reported: 3,
  delivered:     2,
  deferred:      1,
});

/**
 * Strip SendGrid's ".filterXXX.XX.XXX" suffix from sg_message_id.
 * Our email_messages.provider_message_id stores only the base (from the
 * x-message-id response header); webhooks arrive with the dotted suffix.
 * Base64 IDs don't contain dots, so split-on-'.' is safe.
 */
export function extractBaseMessageId(sgMessageId) {
  if (sgMessageId == null || sgMessageId === '') return null;
  const dot = sgMessageId.indexOf('.');
  return dot === -1 ? sgMessageId : sgMessageId.slice(0, dot);
}

/**
 * Dedup check: has this sg_event_id already been appended to delivery_events?
 * @param {Array<{sg_event_id:string}>|null|undefined} deliveryEvents
 * @param {string|null|undefined} sgEventId
 */
export function isDuplicateEvent(deliveryEvents, sgEventId) {
  if (!sgEventId) return false;
  if (!Array.isArray(deliveryEvents) || deliveryEvents.length === 0) return false;
  for (const e of deliveryEvents) {
    if (e && e.sg_event_id === sgEventId) return true;
  }
  return false;
}

/**
 * Compute the new delivery_status given the current value and the incoming
 * event type. Returns current unchanged if the new event is less severe or
 * unknown.
 *
 * @param {string|null} current
 * @param {string} newEvent
 * @returns {string|null}
 */
export function computeNewDeliveryStatus(current, newEvent) {
  const newSev = SEVERITY[newEvent];
  if (newSev == null) return current;  // unknown event — no-op
  const currentSev = current == null ? 0 : (SEVERITY[current] ?? 0);
  return newSev >= currentSev ? newEvent : current;
}

/**
 * Normalize a raw SendGrid event into the shape we store in delivery_events.
 * Drops fields we don't need and stamps our own received_at timestamp.
 */
export function normalizeEvent(rawEvent) {
  return {
    event: rawEvent.event ?? null,
    timestamp: rawEvent.timestamp ?? null,
    sg_event_id: rawEvent.sg_event_id ?? null,
    sg_message_id: rawEvent.sg_message_id ?? null,
    email: rawEvent.email ?? null,
    response: rawEvent.response ?? null,
    reason: rawEvent.reason ?? null,
    received_at: new Date().toISOString(),
  };
}

/** Exported for callers that need to know which events we act on. */
export const TRACKED_EVENTS = Object.freeze([
  'delivered', 'bounced', 'dropped', 'spam_reported', 'deferred',
]);

export function isTrackedEvent(event) {
  return TRACKED_EVENTS.includes(event);
}
