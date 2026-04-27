import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import {
  DELIVERY_ORDER_SECTIONS,
  SECTIONS_BY_DOCUMENT_TYPE,
  getSectionsForDocumentType,
  computeVisibility,
  extractColors,
} from '../lib/constants/document-sections.js';

test('DELIVERY_ORDER_SECTIONS entries have required keys', () => {
  for (const s of DELIVERY_ORDER_SECTIONS) {
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

test('PortPro DO tree sections are present', () => {
  const ids = DELIVERY_ORDER_SECTIONS.map((s) => s.id);
  for (const id of [
    'header',
    'delivery_order_details',
    'address_details',
    'move_events',
    'order_details',
    'commodity_details',
    'notes',
    'signature',
    'disclaimer',
    'barcode',
    'footer',
  ]) {
    assert.ok(ids.includes(id), `missing section: ${id}`);
  }
});

test('footer is always-on (not toggleable)', () => {
  const footer = DELIVERY_ORDER_SECTIONS.find((s) => s.id === 'footer');
  assert.equal(footer.toggleable, false);
});

test('order_details has the 19 expected fields', () => {
  const od = DELIVERY_ORDER_SECTIONS.find((s) => s.id === 'order_details');
  const fieldIds = od.fields.map((f) => f.id);
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

test('getSectionsForDocumentType returns the registry for both DO variants', () => {
  assert.equal(getSectionsForDocumentType('delivery_order_full'), DELIVERY_ORDER_SECTIONS);
  assert.equal(getSectionsForDocumentType('delivery_order_next_move'), DELIVERY_ORDER_SECTIONS);
});

test('getSectionsForDocumentType returns [] for unknown types', () => {
  assert.deepEqual(getSectionsForDocumentType('not_a_type'), []);
});

test('computeVisibility returns {visibility, fields} with no config', () => {
  const result = computeVisibility(DELIVERY_ORDER_SECTIONS, undefined);
  assert.ok(result.visibility);
  assert.ok(result.fields);
  assert.equal(result.visibility.header, true);
  assert.equal(result.visibility.commodity_details, false); // defaultVisible: false
  assert.equal(result.visibility.footer, true); // non-toggleable always true
  // Default-true field semantics
  assert.equal(result.fields.order_details.container_number, true);
  assert.equal(result.fields.header.logo, true);
});

test('computeVisibility honors master visibility override', () => {
  const result = computeVisibility(DELIVERY_ORDER_SECTIONS, {
    visibility: { address_details: false },
  });
  assert.equal(result.visibility.address_details, false);
  assert.equal(result.visibility.order_details, true); // unaffected
});

test('computeVisibility honors per-field overrides', () => {
  const result = computeVisibility(DELIVERY_ORDER_SECTIONS, {
    perSection: {
      order_details: { fields: { container_number: false, seal: false } },
    },
  });
  assert.equal(result.fields.order_details.container_number, false);
  assert.equal(result.fields.order_details.seal, false);
  assert.equal(result.fields.order_details.mbol, true); // unspecified = default-true
});

test('computeVisibility default-true for fields not present in config', () => {
  const result = computeVisibility(DELIVERY_ORDER_SECTIONS, {
    perSection: { header: { fields: { logo: false } } },
  });
  assert.equal(result.fields.header.logo, false);
  assert.equal(result.fields.header.address, true); // unspecified
  assert.equal(result.fields.header.phone, true); // unspecified
});

test('computeVisibility ignores override for non-toggleable sections', () => {
  const result = computeVisibility(DELIVERY_ORDER_SECTIONS, {
    visibility: { footer: false },
  });
  assert.equal(result.visibility.footer, true);
});

test('extractColors returns defaults when sectionConfig is empty/missing', () => {
  assert.deepEqual(extractColors(undefined), { accent: '#3B82F6', text: '#111827' });
  assert.deepEqual(extractColors(null), { accent: '#3B82F6', text: '#111827' });
  assert.deepEqual(extractColors({}), { accent: '#3B82F6', text: '#111827' });
  assert.deepEqual(extractColors({ visibility: {} }), { accent: '#3B82F6', text: '#111827' });
});

test('extractColors preserves provided values', () => {
  const cfg = { colors: { accent: '#FF0000', text: '#222222' } };
  assert.deepEqual(extractColors(cfg), { accent: '#FF0000', text: '#222222' });
});

test('extractColors fills only-accent or only-text with defaults', () => {
  assert.deepEqual(
    extractColors({ colors: { accent: '#00FF00' } }),
    { accent: '#00FF00', text: '#111827' }
  );
  assert.deepEqual(
    extractColors({ colors: { text: '#888888' } }),
    { accent: '#3B82F6', text: '#888888' }
  );
});
