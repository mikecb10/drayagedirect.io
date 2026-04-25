// pages/api/driver/moves/[id]/index.js
import { requireDriver } from '../../../../../lib/driver-auth/middleware.js';
import { getServiceClient } from '../../../../../lib/tenant-api.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' });
  const ctx = await requireDriver(req, res);
  if (!ctx) return;

  const svc = getServiceClient();
  const { id } = req.query;

  const { data: move, error } = await svc
    .from('order_container_moves')
    .select(`
      id, order_id, driver_id, status, tracking_status, scheduled_date, sort_order,
      session_started_at, session_ended_at, last_ping_at, ping_count,
      order:orders(
        id, order_number, container_number, container_size, container_type, last_free_day, load_type
      ),
      events:order_routing_events(
        id, sequence, event_type, event_status, location_id, location_name,
        address, city, state, zip, scheduled_at, arrived_at, departed_at,
        eta_arrival_at, eta_distance_remaining_miles
      )
    `)
    .eq('id', id)
    .eq('tenant_id', ctx.tenantId)
    .maybeSingle();

  if (error) return res.status(500).json({ error: error.message });
  if (!move) return res.status(404).json({ error: 'move_not_found' });
  if (move.driver_id !== ctx.driverId) return res.status(403).json({ error: 'forbidden' });

  if (Array.isArray(move.events)) {
    move.events.sort((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0));
  }

  return res.status(200).json({ move });
}
