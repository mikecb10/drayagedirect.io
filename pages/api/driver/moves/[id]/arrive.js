import { requireDriver } from '../../../../../lib/driver-auth/middleware.js';
import { getServiceClient } from '../../../../../lib/tenant-api.js';
import { checkTrackingGates } from '../../../../../lib/driver-auth/tracking-gates.js';
import { applyDriverAction } from '../../../../../lib/routing/driver-action.js';

const GPS_DRIFT_WARN_METERS = 500;

function haversineMeters(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

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
  const { gpsPing, targetEventId, override_distance_warning } = req.body || {};
  if (!gpsPing || typeof gpsPing.latitude !== 'number' || typeof gpsPing.longitude !== 'number' || !gpsPing.recorded_at) {
    return res.status(400).json({ error: 'gpsPing_required' });
  }
  if (!targetEventId) return res.status(400).json({ error: 'targetEventId_required' });

  // Look up event location for distance check.
  // The event's lat/lng comes from its joined location (a customers row),
  // which has columns latitude + longitude (per migration 036/manage org).
  // If columns aren't present on customers, the GPS-drift check silently
  // skips (gps_distance_at_arrival_m stays null).
  const { data: event, error: eventErr } = await svc
    .from('order_routing_events')
    .select('id, location_id, location:customers(latitude, longitude)')
    .eq('id', targetEventId)
    .eq('tenant_id', ctx.tenantId)
    .maybeSingle();
  if (eventErr || !event) return res.status(404).json({ error: 'event_not_found' });

  let gps_distance_at_arrival_m = null;
  if (event.location?.latitude != null && event.location?.longitude != null) {
    gps_distance_at_arrival_m = Math.round(
      haversineMeters(gpsPing.latitude, gpsPing.longitude, event.location.latitude, event.location.longitude),
    );
    if (gps_distance_at_arrival_m > GPS_DRIFT_WARN_METERS && !override_distance_warning) {
      return res.status(409).json({
        error: 'gps_drift_warning',
        gps_distance_m: gps_distance_at_arrival_m,
        detail: 'You appear to be far from the location. Confirm and resend with override_distance_warning: true.',
      });
    }
  }

  try {
    const result = await applyDriverAction({
      supabase: svc, tenantId: ctx.tenantId, moveId, actionType: 'arrive',
      driverId: ctx.driverId, targetEventId, gpsPing,
    });
    // Stamp the GPS distance into the event status history (most recent insert)
    if (gps_distance_at_arrival_m != null) {
      try {
        const { data: histRows } = await svc
          .from('order_routing_event_status_history')
          .select('id, actor_context')
          .eq('tenant_id', ctx.tenantId)
          .eq('event_id', targetEventId)
          .order('transitioned_at', { ascending: false })
          .limit(1);
        const row = histRows?.[0];
        if (row) {
          await svc
            .from('order_routing_event_status_history')
            .update({
              actor_context: {
                ...(row.actor_context ?? {}),
                gps_distance_at_arrival_m,
              },
            })
            .eq('id', row.id);
        }
      } catch (e) {
        console.error('gps-distance audit update failed:', e?.message || e);
      }
    }
    return res.status(200).json({ ...result, gps_distance_at_arrival_m });
  } catch (e) {
    if (e.message === 'ping_cap_reached') return res.status(429).json({ error: 'ping_cap_reached' });
    if (e.message === 'move_unassigned') return res.status(409).json({ error: 'move_unassigned' });
    if (e.message?.startsWith('forbidden')) return res.status(403).json({ error: 'forbidden' });
    if (e.message?.startsWith('Invalid transition')) return res.status(409).json({ error: 'invalid_transition', detail: e.message });
    console.error('driver arrive error:', e);
    return res.status(500).json({ error: 'internal_error', detail: e.message });
  }
}
