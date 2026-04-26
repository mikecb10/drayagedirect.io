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
