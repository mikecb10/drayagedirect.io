import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import {
  DOCUMENT_TYPES,
  VALID_DOCUMENT_TYPES,
  DOCUMENT_TYPE_LABELS,
  getDocumentType,
  isValidDocumentType,
} from '../lib/constants/document-types.js';

test("'pod' is in DOCUMENT_TYPES", () => {
  const ids = DOCUMENT_TYPES.map((t) => t.value);
  assert.ok(ids.includes('pod'), `missing 'pod' in: ${ids.join(', ')}`);
});

test("getDocumentType('pod') returns category 'load', label 'Proof of Delivery'", () => {
  const entry = getDocumentType('pod');
  assert.equal(entry.value, 'pod');
  assert.equal(entry.label, 'Proof of Delivery');
  assert.equal(entry.category, 'load');  // NOT 'ar' — POD is a load-side artifact
  assert.equal(typeof entry.description, 'string');
});

test("isValidDocumentType('pod') is true", () => {
  assert.equal(isValidDocumentType('pod'), true);
  assert.ok(VALID_DOCUMENT_TYPES.includes('pod'));
  assert.equal(DOCUMENT_TYPE_LABELS['pod'], 'Proof of Delivery');
});

test('all 6 doc types now present (regression)', () => {
  const ids = DOCUMENT_TYPES.map((t) => t.value);
  assert.ok(ids.includes('delivery_order_full'));
  assert.ok(ids.includes('delivery_order_next_move'));
  assert.ok(ids.includes('invoice'));
  assert.ok(ids.includes('rate_con'));
  assert.ok(ids.includes('combined_invoice'));
  assert.ok(ids.includes('pod'));
});
