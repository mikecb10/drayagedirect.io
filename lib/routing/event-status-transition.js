/**
 * Routing-event status transitions. Central state-machine enforcement for
 * all routing events (primary + stop-off alike).
 *
 * Pattern follows B.1a (lib/routing/moves/transition.js + history table).
 * Actor threading per B.1d is MANDATORY — no default. dd-ai-ready skill
 * enforces this.
 */

import { fireRoutingEventTriggers as defaultFireRoutingEventTriggers } from '../email-dispatch/routing-event-fire.js';

// Test seam: tests can swap the trigger-firing implementation.
let _fireRoutingEventTriggers = defaultFireRoutingEventTriggers;
export function __setFireRoutingEventTriggersForTesting(fn) {
  _fireRoutingEventTriggers = fn;
}

const ALLOWED_TRANSITIONS = {
  pending:  ['arrived', 'skipped'],
  arrived:  ['departed', 'skipped'],
  departed: [],
  skipped:  [],
};

const VALID_ACTOR_TYPES = ['human', 'system', 'agent'];

/**
 * @param {string} fromStatus
 * @param {string} toStatus
 * @returns {boolean}
 */
export function isValidTransition(fromStatus, toStatus) {
  const allowed = ALLOWED_TRANSITIONS[fromStatus];
  return Array.isArray(allowed) && allowed.includes(toStatus);
}

/**
 * @param {string} currentStatus
 * @returns {string[]}
 */
export function getAllowedNextStatuses(currentStatus) {
  return ALLOWED_TRANSITIONS[currentStatus] ?? [];
}

/**
 * Transitions an event's status atomically:
 *   1. Reads current event
 *   2. Validates transition is allowed
 *   3. Updates event_status + arrived_at/departed_at (as side effects)
 *   4. Fires routing-event triggers (FU-080) on timestamp side-effects.
 *      Fire-and-forget — errors logged, not bubbled. Triggers run BEFORE
 *      the history write so a history-row failure cannot prevent a trigger
 *      that's already been promised to the dispatcher's email pipeline.
 *      Note: when toStatus='departed' on a forgotten-arrival path
 *      (event.arrived_at was null and gets auto-filled), BOTH the
 *      arrived_at and departed_at triggers fire — same physical moment,
 *      two semantic events.
 *   5. Writes history row with actor threading (log-and-continue)
 *   6. Returns updated event
 *
 * Throws on invalid transition, missing actor, or invalid actor.type.
 *
 * @param {object} params
 * @param {object} params.supabase - Supabase service client
 * @param {string} params.tenantId
 * @param {string} params.eventId
 * @param {string} params.toStatus
 * @param {{ id?: string, type: 'human' | 'system' | 'agent', context?: object }} params.actor
 * @param {string} [params.note]
 * @returns {Promise<object>} updated event row
 */
export async function transitionEventStatus({
  supabase, tenantId, eventId, toStatus,
  actor, note,
}) {
  if (!actor || typeof actor !== 'object') {
    throw new Error('actor is required');
  }
  if (!actor.type) {
    throw new Error('actor.type is required (one of: human, system, agent)');
  }
  if (!VALID_ACTOR_TYPES.includes(actor.type)) {
    throw new Error(`actor.type must be one of ${VALID_ACTOR_TYPES.join(', ')}; got: ${actor.type}`);
  }

  // 1. Read current event
  const { data: event, error: readErr } = await supabase
    .from('order_routing_events')
    .select('*')
    .eq('id', eventId)
    .eq('tenant_id', tenantId)
    .maybeSingle();
  if (readErr) throw readErr;
  if (!event) throw new Error(`Event not found: ${eventId} for tenant ${tenantId}`);

  const fromStatus = event.event_status;

  // 2. Validate
  if (!isValidTransition(fromStatus, toStatus)) {
    throw new Error(`Invalid transition: ${fromStatus} -> ${toStatus} for event ${eventId}`);
  }

  // 3. Update event (single-statement — event_status + timestamps together)
  const update = { event_status: toStatus };
  const now = new Date().toISOString();
  if (toStatus === 'arrived' && !event.arrived_at) {
    update.arrived_at = now;
  }
  if (toStatus === 'departed') {
    if (!event.departed_at) update.departed_at = now;
    if (!event.arrived_at) update.arrived_at = now; // forgotten-arrival UX
  }
  // 'skipped' leaves timestamps null

  const { data: updated, error: updateErr } = await supabase
    .from('order_routing_events')
    .update(update)
    .eq('id', eventId)
    .eq('tenant_id', tenantId)
    .select()
    .single();
  if (updateErr) throw updateErr;

  // FU-080: fire routing-event triggers on timestamp side-effects so driver-tap
  // and dispatcher-edit paths both reliably fire dispatcher email triggers.
  // Fire-and-forget — errors logged, not bubbled (matches event-row PUT pattern).
  const eventType = updated.event_type;
  if (eventType) {
    if (toStatus === 'arrived' || (toStatus === 'departed' && update.arrived_at && !event.arrived_at)) {
      try {
        await _fireRoutingEventTriggers(supabase, {
          tenantId,
          loadId: updated.order_id,
          eventType,
          timestampField: 'arrived_at',
          userId: actor.id ?? null,
        });
      } catch (e) {
        console.error('event-status-transition arrived trigger error:', e?.message || e);
      }
    }
    if (toStatus === 'departed') {
      try {
        await _fireRoutingEventTriggers(supabase, {
          tenantId,
          loadId: updated.order_id,
          eventType,
          timestampField: 'departed_at',
          userId: actor.id ?? null,
        });
      } catch (e) {
        console.error('event-status-transition departed trigger error:', e?.message || e);
      }
    }
  }

  // 4. Write history row (log-and-continue; non-fatal).
  //    Mirrors moves/transition.js — audit gap is preferred to rollback
  //    complexity; losing an audit row is bad but losing the state
  //    transition is worse. Actor threading required by DB CHECK constraint.
  try {
    const { error: historyErr } = await supabase
      .from('order_routing_event_status_history')
      .insert({
        tenant_id: tenantId,
        event_id: eventId,
        from_status: fromStatus,
        to_status: toStatus,
        actor_id: actor.id ?? null,
        actor_type: actor.type,
        actor_context: actor.context ?? null,
        note: note ?? null,
      });
    if (historyErr) {
      console.error(`event history insert failed for ${eventId}:`, historyErr.message);
    }
  } catch (e) {
    console.error(`event history insert threw for ${eventId}:`, e?.message || e);
  }

  return updated;
}

