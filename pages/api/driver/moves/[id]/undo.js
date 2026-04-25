/**
 * Undoes the driver's most recent transition on this move.
 * Rules:
 *   - Within 2 minutes of the original action
 *   - No dispatcher_ui-source history row exists after the original tap
 *   - Idempotent: running undo twice is rejected (no transitions to undo)
 */
import { requireDriver } from '../../../../../lib/driver-auth/middleware.js';
import { getServiceClient } from '../../../../../lib/tenant-api.js';
import { checkTrackingGates } from '../../../../../lib/driver-auth/tracking-gates.js';

const UNDO_WINDOW_MS = 2 * 60 * 1000;

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });
  const ctx = await requireDriver(req, res);
  if (!ctx) return;

  const svc = getServiceClient();
  const gateFail = await checkTrackingGates({
    supabase: svc, tenantId: ctx.tenantId, driver: ctx.driver,
  });
  if (gateFail) return res.status(gateFail.status).json({ error: gateFail.error });

  const { id: moveId } = req.query;

  // 1. Verify move ownership
  const { data: move, error: moveErr } = await svc
    .from('order_container_moves')
    .select('id, driver_id, tracking_status')
    .eq('id', moveId)
    .eq('tenant_id', ctx.tenantId)
    .maybeSingle();
  if (moveErr || !move) return res.status(404).json({ error: 'move_not_found' });
  if (move.driver_id !== ctx.driverId) return res.status(403).json({ error: 'forbidden' });

  // 2. Find most recent driver-app event-status transition on any event of this move,
  //    within undo window, with no dispatcher override after.
  const cutoffIso = new Date(Date.now() - UNDO_WINDOW_MS).toISOString();
  const { data: histRows } = await svc
    .from('order_routing_event_status_history')
    .select('id, event_id, from_status, to_status, transitioned_at, actor_context')
    .eq('tenant_id', ctx.tenantId)
    .gte('transitioned_at', cutoffIso)
    .order('transitioned_at', { ascending: false });

  // Filter by events in this move
  const { data: moveEvents } = await svc
    .from('order_routing_events')
    .select('id')
    .eq('tenant_id', ctx.tenantId)
    .eq('move_id', moveId);
  const moveEventIds = new Set((moveEvents ?? []).map((e) => e.id));

  let target = null;
  for (const row of histRows ?? []) {
    if (!moveEventIds.has(row.event_id)) continue;
    if (row.actor_context?.source !== 'driver_app') continue;
    target = row;
    break;
  }
  if (!target) return res.status(409).json({ error: 'no_undo_target' });

  // 3. Reject if a dispatcher_ui row exists after the target on the same event
  const { data: laterDispatcher } = await svc
    .from('order_routing_event_status_history')
    .select('id, actor_context')
    .eq('tenant_id', ctx.tenantId)
    .eq('event_id', target.event_id)
    .gt('transitioned_at', target.transitioned_at);
  if ((laterDispatcher ?? []).some((r) => r.actor_context?.source === 'dispatcher_ui')) {
    return res.status(409).json({ error: 'dispatcher_overrode' });
  }

  // 4. Reverse transition (direct revert; bypasses state machine).
  const update = { event_status: target.from_status };
  if (target.to_status === 'arrived') update.arrived_at = null;
  if (target.to_status === 'departed') update.departed_at = null;
  const { error: evUpdErr } = await svc
    .from('order_routing_events')
    .update(update)
    .eq('id', target.event_id)
    .eq('tenant_id', ctx.tenantId);
  if (evUpdErr) return res.status(500).json({ error: evUpdErr.message });

  await svc.from('order_routing_event_status_history').insert({
    tenant_id: ctx.tenantId,
    event_id: target.event_id,
    from_status: target.to_status,
    to_status: target.from_status,
    actor_id: ctx.driverId,
    actor_type: 'human',
    actor_context: { source: 'driver_app', undo: true, original_history_id: target.id },
    note: 'driver undo',
  });

  // 5. Reverse the tracking_status transition if needed.
  let trackingFrom = move.tracking_status;
  let trackingTo = null;
  if (target.to_status === 'arrived' && trackingFrom === 'on_site') trackingTo = 'in_transit';
  if (target.to_status === 'departed' && (trackingFrom === 'in_transit' || trackingFrom === 'completed')) trackingTo = 'on_site';

  if (trackingTo) {
    await svc
      .from('order_container_moves')
      .update({ tracking_status: trackingTo, session_ended_at: null })
      .eq('id', moveId)
      .eq('tenant_id', ctx.tenantId);
    await svc.from('move_tracking_session_history').insert({
      tenant_id: ctx.tenantId,
      move_id: moveId,
      from_status: trackingFrom,
      to_status: trackingTo,
      actor_id: ctx.driverId,
      actor_type: 'human',
      actor_context: { source: 'driver_app', undo: true, original_history_id: target.id },
      note: 'driver undo',
    });
  }

  return res.status(200).json({ undone: { event_id: target.event_id, from: target.to_status, to: target.from_status } });
}
