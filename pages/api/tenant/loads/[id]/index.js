import {
  requireTenantUser,
  requirePermission,
  getServiceClient,
} from '../../../../../lib/tenant-api';
import { logTenantAction, getClientIp } from '../../../../../lib/tenant-audit';
import { PERMISSIONS, hasPermission } from '../../../../../lib/permissions';
import { fireFieldChangeTriggers, fireOrderStatusChangeTriggers } from '../../../../../lib/email-dispatch';
import { fetchLoadMarginInputs, computeLoadMargin } from '../../../../../lib/load-margin';
import { validateLoadPayload } from '../../../../../lib/validation/load-payload.js';

// NOTE: load_type is intentionally NOT editable — the load number has the
// type letter baked in (M/N/E/O/R/B), so changing the type would make the
// load number misleading. Users must delete + recreate to change load type.
const EDITABLE_FIELDS = [
  'customer_id',
  'status',
  'routing_template_id',
  'routing_template_name',
  'pickup_location_id',
  'delivery_location_id',
  'return_location_id',
  'final_delivery_location_id',
  'trailer_id',
  'container_owner_id',
  'container_type_id',
  'container_size_id',
  'chassis_type_id',
  'chassis_size_id',
  // Cargo metrics
  'piece_count',
  'pallet_count',
  'weight_kg',
  'commodity_description',
  // Dates
  'pickup_date',
  'delivery_date',
  'cutoff_date',
  'last_free_day',
  'vessel_eta',
  'discharge_date',
  'outgate_date',
  'empty_date',
  'per_diem_free_day',
  'ingate_date',
  'ready_to_return_date',
  // Container / equipment
  'container_number',
  'container_size',
  'container_type',
  'seal_number',
  'chassis_number',
  'chassis_size',
  'chassis_type',
  'chassis_owner',
  'steamship_line',
  'steamship_line_scac',
  'genset_number',
  'genset_temperature',
  'genset_route',
  'genset_scac',
  'weight_lbs',
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
  // Appointment windows
  'pickup_apt_from',
  'pickup_apt_to',
  'delivery_apt_from',
  'delivery_apt_to',
  'return_apt_from',
  'return_apt_to',
  // Chassis locations
  'hook_chassis_location_id',
  'terminate_chassis_location_id',
  // Assignment
  'driver_id',
  'dispatched_at',
  'branch_id',
  // Notes
  'notes',
  'internal_notes',
];

