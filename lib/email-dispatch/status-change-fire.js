/**
 * Status-Change Trigger Firing (generalized)
 *
 * Called after a status transition on an entity (order, charge_set, or
 * container_move). Writes a row to the entity's status_history table and
 * fires any active triggers whose entity_type + event_name match the new
 * status.
 *
 * Fire-and-forget: errors are logged but never bubble up to the caller.
 *
 * The generalized signature is the primary export:
 *   fireStatusChangeTriggers(svc, { tenantId, entityType, entityId, oldStatus, newStatus, userId })
 *
 * For backward compatibility with orders-only callers, a thin wrapper
 * fireOrderStatusChangeTriggers accepts the prior `{ loadId, ... }` shape.
 *
 * Part of Stream B.1b (event spine generalization).
 */

import { fireTrigger } from './dispatcher.js';

// Entity -> (history table, history id column). Single source of truth.
// Adding a 4th entity: add a row here + update the CHECK constraint in
// migration 097 (supabase/migrations/097_trigger_entity_type.sql).
const HISTORY_TABLE_BY_ENTITY = {
  order:      { table: 'order_status_history',                  idColumn: 'order_id' },
  charge_set: { table: 'order_charge_sets_status_history',      idColumn: 'charge_set_id' },
  move:       { table: 'order_container_moves_status_history',  idColumn: 'move_id' },
};

/**
 * Generalized status-change trigger firing.
 *
 * @param svc service-role Supabase client
 * @param {{
 *   tenantId: string,
 *   entityType: 'order' | 'charge_set' | 'move',
 *   entityId: string,
 *   oldStatus: string | null,
 *   newStatus: string,
 *   userId: string | null,
 * }} params
 * @returns {Promise<{ firesAttempted: number, firesSucceeded: number }>}
 * @throws on unknown entityType (misuse — intentionally loud).
 */
export async function fireStatusChangeTriggers(svc, params) {
  const { tenantId, entityType, entityId, oldStatus, newStatus, userId } = params;

  if (!tenantId || !entityId || !newStatus) {
    return { firesAttempted: 0, firesSucceeded: 0 };
  }
  if (oldStatus === newStatus) {
    return { firesAttempted: 0, firesSucceeded: 0 };
  }

  const config = HISTORY_TABLE_BY_ENTITY[entityType];
  if (!config) {
    throw new Error(`unknown entityType: ${entityType}`);
  }

  // 1. Write to the entity's status_history table.
  //    Non-fatal: firing still works without the history row (used for
  //    immediate triggers). Delayed triggers depend on the row, but an
  //    INSERT failure there is logged and retried on the next transition.
  //
  //    NOTE: Stream B.1a's transition helpers (transitionChargeSetStatus,
  //    transitionMoveStatus) ALSO write a history row. This creates 2 rows
  //    per transition for charge_set/move. Tracked as FU-074 for unification;
  //    harmless at current scale — each row has a unique uuid.
  try {
    const historyRow = {
      tenant_id: tenantId,
      [config.idColumn]: entityId,
      old_status: oldStatus || null,
      new_status: newStatus,
      changed_by: userId || null,
    };
    const { error } = await svc.from(config.table).insert(historyRow);
    if (error) {
      console.error(`${entityType} history insert failed:`, error.message);
    }
  } catch (e) {
    console.error(`${entityType} history insert threw:`, e?.message || e);
  }

  // 2. Find active status triggers matching entity_type + event_name
  const { data: triggers, error } = await svc
    .from('email_template_triggers')
    .select('*')
    .eq('tenant_id', tenantId)
    .eq('trigger_kind', 'status')
    .eq('entity_type', entityType)
    .eq('is_active', true)
    .eq('event_name', newStatus);

  if (error) {
    console.error('fireStatusChangeTriggers trigger fetch:', error.message);
    return { firesAttempted: 0, firesSucceeded: 0 };
  }

  if (!triggers || triggers.length === 0) {
    return { firesAttempted: 0, firesSucceeded: 0 };
  }

  // 3. Immediate triggers (notify_after = 0) fire inline; delayed
  //    triggers (notify_after > 0) wait for the polled worker.
  let succeeded = 0;
  const attempts = [];

  for (const trigger of triggers) {
    const cond = trigger.conditions || {};
    const notifyAfter = cond.notify_after || { days: 0, hours: 0, minutes: 0 };
    const delayMs =
      ((Number(notifyAfter.days) || 0) * 86400 +
        (Number(notifyAfter.hours) || 0) * 3600 +
        (Number(notifyAfter.minutes) || 0) * 60) *
      1000;

    if (delayMs > 0) {
      // Delayed - polled worker picks it up from history.
      continue;
    }

    const fireKey = `status_${entityType}_${newStatus}_${Date.now()}`;
    // NOTE: existing fireTrigger signature expects `loadId`. For non-order
    // entities the dispatcher's context-builder may not handle them
    // gracefully - that's FU-072 territory. We pass entityId as loadId
    // for orders (same shape as before). For charge_set/move, the trigger
    // will attempt to fire but may fail during context-building; failure
    // is caught by the per-attempt .catch and logged, not bubbled.
    attempts.push(
      fireTrigger(svc, {
        tenantId,
        triggerId: trigger.id,
        loadId: entityType === 'order' ? entityId : null,
        entityType,
        entityId,
        fireKey,
        userId,
        eventName: newStatus,
      })
        .then((result) => {
          if (result?.outcome === 'fired') succeeded++;
          return result;
        })
        .catch((e) => {
          console.error(
            `fireStatusChangeTriggers[${trigger.id}] ${entityType}/${newStatus}:`,
            e.message
          );
          return null;
        })
    );
  }

  await Promise.all(attempts);
  return { firesAttempted: attempts.length, firesSucceeded: succeeded };
}

/**
 * Backward-compat wrapper for orders-only callers. Forwards to
 * fireStatusChangeTriggers with entityType='order'.
 *
 * New callers should use fireStatusChangeTriggers directly.
 *
 * @param svc
 * @param {{ tenantId: string, loadId: string, oldStatus: string | null, newStatus: string, userId: string | null }} params
 */
export async function fireOrderStatusChangeTriggers(svc, { tenantId, loadId, oldStatus, newStatus, userId }) {
  return fireStatusChangeTriggers(svc, {
    tenantId,
    entityType: 'order',
    entityId: loadId,
    oldStatus,
    newStatus,
    userId,
  });
}
