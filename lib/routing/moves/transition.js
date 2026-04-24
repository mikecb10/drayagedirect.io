/**
 * Container-Move Status Transition Helper
 *
 * Centralizes all writes to order_container_moves.status. Mirrors
 * transitionChargeSetStatus: UPDATE + history + log-and-continue.
 *
 * Cascade (B.1e Task 11): when a move transitions to 'completed', any
 * still-pending or still-arrived events under that move are auto-
 * transitioned to 'departed' with actor_type='system'. This keeps
 * move+event state consistent without dispatcher rework — the cascade
 * is an internal data-consistency mechanism, not a user-facing event,
 * so it intentionally bypasses the email-trigger pipeline (which lives
 * in the PUT endpoint, not in the helper).
 *
 * Except for the completion cascade, complete_load / uncomplete_load in
 * pages/api/tenant/loads/[id]/routing/index.js are explicit user
 * actions that write orders.status directly, not derived from move state.
 *
 * For bulk operations, callers fetch affected moves first then
 * loop-serial through this helper (see routing/index.js:692-707 + 742-756).
 *
 * Stream B.1b: after a successful status change, also fires
 * fireStatusChangeTriggers with entityType='move'. Fire-and-forget;
 * errors logged, not bubbled.
 */

import { fireStatusChangeTriggers } from '../../email-dispatch/status-change-fire.js';
import { transitionEventStatus } from '../event-status-transition.js';

/**
 * @param svc service-role Supabase client
 * @param {{
 *   tenantId: string,
 *   moveId: string,
 *   newStatus: string,
 *   actorUserId: string | null,
 *   actorType?: 'human' | 'system' | 'agent',  // Stream B.1d — defaults to 'human'
 *   extraFields?: object,
 * }} params
 * @returns {Promise<{ oldStatus: string | null, newStatus: string, row: object }>}
 * @throws on DB UPDATE failure.
 */
