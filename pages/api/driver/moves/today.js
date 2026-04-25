// pages/api/driver/moves/today.js
import { requireDriver } from '../../../../lib/driver-auth/middleware.js';
import { getServiceClient } from '../../../../lib/tenant-api.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' });
  const ctx = await requireDriver(req, res);
  if (!ctx) return;

  const svc = getServiceClient();

  // Today defined as scheduled_date = today (driver's local "today" — for v1
  // we use server-local date since drivers operate in tenant timezone; can
  // pass ?date=YYYY-MM-DD to override).
  const dateParam = req.query.date;
  const today = dateParam || new Date().toISOString().slice(0, 10);

  const { data: moves, error } = await svc
    .from('order_container_moves')
    .select(`
      id, order_id, status, tracking_status, scheduled_date, sort_order,
      session_started_at, session_ended_at, last_ping_at, ping_count,
      order:orders(
        id, order_number, container_number, container_size, container_type, last_free_day,
        load_type
      ),
      events:order_routing_events(
        id, sequence, event_type, event_status, location_id, location_name,
        address, city, state, zip, scheduled_at, arrived_at, departed_at,
        eta_arrival_at, eta_distance_remaining_miles
      )
    `)
    .eq('tenant_id', ctx.tenantId)
    .eq('driver_id', ctx.driverId)
    .eq('scheduled_date', today)
    .neq('status', 'cancelled')
    .order('sort_order', { ascending: true });

  if (error) return res.status(500).json({ error: error.message });

  // Sort events per move
  for (const m of moves ?? []) {
    if (Array.isArray(m.events)) {
      m.events.sort((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0));
    }
  }

  return res.status(200).json({ date: today, moves: moves ?? [] });
}
