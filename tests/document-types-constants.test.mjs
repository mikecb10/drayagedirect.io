import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import {
  DOCUMENT_TYPES,
  VALID_DOCUMENT_TYPES,
  DOCUMENT_TYPE_LABELS,
  getDocumentType,
  isValidDocumentType,
} from '../lib/constants/document-types.js';

test('DOCUMENT_TYPES contains all 7 registered doc types', () => {
  const values = DOCUMENT_TYPES.map((t) => t.value).sort();
  assert.deepEqual(values, ['combined_invoice', 'delivery_order_full', 'delivery_order_next_move', 'invoice', 'pod', 'rate_con', 'statement']);
});

test('every DOCUMENT_TYPES entry has required fields', () => {
  for (const t of DOCUMENT_TYPES) {
    assert.equal(typeof t.value, 'string', `missing value: ${JSON.stringify(t)}`);
    assert.equal(typeof t.label, 'string', `missing label: ${t.value}`);
    assert.equal(typeof t.description, 'string', `missing description: ${t.value}`);
    assert.equal(typeof t.category, 'string', `missing category: ${t.value}`);
  }
});

test('VALID_DOCUMENT_TYPES is the value list', () => {
  assert.deepEqual(
    VALID_DOCUMENT_TYPES.sort(),
    DOCUMENT_TYPES.map((t) => t.value).sort()
  );
});

test('DOCUMENT_TYPE_LABELS maps value -> label', () => {
  for (const t of DOCUMENT_TYPES) {
    assert.equal(DOCUMENT_TYPE_LABELS[t.value], t.label);
  }
});

test('getDocumentType finds known types and returns null for unknown', () => {
  assert.equal(getDocumentType('delivery_order_full').value, 'delivery_order_full');
  assert.equal(getDocumentType('does_not_exist'), null);
});

test('isValidDocumentType true/false', () => {
  assert.equal(isValidDocumentType('delivery_order_full'), true);
  assert.equal(isValidDocumentType('delivery_order_next_move'), true);
  assert.equal(isValidDocumentType('not_a_type'), false);
  assert.equal(isValidDocumentType(null), false);
  assert.equal(isValidDocumentType(undefined), false);
  assert.equal(isValidDocumentType(''), false);
});
