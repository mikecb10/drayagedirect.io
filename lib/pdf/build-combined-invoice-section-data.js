/**
 * Build per-section data subsets for the Combined Invoice composer.
 * Pure function; exported for unit testing. Lives in lib/pdf/ so tests/
 * can import it without a JSX-capable runner.
 *
 * For Address Details specifically, this sets `data.customer = doc.bill_to`
 * because AddressDetails.js (shared) reads `data.customer` internally. The
 * "Bill To" label is applied at the renderSection switch site (see
 * components/pdf/CombinedInvoiceTemplate.js).
 *
 * Combined Invoice differs from Invoice in 4 places:
 *   1. invoice_details.consolidated_count drives "(N loads)" rendering
 *   2. address_details has only the customer (Bill To); pickup/delivery/return are per-load
 *   3. NEW loads_summary: pass-through of doc.loads_summary[]
 *   4. charge_details has charge_groups (per-load buckets with subtotals) instead of charge_lines
 *   5. notes has only billing_notes (driver/load notes are per-load, ambiguous)
 */
export function buildSectionData(doc) {
  const meta = doc.invoice_meta || {};

  return {
    header: {
      tenantName: doc.tenant_name,
      tenantInfo: doc.tenant_info || {},
    },
    invoice_details: {
      invoice_number:     meta.invoice_number ?? null,
      load_number:        null,  // overridden by InvoiceDetails when consolidated_count > 1 → "(N loads)"
      customer_reference: null,  // ambiguous on consolidated; could populate if all orders share same PO — defer
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
      // Combined Invoice has no per-load locations at the document level.
      pickup_location:   null,
      delivery_location: null,
      return_location:   null,
      appointment_times: null,
      is_operational_street_turn: false,
    },
    loads_summary: doc.loads_summary || [],
    charge_details: {
      charge_groups: doc.charge_groups || [],
      totals:        doc.totals       || { subtotal_cents: 0, total_cents: 0 },
    },
    notes: {
      billing_notes: meta.notes ?? null,
    },
    disclaimer: doc.section_config?.disclaimer?.enabled
      ? { text: doc.section_config.disclaimer.text || '' }
      : null,
  };
}
