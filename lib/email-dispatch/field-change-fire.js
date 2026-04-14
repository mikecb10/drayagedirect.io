/**
 * Field-Change Trigger Firing
 *
 * Called from the loads PUT handler immediately after a successful DB
 * write. Detects which orders columns changed between oldLoad and
 * newLoad, looks up any active field_change triggers whose event_name
 * matches one of the changed fields, and fires them via the dispatcher.
 *
 * Fire-and-forget from the caller's perspective — the PUT response is
 * returned before this completes, and any errors here are logged but
 * never bubble up to the API client. See the .catch() wrapper at the
 * loads/[id].js injection site.
 */

import { FIELD_CHANGE_TRIGGERS } from '../email-trigger-events.js';
import { fireTrigger } from './dispatcher.js';

/**
 * Translate a FIELD_CHANGE_TRIGGERS key to the actual `orders` column
 * name. Most are 1:1 but a few have different schema names.
 *
 * Keys that don't correspond to a simple orders column (pod, the
 * appointment keys, etc.) are set to null here — their triggers won't
 * fire via this path. Follow-up milestones will add the derived-field
 * hooks separately (e.g. document_submissions change detection for
 * POD, routing event arrival-time detection for empty_return_date and
 * the appointment keys).
 */
const FIELD_KEY_TO_COLUMN = {
  container_number: 'container_number',
  cutoff_date: 'cutoff_date',
  delivery_appointment: null, // TODO (routing events)
  empty_return_date: null, // TODO (routing return arrival)
  last_free_day: 'last_free_day',
  master_bill_of_lading: 'bill_of_lading',
  pickup_appointment: null, // TODO (routing events)
  pod: null, // TODO (document_submissions)
  return_appointment: null, // TODO (routing events)
  seal_number: 'seal_number',
  total_weight: 'weight_lbs',
};

function classifyChange(oldV, newV) {
  const oldEmpty = oldV == null || oldV === '';
  const newEmpty = newV == null || newV === '';
  if (oldEmpty && newEmpty) return null; // No change
  if (oldEmpty && !newEmpty) return 'added';
  if (!oldEmpty && newEmpty) return 'removed';
  // Both non-empty. Compare via JSON.stringify for arrays/dates.
  if (oldV === newV) return null;
  if (typeof oldV === 'object' || typeof newV === 'object') {
    if (JSON.stringify(oldV) === JSON.stringify(newV)) return null;
  }
  return 'updated';
}

/**
 * Main entry — called from the loads PUT handler.
 *
 * @param svc service-role Supabase client
 * @param {{
 *   tenantId: string,
 *   loadId: string,
 *   oldLoad: object,
 *   newLoad: object,
 *   userId: string | null,
 * }} params
 * @returns {Promise<{firesAttempted: number, firesSucceeded: number}>}
 */
export async function fireFieldChangeTriggers(svc, params) {
  const { tenantId, loadId, oldLoad, newLoad, userId } = params;
  if (!tenantId || !loadId || !oldLoad || !newLoad) {
    return { firesAttempted: 0, firesSucceeded: 0 };
  }

  // 1. Compute which trigger keys represent fields that actually changed
  const changed = [];
  for (const trigger of FIELD_CHANGE_TRIGGERS) {
    const column = FIELD_KEY_TO_COLUMN[trigger.key];
    if (!column) continue; // Key has no direct orders column — skipped
    const changeType = classifyChange(oldLoad[column], newLoad[column]);
    if (changeType) changed.push({ key: trigger.key, column, changeType });
  }

  if (changed.length === 0) {
    return { firesAttempted: 0, firesSucceeded: 0 };
  }

  // 2. Fetch active field_change triggers matching any changed field
  const { data: triggers, error } = await svc
    .from('email_template_triggers')
    .select('*')
    .eq('tenant_id', tenantId)
    .eq('trigger_kind', 'field_change')
    .eq('is_active', true)
    .in(
      'event_name',
      changed.map((c) => c.key)
    );

  if (error) {
    console.error('fireFieldChangeTriggers trigger fetch:', error.message);
    return { firesAttempted: 0, firesSucceeded: 0 };
  }

  let succeeded = 0;
  const attempts = [];

  for (const trigger of triggers || []) {
    const change = changed.find((c) => c.key === trigger.event_name);
    if (!change) continue;

    // Check conditions.change_type — 'updated' acts as a wildcard per
    // summarizeTrigger() semantics in email-trigger-events.js
    const wantedType = trigger.conditions?.change_type;
    if (wantedType && wantedType !== 'updated' && wantedType !== change.changeType) {
      continue;
    }

    const fireKey = `${trigger.event_name}_${Date.now()}`;
    attempts.push(
      fireTrigger(svc, {
        tenantId,
        triggerId: trigger.id,
        loadId,
        fireKey,
        userId,
        eventName: trigger.event_name,
      })
        .then((result) => {
          if (result.outcome === 'fired') succeeded++;
          return result;
        })
        .catch((e) => {
          console.error(
            `fireFieldChangeTriggers[${trigger.id}] ${trigger.event_name}:`,
            e.message
          );
          return null;
        })
    );
  }

  await Promise.all(attempts);
  return { firesAttempted: attempts.length, firesSucceeded: succeeded };
}
