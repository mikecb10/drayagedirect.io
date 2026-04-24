import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import {
  hashPassword,
  verifyPassword,
  signDriverJWT,
  verifyDriverJWT,
  generateTempPassword,
  TOKEN_TTL_DAYS,
} from '../lib/driver-auth/utils.js';

const TEST_SECRET = 'test-secret-do-not-use-in-prod';

test('hashPassword + verifyPassword round-trip', async () => {
  const hash = await hashPassword('correct-horse');
  assert.ok(hash.startsWith('$2'));
  assert.equal(await verifyPassword('correct-horse', hash), true);
  assert.equal(await verifyPassword('battery-staple', hash), false);
});

test('signDriverJWT + verifyDriverJWT round-trip', async () => {
  const token = signDriverJWT(
    { driverId: 'd1', tenantId: 't1' },
    TEST_SECRET,
  );
  assert.equal(typeof token, 'string');
  const claims = verifyDriverJWT(token, TEST_SECRET);
  assert.equal(claims.driverId, 'd1');
  assert.equal(claims.tenantId, 't1');
  assert.equal(typeof claims.iat, 'number');
  assert.equal(typeof claims.exp, 'number');
  assert.ok(claims.exp - claims.iat >= TOKEN_TTL_DAYS * 86400 - 1);
});

test('verifyDriverJWT rejects tampered token', async () => {
  const token = signDriverJWT({ driverId: 'd1', tenantId: 't1' }, TEST_SECRET);
  const parts = token.split('.');
  parts[2] = parts[2].slice(0, -2) + 'AA';
  assert.throws(() => verifyDriverJWT(parts.join('.'), TEST_SECRET));
});

test('verifyDriverJWT rejects token signed with different secret', () => {
  const token = signDriverJWT({ driverId: 'd1', tenantId: 't1' }, TEST_SECRET);
  assert.throws(() => verifyDriverJWT(token, 'different-secret'));
});

test('generateTempPassword produces 8-char alphanumeric', () => {
  const p = generateTempPassword();
  assert.equal(p.length, 8);
  assert.match(p, /^[A-Za-z0-9]+$/);
});
