import { renderToBuffer } from '@react-pdf/renderer';
import React from 'react';
import RateConTemplate from '../../components/pdf/RateConTemplate';
import { resolveTemplateConfig } from './resolve-template-config';

/**
 * Fetch rate-con data (charge set + order + line items + tenant info)
 * and shape it for the Document Designer composer. Returns null if the
 * charge set doesn't exist for this tenant.
 *
 * NOTE: pickup/delivery locations are stored on the orders table as foreign
 * keys to the customers table (not a separate locations table). The FK names
 * are orders_pickup_location_id_fkey and orders_delivery_location_id_fkey,
 * confirmed from the existing load-detail endpoint.
 */
export async function fetchRateConData(svc, chargeSetId, tenantId) {
  // 1. Charge set + order + pickup_org + delivery_org + line items (1 query, joined)
  const { data: cs, error: csErr } = await svc
    .from('order_charge_sets')
    .select(`
      id, charge_set_number, created_at, total_cents,
      order:orders(
        id, order_number, customer_reference, customer_id,
        container_number, chassis_number,
        container_size, container_type, chassis_size, chassis_type,
        chassis_owner, steamship_line, seal_number,
        mbol, hbol, booking_number, pickup_number,
        is_hazmat, last_free_day, per_diem_free_day,
        pull_container_date, return_container_date,
        notes, internal_notes,
        pickup_apt_from, delivery_apt_from,
        pickup_org:customers!orders_pickup_location_id_fkey(id, name, address_line1, city, state, zip),
        delivery_org:customers!orders_delivery_location_id_fkey(id, name, address_line1, city, state, zip)
      ),
      line_items:order_charge_set_line_items(
        id, name, description, unit_count, per_unit_price_cents, total_cents
      )
    `)
    .eq('id', chargeSetId)
    .eq('tenant_id', tenantId)
    .maybeSingle();

  if (csErr) throw new Error(`Charge set fetch failed: ${csErr.message}`);
  if (!cs) return null;

  const order = cs.order || null;

  // 2. Order's moves + events (skip if no order)
  let moves = [];
  let loadLevelLocations = { pickup_location: null, delivery_location: null, return_location: null };
  if (order?.id) {
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

    moves = (rawMoves || []).map((m) => ({
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

    // Derive load-level locations from the order's events (matches DO + Invoice behavior)
    const { deriveLoadLevelLocations } = await import('./render-delivery-order');
    loadLevelLocations = deriveLoadLevelLocations(moves);
  }

  // 3. Map charge lines from order_charge_set_line_items DIRECT (not invoice_line_items).
  // Preserve the legacy fallback: description || name (when only `name` is set).
  const chargeLines = (cs.line_items || []).map((li) => ({
    description:        li.description || li.name,
    quantity:           li.unit_count   || 1,
    unit_amount_cents:  li.per_unit_price_cents,
    total_amount_cents: li.total_cents,
  }));

  // 4. Tenant + tenant_settings for Header
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

  return {
    charge_set_id: cs.id,
    tenant_name: tenant?.name || '',
    tenant_info,
    bill_to_customer_id: order?.customer_id || null,
    rate_con_meta: {
      confirmation_number:  cs.charge_set_number,
      issue_date:           cs.created_at,
      reference_number:     order?.customer_reference || order?.order_number || null,
      pickup_appointment:   order?.pickup_apt_from || null,
      delivery_appointment: order?.delivery_apt_from || null,
    },
    first_order: order,
    load_level_locations: loadLevelLocations,
    moves,
    charge_lines: chargeLines,
    totals: {
      total_cents: cs.total_cents,
      // No subtotal_cents — charge_set.total_cents is the only authoritative total
    },
  };
}

/**
 * Fetch rate-con data + render as PDF Buffer. Public signature unchanged
 * (callers in send-rate-con-email + bulk-send-rate-con + pdf/rate-con/[id]
 * + archive.js pass these 3 args verbatim).
 *
 * @param {SupabaseClient} svc - service-role client
 * @param {string} chargeSetId
 * @param {string} tenantId
 * @returns {Promise<Buffer>}
 * @throws {Error} 'Charge set not found' if missing or wrong tenant
 */
export async function renderRateConPdf(svc, chargeSetId, tenantId) {
  const doc = await fetchRateConData(svc, chargeSetId, tenantId);
  if (!doc) throw new Error('Charge set not found');

  const sectionConfig = await resolveTemplateConfig(
    svc, tenantId, doc.bill_to_customer_id, 'rate_con'
  );

  return await renderToBuffer(
    React.createElement(RateConTemplate, { doc, sectionConfig })
  );
}
