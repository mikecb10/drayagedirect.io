import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import {
  DOCUMENT_TYPES,
  VALID_DOCUMENT_TYPES,
  DOCUMENT_TYPE_LABELS,
  getDocumentType,
  isValidDocumentType,
} from '../lib/constants/document-types.js';

test("'invoice' is in DOCUMENT_TYPES", () => {
  const ids = DOCUMENT_TYPES.map((t) => t.value);
  assert.ok(ids.includes('invoice'), `missing 'invoice' in: ${ids.join(', ')}`);
});

test("getDocumentType('invoice') returns the entry with category 'ar'", () => {
  const entry = getDocumentType('invoice');
  assert.equal(entry.value, 'invoice');
  assert.equal(entry.label, 'Invoice');
  assert.equal(entry.category, 'ar');
  assert.equal(typeof entry.description, 'string');
});

test("isValidDocumentType('invoice') is true", () => {
  assert.equal(isValidDocumentType('invoice'), true);
  assert.ok(VALID_DOCUMENT_TYPES.includes('invoice'));
  assert.equal(DOCUMENT_TYPE_LABELS['invoice'], 'Invoice');
});

test("existing DO doc types still present (regression)", () => {
  const ids = DOCUMENT_TYPES.map((t) => t.value);
  assert.ok(ids.includes('delivery_order_full'));
  assert.ok(ids.includes('delivery_order_next_move'));
});
