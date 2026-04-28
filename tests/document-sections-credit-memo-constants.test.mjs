import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import {
  CREDIT_MEMO_SECTIONS,
  SECTIONS_BY_DOCUMENT_TYPE,
  getSectionsForDocumentType,
  computeVisibility,
} from '../lib/constants/document-sections.js';

test('CREDIT_MEMO_SECTIONS entries have required keys', () => {
  for (const s of CREDIT_MEMO_SECTIONS) {
    assert.equal(typeof s.id, 'string');
    assert.equal(typeof s.label, 'string');
    assert.equal(typeof s.defaultVisible, 'boolean');
    assert.equal(typeof s.toggleable, 'boolean');
    if (s.fields) {
      assert.ok(Array.isArray(s.fields));
      for (const f of s.fields) {
        assert.equal(typeof f.id, 'string');
        assert.equal(typeof f.label, 'string');
        assert.equal(typeof f.defaultVisible, 'boolean');
      }
    }
  }
});

test('all 10 CREDIT_MEMO sections present in expected order', () => {
  const ids = CREDIT_MEMO_SECTIONS.map((s) => s.id);
  for (const id of [
    'header', 'memo_details', 'address_details',
    'reason', 'issued_from_invoice', 'applied_to_invoice',
    'credit_amount', 'notes', 'disclaimer', 'footer',
  ]) {
    assert.ok(ids.includes(id), `missing CREDIT_MEMO section: ${id}`);
  }
  assert.equal(CREDIT_MEMO_SECTIONS.length, 10);
});

test('footer is non-toggleable on Credit Memo', () => {
  const footer = CREDIT_MEMO_SECTIONS.find((s) => s.id === 'footer');
  assert.equal(footer.toggleable, false);
});

test('notes and disclaimer default OFF on Credit Memo', () => {
  for (const id of ['notes', 'disclaimer']) {
    const s = CREDIT_MEMO_SECTIONS.find((x) => x.id === id);
    assert.equal(s.defaultVisible, false, `${id} should default off`);
  }
});

test('memo_details, reason, issued_from_invoice, applied_to_invoice, credit_amount default ON', () => {
  for (const id of ['memo_details', 'reason', 'issued_from_invoice', 'applied_to_invoice', 'credit_amount']) {
    const s = CREDIT_MEMO_SECTIONS.find((x) => x.id === id);
    assert.equal(s.defaultVisible, true, `${id} should default on`);
  }
});

test('memo_details has 3 fields including applied_date', () => {
  const s = CREDIT_MEMO_SECTIONS.find((x) => x.id === 'memo_details');
  const fieldIds = s.fields.map((f) => f.id);
  for (const id of ['memo_number', 'issue_date', 'applied_date']) {
    assert.ok(fieldIds.includes(id), `missing memo_details field: ${id}`);
  }
  assert.equal(fieldIds.length, 3);
});

test('address_details uses bill_to (NOT customer)', () => {
  const s = CREDIT_MEMO_SECTIONS.find((x) => x.id === 'address_details');
  const fieldIds = s.fields.map((f) => f.id);
  assert.ok(fieldIds.includes('bill_to'), 'bill_to required');
  assert.ok(!fieldIds.includes('customer'), 'customer should NOT exist on credit_memo (DO-only)');
  assert.equal(fieldIds.length, 3);  // bill_to + phone + email
});

test('reason has no fields (master-toggle only)', () => {
  const s = CREDIT_MEMO_SECTIONS.find((x) => x.id === 'reason');
  assert.equal(s.fields, undefined, 'reason should not have fields array');
});

test('issued_from_invoice has 4 fields', () => {
  const s = CREDIT_MEMO_SECTIONS.find((x) => x.id === 'issued_from_invoice');
  const fieldIds = s.fields.map((f) => f.id);
  for (const id of ['invoice_number', 'invoice_date', 'due_date', 'total']) {
    assert.ok(fieldIds.includes(id), `missing issued_from_invoice field: ${id}`);
  }
  assert.equal(fieldIds.length, 4);
});

test('applied_to_invoice has 5 fields including applied_amount', () => {
  const s = CREDIT_MEMO_SECTIONS.find((x) => x.id === 'applied_to_invoice');
  const fieldIds = s.fields.map((f) => f.id);
  for (const id of ['invoice_number', 'invoice_date', 'balance_due', 'applied_amount', 'applied_date']) {
    assert.ok(fieldIds.includes(id), `missing applied_to_invoice field: ${id}`);
  }
  assert.equal(fieldIds.length, 5);
});

test('credit_amount has 1 field (total)', () => {
  const s = CREDIT_MEMO_SECTIONS.find((x) => x.id === 'credit_amount');
  const fieldIds = s.fields.map((f) => f.id);
  assert.ok(fieldIds.includes('total'));
  assert.equal(fieldIds.length, 1);
});

test('notes has payment_instructions + custom_notes fields', () => {
  const s = CREDIT_MEMO_SECTIONS.find((x) => x.id === 'notes');
  const fieldIds = s.fields.map((f) => f.id);
  assert.ok(fieldIds.includes('payment_instructions'));
  assert.ok(fieldIds.includes('custom_notes'));
  assert.equal(fieldIds.length, 2);
});

test('SECTIONS_BY_DOCUMENT_TYPE wired for credit_memo', () => {
  assert.equal(SECTIONS_BY_DOCUMENT_TYPE.credit_memo, CREDIT_MEMO_SECTIONS);
  assert.equal(getSectionsForDocumentType('credit_memo'), CREDIT_MEMO_SECTIONS);
});

test('computeVisibility default for Credit Memo', () => {
  const result = computeVisibility(CREDIT_MEMO_SECTIONS, null);
  assert.equal(result.visibility.notes, false);
  assert.equal(result.visibility.disclaimer, false);
  assert.equal(result.visibility.memo_details, true);
  assert.equal(result.visibility.reason, true);
  assert.equal(result.visibility.issued_from_invoice, true);
  assert.equal(result.visibility.applied_to_invoice, true);
  assert.equal(result.visibility.credit_amount, true);
  assert.equal(result.visibility.footer, true);  // non-toggleable always on
});
