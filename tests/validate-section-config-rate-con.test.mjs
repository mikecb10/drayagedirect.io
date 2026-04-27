import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { validateSectionConfig } from '../lib/pdf/validate-section-config.js';

test("validator accepts pickup_location=false on rate_con's address_details", () => {
  const r = validateSectionConfig(
    { perSection: { address_details: { fields: { pickup_location: false } } } },
    'rate_con',
  );
  assert.equal(r.ok, true);
});

test("validator REJECTS bill_to=false on rate_con (Invoice-only field)", () => {
  const r = validateSectionConfig(
    { perSection: { address_details: { fields: { bill_to: false } } } },
    'rate_con',
  );
  assert.equal(r.ok, false);
  assert.match(r.error, /unknown field id/);
  assert.match(r.error, /bill_to/);
});

test("validator REJECTS customer=false on rate_con (DO-only field)", () => {
  const r = validateSectionConfig(
    { perSection: { address_details: { fields: { customer: false } } } },
    'rate_con',
  );
  assert.equal(r.ok, false);
  assert.match(r.error, /unknown field id/);
  assert.match(r.error, /customer/);
});

test("validator REJECTS billing_notes=false on rate_con (Invoice-only field)", () => {
  const r = validateSectionConfig(
    { perSection: { notes: { fields: { billing_notes: false } } } },
    'rate_con',
  );
  assert.equal(r.ok, false);
  assert.match(r.error, /billing_notes/);
});

test('field-ID isolation: customer accepted on DO, REJECTED on rate_con', () => {
  const payload = { perSection: { address_details: { fields: { customer: false } } } };
  assert.equal(validateSectionConfig(payload, 'delivery_order_full').ok, true);
  assert.equal(validateSectionConfig(payload, 'rate_con').ok,            false);
});

test('field-ID isolation: bill_to accepted on Invoice, REJECTED on rate_con', () => {
  const payload = { perSection: { address_details: { fields: { bill_to: false } } } };
  assert.equal(validateSectionConfig(payload, 'invoice').ok,  true);
  assert.equal(validateSectionConfig(payload, 'rate_con').ok, false);
});

test('field-ID isolation: rate_con_details fields accepted on rate_con only', () => {
  const payload = { perSection: { rate_con_details: { fields: { confirmation_number: false } } } };
  assert.equal(validateSectionConfig(payload, 'rate_con').ok,            true);
  assert.equal(validateSectionConfig(payload, 'invoice').ok,             false);
  assert.equal(validateSectionConfig(payload, 'delivery_order_full').ok, false);
});

test("validator accepts a full rate_con section_config payload", () => {
  const r = validateSectionConfig(
    {
      visibility: { rate_con_details: true, move_events: false, signature: false },
      perSection: {
        charge_details: { fields: { charge_name: true, units: true, rates: false, charges: true } },
        notes:          { fields: { driver_notes: true, load_notes: false } },
      },
      colors: { accent: '#FF0000', text: '#222222' },
    },
    'rate_con',
  );
  assert.equal(r.ok, true);
});
