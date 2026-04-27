import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { buildSectionData } from '../lib/pdf/build-invoice-section-data.js';

const baseDoc = {
  invoice_id: 'inv-uuid',
  tenant_name: 'Acme Drayage',
  tenant_info: {
    logo_url: 'https://example.com/logo.png',
    address: '1 Main St, Newark, NJ 07102',
    phone: '555-1212',
    website: 'acme.com',
  },
  bill_to: { name: 'Walmart', address_line1: '702 SW 8th', city: 'Bentonville', state: 'AR', zip: '72716' },
  customer_contact: { phone: '555-9999', email: 'ap@walmart.com' },
  bill_to_customer_id: 'cust-walmart-uuid',
  invoice_meta: {
    invoice_number: 'INV-001',
    invoice_date: '2026-04-25',
    due_date: '2026-05-25',
    terms_days: 30,
    is_consolidated: false,
    consolidated_count: 1,
    notes: 'Thank you for your business.',
  },
  first_order: {
    order_id: 'order-uuid',
    order_number: 'L-ABC',
    customer_reference: 'PO-12345',
    container_number: 'MSCU1234567',
    container_size: '40',
    container_type: 'HC',
    chassis_number: 'CHX9999',
    chassis_size: null,
    chassis_type: null,
    chassis_owner: null,
    steamship_line: 'MSC',
    seal_number: 'SEAL999',
    mbol: 'MBL123',
    hbol: 'HBL456',
    booking_number: 'BK789',
    pickup_number: 'PU123',
    is_hazmat: false,
    last_free_day: '2026-04-22',
    per_diem_free_day: '2026-04-25',
    pull_container_date: '2026-04-20',
    return_container_date: '2026-04-23',
    notes: 'Driver notes here',
    internal_notes: 'Load/internal notes here',
  },
  load_level_locations: {
    pickup_location:   { name: 'Newark Terminal', city: 'Newark', state: 'NJ' },
    delivery_location: { name: 'Edison Warehouse', city: 'Edison', state: 'NJ' },
    return_location:   { name: 'Newark Terminal', city: 'Newark', state: 'NJ' },
  },
  moves: [],
  charge_lines: [
    { description: 'Linehaul', quantity: 1, unit_amount_cents: 75000, total_amount_cents: 75000 },
    { description: 'FSC',      quantity: 1, unit_amount_cents: 12500, total_amount_cents: 12500 },
  ],
  totals: { subtotal_cents: 87500, total_cents: 87500 },
};

test('buildSectionData maps invoice metadata to invoice_details', () => {
  const sd = buildSectionData(baseDoc);
  assert.equal(sd.invoice_details.invoice_number, 'INV-001');
  assert.equal(sd.invoice_details.load_number, 'L-ABC');
  assert.equal(sd.invoice_details.customer_reference, 'PO-12345');
  assert.equal(sd.invoice_details.invoice_date, '2026-04-25');
  assert.equal(sd.invoice_details.terms_days, 30);
  assert.equal(sd.invoice_details.due_date, '2026-05-25');
  assert.equal(sd.invoice_details.consolidated_count, 1);
});

test('buildSectionData passes consolidated_count for consolidated invoice', () => {
  const sd = buildSectionData({
    ...baseDoc,
    invoice_meta: { ...baseDoc.invoice_meta, is_consolidated: true, consolidated_count: 3 },
  });
  assert.equal(sd.invoice_details.consolidated_count, 3);
});

test('buildSectionData maps bill_to to address_details.customer (AddressDetails-internal ID)', () => {
  const sd = buildSectionData(baseDoc);
  assert.equal(sd.address_details.customer.name, 'Walmart');
  assert.equal(sd.address_details.customer.city, 'Bentonville');
  assert.equal(sd.address_details.customer.phone, '555-9999');  // from customer_contact
  assert.equal(sd.address_details.customer.email, 'ap@walmart.com');
});

test('buildSectionData maps load_level_locations to address_details', () => {
  const sd = buildSectionData(baseDoc);
  assert.equal(sd.address_details.pickup_location.name,   'Newark Terminal');
  assert.equal(sd.address_details.delivery_location.name, 'Edison Warehouse');
  assert.equal(sd.address_details.return_location.name,   'Newark Terminal');
});

test('buildSectionData maps first_order columns to order_details (19 fields)', () => {
  const sd = buildSectionData(baseDoc);
  assert.equal(sd.order_details.reference_number,      'PO-12345');
  assert.equal(sd.order_details.container_number,      'MSCU1234567');
  assert.equal(sd.order_details.chassis_number,        'CHX9999');
  assert.equal(sd.order_details.steamship_line,        'MSC');
  assert.equal(sd.order_details.seal,                  'SEAL999');
  assert.equal(sd.order_details.mbol,                  'MBL123');
  assert.equal(sd.order_details.booking_bl,            'BK789');  // sourced from booking_number
  assert.equal(sd.order_details.pickup_number,         'PU123');
  assert.equal(sd.order_details.last_free_day,         '2026-04-22');
  assert.equal(sd.order_details.pull_container_date,   '2026-04-20');
  assert.equal(sd.order_details.return_container_date, '2026-04-23');
});

test('buildSectionData returns null-safe shapes when first_order is null', () => {
  const sd = buildSectionData({ ...baseDoc, first_order: null, load_level_locations: null });
  // Should not crash; sections degrade gracefully.
  assert.equal(sd.address_details.pickup_location, null);
  assert.equal(sd.address_details.delivery_location, null);
  assert.equal(sd.address_details.return_location, null);
  assert.equal(sd.order_details.reference_number, null);  // all 19 fields null
  assert.equal(sd.notes.driver_notes, null);
  assert.equal(sd.notes.load_notes, null);
});

test('buildSectionData maps charge_lines + totals to charge_details', () => {
  const sd = buildSectionData(baseDoc);
  assert.equal(sd.charge_details.charge_lines.length, 2);
  assert.equal(sd.charge_details.charge_lines[0].description, 'Linehaul');
  assert.equal(sd.charge_details.totals.subtotal_cents, 87500);
  assert.equal(sd.charge_details.totals.total_cents, 87500);
});

test('buildSectionData maps notes correctly (driver from order.notes, billing from invoice.notes, load from order.internal_notes)', () => {
  const sd = buildSectionData(baseDoc);
  assert.equal(sd.notes.driver_notes,  'Driver notes here');
  assert.equal(sd.notes.billing_notes, 'Thank you for your business.');
  assert.equal(sd.notes.load_notes,    'Load/internal notes here');
});
