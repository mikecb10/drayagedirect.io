import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import {
  DOCUMENT_TYPES,
  VALID_DOCUMENT_TYPES,
  DOCUMENT_TYPE_LABELS,
  getDocumentType,
  isValidDocumentType,
} from '../lib/constants/document-types.js';

test("'credit_memo' is in DOCUMENT_TYPES", () => {
  const ids = DOCUMENT_TYPES.map((t) => t.value);
  assert.ok(ids.includes('credit_memo'), `missing 'credit_memo' in: ${ids.join(', ')}`);
});

test("getDocumentType('credit_memo') returns category 'ar', label 'Credit Memo'", () => {
  const entry = getDocumentType('credit_memo');
  assert.equal(entry.value, 'credit_memo');
  assert.equal(entry.label, 'Credit Memo');
  assert.equal(entry.category, 'ar');
  assert.equal(typeof entry.description, 'string');
});

test("isValidDocumentType('credit_memo') is true", () => {
  assert.equal(isValidDocumentType('credit_memo'), true);
  assert.ok(VALID_DOCUMENT_TYPES.includes('credit_memo'));
  assert.equal(DOCUMENT_TYPE_LABELS['credit_memo'], 'Credit Memo');
});

test('all 8 doc types now present (regression)', () => {
  const ids = DOCUMENT_TYPES.map((t) => t.value);
  assert.ok(ids.includes('delivery_order_full'));
  assert.ok(ids.includes('delivery_order_next_move'));
  assert.ok(ids.includes('invoice'));
  assert.ok(ids.includes('rate_con'));
  assert.ok(ids.includes('combined_invoice'));
  assert.ok(ids.includes('pod'));
  assert.ok(ids.includes('statement'));
  assert.ok(ids.includes('credit_memo'));
});
