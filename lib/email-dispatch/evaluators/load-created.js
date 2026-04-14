/**
 * Composite event evaluator: load_created
 *
 * Fires for loads that were created within the last `notify_after`
 * window. The dedupe layer uses a per-day fire_key so a load still
 * within the window on a subsequent day re-fires exactly once per day.
 *
 * Default window if unset: 15 minutes.
 *
 * Conditions shape:
 *   { notify_after: { days, hours, minutes } }
 */

function durationToMs(d) {
  if (!d || typeof d !== 'object') return 0;
  const days = Number(d.days) || 0;
  const hours = Number(d.hours) || 0;
  const minutes = Number(d.minutes) || 0;
  return (days * 86400 + hours * 3600 + minutes * 60) * 1000;
}

export async function evaluate(svc, tenantId, trigger) {
  const cond = trigger.conditions || {};
  let windowMs = durationToMs(cond.notify_after);
  // Default to 15 minutes if the trigger doesn't specify
  if (!windowMs) windowMs = 15 * 60 * 1000;

  const since = new Date(Date.now() - windowMs).toISOString();

  const { data, error } = await svc
    .from('orders')
    .select('id, created_at')
    .eq('tenant_id', tenantId)
    .gte('created_at', since)
    .is('deleted_at', null);

  if (error) {
    console.error('load_created fetch:', error.message);
    return [];
  }

  return (data || []).map((l) => ({
    load_id: l.id,
    reason: `created_at=${l.created_at}`,
  }));
}
