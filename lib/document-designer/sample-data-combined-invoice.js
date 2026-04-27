// Mirror this shape against buildSectionData() in lib/pdf/build-combined-invoice-section-data.js —
// drift here means the preview shows different content than the printed PDF.
//
// Combined Invoice differs from Invoice in 3 ways:
//   1. invoice_details.consolidated_count = N > 1 → InvoiceDetails renders "(N loads)" for Load Number
//   2. address_details.customer is the Bill To (only field; no per-load locations)
//   3. NEW loads_summary array (N rows) and charge_details with charge_groups (N groups + grand total)

const sampleData = {
  header: {
    tenantName: 'Your Company',
    tenantInfo: {
      logo_url: null,
      address: '123 Main Street, City, ST 12345, USA',
      phone: '555-555-1212',
      website: 'www.yourcompany.com',
    },
  },
  invoice_details: {
    invoice_number: 'INV-2026-007',
    load_number: null,  // overridden to "(3 loads)" by InvoiceDetails when consolidated_count > 1
    customer_reference: 'PO-99999',
    invoice_date: 'MONTH DD, YYYY',
    terms_days: 30,
    due_date: 'MONTH DD, YYYY',
    consolidated_count: 3,
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
    pickup_location:   null,  // per-load — not shown at the document level
    delivery_location: null,
    return_location:   null,
    appointment_times: null,
    is_operational_street_turn: false,
  },
  loads_summary: [
    {
      order_id: 'order-1-uuid',
      load_number: 'L-ABC',
      container_number: 'MSCU1234567',
      chassis_number: 'CHX9999',
      pickup_location: { name: 'Newark Terminal', city: 'Newark', state: 'NJ' },
      delivery_location: { name: 'Edison Warehouse', city: 'Edison', state: 'NJ' },
      pickup_date: 'MONTH DD',
      delivery_date: 'MONTH DD',
    },
    {
      order_id: 'order-2-uuid',
      load_number: 'L-DEF',
      container_number: 'MSCU5678901',
      chassis_number: 'CHX1234',
      pickup_location: { name: 'Elizabeth Port', city: 'Elizabeth', state: 'NJ' },
      delivery_location: { name: 'Edison Warehouse', city: 'Edison', state: 'NJ' },
      pickup_date: 'MONTH DD',
      delivery_date: 'MONTH DD',
    },
    {
      order_id: 'order-3-uuid',
      load_number: 'L-GHI',
      container_number: 'MSCU9999999',
      chassis_number: 'CHX5555',
      pickup_location: { name: 'Newark Terminal', city: 'Newark', state: 'NJ' },
      delivery_location: { name: 'Bayonne Yard', city: 'Bayonne', state: 'NJ' },
      pickup_date: 'MONTH DD',
      delivery_date: 'MONTH DD',
    },
  ],
  charge_details: {
    charge_groups: [
      {
        order_id: 'order-1-uuid',
        load_number: 'L-ABC',
        lines: [
          { description: 'Linehaul - 40\' Container', quantity: 1, unit_amount_cents: 75000, total_amount_cents: 75000 },
          { description: 'Fuel Surcharge',            quantity: 1, unit_amount_cents: 12500, total_amount_cents: 12500 },
        ],
        subtotal_cents: 87500,
      },
      {
        order_id: 'order-2-uuid',
        load_number: 'L-DEF',
        lines: [
          { description: 'Linehaul - 40\' Container', quantity: 1, unit_amount_cents: 75000, total_amount_cents: 75000 },
          { description: 'Fuel Surcharge',            quantity: 1, unit_amount_cents: 12500, total_amount_cents: 12500 },
          { description: 'Chassis Day Use',           quantity: 2, unit_amount_cents: 3500,  total_amount_cents: 7000 },
        ],
        subtotal_cents: 94500,
      },
      {
        order_id: 'order-3-uuid',
        load_number: 'L-GHI',
        lines: [
          { description: 'Linehaul - 40\' Container', quantity: 1, unit_amount_cents: 100000, total_amount_cents: 100000 },
          { description: 'Fuel Surcharge',            quantity: 1, unit_amount_cents: 12000,  total_amount_cents: 12000 },
        ],
        subtotal_cents: 112000,
      },
    ],
    totals: {
      subtotal_cents: 294000,
      total_cents: 294000,
    },
  },
  notes: {
    billing_notes: 'SAMPLE billing notes — payment terms apply to total of all loads.',
  },
  disclaimer: {
    text: 'Disclaimer text shows here. This is editable per-tenant in FU-035-G.',
  },
};

export default sampleData;
