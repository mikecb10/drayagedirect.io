import { requireTenantUser, getServiceClient } from '../../../../../lib/tenant-api';

/**
 * GET /api/tenant/loads/[id]/tracking
 *
 * Returns tracking data for a load:
 *   - last_ping: most recent GPS ping for the assigned driver
 *   - geofence_events: enter/exit events for this load
 *   - drive_segments: driving/dwell segments for this load
 *   - routing_events: the load's routing events with timestamps (for sidebar)
 *   - gps_source: current GPS source (eld / mobile_app / null)
 */
export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const ctx = await requireTenantUser(req, res);
  if (!ctx) return;

  const { id } = req.query;
  const svc = getServiceClient();

  // Get the load with driver + org info including geofence data
  const { data: load } = await svc
    .from('orders')
    .select(`
      id, driver_id, status,
      pickup_org:customers!orders_pickup_location_id_fkey(id, name, address_line1, city, state, geofence_type, geofence_data),
      delivery_org:customers!orders_delivery_location_id_fkey(id, name, address_line1, city, state, geofence_type, geofence_data),
      return_org:customers!orders_return_location_id_fkey(id, name, address_line1, city, state, geofence_type, geofence_data)
    `)
    .eq('tenant_id', ctx.tenantId)
    .eq('id', id)
    .is('deleted_at', null)
    .single();

  if (!load) return res.status(404).json({ error: 'Load not found' });

  let lastPing = null;
  let gpsSource = null;
  let geofenceEvts = [];
  let segments = [];

  if (load.driver_id) {
    // Get driver's last known location
    const { data: driver } = await svc
      .from('drivers')
      .select('id, last_latitude, last_longitude, last_location_at, last_location_source, last_speed_mph, last_heading, eld_connected, eld_provider')
      .eq('id', load.driver_id)
      .single();

    if (driver?.last_latitude) {
      lastPing = {
        latitude: driver.last_latitude,
        longitude: driver.last_longitude,
        recorded_at: driver.last_location_at,
        received_at: driver.last_location_at,
        speed_mph: driver.last_speed_mph,
        heading: driver.last_heading,
        source: driver.last_location_source,
      };
      gpsSource = driver.last_location_source || (driver.eld_connected ? 'eld' : null);
    }

    // Get geofence events for this load
    try {
      const { data } = await svc
        .from('geofence_events')
        .select('*, organization:customers(id, name)')
        .eq('order_id', id)
        .order('recorded_at', { ascending: true });
      geofenceEvts = data || [];
    } catch {}

    // Get drive segments for this load
    try {
      const { data } = await svc
        .from('drive_segments')
        .select('*')
        .eq('order_id', id)
        .order('started_at', { ascending: true });
      segments = data || [];
    } catch {}
  }

  // Get routing events for the sidebar
  const { data: routingEvents } = await svc
    .from('order_routing_events')
    .select('id, sequence, event_type, location_name, city, state, arrived_at, departed_at, move_id')
    .eq('order_id', id)
    .order('sequence', { ascending: true });

  // Get moves for grouping
  const { data: movesData } = await svc
    .from('order_container_moves')
    .select('id, sequence, status, started_at, completed_at')
    .eq('order_id', id)
    .order('sequence', { ascending: true });

  return res.status(200).json({
    last_ping: lastPing,
    gps_source: gpsSource,
    geofence_events: geofenceEvts,
    drive_segments: segments,
    routing_events: routingEvents || [],
    moves: movesData || [],
    // Org data with geofence info for map rendering
    locations: {
      pickup: load.pickup_org || null,
      delivery: load.delivery_org || null,
      return: load.return_org || null,
    },
  });
}
