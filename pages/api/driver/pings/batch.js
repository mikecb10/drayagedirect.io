/**
 * POST /api/driver/pings/batch
 * Body: { items: [{ moveId, gpsPing }, ...] }   max 100
 *
 * For offline-queue flush. Each insert preserves recorded_at; received_at
 * defaults to server now(). Skips ping_count cap enforcement on individual
 * items (the queue itself caps at 100, and a flush of 100 mostly-offline
 * pings is legitimate). Does NOT recompute ETA per item — cost gating.
 *
 * Returns: { accepted: N }
 */
import { requireDriver } from '../../../../lib/driver-auth/middleware.js';
import { getServiceClient } from '../../../../lib/tenant-api.js';
import { checkTrackingGates } from '../../../../lib/driver-auth/tracking-gates.js';

const MAX_BATCH_SIZE = 100;
const PING_SOURCE = 'mobile_app';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });
  const ctx = await requireDriver(req, res);
  if (!ctx) return;

  const svc = getServiceClient();
  const gateFail = await checkTrackingGates({
    supabase: svc, tenantId: ctx.tenantId, driver: ctx.driver,
  });
  if (gateFail) return res.status(gateFail.status).json({ error: gateFail.error });

  const { items } = req.body || {};
  if (!Array.isArray(items)) return res.status(400).json({ error: 'items_array_required' });
  if (items.length === 0) return res.status(200).json({ accepted: 0 });
  if (items.length > MAX_BATCH_SIZE) return res.status(413).json({ error: 'batch_too_large' });

  // Single multi-row INSERT (atomic enough for v1 — partial failures surface
  // as a single error and we accept that limitation).
  const rows = items.map((item) => ({
    tenant_id: ctx.tenantId,
    move_id: item.moveId,
    driver_id: ctx.driverId,
    latitude: item.gpsPing.latitude,
    longitude: item.gpsPing.longitude,
    accuracy_meters: item.gpsPing.accuracy_meters ?? null,
    speed_mph: item.gpsPing.speed_mph ?? null,
    heading: item.gpsPing.heading ?? null,
    battery_pct: item.gpsPing.battery_pct ?? null,
    source: PING_SOURCE,
    recorded_at: item.gpsPing.recorded_at,
  }));
  const { error } = await svc.from('driver_location_pings').insert(rows);
  if (error) return res.status(500).json({ error: error.message });

  // Bump last_ping_at + ping_count per move (best-effort, group by move_id and
  // pick latest recorded_at). v1: scan + update from highest recorded_at.
  const byMove = new Map();
  for (const item of items) {
    const cur = byMove.get(item.moveId);
    if (!cur || item.gpsPing.recorded_at > cur.recorded_at) {
      byMove.set(item.moveId, {
        recorded_at: item.gpsPing.recorded_at,
        latitude: item.gpsPing.latitude,
        longitude: item.gpsPing.longitude,
        count_in_batch: (cur?.count_in_batch ?? 0) + 1,
      });
    } else {
      byMove.set(item.moveId, { ...cur, count_in_batch: (cur?.count_in_batch ?? 0) + 1 });
    }
  }
  for (const [moveId, latest] of byMove.entries()) {
    const { data: cur } = await svc
      .from('order_container_moves')
      .select('ping_count, last_ping_at')
      .eq('id', moveId)
      .eq('tenant_id', ctx.tenantId)
      .maybeSingle();
    if (!cur) continue;
    const update = { ping_count: (cur.ping_count ?? 0) + latest.count_in_batch };
    if (!cur.last_ping_at || latest.recorded_at > cur.last_ping_at) {
      update.last_ping_at = latest.recorded_at;
    }
    await svc
      .from('order_container_moves')
      .update(update)
      .eq('id', moveId)
      .eq('tenant_id', ctx.tenantId);
  }

  // Update driver's last_* from the absolute-latest ping in the batch
  let latestPing = null;
  for (const item of items) {
    if (!latestPing || item.gpsPing.recorded_at > latestPing.recorded_at) {
      latestPing = item.gpsPing;
    }
  }
  if (latestPing) {
    await svc
      .from('drivers')
      .update({
        last_latitude: latestPing.latitude,
        last_longitude: latestPing.longitude,
        last_location_at: latestPing.recorded_at,
        last_location_source: PING_SOURCE,
        last_speed_mph: latestPing.speed_mph ?? null,
        last_heading: latestPing.heading ?? null,
      })
      .eq('id', ctx.driverId)
      .eq('tenant_id', ctx.tenantId);
  }

  return res.status(200).json({ accepted: items.length });
}
