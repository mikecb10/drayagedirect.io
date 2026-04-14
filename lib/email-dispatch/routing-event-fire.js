/**
 * Routing Event Trigger Firing
 *
 * Fires status-kind triggers when a routing event gets its arrived_at
 * or departed_at timestamp set. Maps the routing event type (pull,
 * deliver, return, etc.) to the trigger event_name that dispatchers
 * configure in the trigger editor.
 *
 * Mapping:
 *   pull/pickup  + arrived_at → arrived_at_pick_container
 *   deliver      + arrived_at → arrived_at_deliver_load
 *   return       + arrived_at → arrived_at_return_load
 *   pull/pickup  + start_move → enroute_to_pick_container
 *
 * Called from the routing events PUT handler (events/[eventId].js)
 * after a timestamp is set on an event.
 */

import { fireTrigger } from './dispatcher.js';

/**
 * Map routing event type + which timestamp was set → trigger event_name.
 * Returns null if no trigger should fire for this combination.
 *
 * Each routing event type has BOTH an arrived and departed trigger so
 * dispatchers can pick the exact moment they want notifications to fire.
 * For example:
 *   pull: arrived  = "driver at terminal gate"
 *   pull: departed = "container picked up, enroute to delivery"
 */
const ARRIVED_MAP = {
  pull: 'arrived_at_pick_container',
  pickup: 'arrived_at_pick_container',
  deliver: 'arrived_at_deliver_load',
  return: 'arrived_at_return_load',
  drop: 'arrived_at_drop_container',
  hook: 'arrived_to_hook_container',
  hook_chassis: 'arrived_to_chassis',
  return_chassis: 'arrived_to_return_chassis',
  stop_off: 'arrived_at_stop_off',
};

const DEPARTED_MAP = {
  pull: 'departed_pick_container',
  pickup: 'departed_pick_container',
  deliver: 'departed_deliver_load',
  return: 'departed_return_load',
  drop: 'departed_drop_container',
  hook: 'departed_hook_container',
  hook_chassis: 'departed_chassis',
  return_chassis: 'departed_return_chassis',
  stop_off: 'departed_stop_off',
};

/**
 * Fire matching status triggers for a routing event timestamp change.
 *
 * @param svc  service-role Supabase client
 * @param {{
 *   tenantId: string,
 *   loadId: string,
 *   eventType: string,       // 'pull' | 'pickup' | 'deliver' | 'return' | 'drop' | 'hook'
 *   timestampField: string,  // 'arrived_at' | 'departed_at' | 'started_at'
 *   userId?: string | null,
 * }} params
 */
export async function fireRoutingEventTriggers(svc, params) {
  const { tenantId, loadId, eventType, timestampField, userId } = params;
  if (!tenantId || !loadId || !eventType) {
    return { firesAttempted: 0, firesSucceeded: 0 };
  }

  // Determine which trigger event_name this routing event maps to
  let triggerEventName = null;
  if (timestampField === 'arrived_at') {
    triggerEventName = ARRIVED_MAP[eventType] || null;
  } else if (timestampField === 'departed_at') {
    triggerEventName = DEPARTED_MAP[eventType] || null;
  }

  if (!triggerEventName) {
    return { firesAttempted: 0, firesSucceeded: 0 };
  }

  // Find active status triggers matching this event_name
  const { data: triggers, error } = await svc
    .from('email_template_triggers')
    .select('*')
    .eq('tenant_id', tenantId)
    .eq('trigger_kind', 'status')
    .eq('is_active', true)
    .eq('event_name', triggerEventName);

  if (error || !triggers || triggers.length === 0) {
    return { firesAttempted: 0, firesSucceeded: 0 };
  }

  let succeeded = 0;
  const attempts = [];

  for (const trigger of triggers) {
    // Check for delayed triggers — skip if notify_after > 0
    const cond = trigger.conditions || {};
    const notifyAfter = cond.notify_after || { days: 0, hours: 0, minutes: 0 };
    const delayMs =
      ((Number(notifyAfter.days) || 0) * 86400 +
        (Number(notifyAfter.hours) || 0) * 3600 +
        (Number(notifyAfter.minutes) || 0) * 60) *
      1000;
    if (delayMs > 0) continue; // Polled worker handles delayed triggers

    const fireKey = `routing_${eventType}_${timestampField}_${Date.now()}`;
    attempts.push(
      fireTrigger(svc, {
        tenantId,
        triggerId: trigger.id,
        loadId,
        fireKey,
        userId,
        eventName: triggerEventName,
      })
        .then((result) => {
          if (result.outcome === 'fired') succeeded++;
          return result;
        })
        .catch((e) => {
          console.error(
            `fireRoutingEventTriggers[${trigger.id}] ${triggerEventName}:`,
            e.message
          );
          return null;
        })
    );
  }

  await Promise.all(attempts);
  return { firesAttempted: attempts.length, firesSucceeded: succeeded };
}
