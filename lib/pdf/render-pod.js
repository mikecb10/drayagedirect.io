import { renderToBuffer } from '@react-pdf/renderer';
import React from 'react';
import PodTemplate from '../../components/pdf/PodTemplate';
import { resolveTemplateConfig } from './resolve-template-config';
import { formatDate, formatTime } from './format-date';

/**
 * Resolve the POD's "Driver" field via this fallback chain:
 *   1. Driver of the LAST move whose events[] contains a `deliver` event
 *   2. Driver of the last move overall
 *   3. Driver of the first move
 *   4. null
 *
 * Each "driver" is `${first_name} ${last_name}` from the move's joined
 * drivers row, or null if no driver assigned.
 */
function resolveDriverName(moves) {
  if (!Array.isArray(moves) || moves.length === 0) return null;

  // Pass 1: last move with a deliver event
  for (let i = moves.length - 1; i >= 0; i--) {
    const m = moves[i];
    const hasDeliver = (m.events || []).some((e) => e.event_type === 'deliver');
    if (hasDeliver && m.driver) {
      return [m.driver.first_name, m.driver.last_name].filter(Boolean).join(' ') || null;
    }
  }

  // Pass 2: last move with any driver
  for (let i = moves.length - 1; i >= 0; i--) {
    if (moves[i].driver) {
      return [moves[i].driver.first_name, moves[i].driver.last_name].filter(Boolean).join(' ') || null;
    }
  }

  // Pass 3: first move with any driver (already covered by pass 2 reverse loop, but keep for clarity)
  // Pass 4: null
  return null;
}

/**
 * Find the last `deliver` event across all moves, sorted by sequence.
 * Returns the event row, or null.
 */
function findLastDeliverEvent(moves) {
  const allDelivers = (moves || [])
    .flatMap((m) => (m.events || []).filter((e) => e.event_type === 'deliver'));
  if (allDelivers.length === 0) return null;
  // Sort by sequence ascending; take last
  allDelivers.sort((a, b) => (a.sequence || 0) - (b.sequence || 0));
  return allDelivers[allDelivers.length - 1];
}

/**
 * Fetch POD data for an order and shape it for the composer.
 * Returns null if the order doesn't exist for this tenant.
 */
