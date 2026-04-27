import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import {
  INVOICE_SECTIONS,
  SECTIONS_BY_DOCUMENT_TYPE,
  getSectionsForDocumentType,
  computeVisibility,
} from '../lib/constants/document-sections.js';

test('INVOICE_SECTIONS entries have required keys', () => {
  for (const s of INVOICE_SECTIONS) {
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

test('all 10 Invoice sections present', () => {
  const ids = INVOICE_SECTIONS.map((s) => s.id);
  for (const id of [
    'header',
    'invoice_details',
    'address_details',
    'move_events',
    'order_details',
    'commodity_details',
    'charge_details',
    'notes',
    'disclaimer',
    'footer',
  ]) {
    assert.ok(ids.includes(id), `missing Invoice section: ${id}`);
  }
  assert.equal(INVOICE_SECTIONS.length, 10);
});

test('footer is non-toggleable on Invoice', () => {
  const footer = INVOICE_SECTIONS.find((s) => s.id === 'footer');
  assert.equal(footer.toggleable, false);
});

test('move_events / commodity_details / disclaimer default off on Invoice', () => {
  for (const id of ['move_events', 'commodity_details', 'disclaimer']) {
    const s = INVOICE_SECTIONS.find((x) => x.id === id);
    assert.equal(s.defaultVisible, false, `${id} should default off`);
  }
});

test('invoice_details has 6 fields', () => {
  const s = INVOICE_SECTIONS.find((x) => x.id === 'invoice_details');
  const fieldIds = s.fields.map((f) => f.id);
  for (const id of [
    'invoice_number', 'load_number', 'customer_reference',
    'invoice_date', 'terms', 'due_date',
  ]) {
    assert.ok(fieldIds.includes(id), `missing invoice_details field: ${id}`);
  }
  assert.equal(fieldIds.length, 6);
});

test('charge_details has 4 fields, NOT free_units or hours', () => {
  const s = INVOICE_SECTIONS.find((x) => x.id === 'charge_details');
  const fieldIds = s.fields.map((f) => f.id);
  for (const id of ['charge_name', 'units', 'rates', 'charges']) {
    assert.ok(fieldIds.includes(id), `missing charge_details field: ${id}`);
  }
  assert.ok(!fieldIds.includes('free_units'), 'free_units should NOT be registered (no data source)');
  assert.ok(!fieldIds.includes('hours'),      'hours should NOT be registered (no data source)');
  assert.equal(fieldIds.length, 4);
});

test('notes has 3 fields, NOT yard_notes or customer_notes', () => {
  const s = INVOICE_SECTIONS.find((x) => x.id === 'notes');
  const fieldIds = s.fields.map((f) => f.id);
  for (const id of ['driver_notes', 'billing_notes', 'load_notes']) {
    assert.ok(fieldIds.includes(id), `missing notes field: ${id}`);
  }
  assert.ok(!fieldIds.includes('yard_notes'),     'yard_notes should NOT be registered (no data source)');
  assert.ok(!fieldIds.includes('customer_notes'), 'customer_notes should NOT be registered (no data source)');
  assert.equal(fieldIds.length, 3);
});

test('address_details has bill_to (NOT customer)', () => {
  const s = INVOICE_SECTIONS.find((x) => x.id === 'address_details');
  const fieldIds = s.fields.map((f) => f.id);
  assert.ok(fieldIds.includes('bill_to'),   'bill_to required');
  assert.ok(!fieldIds.includes('customer'), 'customer should NOT exist on Invoice (DO-only)');
});

test("getSectionsForDocumentType('invoice') returns INVOICE_SECTIONS", () => {
  assert.equal(getSectionsForDocumentType('invoice'), INVOICE_SECTIONS);
});

test('computeVisibility honors INVOICE_SECTIONS defaults with no config', () => {
  const result = computeVisibility(INVOICE_SECTIONS, undefined);
  assert.equal(result.visibility.header, true);
  assert.equal(result.visibility.invoice_details, true);
  assert.equal(result.visibility.charge_details, true);
  assert.equal(result.visibility.move_events, false);          // default off
  assert.equal(result.visibility.commodity_details, false);    // default off
  assert.equal(result.visibility.disclaimer, false);           // default off
  assert.equal(result.visibility.footer, true);                // non-toggleable
  assert.equal(result.fields.charge_details.charge_name, true);
  assert.equal(result.fields.notes.billing_notes, true);
  assert.equal(result.fields.notes.driver_notes, false);       // default off
});
