import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import {
  DOCUMENT_TYPES,
  VALID_DOCUMENT_TYPES,
  DOCUMENT_TYPE_LABELS,
  getDocumentType,
  isValidDocumentType,
} from '../lib/constants/document-types.js';

test("'statement' is in DOCUMENT_TYPES", () => {
  const ids = DOCUMENT_TYPES.map((t) => t.value);
  assert.ok(ids.includes('statement'), `missing 'statement' in: ${ids.join(', ')}`);
});

test("getDocumentType('statement') returns category 'ar', label 'Statement of Account'", () => {
  const entry = getDocumentType('statement');
  assert.equal(entry.value, 'statement');
  assert.equal(entry.label, 'Statement of Account');
  assert.equal(entry.category, 'ar');
  assert.equal(typeof entry.description, 'string');
});

test("isValidDocumentType('statement') is true", () => {
  assert.equal(isValidDocumentType('statement'), true);
  assert.ok(VALID_DOCUMENT_TYPES.includes('statement'));
  assert.equal(DOCUMENT_TYPE_LABELS['statement'], 'Statement of Account');
});

test('all 7 doc types now present (regression)', () => {
  const ids = DOCUMENT_TYPES.map((t) => t.value);
  assert.ok(ids.includes('delivery_order_full'));
  assert.ok(ids.includes('delivery_order_next_move'));
  assert.ok(ids.includes('invoice'));
  assert.ok(ids.includes('rate_con'));
  assert.ok(ids.includes('combined_invoice'));
  assert.ok(ids.includes('pod'));
  assert.ok(ids.includes('statement'));
});
