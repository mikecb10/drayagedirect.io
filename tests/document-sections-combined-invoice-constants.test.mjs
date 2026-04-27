import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import {
  COMBINED_INVOICE_SECTIONS,
  SECTIONS_BY_DOCUMENT_TYPE,
  getSectionsForDocumentType,
  computeVisibility,
} from '../lib/constants/document-sections.js';

test('COMBINED_INVOICE_SECTIONS entries have required keys', () => {
  for (const s of COMBINED_INVOICE_SECTIONS) {
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

test('all 8 Combined Invoice sections present in expected order', () => {
  const ids = COMBINED_INVOICE_SECTIONS.map((s) => s.id);
  for (const id of [
    'header', 'invoice_details', 'address_details', 'loads_summary',
    'charge_details', 'notes', 'disclaimer', 'footer',
  ]) {
    assert.ok(ids.includes(id), `missing Combined Invoice section: ${id}`);
  }
  assert.equal(COMBINED_INVOICE_SECTIONS.length, 8);
});

test('footer is non-toggleable on Combined Invoice', () => {
  const footer = COMBINED_INVOICE_SECTIONS.find((s) => s.id === 'footer');
  assert.equal(footer.toggleable, false);
});

test('disclaimer defaults off on Combined Invoice', () => {
  const s = COMBINED_INVOICE_SECTIONS.find((x) => x.id === 'disclaimer');
  assert.equal(s.defaultVisible, false);
});

test('invoice_details has 6 fields (same as Invoice)', () => {
  const s = COMBINED_INVOICE_SECTIONS.find((x) => x.id === 'invoice_details');
  const fieldIds = s.fields.map((f) => f.id);
  for (const id of [
    'invoice_number', 'load_number', 'customer_reference',
    'invoice_date', 'terms', 'due_date',
  ]) {
    assert.ok(fieldIds.includes(id), `missing invoice_details field: ${id}`);
  }
  assert.equal(fieldIds.length, 6);
});

test('address_details has ONLY bill_to (NO location fields)', () => {
  const s = COMBINED_INVOICE_SECTIONS.find((x) => x.id === 'address_details');
  const fieldIds = s.fields.map((f) => f.id);
  assert.ok(fieldIds.includes('bill_to'), 'bill_to required');
  assert.ok(!fieldIds.includes('customer'),           'customer should NOT be on combined_invoice');
  assert.ok(!fieldIds.includes('pickup_location'),    'pickup_location should NOT be on combined_invoice (per-load)');
  assert.ok(!fieldIds.includes('delivery_location'),  'delivery_location should NOT be on combined_invoice (per-load)');
  assert.ok(!fieldIds.includes('return_location'),    'return_location should NOT be on combined_invoice (per-load)');
  assert.equal(fieldIds.length, 1);
});

test('loads_summary has 7 fields', () => {
  const s = COMBINED_INVOICE_SECTIONS.find((x) => x.id === 'loads_summary');
  const fieldIds = s.fields.map((f) => f.id);
  for (const id of [
    'load_number', 'container_number', 'chassis_number',
    'pickup_location', 'delivery_location',
    'pickup_date', 'delivery_date',
  ]) {
    assert.ok(fieldIds.includes(id), `missing loads_summary field: ${id}`);
  }
  assert.equal(fieldIds.length, 7);
});

test('charge_details has 4 fields (same as Invoice)', () => {
  const s = COMBINED_INVOICE_SECTIONS.find((x) => x.id === 'charge_details');
  const fieldIds = s.fields.map((f) => f.id);
  for (const id of ['charge_name', 'units', 'rates', 'charges']) {
    assert.ok(fieldIds.includes(id), `missing charge_details field: ${id}`);
  }
  assert.equal(fieldIds.length, 4);
});

test('notes has ONLY billing_notes (NOT driver/load notes)', () => {
  const s = COMBINED_INVOICE_SECTIONS.find((x) => x.id === 'notes');
  const fieldIds = s.fields.map((f) => f.id);
  assert.ok(fieldIds.includes('billing_notes'), 'billing_notes required');
  assert.ok(!fieldIds.includes('driver_notes'), 'driver_notes should NOT be on combined_invoice (per-load, ambiguous)');
  assert.ok(!fieldIds.includes('load_notes'),   'load_notes should NOT be on combined_invoice (per-load, ambiguous)');
  assert.equal(fieldIds.length, 1);
});

test("getSectionsForDocumentType('combined_invoice') returns COMBINED_INVOICE_SECTIONS", () => {
  assert.equal(getSectionsForDocumentType('combined_invoice'), COMBINED_INVOICE_SECTIONS);
});

test('computeVisibility honors COMBINED_INVOICE_SECTIONS defaults with no config', () => {
  const result = computeVisibility(COMBINED_INVOICE_SECTIONS, undefined);
  assert.equal(result.visibility.header, true);
  assert.equal(result.visibility.invoice_details, true);
  assert.equal(result.visibility.loads_summary, true);
  assert.equal(result.visibility.charge_details, true);
  assert.equal(result.visibility.disclaimer, false);  // default off
  assert.equal(result.visibility.footer, true);       // non-toggleable
  assert.equal(result.fields.charge_details.charge_name, true);
  assert.equal(result.fields.notes.billing_notes, true);
  assert.equal(result.fields.loads_summary.chassis_number, false);  // chassis_number defaults off per spec
});
