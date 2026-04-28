// Mirror this shape against buildSectionData() in lib/pdf/build-statement-section-data.js —
// drift here means the preview shows different content than the printed PDF.

const sampleData = {
  header: {
    tenantName: 'Your Company',
    title: 'STATEMENT',
    subtitle: 'OF ACCOUNT',
    tenantInfo: {
      logo_url: null,
      address: '123 Main Street, City, ST 12345, USA',
      phone: '555-555-1212',
      website: 'www.yourcompany.com',
    },
  },
  statement_details: {
    as_of_date: 'Apr 27, 2026',
    account_number: 'CUST-WMT-0042',
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
  open_invoices: [
    { invoice_id: 'inv-1', invoice_number: 'INV-2026-001', invoice_date: 'Apr 18, 2026', due_date: 'May 18, 2026', days_past_due: -21, customer_reference: 'PO-99821', original_amount_cents: 120000, balance_due_cents: 120000 },
    { invoice_id: 'inv-2', invoice_number: 'INV-2026-005', invoice_date: 'Mar 15, 2026', due_date: 'Apr 14, 2026', days_past_due: 13,  customer_reference: 'PO-99750', original_amount_cents: 247500, balance_due_cents: 85000  },
    { invoice_id: 'inv-3', invoice_number: 'INV-2026-007', invoice_date: 'Feb 28, 2026', due_date: 'Mar 30, 2026', days_past_due: 28,  customer_reference: 'PO-99701', original_amount_cents: 184000, balance_due_cents: 184000 },
    { invoice_id: 'inv-4', invoice_number: 'INV-2026-009', invoice_date: 'Feb 20, 2026', due_date: 'Mar 22, 2026', days_past_due: 36,  customer_reference: 'PO-99680', original_amount_cents: 210000, balance_due_cents: 210000 },
    { invoice_id: 'inv-5', invoice_number: 'INV-2025-127', invoice_date: 'Dec 5, 2025',  due_date: 'Jan 4, 2026',  days_past_due: 113, customer_reference: 'PO-99412', original_amount_cents: 325000, balance_due_cents: 325000 },
  ],
  // Keyed by section ID + shaped for the section component's `data` prop.
  // DocumentPreview dispatches via sampleData[s.id] (no buildSectionData on the
  // preview path), so these keys must match STATEMENT_SECTIONS ids exactly.
  aging_summary: {
    current:      120000,  // inv-1 (not yet due)
    days_1_30:    269000,  // inv-2 (13d, $85k) + inv-3 (28d, $184k)
    days_31_60:   210000,  // inv-4 (36d, $210k)
    days_61_90:        0,
    days_90_plus: 325000,  // inv-5 (113d, $325k)
  },
  total_outstanding: {
    total_outstanding_cents: 924000,
  },
  notes: {
    payment_instructions: 'Please remit to: Your Company, 123 Main Street, City, ST 12345.',
    custom_notes: '',
  },
  disclaimer: {
    text: 'Terms & Conditions text shows here. This is editable per-tenant in FU-035-G.',
  },
};

export default sampleData;
