// React-PDF + InvoiceTemplate (a JSX-bearing React component) are
// dynamically imported inside renderInvoicePdf so that this module's
// pure-JS fetcher (fetchInvoiceData) can be unit-tested under bare
// `node --test` without a JSX transformer. See
// tests/invoice-fetcher-integration.test.mjs.
import { resolveTemplateConfig } from './resolve-template-config.js';
import { formatDate } from './format-date.js';

/**
 * Fetch invoice data and shape it for the Document Designer composer.
 * Mirrors fetchDeliveryOrderData's pattern. Returns null if the invoice
 * doesn't exist for this tenant.
 */
export async function fetchInvoiceData(svc, invoiceId, tenantId) {
  // 1. Invoice + bill-to customer (1 query)
  const { data: invoice, error: invErr } = await svc
    .from('invoices')
    .select(`
      id, invoice_number, invoice_date, sent_at, created_at, due_date,
      payment_terms_days, is_consolidated,
      subtotal_cents, total_amount_cents, notes,
      customer_id,
      customer:customers!customer_id(
        id, name, address_line1, address_line2, city, state, zip,
        billing_email, phone
      )
    `)
    .eq('id', invoiceId)
    .eq('tenant_id', tenantId)
    .is('deleted_at', null)
    .maybeSingle();

  if (invErr) throw new Error(`Invoice fetch failed: ${invErr.message}`);
  if (!invoice) return null;

  // 2. Linked charge sets → orders (1 query, joined)
  const { data: linkRows, error: linkErr } = await svc
    .from('invoice_charge_sets')
    .select(`
      charge_set:order_charge_sets(
        id, charge_set_number, order_id,
        order:orders(
          id, order_number, customer_reference,
          container_number, chassis_number,
          container_size, container_type, chassis_size, chassis_type,
          chassis_owner, steamship_line, seal_number,
          mbol, hbol, booking_number, pickup_number,
          is_hazmat, last_free_day, per_diem_free_day,
          pull_container_date, return_container_date,
          notes, internal_notes
        )
      )
    `)
    .eq('invoice_id', invoiceId)
    .eq('tenant_id', tenantId);

  if (linkErr) throw new Error(`invoice_charge_sets lookup failed: ${linkErr.message}`);

  const consolidatedCount = (linkRows || []).length;
  const firstOrder = linkRows?.[0]?.charge_set?.order || null;

  // 3. First order's moves + events (skip if no order)
  let moves = [];
  let loadLevelLocations = { pickup_location: null, delivery_location: null, return_location: null };
  if (firstOrder?.id) {
    const { data: rawMoves, error: movesErr } = await svc
      .from('order_container_moves')
      .select(`
        id, sequence, move_type, status,
        driver:drivers(id, first_name, last_name, phone)
      `)
      .eq('order_id', firstOrder.id)
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

    // Derive load-level locations from the first order's events (matches DO behavior)
    const { deriveLoadLevelLocations } = await import('./render-delivery-order.js');
    loadLevelLocations = deriveLoadLevelLocations(moves);
  }

  // 4. Invoice line items (1 query)
  const { data: lineItems, error: liErr } = await svc
    .from('invoice_line_items')
    .select('id, description, quantity, unit_amount_cents, total_amount_cents, sort_order')
    .eq('invoice_id', invoiceId)
    .eq('tenant_id', tenantId)
    .order('sort_order', { ascending: true });
  if (liErr) throw new Error(`invoice_line_items fetch failed: ${liErr.message}`);

  const chargeLines = (lineItems || []).map((li) => ({
    description:        li.description,
    quantity:           li.quantity,
    unit_amount_cents:  li.unit_amount_cents,
    total_amount_cents: li.total_amount_cents,
  }));

  // 5. Tenant + tenant_settings for Header
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
    invoice_id: invoice.id,
    tenant_name: tenant?.name || '',
    tenant_info,
    bill_to: invoice.customer
      ? {
          name:          invoice.customer.name,
          address_line1: invoice.customer.address_line1,
          city:          invoice.customer.city,
          state:         invoice.customer.state,
          zip:           invoice.customer.zip,
        }
      : null,
    customer_contact: invoice.customer
      ? { phone: invoice.customer.phone, email: invoice.customer.billing_email }
      : null,
    bill_to_customer_id: invoice.customer_id || null,
    invoice_meta: {
      invoice_number:     invoice.invoice_number,
      invoice_date:       formatDate(invoice.invoice_date || invoice.sent_at || invoice.created_at),
      due_date:           formatDate(invoice.due_date),
      terms_days:         invoice.payment_terms_days,
      is_consolidated:    !!invoice.is_consolidated,
      consolidated_count: consolidatedCount,
      notes:              invoice.notes,
    },
    first_order: firstOrder,
    load_level_locations: loadLevelLocations,
    moves,
    charge_lines: chargeLines,
    totals: {
      subtotal_cents: invoice.subtotal_cents,
      total_cents:    invoice.total_amount_cents,
    },
  };
}

/**
 * Fetch invoice data + render as PDF Buffer. Public signature unchanged
 * (callers in send-email + bulk-send pass these 3 args verbatim).
 *
 * @param {SupabaseClient} svc - service-role client
 * @param {string} invoiceId
 * @param {string} tenantId
 * @returns {Promise<Buffer>}
 * @throws {Error} 'Invoice not found' if missing or wrong tenant
 */
export async function renderInvoicePdf(svc, invoiceId, tenantId) {
  // Peek at is_consolidated to decide which composer to use.
  // Single-column SELECT — microseconds. Trade-off: 1 extra round-trip on
  // every Invoice render in exchange for keeping renderInvoicePdf's public
  // signature unchanged (callers in send-email + bulk-send + pdf/invoice/[id]
  // + archive.js stay untouched).
  const { data: peek } = await svc
    .from('invoices')
    .select('is_consolidated')
    .eq('id', invoiceId)
    .eq('tenant_id', tenantId)
    .is('deleted_at', null)
    .maybeSingle();

  if (peek?.is_consolidated) {
    const { renderCombinedInvoicePdf } = await import('./render-combined-invoice');
    return renderCombinedInvoicePdf(svc, invoiceId, tenantId);
  }

  // Single-load path (existing logic)
  const doc = await fetchInvoiceData(svc, invoiceId, tenantId);
  if (!doc) throw new Error('Invoice not found');

  const sectionConfig = await resolveTemplateConfig(
    svc, tenantId, doc.bill_to_customer_id, 'invoice'
  );

  const [{ renderToBuffer }, React, { default: InvoiceTemplate }] = await Promise.all([
    import('@react-pdf/renderer'),
    import('react'),
    import('../../components/pdf/InvoiceTemplate'),
  ]);

  return await renderToBuffer(
    React.createElement(InvoiceTemplate, { doc, sectionConfig })
  );
}
