import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { validateSectionConfig } from '../lib/pdf/validate-section-config.js';

test("validator accepts bill_to=false on statement's address_details", () => {
  const r = validateSectionConfig(
    { perSection: { address_details: { fields: { bill_to: false } } } },
    'statement',
  );
  assert.equal(r.ok, true);
});

test("validator REJECTS customer=false on statement (DO-only field)", () => {
  const r = validateSectionConfig(
    { perSection: { address_details: { fields: { customer: false } } } },
    'statement',
  );
  assert.equal(r.ok, false);
  assert.match(r.error, /unknown field id/);
  assert.match(r.error, /customer/);
});

test("validator REJECTS billing_notes=false on statement's notes (Invoice-only)", () => {
  const r = validateSectionConfig(
    { perSection: { notes: { fields: { billing_notes: false } } } },
    'statement',
  );
  assert.equal(r.ok, false);
  assert.match(r.error, /billing_notes/);
});

test("validator REJECTS driver_notes=false on statement's notes (POD-only)", () => {
  const r = validateSectionConfig(
    { perSection: { notes: { fields: { driver_notes: false } } } },
    'statement',
  );
  assert.equal(r.ok, false);
  assert.match(r.error, /driver_notes/);
});

test("validator accepts statement_details.as_of_date=false", () => {
  const r = validateSectionConfig(
    { perSection: { statement_details: { fields: { as_of_date: false } } } },
    'statement',
  );
  assert.equal(r.ok, true);
});

test("validator accepts open_invoices.days_past_due=false", () => {
  const r = validateSectionConfig(
    { perSection: { open_invoices: { fields: { days_past_due: false } } } },
    'statement',
  );
  assert.equal(r.ok, true);
});

test('field-ID isolation: statement_details fields rejected on other doc types', () => {
  const payload = { perSection: { statement_details: { fields: { as_of_date: false } } } };
  assert.equal(validateSectionConfig(payload, 'statement').ok,           true);
  assert.equal(validateSectionConfig(payload, 'invoice').ok,             false);
  assert.equal(validateSectionConfig(payload, 'rate_con').ok,            false);
  assert.equal(validateSectionConfig(payload, 'combined_invoice').ok,    false);
  assert.equal(validateSectionConfig(payload, 'pod').ok,                 false);
  assert.equal(validateSectionConfig(payload, 'delivery_order_full').ok, false);
});

test('field-ID isolation: invoice_details fields rejected on statement', () => {
  const payload = { perSection: { invoice_details: { fields: { invoice_number: false } } } };
  assert.equal(validateSectionConfig(payload, 'statement').ok, false);
});

test('field-ID isolation: pod_details fields rejected on statement', () => {
  const payload = { perSection: { pod_details: { fields: { driver_name: false } } } };
  assert.equal(validateSectionConfig(payload, 'statement').ok, false);
});

test('validator accepts a full statement section_config payload', () => {
  const r = validateSectionConfig(
    {
      visibility: { open_invoices: true, aging_summary: true, notes: true },
      perSection: {
        statement_details:  { fields: { as_of_date: true, account_number: false } },
        address_details:    { fields: { bill_to: true, phone: true, email: false } },
        open_invoices:      { fields: { invoice_number: true, due_date: true, days_past_due: true, customer_reference: false, original_amount: true, balance_due: true, invoice_date: true } },
        notes:              { fields: { payment_instructions: true, custom_notes: false } },
      },
      colors: { accent: '#1e40af', text: '#222222' },
    },
    'statement',
  );
  assert.equal(r.ok, true);
});
