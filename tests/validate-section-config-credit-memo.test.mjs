import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { validateSectionConfig } from '../lib/pdf/validate-section-config.js';

test('credit_memo accepts memo_number under memo_details.fields', () => {
  const config = {
    perSection: {
      memo_details: { fields: { memo_number: false, issue_date: true, applied_date: true } },
    },
  };
  const result = validateSectionConfig(config, 'credit_memo');
  assert.equal(result.ok, true, JSON.stringify(result));
});

test('credit_memo accepts payment_instructions under notes.fields', () => {
  const config = {
    perSection: {
      notes: { fields: { payment_instructions: true, custom_notes: false } },
    },
  };
  const result = validateSectionConfig(config, 'credit_memo');
  assert.equal(result.ok, true, JSON.stringify(result));
});

test('credit_memo accepts applied_amount on applied_to_invoice ONLY (not on issued_from_invoice)', () => {
  const okConfig = {
    perSection: {
      applied_to_invoice: { fields: { applied_amount: false } },
    },
  };
  assert.equal(validateSectionConfig(okConfig, 'credit_memo').ok, true);

  const badConfig = {
    perSection: {
      issued_from_invoice: { fields: { applied_amount: false } },
    },
  };
  const result = validateSectionConfig(badConfig, 'credit_memo');
  assert.equal(result.ok, false);
  assert.match(
    result.error,
    /applied_amount/,
    `expected applied_amount field-isolation error, got: ${JSON.stringify(result)}`,
  );
});

test('credit_memo accepts total on credit_amount.fields', () => {
  const config = {
    perSection: {
      credit_amount: { fields: { total: true } },
    },
  };
  const result = validateSectionConfig(config, 'credit_memo');
  assert.equal(result.ok, true, JSON.stringify(result));
});

test('credit_memo rejects pod_details (POD-only section ID)', () => {
  const config = {
    visibility: { pod_details: false },
  };
  const result = validateSectionConfig(config, 'credit_memo');
  assert.equal(result.ok, false);
  assert.match(
    result.error,
    /pod_details/,
    `expected pod_details rejection, got: ${JSON.stringify(result)}`,
  );
});

test('credit_memo rejects open_invoices section (Statement-only)', () => {
  const config = {
    visibility: { open_invoices: true },
  };
  const result = validateSectionConfig(config, 'credit_memo');
  assert.equal(result.ok, false);
  assert.match(
    result.error,
    /open_invoices/,
    `expected open_invoices rejection, got: ${JSON.stringify(result)}`,
  );
});

test('credit_memo rejects unknown field on memo_details', () => {
  const config = {
    perSection: {
      memo_details: { fields: { fake_field: true } },
    },
  };
  const result = validateSectionConfig(config, 'credit_memo');
  assert.equal(result.ok, false);
  assert.match(
    result.error,
    /fake_field/,
    `expected fake_field rejection, got: ${JSON.stringify(result)}`,
  );
});

test('credit_memo accepts empty config (defaults)', () => {
  const result = validateSectionConfig({}, 'credit_memo');
  assert.equal(result.ok, true);
});

test('credit_memo accepts colors block', () => {
  const config = { colors: { accent: '#ff0000', text: '#222222' } };
  const result = validateSectionConfig(config, 'credit_memo');
  assert.equal(result.ok, true);
});

test('credit_memo accepts order array', () => {
  const config = {
    order: ['header', 'memo_details', 'address_details', 'reason',
            'issued_from_invoice', 'applied_to_invoice', 'credit_amount',
            'notes', 'disclaimer', 'footer'],
  };
  const result = validateSectionConfig(config, 'credit_memo');
  assert.equal(result.ok, true);
});
