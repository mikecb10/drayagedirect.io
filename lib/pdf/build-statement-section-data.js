/**
 * Build per-section data subsets for the Statement composer. Pure function;
 * exported for unit testing. Lives in lib/pdf/ so tests/ can import it
 * without a JSX-capable runner. Same pattern as
 * lib/pdf/build-{invoice,rate-con,combined-invoice,pod}-section-data.js.
 *
 * For Address Details specifically, this sets `data.customer = doc.bill_to`
 * because AddressDetails.js (shared) reads `data.customer` internally. The
 * "Bill To" label is applied at the renderSection switch site (see
 * components/pdf/StatementTemplate.js).
 */
export function buildSectionData(doc) {
  const meta = doc.statement_meta || {};
  const notes = doc.notes || {};

  return {
    header: {
      tenantName: doc.tenant_name,
      tenantInfo: doc.tenant_info || {},
    },
    statement_details: {
      as_of_date:     meta.as_of_date     ?? null,
      account_number: meta.account_number ?? null,
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
      // Statement has no per-load locations.
      pickup_location: null,
      delivery_location: null,
      return_location: null,
      appointment_times: null,
      is_operational_street_turn: false,
    },
    open_invoices: doc.open_invoices || [],
    aging_summary: doc.aging || { current: 0, days_1_30: 0, days_31_60: 0, days_61_90: 0, days_90_plus: 0 },
    total_outstanding: {
      total_outstanding_cents: doc.total_outstanding_cents ?? 0,
    },
    notes: {
      payment_instructions: notes.payment_instructions ?? null,
      custom_notes:         notes.custom_notes         ?? null,
    },
    disclaimer: doc.section_config?.disclaimer?.enabled
      ? { text: doc.section_config.disclaimer.text || '' }
      : null,
  };
}
