/**
 * GET /api/driver/loads/[id]/rail-slip
 *
 * Driver-facing read-only endpoint that returns the Rail/Port Check-In
 * Slip data for a load. This is the contract a future mobile app will
 * consume to show the driver the info they need to read off at rail/
 * port check-in.
 *
 * ## Stub status
 *
 * Driver authentication is NOT YET BUILT. For now this endpoint
 * accepts the same tenant-user auth as the dispatcher endpoints,
 * which means:
 *   - The dispatcher can hit it from the "Preview as Driver" button
 *     in the routing tab to see exactly what the driver will see.
 *   - When the mobile app is built, we'll add a driver-specific auth
 *     middleware (driver token / mobile session) and update this
 *     handler to validate that the driver requesting the slip is
 *     actually assigned to the load.
 *
 * The response shape below is the contract the mobile team should
 * build against.
 *
 * ## Response shape
 *
 *   {
 *     load_id: "uuid",
 *     order_number: "ORD-O123",
 *     load_type: "outbound" | "export",
 *     verified: boolean,
 *     verified_at: "ISO timestamp" | null,
 *     verified_by: "Mike (Dispatcher)" | null,
 *     check_in_label: "Rail Check-In" | "Port Check-In",
 *     fields: {
 *       container_number: string,
 *       seal_number: string,
 *       reference_number: string,
 *       piece_count: number,
 *       weight_lbs: number,
 *       final_destination: { name, city, state } | null,
 *     },
 *     destination_terminal: { name, city, state } | null
 *   }
 */

import {
  requireTenantUser,
  requirePermission,
  getServiceClient,
} from '../../../../../lib/tenant-api';
import { PERMISSIONS } from '../../../../../lib/permissions';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // STUB: tenant auth for now. Will switch to driver auth when mobile
  // app launches and we have a driver session/token middleware.
  const ctx = await requireTenantUser(req, res);
  if (!ctx) return;
  if (
    !requirePermission(
      ctx,
      [PERMISSIONS.DISPATCHING, PERMISSIONS.ORDER_ENTRY, PERMISSIONS.ALL],
      res
    )
  )
    return;

  const { id } = req.query;
  const svc = getServiceClient();

  const { data: load, error } = await svc
    .from('orders')
    .select(
      `
      id, order_number, load_type,
      container_number, seal_number, customer_reference,
      piece_count, weight_lbs,
      rail_slip_verified_at, rail_slip_verified_by,
      final_delivery_org:customers!orders_final_delivery_location_id_fkey(id, name, city, state),
      return_org:customers!orders_return_location_id_fkey(id, name, city, state),
      verified_by_user:users!orders_rail_slip_verified_by_fkey(id, name)
      `
    )
    .eq('tenant_id', ctx.tenantId)
    .eq('id', id)
    .is('deleted_at', null)
    .maybeSingle();

  if (error || !load) {
    return res.status(404).json({ error: 'Load not found' });
  }

  // Only Outbound and Export loads have a rail/port check-in slip
  if (!['outbound', 'export'].includes(load.load_type)) {
    return res.status(404).json({
      error: 'This load does not require a Rail/Port Check-In Slip.',
    });
  }

  const checkInLabel = load.load_type === 'outbound' ? 'Rail Check-In' : 'Port Check-In';

  return res.status(200).json({
    load_id: load.id,
    order_number: load.order_number,
    load_type: load.load_type,
    verified: !!load.rail_slip_verified_at,
    verified_at: load.rail_slip_verified_at,
    verified_by: load.verified_by_user?.name || null,
    check_in_label: checkInLabel,
    fields: {
      container_number: load.container_number || null,
      seal_number: load.seal_number || null,
      reference_number: load.customer_reference || null,
      piece_count: load.piece_count,
      weight_lbs: load.weight_lbs,
      final_destination: load.final_delivery_org
        ? {
            name: load.final_delivery_org.name,
            city: load.final_delivery_org.city,
            state: load.final_delivery_org.state,
          }
        : null,
    },
    destination_terminal: load.return_org
      ? {
          name: load.return_org.name,
          city: load.return_org.city,
          state: load.return_org.state,
        }
      : null,
  });
}
