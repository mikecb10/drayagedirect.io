/**
 * POST /api/driver/moves/[id]/ping
 * Body: { gpsPing: { latitude, longitude, recorded_at, accuracy_meters?, speed_mph?, heading?, battery_pct? } }
 *
 * Inserts a ping into driver_location_pings, denormalizes onto drivers.last_*,
 * bumps move.last_ping_at + ping_count, recomputes ETA if eligible.
 * Auto-resumes paused → in_transit on first ping after a pause.
 */
import { requireDriver } from '../../../../../lib/driver-auth/middleware.js';
import { getServiceClient } from '../../../../../lib/tenant-api.js';
import { checkTrackingGates } from '../../../../../lib/driver-auth/tracking-gates.js';
import { transitionTrackingSession } from '../../../../../lib/routing/tracking-session-transition.js';
import { recomputeETA } from '../../../../../lib/google-maps/server-distance.js';

const PING_CAP = 500;  // matches lib/routing/driver-action.js (raised from spec's 40)
const ETA_THROTTLE_MS = 90 * 1000;
const ETA_RECOMPUTE_CAP = 50;
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

  const { id: moveId } = req.query;
  const { gpsPing } = req.body || {};
  if (!gpsPing || typeof gpsPing.latitude !== 'number' || typeof gpsPing.longitude !== 'number' || !gpsPing.recorded_at) {
    return res.status(400).json({ error: 'gpsPing_required' });
  }

  // 1. Read move + ownership
  const { data: move, error: moveErr } = await svc
    .from('order_container_moves')
    .select('id, driver_id, tenant_id, tracking_status, ping_count, eta_recompute_count, last_ping_at')
    .eq('id', moveId)
    .eq('tenant_id', ctx.tenantId)
    .maybeSingle();
  if (moveErr || !move) return res.status(404).json({ error: 'move_not_found' });
  if (move.driver_id !== ctx.driverId) return res.status(403).json({ error: 'forbidden' });

  // 2. Cap
  if ((move.ping_count ?? 0) >= PING_CAP) return res.status(429).json({ error: 'ping_cap_reached' });

  // 3. Insert ping into driver_location_pings (with source='mobile_app')
  const { data: pingRow, error: pingErr } = await svc
    .from('driver_location_pings')
    .insert({
      tenant_id: ctx.tenantId, move_id: moveId, driver_id: ctx.driverId,
      latitude: gpsPing.latitude, longitude: gpsPing.longitude,
      accuracy_meters: gpsPing.accuracy_meters ?? null,
      speed_mph: gpsPing.speed_mph ?? null,
      heading: gpsPing.heading ?? null,
      battery_pct: gpsPing.battery_pct ?? null,
      source: PING_SOURCE,
      recorded_at: gpsPing.recorded_at,
    })
    .select()
    .single();
  if (pingErr) return res.status(500).json({ error: pingErr.message });

  // 3a. Denormalize onto drivers.last_* (where-is-driver-now).
  //     Log-and-continue: a denorm failure shouldn't fail the whole ping path.
  const { error: denormErr } = await svc
    .from('drivers')
    .update({
      last_latitude: gpsPing.latitude,
      last_longitude: gpsPing.longitude,
      last_location_at: gpsPing.recorded_at,
      last_location_source: PING_SOURCE,
      last_speed_mph: gpsPing.speed_mph ?? null,
      last_heading: gpsPing.heading ?? null,
    })
    .eq('id', ctx.driverId)
    .eq('tenant_id', ctx.tenantId);
  if (denormErr) {
    console.error(`driver denorm update failed for ${ctx.driverId}:`, denormErr.message);
  }

  // 3b. Bump move's ping_count + last_ping_at (staleness-check column).
  const { error: counterErr } = await svc
    .from('order_container_moves')
    .update({
      ping_count: (move.ping_count ?? 0) + 1,
      last_ping_at: gpsPing.recorded_at,
    })
    .eq('id', moveId)
    .eq('tenant_id', ctx.tenantId);
  if (counterErr) {
    console.error(`move counter update failed for ${moveId}:`, counterErr.message);
  }

  // 4. Auto-resume paused → in_transit
  if (move.tracking_status === 'paused') {
    try {
      await transitionTrackingSession({
        supabase: svc, tenantId: ctx.tenantId, moveId, toStatus: 'in_transit',
        actor: { id: ctx.driverId, type: 'human', context: { source: 'driver_app', resumed_from_pause: true, ping_id: pingRow.id } },
      });
    } catch (e) {
      console.error('auto-resume failed:', e?.message || e);
    }
  }

  // 5. ETA recompute (if eligible: in_transit/paused, last update >90s ago, recompute count <50)
  let eta = null;
  if (move.tracking_status === 'in_transit' || move.tracking_status === 'paused') {
    const lastEtaUpdate = move.last_ping_at ? new Date(move.last_ping_at).getTime() : 0;
    const elapsed = Date.now() - lastEtaUpdate;
    if (elapsed >= ETA_THROTTLE_MS && (move.eta_recompute_count ?? 0) < ETA_RECOMPUTE_CAP) {
      // Find next pending event in this move
      const { data: nextEvent } = await svc
        .from('order_routing_events')
        .select('id, location:customers(latitude, longitude)')
        .eq('tenant_id', ctx.tenantId)
        .eq('move_id', moveId)
        .eq('event_status', 'pending')
        .order('sequence', { ascending: true })
        .limit(1)
        .maybeSingle();

      if (nextEvent?.location?.latitude != null && nextEvent.location?.longitude != null) {
        try {
          const result = await recomputeETA({
            origin: { lat: gpsPing.latitude, lng: gpsPing.longitude },
            destination: {
              lat: nextEvent.location.latitude,
              lng: nextEvent.location.longitude,
              eventId: nextEvent.id,
            },
            recomputeCount: move.eta_recompute_count ?? 0,
          });
          if (!result.skipped) {
            await svc
              .from('order_routing_events')
              .update({
                eta_arrival_at: result.eta_arrival_at,
                eta_updated_at: new Date().toISOString(),
                eta_distance_remaining_miles: result.distance_remaining_miles,
              })
              .eq('id', nextEvent.id);
            if (!result.cached) {
              await svc
                .from('order_container_moves')
                .update({ eta_recompute_count: (move.eta_recompute_count ?? 0) + 1 })
                .eq('id', moveId)
                .eq('tenant_id', ctx.tenantId);
            }
            eta = result;
          }
        } catch (e) {
          console.error('ETA recompute failed:', e?.message || e);
        }
      }
    }
  }

  return res.status(200).json({ ping_id: pingRow.id, eta });
}
