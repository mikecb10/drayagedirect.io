// Mirror this shape against buildSectionData() in components/pdf/InvoiceTemplate.js —
// drift here means the preview shows different content than the printed PDF.

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
    invoice_number: 'INV-2026-001',
    load_number: 'L-ABC123',
    customer_reference: 'PO-12345',
    invoice_date: 'MONTH DD, YYYY',
    terms_days: 30,
    due_date: 'MONTH DD, YYYY',
    consolidated_count: 1,
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
    pickup_location: {
      name: 'SAMPLE PICKUP',
      address_line1: '1210 Corbin Street',
      city: 'Elizabeth',
      state: 'NJ',
      zip: '07201',
    },
    delivery_location: {
      name: 'SAMPLE DELIVERY',
      address_line1: '900 Warehouse Way',
      city: 'Edison',
      state: 'NJ',
      zip: '08837',
    },
    return_location: {
      name: 'SAMPLE RETURN',
      address_line1: '1210 Corbin Street',
      city: 'Elizabeth',
      state: 'NJ',
      zip: '07201',
    },
    appointment_times: { pickup: 'MONTH DD, YYYY h:mm', delivery: 'MONTH DD, YYYY h:mm' },
    is_operational_street_turn: false,
  },
  order_details: {
    reference_number: 'ABC123',
    booking_bl: 'ABC123',
    mbol: 'ABC123',
    hbol: 'ABC123',
    container_number: 'ABC123',
    container_size: 'ABC123',
    container_type: 'ABC123',
    chassis_number: 'ABC123',
    chassis_size: 'ABC123',
    chassis_type: 'ABC123',
    chassis_owner: 'ABC123',
    steamship_line: 'ABC123',
    seal: 'ABC123',
    hazmat: 'ABC123',
    pickup_number: 'ABC123',
    pull_container_date: 'ABC123',
    return_container_date: 'ABC123',
    last_free_day: 'ABC123',
    per_diem_free_day: 'ABC123',
  },
  commodity_details: {
    commodity: 'ABC123',
    description: 'ABC123',
    weight: 'ABC123 LBS',
    pallets: 'ABC123',
    pieces: 'ABC123',
  },
  charge_details: {
    charge_lines: [
      { description: 'Linehaul - 40\' Container', quantity: 1, unit_amount_cents: 75000, total_amount_cents: 75000 },
      { description: 'Fuel Surcharge',            quantity: 1, unit_amount_cents: 12500, total_amount_cents: 12500 },
      { description: 'Chassis Day Use',           quantity: 3, unit_amount_cents: 3500,  total_amount_cents: 10500 },
    ],
    totals: { subtotal_cents: 98000, total_cents: 98000 },
  },
  notes: {
    driver_notes:  'SAMPLE driver notes',
    billing_notes: 'SAMPLE billing notes — payment terms apply.',
    load_notes:    'SAMPLE load notes',
  },
  disclaimer: {
    text: 'Disclaimer text shows here. This is editable per-tenant in FU-035-G.',
  },
};

export default sampleData;