export default async function handler(req, res) {
  const ctx = await requireTenantUser(req, res);
  if (!ctx) return;

  const { id } = req.query;
  const svc = getServiceClient();

  if (req.method === 'GET') {
    if (
      !requirePermission(
        ctx,
        [PERMISSIONS.DISPATCHING, PERMISSIONS.ORDER_ENTRY, PERMISSIONS.ALL],
        res
      )
    )
      return;

    const { data, error } = await svc
      .from('orders')
      .select(
        `
        *,
        customer:customers!orders_customer_id_fkey(id, name, main_phone, main_contact_name),
        pickup_org:customers!orders_pickup_location_id_fkey(id, name, address_line1, city, state, zip),
        delivery_org:customers!orders_delivery_location_id_fkey(id, name, address_line1, city, state, zip),
        return_org:customers!orders_return_location_id_fkey(id, name, address_line1, city, state, zip),
        final_delivery_org:customers!orders_final_delivery_location_id_fkey(id, name, address_line1, city, state, zip),
        driver:drivers(id, first_name, last_name, name, phone),
        container_owner:container_owners(id, name, label, scac_code),
        created_by_user:users!orders_created_by_fkey(id, name, email)
      `
      )
      .eq('tenant_id', ctx.tenantId)
      .eq('id', id)
      .is('deleted_at', null)
      .single();

    if (error || !data) return res.status(404).json({ error: 'Load not found' });

    // Fetch holds
    const { data: holds } = await svc
      .from('order_holds')
      .select('*')
      .eq('tenant_id', ctx.tenantId)
      .eq('order_id', id);

    // ================================================================
    // Routing locks for the Load Info sidebar
    // ================================================================
    //
    // Load Info exposes Pickup / Delivery / Return OrgPickers that mirror
    // the FIRST pull / deliver / return routing event (per the "one-of-each"
    // architectural invariant). Once a dispatcher has started the physical
    // movement — i.e. the matching routing event has an arrived_at or
    // departed_at timestamp — the sidebar MUST lock that location so the
    // dispatcher is forced to edit from the Routing tab (which has the
    // proper locked-event unlock flow + audit trail).
    //
    // Shape:
    //   routing_locks: {
    //     pickup:   { locked: bool, reason: 'arrived'|'departed'|null, event_id: uuid|null },
    //     delivery: { locked: bool, reason: 'arrived'|'departed'|null, event_id: uuid|null },
    //     return:   { locked: bool, reason: 'arrived'|'departed'|null, event_id: uuid|null }
    //   }
    //
    // null reason = no matching event exists yet (e.g. fresh load, or a
    // load_type that doesn't need a return). locked=false when the event
    // exists but no timestamp is set.
    // ================================================================
    const { data: firstEvents } = await svc
      .from('order_routing_events')
      .select('id, event_type, sequence, arrived_at, departed_at')
      .eq('tenant_id', ctx.tenantId)
      .eq('order_id', id)
      .in('event_type', ['pull', 'deliver', 'return'])
      .order('sequence', { ascending: true });

    const LOCK_MAP = { pull: 'pickup', deliver: 'delivery', return: 'return' };
    const routing_locks = {
      pickup: { locked: false, reason: null, event_id: null },
      delivery: { locked: false, reason: null, event_id: null },
      return: { locked: false, reason: null, event_id: null },
    };
    const seenTypes = new Set();
    for (const ev of firstEvents || []) {
      const key = LOCK_MAP[ev.event_type];
      if (!key || seenTypes.has(ev.event_type)) continue;
      seenTypes.add(ev.event_type);
      const reason = ev.departed_at
        ? 'departed'
        : ev.arrived_at
        ? 'arrived'
        : null;
      routing_locks[key] = {
        locked: !!reason,
        reason,
        event_id: ev.id,
      };
    }

    // ── Margin attach (gated by ACCOUNTS_RECEIVABLE / REPORTING / ALL) ──
    if (hasPermission(ctx, [PERMISSIONS.ACCOUNTS_RECEIVABLE, PERMISSIONS.REPORTING])) {
      try {
        const { data: tenant, error: tErr } = await svc
          .from('tenants')
          .select('margin_red_threshold, margin_yellow_threshold, margin_include_dry_runs')
          .eq('id', ctx.tenantId)
          .single();
        if (!tErr && tenant) {
          const inputs = await fetchLoadMarginInputs(svc, {
            tenantId: ctx.tenantId,
            orderIds: [data.id],
            includeDryRuns: tenant.margin_include_dry_runs,
          });
          const { revenueCents, costCents } = inputs.get(data.id) ?? { revenueCents: 0, costCents: 0 };
          data.margin = computeLoadMargin({
            revenueCents,
            costCents,
            redThreshold:    Number(tenant.margin_red_threshold),
            yellowThreshold: Number(tenant.margin_yellow_threshold),
          });
        }
      } catch (marginErr) {
        console.error('[load-margin] attach failed for load', id, marginErr.message);
        // Non-fatal — load.margin stays undefined; surface renders nothing
      }
    }

    return res.status(200).json({ load: data, holds: holds || [], routing_locks });
  }

  if (req.method === 'PUT') {
    if (!requirePermission(ctx, [PERMISSIONS.ORDER_ENTRY, PERMISSIONS.ALL], res)) return;

    const updates = {};
    for (const field of EDITABLE_FIELDS) {
      if (req.body[field] !== undefined) {
        updates[field] = req.body[field];
      }
    }

    // If pickup/delivery location changed, refresh denormalized snapshot fields
    if (updates.pickup_location_id !== undefined) {
      if (updates.pickup_location_id) {
        const { data: loc } = await svc
          .from('customers')
          .select('address_line1, city, state, zip')
          .eq('tenant_id', ctx.tenantId)
          .eq('id', updates.pickup_location_id)
          .maybeSingle();
        if (loc) {
          updates.origin_address = loc.address_line1;
          updates.origin_city = loc.city;
          updates.origin_state = loc.state;
          updates.origin_zip = loc.zip;
        }
      }
    }
    if (updates.delivery_location_id !== undefined) {
      if (updates.delivery_location_id) {
        const { data: loc } = await svc
          .from('customers')
          .select('address_line1, city, state, zip')
          .eq('tenant_id', ctx.tenantId)
          .eq('id', updates.delivery_location_id)
          .maybeSingle();
        if (loc) {
          updates.destination_address = loc.address_line1;
          updates.destination_city = loc.city;
          updates.destination_state = loc.state;
          updates.destination_zip = loc.zip;
        }
      }
    }

    const { data: oldLoad } = await svc
      .from('orders')
      .select('*')
      .eq('tenant_id', ctx.tenantId)
      .eq('id', id)
      .is('deleted_at', null)
      .single();

    if (!oldLoad) return res.status(404).json({ error: 'Load not found' });

    // ================================================================
    // Load-payload validation (chassis_reposition requires hook/terminate
    // chassis locations, etc.). load_type is NOT in EDITABLE_FIELDS so it
    // cannot change on PUT — but hook_chassis_location_id and
    // terminate_chassis_location_id ARE editable. Validate only when one
    // of the validator's relevant fields is being touched; otherwise we
    // pay for zero behavior and allow partial updates to unrelated fields.
    //
    // Effective payload = existing row merged with incoming updates.
    // ================================================================
    const VALIDATION_RELEVANT_FIELDS = [
      'load_type',
      'hook_chassis_location_id',
      'terminate_chassis_location_id',
    ];
    const touchesValidation = VALIDATION_RELEVANT_FIELDS.some((f) => f in updates);
    if (touchesValidation) {
      const effective = { ...oldLoad, ...updates };
      const validation = validateLoadPayload(effective);
      if (!validation.ok) {
        return res
          .status(400)
          .json({ error: validation.error, step: 'validate_load_payload' });
      }
    }

    // ================================================================
    // Rail/Port Check-In Slip auto-unverify cascade
    // ================================================================
    //
    // The slip is the 6 fields the dispatcher gives the driver to read
    // off at rail/port check-in. Once verified (rail_slip_verified_at
    // is set), any change to ANY of those fields invalidates the
    // verification — the dispatcher needs to re-verify against the
    // updated values to make sure the new value still matches the BOL.
    //
    // Only fires when:
    //   - The load is currently verified (rail_slip_verified_at != null)
    //   - At least one of the 6 slip fields is in the incoming patch
    //   - The new value actually differs from the old value
    // ================================================================
    const SLIP_FIELDS = [
      'container_number',
      'seal_number',
      'piece_count',
      'weight_lbs',
      'customer_reference',
      'final_delivery_location_id',
    ];
    if (oldLoad.rail_slip_verified_at) {
      const slipFieldChanged = SLIP_FIELDS.some(
        (f) => f in updates && updates[f] !== oldLoad[f]
      );
      if (slipFieldChanged) {
        updates.rail_slip_verified_at = null;
        updates.rail_slip_verified_by = null;
      }
    }

    const { data, error } = await svc
      .from('orders')
      .update(updates)
      .eq('tenant_id', ctx.tenantId)
      .eq('id', id)
      .is('deleted_at', null)
      .select()
      .single();

    if (error) return res.status(500).json({ error: error.message });

    // ================================================================
    // Routing event location cascade
    // ================================================================
    //
    // When an order-level pickup/delivery/return location_id changes,
    // the matching routing event's location_id must follow — otherwise
    // the sidebar + "Current State" banner show the new location while
    // the routing tab still shows the old one (real desync bug seen
    // on ORD-M000010 2026-04-15).
    //
    // Architectural invariant (per user, 2026-04-15): a load has exactly
    // ONE pull, ONE deliver, and ONE return event. Dual-transaction moves
    // (empty return + live pick on one trip) are modeled as two separate
    // loads each with their own pull event. So the cascade targets exactly
    // one event per type.
    //
    // LOCKED events (arrived_at OR departed_at set) are skipped — editing
    // a timestamped event would rewrite history. The user must clear the
    // timestamps via the routing tab first. We return a warning so the UI
    // can surface this ("Routing didn't follow because the event already
    // has timestamps").
    //
    // Fires SYNCHRONOUSLY before the pricing engines kick off so they see
    // the freshly-cascaded events (driver tariff engine reads
    // routing_events to evaluate 'dropped' conditions, etc.).
    // ================================================================
    const LOCATION_CASCADE = [
      { orderField: 'pickup_location_id', eventType: 'pull' },
      { orderField: 'delivery_location_id', eventType: 'deliver' },
      { orderField: 'return_location_id', eventType: 'return' },
    ];
    const routingCascadeWarnings = [];
    const routingCascadeApplied = [];
    for (const { orderField, eventType } of LOCATION_CASCADE) {
      if (!(orderField in updates)) continue;
      if (updates[orderField] === oldLoad[orderField]) continue;

      const { data: event } = await svc
        .from('order_routing_events')
        .select('id, location_id, arrived_at, departed_at')
        .eq('tenant_id', ctx.tenantId)
        .eq('order_id', id)
        .eq('event_type', eventType)
        .order('sequence', { ascending: true })
        .limit(1)
        .maybeSingle();

      if (!event) continue; // no matching event yet — fine, nothing to cascade

      if (event.arrived_at || event.departed_at) {
        routingCascadeWarnings.push({
          event_type: eventType,
          reason: 'locked',
          message: `Routing ${eventType} event is locked (has timestamps). Clear them first to sync the location.`,
        });
        continue;
      }

      // Build the denorm patch — mirrors the routing event endpoint's
      // customer-lookup pattern (location_name / address / city / state /
      // zip all refreshed from the customer row in one shot).
      let locPatch;
      if (updates[orderField]) {
        const { data: loc } = await svc
          .from('customers')
          .select('name, address_line1, city, state, zip')
          .eq('tenant_id', ctx.tenantId)
          .eq('id', updates[orderField])
          .maybeSingle();
        locPatch = {
          location_id: updates[orderField],
          location_name: loc?.name || null,
          address: loc?.address_line1 || null,
          city: loc?.city || null,
          state: loc?.state || null,
          zip: loc?.zip || null,
        };
      } else {
        // Order-level field was cleared — clear the event too
        locPatch = {
          location_id: null,
          location_name: null,
          address: null,
          city: null,
          state: null,
          zip: null,
        };
      }

      const { error: cascadeErr } = await svc
        .from('order_routing_events')
        .update(locPatch)
        .eq('tenant_id', ctx.tenantId)
        .eq('order_id', id)
        .eq('id', event.id);

      if (cascadeErr) {
        routingCascadeWarnings.push({
          event_type: eventType,
          reason: 'error',
          message: `Failed to sync routing ${eventType} event: ${cascadeErr.message}`,
        });
      } else {
        routingCascadeApplied.push({
          event_id: event.id,
          event_type: eventType,
          from_location_id: event.location_id,
          to_location_id: locPatch.location_id,
          to_location_name: locPatch.location_name,
        });
      }
    }

    await logTenantAction(svc, {
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      action: 'load.update',
      entityType: 'order',
      entityId: id,
      oldValues: oldLoad,
      newValues: data,
      ipAddress: getClientIp(req),
    });

    // Log the routing cascade as its own audit entry so the event-level
    // change is searchable in the audit trail (not buried inside the
    // load.update newValues).
    if (routingCascadeApplied.length > 0) {
      await logTenantAction(svc, {
        tenantId: ctx.tenantId,
        userId: ctx.userId,
        action: 'load.routing_cascaded_from_order',
        entityType: 'order',
        entityId: id,
        newValues: { events: routingCascadeApplied, warnings: routingCascadeWarnings },
        ipAddress: getClientIp(req),
      });
    }

    // If the cascade just unverified the slip, log a separate audit
    // entry so the timeline shows WHY verification was lost.
    if (
      oldLoad.rail_slip_verified_at &&
      'rail_slip_verified_at' in updates &&
      updates.rail_slip_verified_at === null
    ) {
      await logTenantAction(svc, {
        tenantId: ctx.tenantId,
        userId: ctx.userId,
        action: 'load.rail_slip_auto_unverified',
        entityType: 'order',
        entityId: id,
        oldValues: { rail_slip_verified_at: oldLoad.rail_slip_verified_at },
        newValues: {
          changed_fields: SLIP_FIELDS.filter(
            (f) => f in updates && updates[f] !== oldLoad[f]
          ),
        },
        ipAddress: getClientIp(req),
      });
    }

    // Fire any field-change email triggers — fire-and-forget so the PUT
    // never fails if the trigger engine hiccups. Bulk updates do NOT run
    // this path (see pages/api/tenant/loads/bulk-update.js header comment).
    fireFieldChangeTriggers(svc, {
      tenantId: ctx.tenantId,
      loadId: id,
      oldLoad,
      newLoad: data,
      userId: ctx.userId,
    }).catch((e) => console.error('fireFieldChangeTriggers error:', e));

    // Fire status-change triggers when the load's status transitions.
    // Also writes to order_status_history for the polled worker to
    // evaluate delayed triggers later.
    if (oldLoad.status !== data.status) {
      fireOrderStatusChangeTriggers(svc, {
        tenantId: ctx.tenantId,
        loadId: id,
        oldStatus: oldLoad.status,
        newStatus: data.status,
        userId: ctx.userId,
      }).catch((e) => console.error('fireOrderStatusChangeTriggers error:', e));
    }

    // Auto-recalc on matching-field change. Best-effort: failures are
    // logged but never fail the load PUT. Full logic (DRAFT-only guard,
    // no-charge-set skip, recalc pipeline) lives in the helper.
    import('../../../../../lib/auto-recalc-trigger')
      .then(({ maybeRecalcOnLoadChange }) =>
        maybeRecalcOnLoadChange(svc, ctx.tenantId, oldLoad, data)
      )
      .then((result) => {
        if (result?.ran) {
          console.log(`[auto-recalc] load ${id}: applied ${result.applied} charges`);
        }
      })
      .catch((e) => console.error(`[auto-recalc] load ${id} failed:`, e.message));

    // Auto-generate driver pay when driver is assigned
    if ('driver_id' in updates && updates.driver_id && updates.driver_id !== oldLoad.driver_id) {
      import('../../../../../lib/driver-tariff-engine')
        .then(({ findMatchingDriverCharges, applyDriverPayToLoad }) =>
          findMatchingDriverCharges(svc, data, updates.driver_id, ctx.tenantId)
            .then((charges) => {
              if (charges.length > 0) {
                return applyDriverPayToLoad(svc, id, updates.driver_id, ctx.tenantId, charges);
              }
            })
        )
        .catch((e) => console.error('driver tariff auto-apply error:', e));
    }

    return res.status(200).json({
      load: data,
      // Surface any routing cascade outcomes so the UI can toast the
      // user when an order-level location edit didn't propagate to the
      // routing event (e.g. because the event was locked).
      routing_cascade:
        routingCascadeApplied.length > 0 || routingCascadeWarnings.length > 0
          ? { applied: routingCascadeApplied, warnings: routingCascadeWarnings }
          : undefined,
    });
  }

  if (req.method === 'DELETE') {
    if (!requirePermission(ctx, [PERMISSIONS.ALL], res)) return;

    const { error } = await svc
      .from('orders')
      .update({ deleted_at: new Date().toISOString(), status: 'cancelled' })
      .eq('tenant_id', ctx.tenantId)
      .eq('id', id)
      .is('deleted_at', null);

    if (error) return res.status(500).json({ error: error.message });

    await logTenantAction(svc, {
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      action: 'load.delete',
      entityType: 'order',
      entityId: id,
      ipAddress: getClientIp(req),
    });

    return res.status(200).json({ success: true });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
