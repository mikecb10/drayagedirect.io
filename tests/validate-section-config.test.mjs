import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { validateSectionConfig } from '../lib/pdf/validate-section-config.js';

const VALID_TYPE = 'delivery_order_full';

test('validateSectionConfig accepts a valid colors object', () => {
  const r = validateSectionConfig(
    { colors: { accent: '#3B82F6', text: '#111827' } },
    VALID_TYPE,
  );
  assert.equal(r.ok, true);
});

test('validateSectionConfig accepts colors with only accent or only text', () => {
  assert.equal(
    validateSectionConfig({ colors: { accent: '#FF0000' } }, VALID_TYPE).ok,
    true,
  );
  assert.equal(
    validateSectionConfig({ colors: { text: '#222222' } }, VALID_TYPE).ok,
    true,
  );
});

test('validateSectionConfig rejects non-hex colors', () => {
  const r1 = validateSectionConfig({ colors: { accent: 'red' } }, VALID_TYPE);
  assert.equal(r1.ok, false);
  assert.match(r1.error, /accent/);

  const r2 = validateSectionConfig({ colors: { text: '#FFF' } }, VALID_TYPE); // 3-char hex not allowed
  assert.equal(r2.ok, false);
  assert.match(r2.error, /text/);
});

test('validateSectionConfig rejects unknown keys inside colors', () => {
  const r = validateSectionConfig(
    { colors: { accent: '#3B82F6', bogus: '#111827' } },
    VALID_TYPE,
  );
  assert.equal(r.ok, false);
  assert.match(r.error, /unknown key in colors/);
});

test('validateSectionConfig rejects non-object colors', () => {
  assert.equal(
    validateSectionConfig({ colors: '#3B82F6' }, VALID_TYPE).ok,
    false,
  );
  assert.equal(
    validateSectionConfig({ colors: ['#3B82F6'] }, VALID_TYPE).ok,
    false,
  );
});

test('validateSectionConfig still works without colors', () => {
  assert.equal(validateSectionConfig({}, VALID_TYPE).ok, true);
  assert.equal(
    validateSectionConfig({ visibility: {} }, VALID_TYPE).ok,
    true,
  );
});

test('validateSectionConfig still rejects unknown top-level keys', () => {
  const r = validateSectionConfig({ bogus: 1 }, VALID_TYPE);
  assert.equal(r.ok, false);
  assert.match(r.error, /unknown section_config key: bogus/);
});

test('validateSectionConfig accepts valid perSection.fields keys + boolean values', () => {
  const r = validateSectionConfig(
    {
      perSection: {
        order_details: { fields: { container_number: true, seal: false } },
        header: { fields: { logo: false } },
      },
    },
    VALID_TYPE,
  );
  assert.equal(r.ok, true);
});

test('validateSectionConfig rejects unknown field id in perSection.fields', () => {
  const r = validateSectionConfig(
    {
      perSection: {
        order_details: { fields: { container_number: true, typo_field: false } },
      },
    },
    VALID_TYPE,
  );
  assert.equal(r.ok, false);
  assert.match(r.error, /unknown field id/);
  assert.match(r.error, /order_details/);
  assert.match(r.error, /typo_field/);
});

test('validateSectionConfig rejects non-boolean field value in perSection.fields', () => {
  const r = validateSectionConfig(
    {
      perSection: {
        order_details: { fields: { container_number: 'yes' } },
      },
    },
    VALID_TYPE,
  );
  assert.equal(r.ok, false);
  assert.match(r.error, /must be boolean/);
  assert.match(r.error, /container_number/);
});

test('validateSectionConfig rejects fields object on a section that has no fields registry', () => {
  // move_events is a master-toggle-only section (no `fields` array in registry)
  const r = validateSectionConfig(
    {
      perSection: {
        move_events: { fields: { whatever: true } },
      },
    },
    VALID_TYPE,
  );
  assert.equal(r.ok, false);
  assert.match(r.error, /move_events.*does not accept field/i);
});

test('validateSectionConfig allows non-fields keys in perSection (back-compat)', () => {
  // Legacy keys like move_events.show_driver should pass through untouched.
  const r = validateSectionConfig(
    {
      perSection: {
        move_events: { show_driver: true },
      },
    },
    VALID_TYPE,
  );
  assert.equal(r.ok, true);
});

test('validateSectionConfig rejects non-object perSection.fields value', () => {
  const r = validateSectionConfig(
    {
      perSection: {
        order_details: { fields: 'not an object' },
      },
    },
    VALID_TYPE,
  );
  assert.equal(r.ok, false);
  assert.match(r.error, /fields must be an object/);
});
