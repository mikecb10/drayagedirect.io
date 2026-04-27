import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import {
  STATEMENT_SECTIONS,
  SECTIONS_BY_DOCUMENT_TYPE,
  getSectionsForDocumentType,
  computeVisibility,
} from '../lib/constants/document-sections.js';

test('STATEMENT_SECTIONS entries have required keys', () => {
  for (const s of STATEMENT_SECTIONS) {
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

test('all 9 STATEMENT sections present in expected order', () => {
  const ids = STATEMENT_SECTIONS.map((s) => s.id);
  for (const id of [
    'header', 'statement_details', 'address_details',
    'open_invoices', 'aging_summary', 'total_outstanding',
    'notes', 'disclaimer', 'footer',
  ]) {
    assert.ok(ids.includes(id), `missing STATEMENT section: ${id}`);
  }
  assert.equal(STATEMENT_SECTIONS.length, 9);
});

test('footer is non-toggleable on Statement', () => {
  const footer = STATEMENT_SECTIONS.find((s) => s.id === 'footer');
  assert.equal(footer.toggleable, false);
});

test('notes and disclaimer default OFF on Statement', () => {
  for (const id of ['notes', 'disclaimer']) {
    const s = STATEMENT_SECTIONS.find((x) => x.id === id);
    assert.equal(s.defaultVisible, false, `${id} should default off`);
  }
});

test('aging_summary, open_invoices, total_outstanding default ON', () => {
  for (const id of ['aging_summary', 'open_invoices', 'total_outstanding']) {
    const s = STATEMENT_SECTIONS.find((x) => x.id === id);
    assert.equal(s.defaultVisible, true, `${id} should default on`);
  }
});

test('statement_details has 2 fields', () => {
  const s = STATEMENT_SECTIONS.find((x) => x.id === 'statement_details');
  const fieldIds = s.fields.map((f) => f.id);
  for (const id of ['as_of_date', 'account_number']) {
    assert.ok(fieldIds.includes(id), `missing statement_details field: ${id}`);
  }
  assert.equal(fieldIds.length, 2);
});

test('address_details uses bill_to (NOT customer)', () => {
  const s = STATEMENT_SECTIONS.find((x) => x.id === 'address_details');
  const fieldIds = s.fields.map((f) => f.id);
  assert.ok(fieldIds.includes('bill_to'), 'bill_to required');
  assert.ok(!fieldIds.includes('customer'), 'customer should NOT exist on statement (DO-only)');
  assert.equal(fieldIds.length, 3);  // bill_to + phone + email
});

test('open_invoices has 7 fields', () => {
  const s = STATEMENT_SECTIONS.find((x) => x.id === 'open_invoices');
  const fieldIds = s.fields.map((f) => f.id);
  for (const id of [
    'invoice_number', 'invoice_date', 'due_date',
    'days_past_due', 'customer_reference',
    'original_amount', 'balance_due',
  ]) {
    assert.ok(fieldIds.includes(id), `missing open_invoices field: ${id}`);
  }
  assert.equal(fieldIds.length, 7);
});

test('aging_summary has no fields (master toggle only)', () => {
  const s = STATEMENT_SECTIONS.find((x) => x.id === 'aging_summary');
  assert.equal(s.fields, undefined);
});

test('disclaimer has no fields (master toggle only)', () => {
  const s = STATEMENT_SECTIONS.find((x) => x.id === 'disclaimer');
  assert.equal(s.fields, undefined);
});

test('notes has payment_instructions + custom_notes (NOT driver/billing/load notes)', () => {
  const s = STATEMENT_SECTIONS.find((x) => x.id === 'notes');
  const fieldIds = s.fields.map((f) => f.id);
  assert.ok(fieldIds.includes('payment_instructions'));
  assert.ok(fieldIds.includes('custom_notes'));
  assert.ok(!fieldIds.includes('driver_notes'));
  assert.ok(!fieldIds.includes('billing_notes'));
  assert.ok(!fieldIds.includes('load_notes'));
  assert.equal(fieldIds.length, 2);
});

test("getSectionsForDocumentType('statement') returns STATEMENT_SECTIONS", () => {
  assert.equal(getSectionsForDocumentType('statement'), STATEMENT_SECTIONS);
});

test('computeVisibility honors STATEMENT_SECTIONS defaults with no config', () => {
  const result = computeVisibility(STATEMENT_SECTIONS, undefined);
  assert.equal(result.visibility.header, true);
  assert.equal(result.visibility.statement_details, true);
  assert.equal(result.visibility.open_invoices, true);
  assert.equal(result.visibility.aging_summary, true);
  assert.equal(result.visibility.total_outstanding, true);
  assert.equal(result.visibility.notes, false);
  assert.equal(result.visibility.disclaimer, false);
  assert.equal(result.visibility.footer, true);
  assert.equal(result.fields.statement_details.as_of_date, true);
  assert.equal(result.fields.open_invoices.balance_due, true);
});