export async function transitionMoveStatus(svc, params) {
  const { tenantId, moveId, newStatus, actorUserId, actorType = 'human', extraFields } = params;

  const { data: current, error: fetchErr } = await svc
    .from('order_container_moves')
    .select('*')
    .eq('tenant_id', tenantId)
    .eq('id', moveId)
    .maybeSingle();
  if (fetchErr) throw new Error(`move fetch failed: ${fetchErr.message}`);
  if (!current) throw new Error(`move ${moveId} not found for tenant ${tenantId}`);

  const oldStatus = current.status;
  const hasExtraFields = extraFields && Object.keys(extraFields).length > 0;

  if (oldStatus === newStatus && !hasExtraFields) {
    return { oldStatus, newStatus, row: current };
  }

  // extraFields first, status last — this is load-bearing: a caller that
  // accidentally passes `status` in extraFields (forbidden per JSDoc) will
  // have it silently overridden by the newStatus param. This keeps the
  // helper's invariant "newStatus wins" self-evident from reading the code.
  const updatePayload = { ...(extraFields || {}), status: newStatus };
  const { data: updated, error: updErr } = await svc
    .from('order_container_moves')
    .update(updatePayload)
    .eq('tenant_id', tenantId)
    .eq('id', moveId)
    .select()
    .single();
  if (updErr) throw new Error(`move update failed: ${updErr.message}`);

  // History INSERT (log-and-continue; non-fatal).
  // Only when status actually changed — extraFields-only updates don't
  // pollute the audit trail with old_status === new_status rows.
  if (oldStatus !== newStatus) {
    try {
      const { error: histErr } = await svc
        .from('order_container_moves_status_history')
        .insert({
          tenant_id: tenantId,
          move_id: moveId,
          old_status: oldStatus ?? null,
          new_status: newStatus,
          changed_by: actorUserId ?? null,
          actor_type: actorType,
        });
      if (histErr) {
        console.error(`move history insert failed for ${moveId}:`, histErr.message);
      }
    } catch (e) {
      console.error(`move history insert threw for ${moveId}:`, e?.message || e);
    }
  }

  // Fire status-change triggers for move. Fire-and-forget — errors
  // logged, not bubbled. See FU-074 re: history-row duplication (helper
  // writes one, fireStatusChangeTriggers writes another).
  if (oldStatus !== newStatus) {
    try {
      await fireStatusChangeTriggers(svc, {
        tenantId,
        entityType: 'move',
        entityId: moveId,
        oldStatus,
        newStatus,
        userId: actorUserId,
      });
    } catch (e) {
      console.error(`move trigger fire failed for ${moveId}:`, e?.message || e);
    }
  }

  // B.1e Task 11 — Cascade: when a move completes, any still-pending or
  // still-arrived events under it auto-transition to 'departed' with
  // actor_type='system'. Runs ONLY on status change to 'completed'
  // (not on extraFields-only updates) to avoid redundant scans.
  //
  // Log-and-continue per individual event: if one cascade fails, log
  // and keep going — the move's own status update has already succeeded
  // and callers expect completion to be durable even if one event's
  // history row fails to write.
  //
  // Intentionally bypasses email triggers: cascades are a data-
  // consistency mechanism, not a dispatcher action. Email triggers live
  // in the PUT endpoint pipeline, not in transitionEventStatus, so
  // cascades naturally skip them.
  if (newStatus === 'completed' && oldStatus !== newStatus) {
    const { data: stuckEvents, error: stuckErr } = await svc
      .from('order_routing_events')
      .select('id, event_status')
      .eq('tenant_id', tenantId)
      .eq('move_id', moveId)
      .in('event_status', ['pending', 'arrived']);

    if (stuckErr) {
      console.error(`move ${moveId} cascade fetch failed:`, stuckErr.message);
    } else {
      for (const ev of stuckEvents ?? []) {
        try {
          // pending -> arrived -> departed requires two steps per the
          // state machine (see lib/routing/event-status-transition.js).
          if (ev.event_status === 'pending') {
            await transitionEventStatus({
              supabase: svc,
              tenantId,
              eventId: ev.id,
              toStatus: 'arrived',
              actor: {
                type: 'system',
                context: { reason: 'cascaded from parent move completion', moveId },
              },
              note: 'cascaded from parent move completion',
            });
          }
          await transitionEventStatus({
            supabase: svc,
            tenantId,
            eventId: ev.id,
            toStatus: 'departed',
            actor: {
              type: 'system',
              context: { reason: 'cascaded from parent move completion', moveId },
            },
            note: 'cascaded from parent move completion',
          });
        } catch (e) {
          console.error(
            `move ${moveId} cascade failed for event ${ev.id}:`,
            e?.message || e,
          );
          // continue to next event — one cascade failure must not
          // abort others or bubble up to the move-completion caller
        }
      }
    }
  }

  return { oldStatus, newStatus, row: updated };
}

/**
 * Reverts events that were auto-cascaded to 'departed' by a prior
 * complete_load (see cascade block above). Reads
 * order_routing_event_status_history to determine each event's pre-cascade
 * state.
 *
 * Algorithm per event:
 *   1. Fetch history rows ordered transitioned_at DESC.
 *   2. Skip any row tagged with note='cascaded from parent move completion'.
 *   3. First non-cascade row's to_status = the pre-cascade state (revert target).
 *   4. If no non-cascade row exists (event was created and immediately cascaded),
 *      fall back to the FIRST cascade row's from_status.
 *   5. If the event has no cascade-tagged rows at all (wasn't cascaded), skip it.
 *
 * BYPASSES event-status-transition.js state machine: 'departed' is correctly
 * terminal there — manual reverse transitions are not allowed. This function
 * is the only legitimate reverse path and runs only for system-driven reverts.
 *
 * Intentionally bypasses email triggers (same rationale as the cascade itself):
 * a system-driven data-consistency revert must not fire customer-facing
 * "delivery is back in progress" emails.
 *
 * Log-and-continue per individual event: if one revert fails, log and keep
 * going — callers (uncomplete_load) have already reverted the move status and
 * must not abort because one event's history row is stale.
 *
 * @param {object} params
 * @param {object} params.supabase - service-role Supabase client
 * @param {string} params.tenantId
 * @param {string} params.moveId
 * @param {{ id?: string, type: 'system', context?: object }} params.actor
 *        - actor.type MUST be 'system'. Guarded; throws otherwise.
 * @returns {Promise<{ revertedCount: number, skippedCount: number }>}
 */
