import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { buildSectionData } from '../lib/pdf/build-combined-invoice-section-data.js';

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
    invoice_number: 'INV-007',
    invoice_date: 'Apr 25, 2026',
    due_date: 'May 25, 2026',
    terms_days: 30,
    is_consolidated: true,
    consolidated_count: 3,
    notes: 'Multi-load batch billing',
  },
  loads_summary: [
    { order_id: 'o1', load_number: 'L-ABC', container_number: 'MSCU1', chassis_number: 'CHX1',
      pickup_location: { name: 'Newark Terminal', city: 'Newark', state: 'NJ' },
      delivery_location: { name: 'Edison WH', city: 'Edison', state: 'NJ' },
      pickup_date: 'Apr 26', delivery_date: 'Apr 26' },
    { order_id: 'o2', load_number: 'L-DEF', container_number: 'MSCU2', chassis_number: 'CHX2',
      pickup_location: { name: 'Elizabeth Port', city: 'Elizabeth', state: 'NJ' },
      delivery_location: { name: 'Edison WH', city: 'Edison', state: 'NJ' },
      pickup_date: 'Apr 27', delivery_date: 'Apr 27' },
    { order_id: 'o3', load_number: 'L-GHI', container_number: 'MSCU3', chassis_number: 'CHX3',
      pickup_location: { name: 'Newark Terminal', city: 'Newark', state: 'NJ' },
      delivery_location: { name: 'Bayonne Yard', city: 'Bayonne', state: 'NJ' },
      pickup_date: 'Apr 28', delivery_date: 'Apr 28' },
  ],
  charge_groups: [
    { order_id: 'o1', load_number: 'L-ABC', lines: [
        { description: 'Linehaul', quantity: 1, unit_amount_cents: 75000, total_amount_cents: 75000 },
      ], subtotal_cents: 75000 },
    { order_id: 'o2', load_number: 'L-DEF', lines: [
        { description: 'Linehaul', quantity: 1, unit_amount_cents: 75000, total_amount_cents: 75000 },
        { description: 'FSC',      quantity: 1, unit_amount_cents: 12500, total_amount_cents: 12500 },
      ], subtotal_cents: 87500 },
    { order_id: 'o3', load_number: 'L-GHI', lines: [
        { description: 'Linehaul', quantity: 1, unit_amount_cents: 100000, total_amount_cents: 100000 },
      ], subtotal_cents: 100000 },
  ],
  totals: { subtotal_cents: 262500, total_cents: 262500 },
};

test('buildSectionData maps invoice metadata with consolidated_count > 1', () => {
  const sd = buildSectionData(baseDoc);
  assert.equal(sd.invoice_details.invoice_number, 'INV-007');
  assert.equal(sd.invoice_details.consolidated_count, 3);
  assert.equal(sd.invoice_details.terms_days, 30);
});

test('buildSectionData maps bill_to to address_details.customer (AddressDetails-internal ID)', () => {
  const sd = buildSectionData(baseDoc);
  assert.equal(sd.address_details.customer.name, 'Walmart');
  assert.equal(sd.address_details.customer.phone, '555-9999');
  assert.equal(sd.address_details.customer.email, 'ap@walmart.com');
});

test('buildSectionData passes loads_summary array through verbatim', () => {
  const sd = buildSectionData(baseDoc);
  assert.equal(sd.loads_summary.length, 3);
  assert.equal(sd.loads_summary[0].load_number, 'L-ABC');
  assert.equal(sd.loads_summary[1].container_number, 'MSCU2');
  assert.equal(sd.loads_summary[2].pickup_location.city, 'Newark');
});

test('buildSectionData passes charge_groups + totals through verbatim', () => {
  const sd = buildSectionData(baseDoc);
  assert.equal(sd.charge_details.charge_groups.length, 3);
  assert.equal(sd.charge_details.charge_groups[0].subtotal_cents, 75000);
  assert.equal(sd.charge_details.charge_groups[1].lines.length, 2);
  assert.equal(sd.charge_details.totals.total_cents, 262500);
});

test('buildSectionData maps notes.billing_notes from invoice_meta.notes', () => {
  const sd = buildSectionData(baseDoc);
  assert.equal(sd.notes.billing_notes, 'Multi-load batch billing');
});

test('buildSectionData returns null-safe shapes when arrays are missing', () => {
  const sd = buildSectionData({ ...baseDoc, loads_summary: null, charge_groups: null });
  assert.deepEqual(sd.loads_summary, []);
  assert.deepEqual(sd.charge_details.charge_groups, []);
});

test('buildSectionData omits per-load notes (driver/load notes are not registered for combined_invoice)', () => {
  const sd = buildSectionData(baseDoc);
  // billing_notes is the only registered field
  assert.ok('billing_notes' in sd.notes);
  // driver_notes / load_notes should NOT be in the output
  assert.equal(sd.notes.driver_notes, undefined);
  assert.equal(sd.notes.load_notes,   undefined);
});
