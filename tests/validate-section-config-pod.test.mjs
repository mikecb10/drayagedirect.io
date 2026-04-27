import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { validateSectionConfig } from '../lib/pdf/validate-section-config.js';

test("validator accepts bill_to=false on pod's address_details", () => {
  const r = validateSectionConfig(
    { perSection: { address_details: { fields: { bill_to: false } } } },
    'pod',
  );
  assert.equal(r.ok, true);
});

test("validator REJECTS customer=false on pod (DO-only field)", () => {
  const r = validateSectionConfig(
    { perSection: { address_details: { fields: { customer: false } } } },
    'pod',
  );
  assert.equal(r.ok, false);
  assert.match(r.error, /customer/);
});

test("validator REJECTS billing_notes=false on pod's notes (Invoice-only field)", () => {
  const r = validateSectionConfig(
    { perSection: { notes: { fields: { billing_notes: false } } } },
    'pod',
  );
  assert.equal(r.ok, false);
  assert.match(r.error, /billing_notes/);
});

test("validator accepts pod_details.driver_name=false", () => {
  const r = validateSectionConfig(
    { perSection: { pod_details: { fields: { driver_name: false } } } },
    'pod',
  );
  assert.equal(r.ok, true);
});

test('field-ID isolation: pod_details fields rejected on other doc types', () => {
  const payload = { perSection: { pod_details: { fields: { driver_name: false } } } };
  assert.equal(validateSectionConfig(payload, 'pod').ok,                 true);
  assert.equal(validateSectionConfig(payload, 'invoice').ok,             false);
  assert.equal(validateSectionConfig(payload, 'rate_con').ok,            false);
  assert.equal(validateSectionConfig(payload, 'combined_invoice').ok,    false);
  assert.equal(validateSectionConfig(payload, 'delivery_order_full').ok, false);
});

test('field-ID isolation: invoice_details fields rejected on pod', () => {
  const payload = { perSection: { invoice_details: { fields: { invoice_number: false } } } };
  assert.equal(validateSectionConfig(payload, 'pod').ok, false);
});

test("validator accepts a full pod section_config payload", () => {
  const r = validateSectionConfig(
    {
      visibility: { pod_details: true, move_events: true, signature: false },
      perSection: {
        pod_details:        { fields: { order_number: true, customer_reference: true, driver_name: true, delivery_date: true, delivery_time: false } },
        address_details:    { fields: { bill_to: true, pickup_location: true, delivery_location: true, return_location: false, display_pickup_for_operational_street_turns: false } },
        notes:              { fields: { driver_notes: true } },
      },
      colors: { accent: '#FF0000', text: '#222222' },
    },
    'pod',
  );
  assert.equal(r.ok, true);
});
