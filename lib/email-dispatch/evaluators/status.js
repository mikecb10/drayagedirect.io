/**
 * Status trigger evaluator
 *
 * Fires for loads whose current status matches the trigger's
 * event_name (the status slug) AND which entered that status at or
 * before `notify_after` duration ago.
 *
 * Conditions shape:
 *   { notify_after: { days, hours, minutes } }
 *
 * Uses order_status_history (migration 001) to find the exact
 * timestamp the load entered the target status. A load that entered
 * and left and re-entered counts on its most recent entry.
 */

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
  const cond = trigger.conditions || {};
  const notifyAfterMs = durationToMs(cond.notify_after);

  const cutoff = new Date(Date.now() - notifyAfterMs).toISOString();

  // Find transitions INTO the target status at or before cutoff
  const { data: history, error: hErr } = await svc
    .from('order_status_history')
    .select('order_id, created_at')
    .eq('tenant_id', tenantId)
    .eq('new_status', targetStatus)
    .lte('created_at', cutoff);

  if (hErr) {
    console.error('status trigger history fetch:', hErr.message);
    return [];
  }
  if (!history || history.length === 0) return [];

  // Dedupe per load to the latest transition
  const latestByLoad = new Map();
  for (const row of history) {
    const prev = latestByLoad.get(row.order_id);
    if (!prev || new Date(row.created_at) > new Date(prev.created_at)) {
      latestByLoad.set(row.order_id, row);
    }
  }

  const candidateLoadIds = Array.from(latestByLoad.keys());
  if (candidateLoadIds.length === 0) return [];

  // Verify those loads are still in the target status (and not deleted)
  const { data: loads, error: lErr } = await svc
    .from('orders')
    .select('id, status, deleted_at')
    .in('id', candidateLoadIds)
    .eq('tenant_id', tenantId);

  if (lErr) {
    console.error('status trigger load fetch:', lErr.message);
    return [];
  }

  const matches = [];
  for (const load of loads || []) {
    if (load.deleted_at) continue;
    if (load.status !== targetStatus) continue;
    const history_entry = latestByLoad.get(load.id);
    matches.push({
      load_id: load.id,
      reason: `in status '${targetStatus}' since ${history_entry.created_at}`,
    });
  }
  return matches;
}
