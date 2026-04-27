// Mirror this shape against buildSectionData() in components/pdf/RateConTemplate.js
// (extracted to lib/pdf/build-rate-con-section-data.js in FU-035-H2 Task 9) —
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
  rate_con_details: {
    confirmation_number: 'RC-2026-001',
    issue_date: 'MONTH DD, YYYY',
    reference_number: 'PO-12345',
    pickup_appointment: 'MONTH DD, YYYY h:mm',
    delivery_appointment: 'MONTH DD, YYYY h:mm',
  },
  address_details: {
    customer: null,
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
    totals: { total_cents: 98000 },
  },
  notes: {
    driver_notes: 'SAMPLE driver notes',
    load_notes:   'SAMPLE load notes',
  },
  signature: {
    print_name: 'ABC123',
    signature: 'ABC123',
    time_in: 'MONTH DD, YYYY h:mm',
    time_out: 'MONTH DD, YYYY h:mm',
    date: 'MONTH DD, YYYY',
  },
  disclaimer: {
    text: 'Terms & Conditions text shows here. This is editable per-tenant in FU-035-G.',
  },
};

export default sampleData;
