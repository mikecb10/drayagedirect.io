import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { coerceBool, coerceInt } from '../lib/utils/coerce.js';

test('coerceBool — true/false booleans pass through', () => {
  assert.equal(coerceBool(true, false), true);
  assert.equal(coerceBool(false, true), false);
});

test('coerceBool — string "true" / "false" parse correctly', () => {
  assert.equal(coerceBool('true', false), true);
  assert.equal(coerceBool('false', true), false);  // THE BUG FIX
  assert.equal(coerceBool('TRUE', false), true);
  assert.equal(coerceBool('FALSE', true), false);
  assert.equal(coerceBool(' true ', false), true);  // whitespace tolerated
});

test('coerceBool — null/undefined return fallback', () => {
  assert.equal(coerceBool(null, true), true);
  assert.equal(coerceBool(undefined, false), false);
});

test('coerceBool — numeric/other coerces via Boolean()', () => {
  assert.equal(coerceBool(1, false), true);
  assert.equal(coerceBool(0, true), false);
  assert.equal(coerceBool('', true), Boolean(''));  // empty string is falsy
});

test('coerceInt — integers pass through', () => {
  assert.equal(coerceInt(42, 0), 42);
  assert.equal(coerceInt(0, 99), 0);
});

test('coerceInt — string digits parse', () => {
  assert.equal(coerceInt('42', 0), 42);
  assert.equal(coerceInt('-7', 0), -7);
});

test('coerceInt — non-integer returns fallback', () => {
  assert.equal(coerceInt('abc', 99), 99);
  assert.equal(coerceInt(null, 99), 99);
  assert.equal(coerceInt(undefined, 99), 99);
  assert.equal(coerceInt(NaN, 99), 99);
});

test('coerceInt — float string parses to int via parseInt', () => {
  assert.equal(coerceInt('42.7', 0), 42);  // parseInt strips decimal
});
