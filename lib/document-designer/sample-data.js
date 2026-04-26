// Mirror this shape against buildSectionData() in components/pdf/DeliveryOrderTemplate.js —
// drift here means the preview shows different content than the printed PDF.
//
// Sample data uses ABC123 placeholders for fields and "Your Company" / sample address
// for tenant info. Real tenant info wiring is FU-035-F (fetches from /api/tenant/me).

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
  delivery_order_details: {
    delivery_order_number: 'ABC123',
    pickup_number: 'ABC123',
    driver_name: 'John Driver',
    delivery_appointment: 'ABC123',
    reference_number: 'ABC123',
  },
  address_details: {
    customer: {
      name: 'SAMPLE CUSTOMER',
      address_line1: '1210 Corbin Street',
      city: 'Elizabeth',
      state: 'NJ',
      zip: '07201',
      phone: '555-123-4567',
      email: 'customer@example.com',
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
      address_line1: '1210 Corbin Street',
      city: 'Elizabeth',
      state: 'NJ',
      zip: '07201',
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
  notes: {
    driver_notes:   'SAMPLE driver notes',
    yard_notes:     'SAMPLE yard notes',
    customer_notes: 'SAMPLE customer notes',
    billing_notes:  'SAMPLE billing notes',
    load_notes:     'SAMPLE load notes',
  },
  signature: {
    print_name: 'ABC123',
    signature: 'ABC123',
    time_in: 'MONTH DD, YYYY h:mm',
    time_out: 'MONTH DD, YYYY h:mm',
    date: 'MONTH DD, YYYY',
  },
  disclaimer: {
    text: 'Disclaimer text shows here. This is editable per-tenant in FU-035-G.',
  },
};

export default sampleData;
