import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import {
  DOCUMENT_TYPES,
  VALID_DOCUMENT_TYPES,
  DOCUMENT_TYPE_LABELS,
  getDocumentType,
  isValidDocumentType,
} from '../lib/constants/document-types.js';

test("'combined_invoice' is in DOCUMENT_TYPES", () => {
  const ids = DOCUMENT_TYPES.map((t) => t.value);
  assert.ok(ids.includes('combined_invoice'), `missing 'combined_invoice' in: ${ids.join(', ')}`);
});

test("getDocumentType('combined_invoice') returns category 'ar', label 'Combined Invoice'", () => {
  const entry = getDocumentType('combined_invoice');
  assert.equal(entry.value, 'combined_invoice');
  assert.equal(entry.label, 'Combined Invoice');
  assert.equal(entry.category, 'ar');
  assert.equal(typeof entry.description, 'string');
});

test("isValidDocumentType('combined_invoice') is true", () => {
  assert.equal(isValidDocumentType('combined_invoice'), true);
  assert.ok(VALID_DOCUMENT_TYPES.includes('combined_invoice'));
  assert.equal(DOCUMENT_TYPE_LABELS['combined_invoice'], 'Combined Invoice');
});

test('all 5 doc types now present (regression)', () => {
  const ids = DOCUMENT_TYPES.map((t) => t.value);
  assert.ok(ids.includes('delivery_order_full'));
  assert.ok(ids.includes('delivery_order_next_move'));
  assert.ok(ids.includes('invoice'));
  assert.ok(ids.includes('rate_con'));
  assert.ok(ids.includes('combined_invoice'));
});
