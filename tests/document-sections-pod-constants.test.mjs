import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import {
  POD_SECTIONS,
  SECTIONS_BY_DOCUMENT_TYPE,
  getSectionsForDocumentType,
  computeVisibility,
} from '../lib/constants/document-sections.js';

test('POD_SECTIONS entries have required keys', () => {
  for (const s of POD_SECTIONS) {
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

test('all 11 POD sections present in expected order', () => {
  const ids = POD_SECTIONS.map((s) => s.id);
  for (const id of [
    'header', 'pod_details', 'address_details', 'move_events',
    'order_details', 'commodity_details', 'attached_documents',
    'notes', 'signature', 'disclaimer', 'footer',
  ]) {
    assert.ok(ids.includes(id), `missing POD section: ${id}`);
  }
  assert.equal(POD_SECTIONS.length, 11);
});

test('footer is non-toggleable on POD', () => {
  const footer = POD_SECTIONS.find((s) => s.id === 'footer');
  assert.equal(footer.toggleable, false);
});

test('move_events defaults TRUE on POD (different from Invoice/Rate Con/Combined)', () => {
  const s = POD_SECTIONS.find((x) => x.id === 'move_events');
  assert.equal(s.defaultVisible, true);
});

test('commodity_details / signature / disclaimer default OFF on POD', () => {
  for (const id of ['commodity_details', 'signature', 'disclaimer']) {
    const s = POD_SECTIONS.find((x) => x.id === id);
    assert.equal(s.defaultVisible, false, `${id} should default off`);
  }
});

test('pod_details has 5 fields', () => {
  const s = POD_SECTIONS.find((x) => x.id === 'pod_details');
  const fieldIds = s.fields.map((f) => f.id);
  for (const id of [
    'order_number', 'customer_reference', 'driver_name',
    'delivery_date', 'delivery_time',
  ]) {
    assert.ok(fieldIds.includes(id), `missing pod_details field: ${id}`);
  }
  assert.equal(fieldIds.length, 5);
});

test('address_details uses bill_to (NOT customer)', () => {
  const s = POD_SECTIONS.find((x) => x.id === 'address_details');
  const fieldIds = s.fields.map((f) => f.id);
  assert.ok(fieldIds.includes('bill_to'),  'bill_to required');
  assert.ok(!fieldIds.includes('customer'), 'customer should NOT exist on POD (DO-only)');
  assert.equal(fieldIds.length, 5);  // bill_to + 4 location fields
});

test('attached_documents has no fields (master toggle only)', () => {
  const s = POD_SECTIONS.find((x) => x.id === 'attached_documents');
  assert.equal(s.fields, undefined);
});

test('notes has ONLY driver_notes (NOT billing/load notes)', () => {
  const s = POD_SECTIONS.find((x) => x.id === 'notes');
  const fieldIds = s.fields.map((f) => f.id);
  assert.ok(fieldIds.includes('driver_notes'),     'driver_notes required');
  assert.ok(!fieldIds.includes('billing_notes'),   'billing_notes should NOT be on pod');
  assert.ok(!fieldIds.includes('load_notes'),      'load_notes should NOT be on pod');
  assert.equal(fieldIds.length, 1);
});

test('order_details has 19 fields (label "Equipment Details")', () => {
  const s = POD_SECTIONS.find((x) => x.id === 'order_details');
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

test("getSectionsForDocumentType('pod') returns POD_SECTIONS", () => {
  assert.equal(getSectionsForDocumentType('pod'), POD_SECTIONS);
});

test('computeVisibility honors POD_SECTIONS defaults with no config', () => {
  const result = computeVisibility(POD_SECTIONS, undefined);
  assert.equal(result.visibility.header, true);
  assert.equal(result.visibility.pod_details, true);
  assert.equal(result.visibility.move_events, true);          // ← TRUE for POD
  assert.equal(result.visibility.attached_documents, true);
  assert.equal(result.visibility.commodity_details, false);
  assert.equal(result.visibility.signature, false);
  assert.equal(result.visibility.disclaimer, false);
  assert.equal(result.visibility.footer, true);
  assert.equal(result.fields.pod_details.driver_name, true);
  assert.equal(result.fields.notes.driver_notes, true);
});