export async function fetchPodData(svc, orderId, tenantId) {
  // 1. Order + bill-to customer (1 query, joined)
  const { data: order, error: orderErr } = await svc
    .from('orders')
    .select(`
      id, order_number, customer_reference,
      container_number, chassis_number,
      container_size, container_type, chassis_size, chassis_type,
      chassis_owner, steamship_line, seal_number,
      mbol, hbol, booking_number, pickup_number,
      is_hazmat, last_free_day, per_diem_free_day,
      pull_container_date, return_container_date,
      notes, internal_notes,
      customer_id,
      customer:customers!orders_customer_id_fkey(
        id, name, address_line1, address_line2, city, state, zip,
        billing_email, phone
      )
    `)
    .eq('id', orderId)
    .eq('tenant_id', tenantId)
    .maybeSingle();

  if (orderErr) throw new Error(`Order fetch failed: ${orderErr.message}`);
  if (!order) return null;

  // 2. Order's moves + events (2 queries — same shape as DO/Invoice/Rate Con)
  const { data: rawMoves, error: movesErr } = await svc
    .from('order_container_moves')
    .select(`
      id, sequence, move_type, status,
      driver:drivers(id, first_name, last_name, phone)
    `)
    .eq('order_id', order.id)
    .eq('tenant_id', tenantId)
    .order('sequence', { ascending: true });
  if (movesErr) throw new Error(`Moves fetch failed: ${movesErr.message}`);

  const moveIds = (rawMoves || []).map((m) => m.id);
  let events = [];
  if (moveIds.length > 0) {
    const { data: evs, error: evsErr } = await svc
      .from('order_routing_events')
      .select(`
        id, move_id, sequence, event_type,
        scheduled_at, arrived_at, departed_at,
        location_id, location_name, city, state,
        location:customers!order_routing_events_location_id_fkey(id, name, city, state)
      `)
      .in('move_id', moveIds)
      .eq('tenant_id', tenantId)
      .order('sequence', { ascending: true });
    if (evsErr) throw new Error(`Events fetch failed: ${evsErr.message}`);
    events = evs || [];
  }

  const moves = (rawMoves || []).map((m) => ({
    id: m.id,
    move_index: m.sequence,
    move_type: m.move_type,
    status: m.status,
    driver: m.driver,
    events: events
      .filter((e) => e.move_id === m.id)
      .map((e) => ({
        sequence: e.sequence,
        event_type: e.event_type,
        scheduled_at: e.scheduled_at,
        arrived_at: e.arrived_at,
        departed_at: e.departed_at,
        location: e.location
          ? { name: e.location.name, city: e.location.city, state: e.location.state }
          : { name: e.location_name, city: e.city, state: e.state },
      })),
  }));

  // Derive load-level locations (same as DO/Invoice/Rate Con)
  const { deriveLoadLevelLocations } = await import('./render-delivery-order');
  const loadLevelLocations = deriveLoadLevelLocations(moves);

  // 3. POD documents from order_documents (1 query)
  const { data: docRows, error: docErr } = await svc
    .from('order_documents')
    .select('id, file_name, document_type, uploaded_at')
    .eq('order_id', order.id)
    .eq('tenant_id', tenantId)
    .eq('document_type', 'POD')
    .order('uploaded_at', { ascending: true });
  if (docErr) throw new Error(`order_documents fetch failed: ${docErr.message}`);

  const attachedDocuments = (docRows || []).map((d) => ({
    id: d.id,
    file_name: d.file_name,
    document_type: d.document_type,
    uploaded_at: formatDate(d.uploaded_at),
  }));

  // 4. Tenant + tenant_settings for Header (1 query each)
  const { data: tenant } = await svc
    .from('tenants')
    .select('name')
    .eq('id', tenantId)
    .maybeSingle();
  const { data: settings } = await svc
    .from('tenant_settings')
    .select('company_display_name, logo_small_url, logo_large_url, address_line1, address_line2, city, state, zip, phone, website')
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

  // Compute pod_meta: driver_name from heuristic, delivery_date/time from last deliver event
  const driverName = resolveDriverName(moves);
  const lastDeliver = findLastDeliverEvent(moves);
  const deliveryTs = lastDeliver?.departed_at || lastDeliver?.arrived_at || null;

  return {
    order_id: order.id,
    tenant_name: tenant?.name || '',
    tenant_info,
    bill_to: order.customer
      ? {
          name:          order.customer.name,
          address_line1: order.customer.address_line1,
          city:          order.customer.city,
          state:         order.customer.state,
          zip:           order.customer.zip,
        }
      : null,
    customer_contact: order.customer
      ? { phone: order.customer.phone, email: order.customer.billing_email }
      : null,
    bill_to_customer_id: order.customer_id || null,
    pod_meta: {
      order_number:       order.order_number,
      customer_reference: order.customer_reference,
      driver_name:        driverName,
      delivery_date:      formatDate(deliveryTs),
      delivery_time:      formatTime(deliveryTs),
    },
    first_order: order,
    load_level_locations: loadLevelLocations,
    moves,
    attached_documents: attachedDocuments,
  };
}

/**
 * Fetch POD data + render as PDF Buffer.
 *
 * @param {SupabaseClient} svc - service-role client
 * @param {string} orderId
 * @param {string} tenantId
 * @returns {Promise<Buffer>}
 * @throws {Error} 'Order not found' if missing or wrong tenant
 */
export async function renderPodPdf(svc, orderId, tenantId) {
  const doc = await fetchPodData(svc, orderId, tenantId);
  if (!doc) throw new Error('Order not found');

  const sectionConfig = await resolveTemplateConfig(
    svc, tenantId, doc.bill_to_customer_id, 'pod'
  );

  return await renderToBuffer(
    React.createElement(PodTemplate, { doc, sectionConfig })
  );
}
