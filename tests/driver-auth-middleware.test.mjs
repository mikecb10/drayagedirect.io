import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { signDriverJWT } from '../lib/driver-auth/utils.js';
import { requireDriver, __setServiceClientForTesting } from '../lib/driver-auth/middleware.js';

const SECRET = 'test-secret';
process.env.DRIVER_JWT_SECRET = SECRET;

function makeRes() {
  const r = { _status: null, _body: null };
  r.status = (s) => { r._status = s; return r; };
  r.json = (b) => { r._body = b; return r; };
  return r;
}

function makeMockSvc(driverRow) {
  return {
    from: (table) => ({
      select: () => ({
        eq: () => ({
          eq: () => ({
            is: () => ({
              maybeSingle: () => Promise.resolve({ data: driverRow, error: null }),
            }),
          }),
        }),
      }),
    }),
  };
}

test('requireDriver returns 401 when Authorization header missing', async () => {
  __setServiceClientForTesting(makeMockSvc(null));
  const req = { headers: {} };
  const res = makeRes();
  const result = await requireDriver(req, res);
  assert.equal(result, null);
  assert.equal(res._status, 401);
});

test('requireDriver returns 401 on invalid JWT', async () => {
  __setServiceClientForTesting(makeMockSvc(null));
  const req = { headers: { authorization: 'Bearer not.a.jwt' } };
  const res = makeRes();
  const result = await requireDriver(req, res);
  assert.equal(result, null);
  assert.equal(res._status, 401);
});

test('requireDriver returns 401 when driver not found', async () => {
  __setServiceClientForTesting(makeMockSvc(null));
  const token = signDriverJWT({ driverId: 'd1', tenantId: 't1' }, SECRET);
  const req = { headers: { authorization: `Bearer ${token}` } };
  const res = makeRes();
  const result = await requireDriver(req, res);
  assert.equal(result, null);
  assert.equal(res._status, 401);
});

test('requireDriver returns 401 when JWT iat < session_min_iat', async () => {
  // Sign a token with an iat in the past
  const oldToken = signDriverJWT({ driverId: 'd1', tenantId: 't1' }, SECRET);
  const futureMinIat = new Date(Date.now() + 86400 * 1000).toISOString();
  __setServiceClientForTesting(makeMockSvc({
    id: 'd1', tenant_id: 't1', status: 'active',
    session_min_iat: futureMinIat,
    location_tracking_enabled: true,
  }));
  const req = { headers: { authorization: `Bearer ${oldToken}` } };
  const res = makeRes();
  const result = await requireDriver(req, res);
  assert.equal(result, null);
  assert.equal(res._status, 401);
});

test('requireDriver returns ctx on valid token + active driver', async () => {
  __setServiceClientForTesting(makeMockSvc({
    id: 'd1', tenant_id: 't1', name: 'Test Driver', username: 'tdriver',
    status: 'active',
    session_min_iat: '2020-01-01T00:00:00Z',
    location_tracking_enabled: true,
    password_must_change: false,
    tracking_consented_at: null,
    tracking_consent_version: null,
    tracking_revoked_at: null,
  }));
  const token = signDriverJWT({ driverId: 'd1', tenantId: 't1' }, SECRET);
  const req = { headers: { authorization: `Bearer ${token}` } };
  const res = makeRes();
  const result = await requireDriver(req, res);
  assert.ok(result, 'expected non-null ctx');
  assert.equal(result.driverId, 'd1');
  assert.equal(result.tenantId, 't1');
  assert.equal(result.driver.status, 'active');
});

test('requireDriver returns 401 when driver status is not active', async () => {
  __setServiceClientForTesting(makeMockSvc({
    id: 'd1', tenant_id: 't1', status: 'inactive',
    session_min_iat: '2020-01-01T00:00:00Z',
  }));
  const token = signDriverJWT({ driverId: 'd1', tenantId: 't1' }, SECRET);
  const req = { headers: { authorization: `Bearer ${token}` } };
  const res = makeRes();
  const result = await requireDriver(req, res);
  assert.equal(result, null);
  assert.equal(res._status, 401);
});
