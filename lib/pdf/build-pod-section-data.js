/**
 * Build per-section data subsets for the POD composer. Pure function;
 * exported for unit testing. Lives in lib/pdf/ so tests/ can import it
 * without a JSX-capable runner. Same pattern as
 * lib/pdf/build-{invoice,rate-con,combined-invoice}-section-data.js.
 *
 * For Address Details specifically, this sets `data.customer = doc.bill_to`
 * because AddressDetails.js (shared) reads `data.customer` internally. The
 * "Bill To" label is applied at the renderSection switch site (see
 * components/pdf/PodTemplate.js).
 */
export function buildSectionData(doc) {
  const meta = doc.pod_meta || {};
  const order = doc.first_order || null;
  const locations = doc.load_level_locations || {};

  return {
    header: {
      tenantName: doc.tenant_name,
      tenantInfo: doc.tenant_info || {},
    },
    pod_details: {
      order_number:       meta.order_number       ?? null,
      customer_reference: meta.customer_reference ?? null,
      driver_name:        meta.driver_name        ?? null,
      delivery_date:      meta.delivery_date      ?? null,
      delivery_time:      meta.delivery_time      ?? null,
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
      reference_number:      order?.customer_reference    ?? null,
      booking_bl:            order?.booking_number        ?? order?.bl_number ?? null,
      mbol:                  order?.mbol                  ?? null,
      hbol:                  order?.hbol                  ?? null,
      container_number:      order?.container_number      ?? null,
      container_size:        order?.container_size        ?? null,
      container_type:        order?.container_type        ?? null,
      chassis_number:        order?.chassis_number        ?? null,
      chassis_size:          order?.chassis_size          ?? null,
      chassis_type:          order?.chassis_type          ?? null,
      chassis_owner:         order?.chassis_owner         ?? null,
      steamship_line:        order?.steamship_line        ?? null,
      seal:                  order?.seal_number           ?? null,
      hazmat:                order?.is_hazmat ? 'HAZMAT' : null,
      pickup_number:         order?.pickup_number         ?? null,
      pull_container_date:   order?.pull_container_date   ?? null,
      return_container_date: order?.return_container_date ?? null,
      last_free_day:         order?.last_free_day         ?? null,
      per_diem_free_day:     order?.per_diem_free_day     ?? null,
    },
    commodity_details: null,
    attached_documents: doc.attached_documents || [],
    notes: {
      driver_notes: order?.notes ?? null,
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
