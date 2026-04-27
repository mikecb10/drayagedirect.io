import { selectMoves } from './select-moves.js';

/**
 * Derive load-level pickup / delivery / return location objects from the
 * full event sequence across all moves. Used by the PDF composer to render
 * a 3-or-4-col address summary at the top of the document, mirroring
 * PortPro's DO layout.
 *
 * Rules:
 *   - load pickup    = first event with event_type === 'pull'
 *   - load delivery  = last event with event_type === 'deliver'
 *   - load return    = last event with event_type === 'return'
 *   - any of the three may be null if no matching event exists yet
 *     (typical for a new load with no events scheduled, or one-way
 *     drayage with no return leg)
 */
export function deriveLoadLevelLocations(moves) {
  const allEvents = (moves || [])
    .flatMap((m) => m.events || [])
    .sort((a, b) => a.sequence - b.sequence);

  const orgFromEvent = (e) => {
    if (!e || !e.location) return null;
    return {
      name: e.location.name || null,
      address_line1: null, // event row doesn't carry street address; future enrichment
      city: e.location.city || null,
      state: e.location.state || null,
      zip: null,
    };
  };

  const firstPull = allEvents.find((e) => e.event_type === 'pull');
  const lastDeliver = [...allEvents].reverse().find((e) => e.event_type === 'deliver');
  const lastReturn = [...allEvents].reverse().find((e) => e.event_type === 'return');

  return {
    pickup_location: orgFromEvent(firstPull),
    delivery_location: orgFromEvent(lastDeliver),
    return_location: orgFromEvent(lastReturn),
  };
}

/**
 * Fetch the full data shape for a single Delivery Order. Returns null
 * if NEXT_MOVE variant has no eligible move (signals the bulk renderer
 * to skip this load).
 *
 * Schema mapping (orders columns):
 *   - notes              -> instructions.driver_notes
 *   - internal_notes     -> instructions.special_instructions
 *   - is_hazmat (bool)   -> hazmat_details.flag (no detail columns exist yet)
 *   - appointment_number -> appointment_details.pickup_appt_number
 *
 * Move ordering: order_container_moves uses `sequence` as the order
 * column (no `move_index`); we alias it to `move_index` in the data
 * shape so selectMoves and the section components can stay consistent
 * with the design vocabulary.
 *
 * @returns {Promise<object|null>}
 */
