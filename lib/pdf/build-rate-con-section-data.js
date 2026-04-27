/**
 * Build per-section data subsets for the Rate Con composer. Pure function;
 * exported for unit testing. Lives in lib/pdf/ so tests/ can import it
 * without a JSX-capable runner (RateConTemplate.js itself contains JSX
 * which bare Node can't parse). Same pattern as
 * lib/pdf/build-invoice-section-data.js.
 *
 * For Address Details specifically, this sets `data.customer = null`
 * always — rate cons never show a customer block. AddressDetails.js
 * (shared component) reads `data.customer` and short-circuits when null.
 */
export function buildSectionData(doc) {
  const meta = doc.rate_con_meta || {};
  const order = doc.first_order || null;
  const locations = doc.load_level_locations || {};

  return {
    header: {
      tenantName: doc.tenant_name,
      tenantInfo: doc.tenant_info || {},
    },
    rate_con_details: {
      confirmation_number:  meta.confirmation_number  ?? null,
      issue_date:           meta.issue_date           ?? null,
      reference_number:     meta.reference_number     ?? null,
      pickup_appointment:   meta.pickup_appointment   ?? null,
      delivery_appointment: meta.delivery_appointment ?? null,
    },
    address_details: {
      customer: null,  // Rate Con never shows a customer block — AddressDetails.js short-circuits
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
    commodity_details: null,
    charge_details: {
      charge_lines: doc.charge_lines || [],
      totals:       doc.totals       || { total_cents: 0 },
    },
    notes: {
      driver_notes: order?.notes          ?? null,
      load_notes:   order?.internal_notes ?? null,
    },
    signature: {
      print_name: '',
      signature: '',
      date: '',
      time_in: '',
      time_out: '',
    },
    disclaimer: doc.section_config?.disclaimer?.enabled
      ? { text: doc.section_config.disclaimer.text || '' }
      : null,
  };
}
