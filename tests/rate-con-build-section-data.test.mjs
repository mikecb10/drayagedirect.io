import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { buildSectionData } from '../lib/pdf/build-rate-con-section-data.js';

const baseDoc = {
  charge_set_id: 'cs-uuid',
  tenant_name: 'Acme Drayage',
  tenant_info: {
    logo_url: 'https://example.com/logo.png',
    address: '1 Main St, Newark, NJ 07102',
    phone: '555-1212',
    website: 'acme.com',
  },
  bill_to_customer_id: 'cust-walmart-uuid',
  rate_con_meta: {
    confirmation_number: 'RC-001',
    issue_date: '2026-04-25',
    reference_number: 'PO-12345',
    pickup_appointment: '2026-04-26 09:00',
    delivery_appointment: '2026-04-26 16:00',
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
    pickup_location:   { name: 'Newark Terminal',   city: 'Newark', state: 'NJ' },
    delivery_location: { name: 'Edison Warehouse',  city: 'Edison', state: 'NJ' },
    return_location:   { name: 'Newark Terminal',   city: 'Newark', state: 'NJ' },
  },
  moves: [],
  charge_lines: [
    { description: 'Linehaul', quantity: 1, unit_amount_cents: 75000, total_amount_cents: 75000 },
    { description: 'FSC',      quantity: 1, unit_amount_cents: 12500, total_amount_cents: 12500 },
  ],
  totals: { total_cents: 87500 },
};

test('buildSectionData maps rate_con_meta to rate_con_details (5 fields)', () => {
  const sd = buildSectionData(baseDoc);
  assert.equal(sd.rate_con_details.confirmation_number, 'RC-001');
  assert.equal(sd.rate_con_details.issue_date, '2026-04-25');
  assert.equal(sd.rate_con_details.reference_number, 'PO-12345');
  assert.equal(sd.rate_con_details.pickup_appointment, '2026-04-26 09:00');
  assert.equal(sd.rate_con_details.delivery_appointment, '2026-04-26 16:00');
});

test('buildSectionData maps load_level_locations to address_details (no customer field)', () => {
  const sd = buildSectionData(baseDoc);
  assert.equal(sd.address_details.customer, null);
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
  assert.equal(sd.order_details.booking_bl,            'BK789');
  assert.equal(sd.order_details.pickup_number,         'PU123');
  assert.equal(sd.order_details.last_free_day,         '2026-04-22');
  assert.equal(sd.order_details.pull_container_date,   '2026-04-20');
  assert.equal(sd.order_details.return_container_date, '2026-04-23');
});

test('buildSectionData returns null-safe shapes when first_order is null', () => {
  const sd = buildSectionData({ ...baseDoc, first_order: null, load_level_locations: null });
  assert.equal(sd.address_details.customer, null);
  assert.equal(sd.address_details.pickup_location, null);
  assert.equal(sd.address_details.delivery_location, null);
  assert.equal(sd.address_details.return_location, null);
  assert.equal(sd.order_details.reference_number, null);
  assert.equal(sd.notes.driver_notes, null);
  assert.equal(sd.notes.load_notes, null);
});

test('buildSectionData maps charge_lines + totals to charge_details (no subtotal_cents)', () => {
  const sd = buildSectionData(baseDoc);
  assert.equal(sd.charge_details.charge_lines.length, 2);
  assert.equal(sd.charge_details.charge_lines[0].description, 'Linehaul');
  assert.equal(sd.charge_details.totals.total_cents, 87500);
  assert.equal(sd.charge_details.totals.subtotal_cents, undefined);
});

test('buildSectionData maps notes (driver from order.notes, load from order.internal_notes)', () => {
  const sd = buildSectionData(baseDoc);
  assert.equal(sd.notes.driver_notes, 'Driver notes here');
  assert.equal(sd.notes.load_notes,   'Load/internal notes here');
});
