/**
 * Notification Trigger Firing
 *
 * Called from UI buttons and API endpoints to fire notification
 * triggers on demand. Notification triggers are the "dispatcher
 * explicitly said X happened" kind — document validation, load empty,
 * ready to return — as opposed to field-change triggers which fire
 * automatically when data on the load row changes.
 *
 * The supported event_name values come from NOTIFICATION_TRIGGERS in
 * lib/email-trigger-events.js:
 *   - document_validation
 *   - load_empty
 *   - ready_to_return
 *
 * Each call can fan out into multiple trigger fires if the tenant has
 * multiple active notification triggers for the same event_name (e.g.
 * one for customer AP, one for operations). Every fire writes its own
 * email_trigger_log row.
 */

import { fireTrigger } from './dispatcher.js';

/**
 * Fire all matching notification triggers for the given event + load.
 *
 * @param svc service-role Supabase client
 * @param {{
 *   tenantId: string,
 *   loadId: string,
 *   eventName: string,
 *   userId?: string | null,
 * }} params
 * @returns {Promise<{
 *   firesAttempted: number,
 *   firesSucceeded: number,
 *   results: Array<{trigger_id, outcome, messagesCreated?, error?}>
 * }>}
 */
export async function fireNotificationTrigger(svc, params) {
  const { tenantId, loadId, eventName, userId } = params;
  if (!tenantId || !loadId || !eventName) {
    return { firesAttempted: 0, firesSucceeded: 0, results: [] };
  }

  const { data: triggers, error } = await svc
    .from('email_template_triggers')
    .select('*')
    .eq('tenant_id', tenantId)
    .eq('trigger_kind', 'notification')
    .eq('is_active', true)
    .eq('event_name', eventName);

  if (error) {
    return {
      firesAttempted: 0,
      firesSucceeded: 0,
      results: [{ error: error.message }],
    };
  }

  const results = [];
  let succeeded = 0;

  for (const trigger of triggers || []) {
    // fire_key uses the eventName + epoch ms so two back-to-back clicks
    // within the dedupe window return outcome='deduped' on the second.
    // The dedupe index is on (tenant, trigger, load, fire_key) so we use
    // a stable per-click key: eventName plus the closest 10-second bucket
    // so rapid double-clicks collapse to the same key but unrelated fires
    // 11s apart get distinct keys.
    const bucket = Math.floor(Date.now() / 10000);
    const fireKey = `${eventName}_${bucket}`;
    try {
      const result = await fireTrigger(svc, {
        tenantId,
        triggerId: trigger.id,
        loadId,
        fireKey,
        userId,
        eventName,
      });
      results.push({
        trigger_id: trigger.id,
        outcome: result.outcome,
        messagesCreated: result.messagesCreated,
      });
      if (result.outcome === 'fired') succeeded++;
    } catch (e) {
      results.push({
        trigger_id: trigger.id,
        outcome: 'errored',
        error: e.message,
      });
    }
  }

  return {
    firesAttempted: (triggers || []).length,
    firesSucceeded: succeeded,
    results,
  };
}
