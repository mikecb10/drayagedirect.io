// Mirror this shape against buildSectionData() in lib/pdf/build-credit-memo-section-data.js —
// drift here means the preview shows different content than the printed PDF.
//
// Keyed by SECTION ID (matches CREDIT_MEMO_SECTIONS ids) — DocumentPreview
// dispatches via sampleData[s.id], so keys must match exactly. The H5 spec §7.5
// has a regression note about this; the cost of getting it wrong is silent
// "section is empty" in the live preview while the PDF renders correctly.

const sampleData = {
  header: {
    tenantName: 'Your Company',
    title: 'CREDIT MEMO',
    subtitle: 'CM-2026-014',
    tenantInfo: {
      logo_url: null,
      address: '123 Main Street, City, ST 12345, USA',
      phone: '555-555-1212',
      website: 'www.yourcompany.com',
    },
  },
  memo_details: {
    memo_number:  'CM-2026-014',
    issue_date:   'Apr 27, 2026',
    applied_date: 'Apr 28, 2026',
  },
  address_details: {
    customer: {
      name: 'SAMPLE BILL TO',
      address_line1: '500 Customer Plaza',
      city: 'Newark',
      state: 'NJ',
      zip: '07102',
      phone: '555-123-4567',
      email: 'ap@example.com',
    },
    pickup_location: null,
    delivery_location: null,
    return_location: null,
    appointment_times: null,
    is_operational_street_turn: false,
  },
  reason: {
    text: 'Overcharge on chassis days for load LD-2026-7821 — billed 5 days, only 3 used.',
  },
  issued_from_invoice: {
    invoice_number: 'INV-2026-091',
    invoice_date:   'Apr 18, 2026',
    due_date:       'May 18, 2026',
    total_cents:    248500,
  },
  applied_to_invoice: {
    invoice_number:        'INV-2026-103',
    invoice_date:          'Apr 25, 2026',
    balance_due_cents:     142000,
    applied_amount_cents:  40000,
    applied_date:          'Apr 28, 2026',
  },
  credit_amount: {
    total_cents: 40000,
  },
  notes: {
    payment_instructions: 'This credit will be reflected on your next invoice or available for application upon request.',
    custom_notes: '',
  },
  disclaimer: {
    text: 'Terms & Conditions text shows here. This is editable per-tenant in FU-035-G.',
  },
};

export default sampleData;
