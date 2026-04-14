/**
 * Status-Change Trigger Firing
 *
 * Called from the loads PUT handler (and routing API where status
 * changes happen) when a load's status transitions from one value
 * to another. Finds all active `status` kind triggers whose
 * event_name matches the NEW status and fires them immediately.
 *
 * Also writes a row to `order_status_history` so the polled worker
 * can evaluate delayed status triggers (notify_after > 0) via cron.
 *
 * Fire-and-forget from the caller's perspective — errors are logged
 * but never bubble up to the API response.
 */

import { fireTrigger } from './dispatcher.js';

/**
 * @param svc service-role Supabase client
 * @param {{
 *   tenantId: string,
 *   loadId: string,
 *   oldStatus: string | null,
 *   newStatus: string,
 *   userId: string | null,
 * }} params
 */
export async function fireStatusChangeTriggers(svc, params) {
  const { tenantId, loadId, oldStatus, newStatus, userId } = params;
  if (!tenantId || !loadId || !newStatus) {
    return { firesAttempted: 0, firesSucceeded: 0 };
  }
  // No change
  if (oldStatus === newStatus) {
    return { firesAttempted: 0, firesSucceeded: 0 };
  }

  // 1. Write to order_status_history so the polled worker has data
  //    for delayed status triggers (notify_after > 0)
  try {
    await svc.from('order_status_history').insert({
      tenant_id: tenantId,
      order_id: loadId,
      old_status: oldStatus || null,
      new_status: newStatus,
      changed_by: userId || null,
    });
  } catch (e) {
    // Non-fatal — the immediate trigger fire still works without the
    // history row. Log and continue.
    console.error('order_status_history insert failed:', e.message);
  }

  // 2. Find active status triggers matching the new status
  const { data: triggers, error } = await svc
    .from('email_template_triggers')
    .select('*')
    .eq('tenant_id', tenantId)
    .eq('trigger_kind', 'status')
    .eq('is_active', true)
    .eq('event_name', newStatus);

  if (error) {
    console.error('fireStatusChangeTriggers trigger fetch:', error.message);
    return { firesAttempted: 0, firesSucceeded: 0 };
  }

  if (!triggers || triggers.length === 0) {
    return { firesAttempted: 0, firesSucceeded: 0 };
  }

  // 3. For immediate triggers (notify_after = 0 or empty), fire now.
  //    For delayed triggers (notify_after > 0), let the polled worker
  //    pick them up from order_status_history.
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
      // Delayed trigger — the polled worker will pick it up from
      // order_status_history once the delay has elapsed.
      continue;
    }

    const fireKey = `status_${newStatus}_${Date.now()}`;
    attempts.push(
      fireTrigger(svc, {
        tenantId,
        triggerId: trigger.id,
        loadId,
        fireKey,
        userId,
        eventName: newStatus,
      })
        .then((result) => {
          if (result.outcome === 'fired') succeeded++;
          return result;
        })
        .catch((e) => {
          console.error(
            `fireStatusChangeTriggers[${trigger.id}] ${newStatus}:`,
            e.message
          );
          return null;
        })
    );
  }

  await Promise.all(attempts);
  return { firesAttempted: attempts.length, firesSucceeded: succeeded };
}
