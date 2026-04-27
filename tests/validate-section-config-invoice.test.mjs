import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { validateSectionConfig } from '../lib/pdf/validate-section-config.js';

test("validator accepts bill_to=false on Invoice's address_details", () => {
  const r = validateSectionConfig(
    { perSection: { address_details: { fields: { bill_to: false } } } },
    'invoice',
  );
  assert.equal(r.ok, true);
});

test("validator REJECTS customer=false on Invoice (no such field in INVOICE_SECTIONS)", () => {
  const r = validateSectionConfig(
    { perSection: { address_details: { fields: { customer: false } } } },
    'invoice',
  );
  assert.equal(r.ok, false);
  assert.match(r.error, /unknown field id/);
  assert.match(r.error, /customer/);
});

test("validator REJECTS free_units on Invoice's charge_details (FU-112 enforcement)", () => {
  const r = validateSectionConfig(
    { perSection: { charge_details: { fields: { free_units: false } } } },
    'invoice',
  );
  assert.equal(r.ok, false);
  assert.match(r.error, /free_units/);
});

test("validator REJECTS hours on Invoice's charge_details", () => {
  const r = validateSectionConfig(
    { perSection: { charge_details: { fields: { hours: false } } } },
    'invoice',
  );
  assert.equal(r.ok, false);
  assert.match(r.error, /hours/);
});

test("validator REJECTS yard_notes on Invoice's notes (no data source)", () => {
  const r = validateSectionConfig(
    { perSection: { notes: { fields: { yard_notes: false } } } },
    'invoice',
  );
  assert.equal(r.ok, false);
  assert.match(r.error, /yard_notes/);
});

test('field-ID isolation: customer accepted on DO, REJECTED on Invoice', () => {
  const payload = { perSection: { address_details: { fields: { customer: false } } } };
  assert.equal(validateSectionConfig(payload, 'delivery_order_full').ok, true);
  assert.equal(validateSectionConfig(payload, 'invoice').ok,             false);
});

test('field-ID isolation: bill_to accepted on Invoice, REJECTED on DO', () => {
  const payload = { perSection: { address_details: { fields: { bill_to: false } } } };
  assert.equal(validateSectionConfig(payload, 'invoice').ok,             true);
  assert.equal(validateSectionConfig(payload, 'delivery_order_full').ok, false);
});

test("validator accepts a full Invoice section_config payload", () => {
  const r = validateSectionConfig(
    {
      visibility: { invoice_details: true, move_events: false },
      perSection: {
        charge_details: { fields: { charge_name: true, units: true, rates: false, charges: true } },
        notes:          { fields: { driver_notes: false, billing_notes: true, load_notes: true } },
      },
      colors: { accent: '#FF0000', text: '#222222' },
    },
    'invoice',
  );
  assert.equal(r.ok, true);
});