export async function fetchDeliveryOrderData(svc, orderId, tenantId, variant) {
  // 1. Order + bill-to customer (single round-trip)
  const { data: order, error: orderErr } = await svc
    .from('orders')
    .select(`
      id, order_number, customer_reference,
      container_number, chassis_number,
      container_size, container_type, chassis_size, chassis_type,
      seal_number, weight_lbs,
      is_hazmat, appointment_number,
      notes, internal_notes,
      customer_id,
      customer:customers!orders_customer_id_fkey(
        id, name, address_line1, city, state, zip, phone, billing_email
      )
    `)
    .eq('id', orderId)
    .eq('tenant_id', tenantId)
    .maybeSingle();

  if (orderErr) throw new Error(`Order fetch failed: ${orderErr.message}`);
  if (!order) throw new Error(`Order not found: ${orderId}`);

  // 2. Moves with driver, ordered by sequence
  const { data: rawMoves, error: movesErr } = await svc
    .from('order_container_moves')
    .select(`
      id, sequence, move_type, status,
      driver:drivers(id, first_name, last_name, phone)
    `)
    .eq('order_id', orderId)
    .eq('tenant_id', tenantId)
    .order('sequence', { ascending: true });

  if (movesErr) throw new Error(`Moves fetch failed: ${movesErr.message}`);

  // Normalize: alias sequence -> move_index for downstream consumers
  const moves = (rawMoves || []).map((m) => ({
    id: m.id,
    move_index: m.sequence,
    move_type: m.move_type,
    status: m.status,
    driver: m.driver,
    events: [],
  }));
  const totalMoves = moves.length;

  // 3. Apply variant filter
  const selectedMoves = selectMoves(moves, variant);
  if (selectedMoves === null) return null; // NEXT_MOVE: nothing to render

  // 4. Fetch events only for the selected moves
  const selectedMoveIds = selectedMoves.map((m) => m.id);
  if (selectedMoveIds.length > 0) {
    const { data: events, error: eventsErr } = await svc
      .from('order_routing_events')
      .select(`
        id, move_id, sequence, event_type,
        scheduled_at, arrived_at, departed_at,
        location_id, location_name, city, state,
        location:customers!order_routing_events_location_id_fkey(
          id, name, city, state
        )
      `)
      .in('move_id', selectedMoveIds)
      .eq('tenant_id', tenantId)
      .order('sequence', { ascending: true });

    if (eventsErr) throw new Error(`Events fetch failed: ${eventsErr.message}`);

    const byMoveId = new Map(selectedMoves.map((m) => [m.id, m]));
    for (const ev of events || []) {
      const move = byMoveId.get(ev.move_id);
      if (!move) continue;
      // Prefer the joined location name+city+state, fall back to denormalized cols
      const loc = ev.location
        ? { name: ev.location.name, city: ev.location.city, state: ev.location.state }
        : { name: ev.location_name, city: ev.city, state: ev.state };
      move.events.push({
        sequence: ev.sequence,
        event_type: ev.event_type,
        scheduled_at: ev.scheduled_at,
        arrived_at: ev.arrived_at,
        departed_at: ev.departed_at,
        location: loc,
      });
    }
  }

  // 5. Tenant name for header
  const { data: tenant } = await svc
    .from('tenants')
    .select('name')
    .eq('id', tenantId)
    .maybeSingle();

  const { data: settings } = await svc
    .from('tenant_settings')
    .select(`
      company_display_name, logo_small_url, logo_large_url,
      address_line1, address_line2, city, state, zip, phone, website
    `)
    .eq('tenant_id', tenantId)
    .maybeSingle();

  const tenant_info = {
    logo_url: settings?.logo_large_url || settings?.logo_small_url || null,
    address: [
      settings?.address_line1,
      settings?.address_line2,
      [settings?.city, settings?.state, settings?.zip].filter(Boolean).join(', '),
    ].filter(Boolean).join(', ') || null,
    phone: settings?.phone || null,
    website: settings?.website || null,
  };

  // 6. Compose the data shape (per spec §8)
  return {
    order_id: order.id,
    tenant_name: tenant?.name || '',
    tenant_info,
    load_level_locations: deriveLoadLevelLocations(selectedMoves),
    bill_to_customer_id: order.customer_id, // FU-035 cascade resolver hook
    load_metadata: {
      load_number: order.order_number,
      customer_reference: order.customer_reference,
      container_number: order.container_number,
      chassis_number: order.chassis_number,
    },
    bill_to: order.customer
      ? {
          name: order.customer.name,
          address_line1: order.customer.address_line1,
          city: order.customer.city,
          state: order.customer.state,
          zip: order.customer.zip,
        }
      : null,
    customer_contact: order.customer
      ? { phone: order.customer.phone, email: order.customer.billing_email }
      : null,
    equipment_details: {
      container_size: order.container_size,
      container_type: order.container_type,
      chassis_size: order.chassis_size,
      chassis_type: order.chassis_type,
      seal_number: order.seal_number,
      weight_lbs: order.weight_lbs,
    },
    // is_hazmat is a boolean flag today; detail columns (UN, class, emergency
    // phone) don't exist yet. The HazmatDetails section short-circuits if
    // hazmat_class is missing, so this surface stays empty until the schema
    // grows. Setting hazmat_class to 'HAZMAT' here would force render even
    // without specifics, which we intentionally don't.
    hazmat_details: order.is_hazmat
      ? { un_code: null, hazmat_class: 'HAZMAT', emergency_phone: null }
      : null,
    instructions: {
      driver_notes: order.notes,
      special_instructions: order.internal_notes,
    },
    appointment_details: {
      pickup_appt_number: order.appointment_number,
      delivery_appt_number: null,
      gate_codes: null,
    },
    moves: selectedMoves,
    total_moves_in_load: totalMoves,
  };
}
