/**
 * Build per-section data subsets for the Invoice composer. Pure function;
 * exported for unit testing. Mirrors DeliveryOrderTemplate.js's pattern,
 * but lives in lib/pdf/ so tests/ can import it without a JSX-capable runner
 * (InvoiceTemplate.js itself contains JSX which bare Node can't parse).
 *
 * For Address Details specifically, this sets `data.customer = doc.bill_to`
 * because AddressDetails.js (shared between DO and Invoice) reads
 * `data.customer` internally. The Invoice-specific label "Bill To" is
 * applied at the renderSection switch site in InvoiceTemplate.js, not here.
 */
export function buildSectionData(doc) {
  const meta = doc.invoice_meta || {};
  const order = doc.first_order || null;
  const locations = doc.load_level_locations || {};

  return {
    header: {
      tenantName: doc.tenant_name,
      tenantInfo: doc.tenant_info || {},
    },
    invoice_details: {
      invoice_number:     meta.invoice_number ?? null,
      load_number:        order?.order_number ?? null,
      customer_reference: order?.customer_reference ?? null,
      invoice_date:       meta.invoice_date ?? null,
      terms_days:         meta.terms_days ?? null,
      due_date:           meta.due_date ?? null,
      consolidated_count: meta.consolidated_count ?? 1,
    },
    address_details: {
      customer: doc.bill_to ? {
        name:          doc.bill_to.name,
        address_line1: doc.bill_to.address_line1,
        city:          doc.bill_to.city,
        state:         doc.bill_to.state,
        zip:           doc.bill_to.zip,
        phone:         doc.customer_contact?.phone,
        email:         doc.customer_contact?.email,
      } : null,
      pickup_location:   locations.pickup_location   ?? null,
      delivery_location: locations.delivery_location ?? null,
      return_location:   locations.return_location   ?? null,
      appointment_times: null,
      is_operational_street_turn: false,
    },
    order_details: {
      reference_number:      order?.customer_reference  ?? null,
      booking_bl:            order?.booking_number      ?? order?.bl_number ?? null,
      mbol:                  order?.mbol                ?? null,
      hbol:                  order?.hbol                ?? null,
      container_number:      order?.container_number    ?? null,
      container_size:        order?.container_size      ?? null,
      container_type:        order?.container_type      ?? null,
      chassis_number:        order?.chassis_number      ?? null,
      chassis_size:          order?.chassis_size        ?? null,
      chassis_type:          order?.chassis_type        ?? null,
      chassis_owner:         order?.chassis_owner       ?? null,
      steamship_line:        order?.steamship_line      ?? null,
      seal:                  order?.seal_number         ?? null,
      hazmat:                order?.is_hazmat ? 'HAZMAT' : null,
      pickup_number:         order?.pickup_number       ?? null,
      pull_container_date:   order?.pull_container_date ?? null,
      return_container_date: order?.return_container_date ?? null,
      last_free_day:         order?.last_free_day       ?? null,
      per_diem_free_day:     order?.per_diem_free_day   ?? null,
    },
    commodity_details: null,  // No real source yet; sample-data fills preview
    charge_details: {
      charge_lines: doc.charge_lines || [],
      totals:       doc.totals       || { subtotal_cents: 0, total_cents: 0 },
    },
    notes: {
      driver_notes:  order?.notes          ?? null,    // orders.notes  → driver_notes
      billing_notes: meta.notes            ?? null,    // invoices.notes → billing_notes
      load_notes:    order?.internal_notes ?? null,    // orders.internal_notes → load_notes
    },
    disclaimer: doc.section_config?.disclaimer?.enabled
      ? { text: doc.section_config.disclaimer.text || '' }
      : null,
  };
}
