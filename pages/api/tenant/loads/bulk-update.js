import {
  requireTenantUser,
  requirePermission,
  getServiceClient,
} from '../../../../lib/tenant-api';
import { logTenantAction, getClientIp } from '../../../../lib/tenant-audit';
import { PERMISSIONS } from '../../../../lib/permissions';

/**
 * Bulk update loads endpoint.
 * POST body: { load_ids: [uuid, uuid, ...], patch: { field: value, ... } }
 *
 * Applies the same patch object to every load in load_ids. The patch is
 * restricted to the same field allowlist as single-load PUT.
 *
 * ── Email trigger limitation (Milestone 4c) ──
 * This endpoint does NOT fire field-change email triggers. The single-
 * load PUT handler at pages/api/tenant/loads/[id]/index.js captures
 * oldLoad before the update and passes both old + new to
 * fireFieldChangeTriggers; bulk-update uses a single `.update().in(...)`
 * call and never hydrates per-load old values, so we can't compute the
 * per-row delta without a separate pre-fetch pass (expensive). Deferred
 * to a later milestone. If a dispatcher needs trigger fires on a bulk
 * change, they should apply the change via individual PUTs.
 */

// NOTE: load_type is intentionally excluded — the load number has the type
// letter baked in (M/N/E/O/R/B), so changing type would make the load number
// misleading. Users must delete + recreate to change load type.
const EDITABLE_FIELDS = [
  // Identity / routing
  'status',
  // Locations
  'pickup_location_id',
  'delivery_location_id',
  'return_location_id',
  'final_delivery_location_id',
  // Dates
  'pickup_date',
  'delivery_date',
  'cutoff_date',
  'last_free_day',
  'vessel_eta',
  'container_eta',
  'available_date',
  'discharge_date',
  'outgate_date',
  'empty_date',
  'per_diem_free_day',
  'ingate_date',
  'ready_to_return_date',
  // Appointment windows
  'pickup_apt_from',
  'pickup_apt_to',
  'delivery_apt_from',
  'delivery_apt_to',
  'return_apt_from',
  'return_apt_to',
  // Container / equipment
  'container_number',
  'container_size',
  'container_type',
  'container_size_id',
  'container_type_id',
  'seal_number',
  'chassis_number',
  'chassis_size',
  'chassis_type',
  'chassis_size_id',
  'chassis_type_id',
  'chassis_owner',
  'gray_chassis_number',
  'gray_container_number',
  'ref_container_number',
  'steamship_line',
  'steamship_line_scac',
  'container_owner_id',
  'genset_number',
  'genset_temperature',
  'genset_route',
  'genset_scac',
  'weight_lbs',
  'weight_kg',
  'piece_count',
  'pallet_count',
  'commodity_description',
  // Flags
  'is_hazmat',
  'is_overweight',
  'is_overheight',
  'is_liquor',
  'is_hot',
  'is_genset',
  'is_scale',
  'is_ev',
  'is_street_turn',
  'is_oog',
  'is_bonded',
  'is_double',
  'is_tanker',
  'is_bill_only',
  // References
  'bill_of_lading',
  'house_bol',
  'booking_number',
  'customer_reference',
  'po_numbers',
  'vessel_name',
  'voyage_number',
  'shipment_number',
  'pickup_number',
  'appointment_number',
  'return_number',
  'reservation_number',
  'delivery_reference',
  'work_order',
  // Assignment
  'driver_id',
  'csr_user_id',
  'terminal_status',
  // Notes
  'notes',
  'internal_notes',
];

export default async function handler(req, res) {
  const ctx = await requireTenantUser(req, res);
  if (!ctx) return;

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!requirePermission(ctx, [PERMISSIONS.ORDER_ENTRY, PERMISSIONS.DISPATCHING, PERMISSIONS.ALL], res))
    return;

  const svc = getServiceClient();
  const { load_ids, patch } = req.body || {};

  if (!Array.isArray(load_ids) || load_ids.length === 0) {
    return res.status(400).json({ error: 'load_ids must be a non-empty array' });
  }
  if (!patch || typeof patch !== 'object' || Object.keys(patch).length === 0) {
    return res.status(400).json({ error: 'patch must be a non-empty object' });
  }

  // Build the update object using only allowlisted fields
  const updates = {};
  for (const f of EDITABLE_FIELDS) {
    if (patch[f] !== undefined) updates[f] = patch[f];
  }
  if (Object.keys(updates).length === 0) {
    return res.status(400).json({ error: 'No valid fields in patch' });
  }

  // Run the update scoped to the tenant + the given IDs
  const { data, error } = await svc
    .from('orders')
    .update(updates)
    .eq('tenant_id', ctx.tenantId)
    .in('id', load_ids)
    .is('deleted_at', null)
    .select('id, order_number');

  if (error) return res.status(500).json({ error: error.message });

  // Write one audit row per affected load (entity_id scoped to that load)
  // so each load's audit page surfaces the change. The bulk_count field
  // lets a future reader see this update was part of a multi-load action.
  const updatedIds = (data || []).map((d) => d.id);
  const ip = getClientIp(req);
  await Promise.all(
    updatedIds.map((load_id) =>
      logTenantAction(svc, {
        tenantId: ctx.tenantId,
        userId: ctx.userId,
        action: 'load.bulk_update',
        entityType: 'order',
        entityId: load_id,
        newValues: { patch: updates, bulk_count: updatedIds.length },
        ipAddress: ip,
      })
    )
  );

  return res.status(200).json({
    updated: data?.length || 0,
    load_ids: (data || []).map((d) => d.id),
  });
}
