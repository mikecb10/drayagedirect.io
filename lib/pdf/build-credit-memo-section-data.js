/**
 * Build per-section data subsets for the Credit Memo composer. Pure function;
 * exported for unit testing. Lives in lib/pdf/ so tests/ can import it
 * without a JSX-capable runner. Same pattern as
 * lib/pdf/build-{invoice,rate-con,combined-invoice,pod,statement}-section-data.js.
 *
 * For Address Details specifically, this sets `data.customer = doc.bill_to`
 * because AddressDetails.js (shared) reads `data.customer` internally. The
 * "Bill To" label is applied at the renderSection switch site (see
 * components/pdf/CreditMemoTemplate.js).
 *
 * Reason / Issued From / Applied To sections may be null — the composer's
 * switch dispatch returns null in those cases, which auto-hides them from
 * the rendered output regardless of Designer toggle (per spec §7.7).
 */
export function buildSectionData(doc) {
  const meta = doc.memo_meta || {};
  const notes = doc.notes || {};
  const reasonText = meta.reason && String(meta.reason).trim();

  return {
    header: {
      tenantName: doc.tenant_name,
      tenantInfo: doc.tenant_info || {},
    },
    memo_details: {
      memo_number:  meta.memo_number  ?? null,
      issue_date:   meta.issue_date   ?? null,
      applied_date: meta.applied_date ?? null,
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
      // Credit Memo has no per-load locations.
      pickup_location: null,
      delivery_location: null,
      return_location: null,
      appointment_times: null,
      is_operational_street_turn: false,
    },
    reason: reasonText ? { text: reasonText } : null,
    issued_from_invoice: doc.issued_from_invoice
      ? {
          invoice_number: doc.issued_from_invoice.invoice_number,
          invoice_date:   doc.issued_from_invoice.invoice_date,
          due_date:       doc.issued_from_invoice.due_date,
          total_cents:    doc.issued_from_invoice.total_cents,
        }
      : null,
    applied_to_invoice: doc.applied_to_invoice
      ? {
          invoice_number:       doc.applied_to_invoice.invoice_number,
          invoice_date:         doc.applied_to_invoice.invoice_date,
          balance_due_cents:    doc.applied_to_invoice.balance_due_cents,
          applied_amount_cents: doc.applied_to_invoice.applied_amount_cents,
          applied_date:         doc.applied_to_invoice.applied_date,
        }
      : null,
    credit_amount: {
      total_cents: doc.credit_amount_cents ?? 0,
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
