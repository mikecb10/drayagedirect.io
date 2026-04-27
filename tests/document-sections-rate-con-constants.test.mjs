import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import {
  RATE_CON_SECTIONS,
  SECTIONS_BY_DOCUMENT_TYPE,
  getSectionsForDocumentType,
  computeVisibility,
} from '../lib/constants/document-sections.js';

test('RATE_CON_SECTIONS entries have required keys', () => {
  for (const s of RATE_CON_SECTIONS) {
    assert.equal(typeof s.id, 'string', `missing id: ${JSON.stringify(s)}`);
    assert.equal(typeof s.label, 'string', `missing label: ${s.id}`);
    assert.equal(typeof s.defaultVisible, 'boolean', `defaultVisible: ${s.id}`);
    assert.equal(typeof s.toggleable, 'boolean', `toggleable: ${s.id}`);
    if (s.fields) {
      assert.ok(Array.isArray(s.fields), `fields must be array: ${s.id}`);
      for (const f of s.fields) {
        assert.equal(typeof f.id, 'string', `field missing id in ${s.id}`);
        assert.equal(typeof f.label, 'string', `field missing label: ${s.id}.${f.id}`);
        assert.equal(typeof f.defaultVisible, 'boolean', `field defaultVisible: ${s.id}.${f.id}`);
      }
    }
  }
});

test('all 11 Rate Con sections present', () => {
  const ids = RATE_CON_SECTIONS.map((s) => s.id);
  for (const id of [
    'header', 'rate_con_details', 'address_details', 'move_events',
    'order_details', 'commodity_details', 'charge_details', 'notes',
    'signature', 'disclaimer', 'footer',
  ]) {
    assert.ok(ids.includes(id), `missing Rate Con section: ${id}`);
  }
  assert.equal(RATE_CON_SECTIONS.length, 11);
});

test('footer is non-toggleable on Rate Con', () => {
  const footer = RATE_CON_SECTIONS.find((s) => s.id === 'footer');
  assert.equal(footer.toggleable, false);
});

test('move_events / commodity_details / signature / disclaimer default off on Rate Con', () => {
  for (const id of ['move_events', 'commodity_details', 'signature', 'disclaimer']) {
    const s = RATE_CON_SECTIONS.find((x) => x.id === id);
    assert.equal(s.defaultVisible, false, `${id} should default off`);
  }
});

test('rate_con_details has 5 fields', () => {
  const s = RATE_CON_SECTIONS.find((x) => x.id === 'rate_con_details');
  const fieldIds = s.fields.map((f) => f.id);
  for (const id of [
    'confirmation_number', 'issue_date', 'reference_number',
    'pickup_appointment', 'delivery_appointment',
  ]) {
    assert.ok(fieldIds.includes(id), `missing rate_con_details field: ${id}`);
  }
  assert.equal(fieldIds.length, 5);
});

test('address_details has 4 fields and NO customer/bill_to', () => {
  const s = RATE_CON_SECTIONS.find((x) => x.id === 'address_details');
  const fieldIds = s.fields.map((f) => f.id);
  for (const id of [
    'pickup_location', 'delivery_location', 'return_location',
    'display_pickup_for_operational_street_turns',
  ]) {
    assert.ok(fieldIds.includes(id), `missing address_details field: ${id}`);
  }
  assert.ok(!fieldIds.includes('customer'), 'customer should NOT be in rate_con address_details');
  assert.ok(!fieldIds.includes('bill_to'),  'bill_to should NOT be in rate_con address_details');
  assert.equal(fieldIds.length, 4);
});

test('charge_details has 4 fields (label "Rate Details")', () => {
  const s = RATE_CON_SECTIONS.find((x) => x.id === 'charge_details');
  assert.equal(s.label, 'Rate Details');
  const fieldIds = s.fields.map((f) => f.id);
  for (const id of ['charge_name', 'units', 'rates', 'charges']) {
    assert.ok(fieldIds.includes(id), `missing charge_details field: ${id}`);
  }
  assert.equal(fieldIds.length, 4);
});

test('notes has 2 fields, NOT billing_notes / yard_notes / customer_notes', () => {
  const s = RATE_CON_SECTIONS.find((x) => x.id === 'notes');
  const fieldIds = s.fields.map((f) => f.id);
  for (const id of ['driver_notes', 'load_notes']) {
    assert.ok(fieldIds.includes(id), `missing notes field: ${id}`);
  }
  assert.ok(!fieldIds.includes('billing_notes'),  'billing_notes should NOT be on rate_con (Invoice-only)');
  assert.ok(!fieldIds.includes('yard_notes'),     'yard_notes should NOT be on rate_con');
  assert.ok(!fieldIds.includes('customer_notes'), 'customer_notes should NOT be on rate_con');
  assert.equal(fieldIds.length, 2);
});

test('order_details has 19 fields (label "Equipment Details", same field IDs as DO/Invoice)', () => {
  const s = RATE_CON_SECTIONS.find((x) => x.id === 'order_details');
  assert.equal(s.label, 'Equipment Details');
  const fieldIds = s.fields.map((f) => f.id);
  for (const id of [
    'reference_number', 'booking_bl', 'mbol', 'hbol',
    'container_number', 'container_size', 'container_type',
    'chassis_number', 'chassis_size', 'chassis_type', 'chassis_owner',
    'steamship_line', 'seal', 'hazmat', 'pickup_number',
    'pull_container_date', 'return_container_date',
    'last_free_day', 'per_diem_free_day',
  ]) {
    assert.ok(fieldIds.includes(id), `missing order_details field: ${id}`);
  }
  assert.equal(fieldIds.length, 19);
});

test('disclaimer label is "Terms & Conditions"', () => {
  const s = RATE_CON_SECTIONS.find((x) => x.id === 'disclaimer');
  assert.equal(s.label, 'Terms & Conditions');
});

test("getSectionsForDocumentType('rate_con') returns RATE_CON_SECTIONS", () => {
  assert.equal(getSectionsForDocumentType('rate_con'), RATE_CON_SECTIONS);
});

test('computeVisibility honors RATE_CON_SECTIONS defaults with no config', () => {
  const result = computeVisibility(RATE_CON_SECTIONS, undefined);
  assert.equal(result.visibility.header, true);
  assert.equal(result.visibility.rate_con_details, true);
  assert.equal(result.visibility.charge_details, true);
  assert.equal(result.visibility.move_events, false);
  assert.equal(result.visibility.commodity_details, false);
  assert.equal(result.visibility.signature, false);
  assert.equal(result.visibility.disclaimer, false);
  assert.equal(result.visibility.footer, true);
  assert.equal(result.fields.charge_details.charge_name, true);
  assert.equal(result.fields.notes.driver_notes, true);
  assert.equal(result.fields.notes.load_notes, true);
});
