/**
 * Routing-event status transitions. Central state-machine enforcement for
 * all routing events (primary + stop-off alike).
 *
 * Pattern follows B.1a (lib/routing/moves/transition.js + history table).
 * Actor threading per B.1d is MANDATORY — no default. dd-ai-ready skill
 * enforces this.
 */

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
 *   4. Writes history row with actor threading
 *   5. Returns updated event
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
