/**
 * Status trigger evaluator (generalized)
 *
 * Fires for entities whose current status matches the trigger's
 * event_name AND which entered that status at or before `notify_after`
 * duration ago.
 *
 * Entity-aware: reads from order_status_history, order_charge_sets_status_history,
 * or order_container_moves_status_history based on trigger.entity_type.
 *
 * Conditions shape:
 *   { notify_after: { days, hours, minutes } }
 *
 * A trigger with no entity_type (pre-migration or hand-inserted) defaults
 * to 'order' for backward compat.
 *
 * Candidate shape:
 *   - order entities: { load_id, reason } — unchanged from pre-B.1b so the
 *     polled worker (lib/email-dispatch/polled-worker.js) keeps working.
 *   - non-order entities (charge_set, move): { entityType, entityId, enteredAt, reason }.
 *     The polled worker ignores these in this MVP (FU-073 generalizes the worker).
 *
 * Part of Stream B.1b (event spine generalization).
 */

import { HISTORY_TABLE_BY_ENTITY } from '../entity-history.js';

function durationToMs(d) {
  if (!d || typeof d !== 'object') return 0;
  const days = Number(d.days) || 0;
  const hours = Number(d.hours) || 0;
  const minutes = Number(d.minutes) || 0;
  return (days * 86400 + hours * 3600 + minutes * 60) * 1000;
}

export async function evaluate(svc, tenantId, trigger) {
  const targetStatus = trigger.event_name;
  if (!targetStatus) return [];

  const entityType = trigger.entity_type || 'order';
  const config = HISTORY_TABLE_BY_ENTITY[entityType];
  if (!config) {
    console.warn(`status evaluator: unknown entity_type ${entityType} on trigger ${trigger.id}`);
    return [];
  }

  const cond = trigger.conditions || {};
  const notifyAfterMs = durationToMs(cond.notify_after);
  const cutoff = new Date(Date.now() - notifyAfterMs).toISOString();

  // Find transitions INTO targetStatus at or before cutoff.
  const { data: history, error: hErr } = await svc
    .from(config.table)
    .select(`${config.idColumn}, created_at`)
    .eq('tenant_id', tenantId)
    .eq('new_status', targetStatus)
    .lte('created_at', cutoff);

  if (hErr) {
    console.error(`status evaluator history fetch for ${entityType}:`, hErr.message);
    return [];
  }
  if (!history || history.length === 0) return [];

  // Dedupe per entity to the latest transition
  const latestByEntity = new Map();
  for (const row of history) {
    const rowId = row[config.idColumn];
    const prev = latestByEntity.get(rowId);
    if (!prev || new Date(row.created_at) > new Date(prev.created_at)) {
      latestByEntity.set(rowId, row);
    }
  }

  const candidateIds = Array.from(latestByEntity.keys());
  if (candidateIds.length === 0) return [];

  // For orders: verify loads are still in target status (and not deleted).
  // Preserves pre-B.1b behavior + candidate shape (load_id + reason) so the
  // polled worker consumes candidates unchanged.
  if (entityType === 'order') {
    const { data: loads, error: lErr } = await svc
      .from('orders')
      .select('id, status, deleted_at')
      .in('id', candidateIds)
      .eq('tenant_id', tenantId);

    if (lErr) {
      console.error('status trigger load fetch:', lErr.message);
      return [];
    }

    const matches = [];
    for (const load of loads || []) {
      if (load.deleted_at) continue;
      if (load.status !== targetStatus) continue;
      const history_entry = latestByEntity.get(load.id);
      matches.push({
        load_id: load.id,
        reason: `in status '${targetStatus}' since ${history_entry.created_at}`,
      });
    }
    return matches;
  }

  // For non-order entities (charge_set, move): return candidates without
  // the live-status verification step. The worker doesn't yet dispatch
  // non-order candidates (FU-073), so this is shaped for future use.
  return candidateIds.map((id) => {
    const history_entry = latestByEntity.get(id);
    return {
      entityType,
      entityId: id,
      enteredAt: history_entry.created_at,
      reason: `in status '${targetStatus}' since ${history_entry.created_at}`,
    };
  });
}
