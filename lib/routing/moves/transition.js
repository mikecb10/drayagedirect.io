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