/**
 * Pure derivation: given a pair of {arrived_at, departed_at} timestamps,
 * returns the implied event_status. Used by the legacy direct-timestamp
 * PUT path (FU-082) when a dispatcher backfills timestamps without going
 * through transitionEventStatus.
 *
 *   departed_at IS NOT NULL                           -> 'departed'
 *   arrived_at IS NOT NULL AND departed_at IS NULL    -> 'arrived'
 *   both NULL                                         -> 'pending'
 *
 * @param {{ arrived_at: string | null, departed_at: string | null }} timestamps
 * @returns {'pending' | 'arrived' | 'departed'}
 */
export function deriveEventStatusFromTimestamps({ arrived_at, departed_at }) {
  if (departed_at) return 'departed';
  if (arrived_at)  return 'arrived';
  return 'pending';
}

/**
 * Synchronizes event_status with the resulting timestamp state, intended
 * for the legacy EDITABLE-fields PUT path on /api/tenant/loads/[id]/routing/
 * events/[eventId].js (FU-082). When a dispatcher writes arrived_at /
 * departed_at directly (e.g., backfilling a forgotten arrival), this helper:
 *
 *   1. Derives the target event_status from the post-update timestamps.
 *   2. If the derived status differs from priorStatus, UPDATEs event_status
 *      and INSERTs a history row tagged with the supplied actor.
 *   3. No-ops when the derived status already equals priorStatus.
 *
 * Differs from transitionEventStatus():
 *   - NO state-machine validation. The legacy path is the "raw timestamp"
 *     escape hatch — it must allow transitions the strict helper would
 *     reject (e.g., pending -> departed when a dispatcher backfills
 *     departed_at only). The state machine is for normal user actions
 *     via the toStatus path; this helper is for direct timestamp edits.
 *   - Derives target status from timestamps rather than taking toStatus.
 *
 * History write is log-and-continue: audit gap is preferred to rollback
 * complexity. Mirrors transitionEventStatus() and moves/transition.js.
 *
 * @param {object} params
 * @param {object} params.supabase           - Supabase service client
 * @param {string} params.tenantId
 * @param {string} params.eventId
 * @param {string} params.priorStatus        - event_status BEFORE the timestamp UPDATE
 * @param {{ arrived_at: string | null, departed_at: string | null }} params.currentTimestamps
 *        post-UPDATE timestamps (typically from `.select().single()` on the UPDATE)
 * @param {{ id?: string, type: 'human' | 'system' | 'agent', context?: object }} params.actor
 * @param {string} [params.note]             - defaults to 'derived from direct timestamp edit'
 * @returns {Promise<{ derivedStatus: string, changed: boolean }>}
 *          derivedStatus: the resolved status (regardless of whether it was written)
 *          changed: true iff an UPDATE + history INSERT was attempted
 */
export async function syncEventStatusFromTimestamps({
  supabase, tenantId, eventId, priorStatus, currentTimestamps, actor,
  note = 'derived from direct timestamp edit',
}) {
  if (!actor || typeof actor !== 'object') {
    throw new Error('actor is required');
  }
  if (!actor.type) {
    throw new Error('actor.type is required (one of: human, system, agent)');
  }
  if (!VALID_ACTOR_TYPES.includes(actor.type)) {
    throw new Error(`actor.type must be one of ${VALID_ACTOR_TYPES.join(', ')}; got: ${actor.type}`);
  }

  const derivedStatus = deriveEventStatusFromTimestamps(currentTimestamps);

  if (derivedStatus === priorStatus) {
    return { derivedStatus, changed: false };
  }

  // BYPASS the state machine — see JSDoc above. Direct UPDATE only
  // touches event_status (timestamps were already written by the caller's
  // EDITABLE-fields update; this helper is the status-sync sidecar).
  const { error: updateErr } = await supabase
    .from('order_routing_events')
    .update({ event_status: derivedStatus })
    .eq('id', eventId)
    .eq('tenant_id', tenantId);
  if (updateErr) {
    throw new Error(`event_status sync update failed: ${updateErr.message}`);
  }

  // Write history row (log-and-continue; non-fatal).
  try {
    const { error: historyErr } = await supabase
      .from('order_routing_event_status_history')
      .insert({
        tenant_id: tenantId,
        event_id: eventId,
        from_status: priorStatus,
        to_status: derivedStatus,
        actor_id: actor.id ?? null,
        actor_type: actor.type,
        actor_context: actor.context ?? null,
        note,
      });
    if (historyErr) {
      console.error(`event status sync history insert failed for ${eventId}:`, historyErr.message);
    }
  } catch (e) {
    console.error(`event status sync history insert threw for ${eventId}:`, e?.message || e);
  }

  return { derivedStatus, changed: true };
}
