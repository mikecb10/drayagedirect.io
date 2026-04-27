import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import {
  DOCUMENT_TYPES,
  VALID_DOCUMENT_TYPES,
  DOCUMENT_TYPE_LABELS,
  getDocumentType,
  isValidDocumentType,
} from '../lib/constants/document-types.js';

test("'rate_con' is in DOCUMENT_TYPES", () => {
  const ids = DOCUMENT_TYPES.map((t) => t.value);
  assert.ok(ids.includes('rate_con'), `missing 'rate_con' in: ${ids.join(', ')}`);
});

test("getDocumentType('rate_con') returns category 'ar', label 'Rate Confirmation'", () => {
  const entry = getDocumentType('rate_con');
  assert.equal(entry.value, 'rate_con');
  assert.equal(entry.label, 'Rate Confirmation');
  assert.equal(entry.category, 'ar');
  assert.equal(typeof entry.description, 'string');
});

test("isValidDocumentType('rate_con') is true", () => {
  assert.equal(isValidDocumentType('rate_con'), true);
  assert.ok(VALID_DOCUMENT_TYPES.includes('rate_con'));
  assert.equal(DOCUMENT_TYPE_LABELS['rate_con'], 'Rate Confirmation');
});

test('all 4 doc types now present (regression)', () => {
  const ids = DOCUMENT_TYPES.map((t) => t.value);
  assert.ok(ids.includes('delivery_order_full'));
  assert.ok(ids.includes('delivery_order_next_move'));
  assert.ok(ids.includes('invoice'));
  assert.ok(ids.includes('rate_con'));
});