export async function revertCascadedEventsForMove({
  supabase, tenantId, moveId, actor,
}) {
  if (!actor || actor.type !== 'system') {
    throw new Error('revertCascadedEventsForMove requires actor.type=system');
  }

  // Only events currently at 'departed' are candidates — cascade only sets
  // events to departed. If an event is pending/arrived, the cascade didn't
  // push it (or something else already reverted it).
  const { data: candidateEvents, error: fetchErr } = await supabase
    .from('order_routing_events')
    .select('id, event_status')
    .eq('tenant_id', tenantId)
    .eq('move_id', moveId)
    .eq('event_status', 'departed');

  if (fetchErr) {
    console.error(`revert cascade fetch failed for move ${moveId}:`, fetchErr.message);
    return { revertedCount: 0, skippedCount: 0 };
  }

  let revertedCount = 0;
  let skippedCount = 0;

  for (const ev of candidateEvents ?? []) {
    try {
      // Read full history for this event, newest-first.
      const { data: history, error: histErr } = await supabase
        .from('order_routing_event_status_history')
        .select('from_status, to_status, note, transitioned_at')
        .eq('tenant_id', tenantId)
        .eq('event_id', ev.id)
        .order('transitioned_at', { ascending: false });

      if (histErr) {
        console.error(`revert cascade history fetch failed for event ${ev.id}:`, histErr.message);
        skippedCount++;
        continue;
      }

      const rows = history ?? [];
      const cascadeNote = 'cascaded from parent move completion';
      const hasCascade = rows.some((r) => r.note === cascadeNote);

      if (!hasCascade) {
        // Not cascaded — leave it alone. An event at 'departed' without a
        // cascade row got there via normal dispatcher action; it's NOT
        // this function's responsibility to touch it.
        skippedCount++;
        continue;
      }

      // Determine pre-cascade state:
      // - Walk newest→oldest; first row NOT tagged as cascade tells us the
      //   to_status that existed before the cascade ran.
      // - If every row is a cascade row (unusual — event was created and
      //   immediately cascaded), fall back to the OLDEST cascade row's
      //   from_status. rows[] is newest-first, so oldest is rows[rows.length - 1].
      const firstNonCascade = rows.find((r) => r.note !== cascadeNote);
      let revertTo;
      if (firstNonCascade) {
        revertTo = firstNonCascade.to_status;
      } else {
        // All rows are cascade rows. Use the earliest cascade's from_status.
        const oldestCascade = rows[rows.length - 1];
        revertTo = oldestCascade.from_status;
      }

      if (!revertTo || revertTo === ev.event_status) {
        // No meaningful revert (e.g. null from_status on a creation row,
        // or already at target). Skip safely.
        skippedCount++;
        continue;
      }

      // BYPASS the event-status state machine via raw supabase calls.
      // Reverse-transition is only allowed for system-driven cascade revert.
      const updatePayload = { event_status: revertTo };
      // Reverse the timestamps cascade's forgotten-arrival UX may have stamped.
      if (revertTo === 'arrived') {
        updatePayload.departed_at = null;
      } else if (revertTo === 'pending') {
        updatePayload.departed_at = null;
        updatePayload.arrived_at = null;
      }

      const { error: updErr } = await supabase
        .from('order_routing_events')
        .update(updatePayload)
        .eq('id', ev.id)
        .eq('tenant_id', tenantId);

      if (updErr) {
        console.error(`revert cascade update failed for event ${ev.id}:`, updErr.message);
        skippedCount++;
        continue;
      }

      // Write the reverse history row.
      const { error: histInsertErr } = await supabase
        .from('order_routing_event_status_history')
        .insert({
          tenant_id: tenantId,
          event_id: ev.id,
          from_status: ev.event_status, // 'departed'
          to_status: revertTo,
          actor_id: actor.id ?? null,
          actor_type: 'system',
          actor_context: { reason: 'reverted from uncomplete_load', moveId, ...(actor.context || {}) },
          note: 'reverted from uncomplete_load',
        });

      if (histInsertErr) {
        console.error(`revert cascade history insert failed for event ${ev.id}:`, histInsertErr.message);
        // Event already updated; history row is audit-best-effort (mirrors
        // the pattern in transitionEventStatus).
      }

      revertedCount++;
    } catch (e) {
      console.error(`revert cascade failed for event ${ev.id}:`, e?.message || e);
      skippedCount++;
      // Continue to next event
    }
  }

  return { revertedCount, skippedCount };
}
