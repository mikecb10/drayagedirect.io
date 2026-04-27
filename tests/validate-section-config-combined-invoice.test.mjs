import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { validateSectionConfig } from '../lib/pdf/validate-section-config.js';

test("validator accepts bill_to=false on combined_invoice's address_details", () => {
  const r = validateSectionConfig(
    { perSection: { address_details: { fields: { bill_to: false } } } },
    'combined_invoice',
  );
  assert.equal(r.ok, true);
});

test("validator REJECTS pickup_location=false on combined_invoice (Invoice/Rate-Con-only field)", () => {
  const r = validateSectionConfig(
    { perSection: { address_details: { fields: { pickup_location: false } } } },
    'combined_invoice',
  );
  assert.equal(r.ok, false);
  assert.match(r.error, /unknown field id/);
  assert.match(r.error, /pickup_location/);
});

test("validator REJECTS customer=false on combined_invoice (DO-only field)", () => {
  const r = validateSectionConfig(
    { perSection: { address_details: { fields: { customer: false } } } },
    'combined_invoice',
  );
  assert.equal(r.ok, false);
  assert.match(r.error, /customer/);
});

test("validator REJECTS driver_notes=false on combined_invoice's notes", () => {
  const r = validateSectionConfig(
    { perSection: { notes: { fields: { driver_notes: false } } } },
    'combined_invoice',
  );
  assert.equal(r.ok, false);
  assert.match(r.error, /driver_notes/);
});

test("validator accepts loads_summary fields on combined_invoice", () => {
  const r = validateSectionConfig(
    { perSection: { loads_summary: { fields: { container_number: false, chassis_number: true } } } },
    'combined_invoice',
  );
  assert.equal(r.ok, true);
});

test('field-ID isolation: loads_summary.fields rejected on Invoice / Rate Con / DO', () => {
  const payload = { perSection: { loads_summary: { fields: { load_number: false } } } };
  assert.equal(validateSectionConfig(payload, 'combined_invoice').ok,    true);
  assert.equal(validateSectionConfig(payload, 'invoice').ok,             false);
  assert.equal(validateSectionConfig(payload, 'rate_con').ok,            false);
  assert.equal(validateSectionConfig(payload, 'delivery_order_full').ok, false);
});

test("validator accepts a full combined_invoice section_config payload", () => {
  const r = validateSectionConfig(
    {
      visibility: { invoice_details: true, loads_summary: true, disclaimer: false },
      perSection: {
        loads_summary:   { fields: { load_number: true, container_number: true, chassis_number: false, pickup_location: true, delivery_location: true, pickup_date: true, delivery_date: true } },
        charge_details:  { fields: { charge_name: true, units: true, rates: true, charges: true } },
        notes:           { fields: { billing_notes: true } },
      },
      colors: { accent: '#FF0000', text: '#222222' },
    },
    'combined_invoice',
  );
  assert.equal(r.ok, true);
});
