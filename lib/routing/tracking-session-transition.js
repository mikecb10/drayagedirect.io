/**
 * Tracking-session status transitions on order_container_moves.
 * Mirrors lib/routing/event-status-transition.js — actor.type is mandatory
 * (B.1d). Log-and-continue history pattern. Fires NO email triggers (move-
 * tracking is internal data; tracking_status is not a dispatcher event).
 *
 * Spec: docs/superpowers/specs/2026-04-24-driver-move-tracking-design.md §3
 */

const ALLOWED_TRANSITIONS = {
  idle:       ['in_transit'],
  in_transit: ['on_site', 'paused', 'completed'],
  on_site:    ['in_transit', 'paused', 'completed'],
  paused:     ['in_transit'],
  completed:  [],
};

const VALID_ACTOR_TYPES = ['human', 'system', 'agent'];

export function isValidTrackingTransition(fromStatus, toStatus) {
  const allowed = ALLOWED_TRANSITIONS[fromStatus];
  return Array.isArray(allowed) && allowed.includes(toStatus);
}

export function getAllowedNextTrackingStatuses(currentStatus) {
  return ALLOWED_TRANSITIONS[currentStatus] ?? [];
}

/**
 * @param {object} params
 * @param {object} params.supabase
 * @param {string} params.tenantId
 * @param {string} params.moveId
 * @param {string} params.toStatus
 * @param {{ id?: string, type: 'human' | 'system' | 'agent', context?: object }} params.actor
 * @param {string} [params.note]
 * @returns {Promise<object>} updated move row
 */
export async function transitionTrackingSession({
  supabase, tenantId, moveId, toStatus,
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

  // 1. Read current
  const { data: move, error: readErr } = await supabase
    .from('order_container_moves')
    .select('tracking_status, session_started_at, session_ended_at')
    .eq('id', moveId)
    .eq('tenant_id', tenantId)
    .maybeSingle();
  if (readErr) throw readErr;
  if (!move) throw new Error(`Move not found: ${moveId} for tenant ${tenantId}`);

  const fromStatus = move.tracking_status;

  // 2. Validate
  if (!isValidTrackingTransition(fromStatus, toStatus)) {
    throw new Error(`Invalid transition: ${fromStatus} -> ${toStatus} for move ${moveId}`);
  }

  // 3. Update
  const update = { tracking_status: toStatus };
  const now = new Date().toISOString();
  if (fromStatus === 'idle' && !move.session_started_at) {
    update.session_started_at = now;
  }
  if (toStatus === 'completed' && !move.session_ended_at) {
    update.session_ended_at = now;
  }

  const { data: updated, error: updErr } = await supabase
    .from('order_container_moves')
    .update(update)
    .eq('id', moveId)
    .eq('tenant_id', tenantId)
    .select()
    .single();
  if (updErr) throw updErr;

  // 4. History (log-and-continue)
  try {
    const { error: histErr } = await supabase
      .from('move_tracking_session_history')
      .insert({
        tenant_id: tenantId,
        move_id: moveId,
        from_status: fromStatus,
        to_status: toStatus,
        actor_id: actor.id ?? null,
        actor_type: actor.type,
        actor_context: actor.context ?? null,
        note: note ?? null,
      });
    if (histErr) {
      console.error(`tracking history insert failed for ${moveId}:`, histErr.message);
    }
  } catch (e) {
    console.error(`tracking history insert threw for ${moveId}:`, e?.message || e);
  }

  return updated;
}
