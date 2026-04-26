import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import {
  DELIVERY_ORDER_SECTIONS,
  SECTIONS_BY_DOCUMENT_TYPE,
  getSectionsForDocumentType,
  computeVisibility,
} from '../lib/constants/document-sections.js';

test('DELIVERY_ORDER_SECTIONS has all entries with required fields', () => {
  for (const s of DELIVERY_ORDER_SECTIONS) {
    assert.equal(typeof s.id, 'string', `missing id: ${JSON.stringify(s)}`);
    assert.equal(typeof s.label, 'string', `missing label: ${s.id}`);
    assert.equal(typeof s.defaultVisible, 'boolean', `defaultVisible: ${s.id}`);
    assert.equal(typeof s.toggleable, 'boolean', `toggleable: ${s.id}`);
  }
});

test('move_block, load_metadata, footer are non-toggleable on Delivery Order', () => {
  const byId = Object.fromEntries(DELIVERY_ORDER_SECTIONS.map((s) => [s.id, s]));
  assert.equal(byId.move_block.toggleable, false);
  assert.equal(byId.load_metadata.toggleable, false);
  assert.equal(byId.footer.toggleable, false);
});

test('getSectionsForDocumentType returns the registry for both variants', () => {
  assert.equal(
    getSectionsForDocumentType('delivery_order_full'),
    DELIVERY_ORDER_SECTIONS
  );
  assert.equal(
    getSectionsForDocumentType('delivery_order_next_move'),
    DELIVERY_ORDER_SECTIONS
  );
});

test('getSectionsForDocumentType returns [] for unknown types', () => {
  assert.deepEqual(getSectionsForDocumentType('not_a_type'), []);
});

test('computeVisibility uses defaults when no config provided', () => {
  const v = computeVisibility(DELIVERY_ORDER_SECTIONS, undefined);
  assert.equal(v.bill_to, true);
  assert.equal(v.signature_block, false); // defaultVisible: false
  assert.equal(v.move_block, true); // non-toggleable, always true
});

test('computeVisibility honors override for toggleable sections', () => {
  const v = computeVisibility(DELIVERY_ORDER_SECTIONS, {
    visibility: { bill_to: false, signature_block: true },
  });
  assert.equal(v.bill_to, false);
  assert.equal(v.signature_block, true);
});

test('computeVisibility ignores override on non-toggleable sections', () => {
  const v = computeVisibility(DELIVERY_ORDER_SECTIONS, {
    visibility: { move_block: false }, // attempt to hide load-bearing section
  });
  assert.equal(v.move_block, true); // still on
});
