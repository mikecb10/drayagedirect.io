// tests/google-maps-server-distance.test.mjs
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import {
  buildCacheKey,
  recomputeETA,
  __resetCacheForTesting,
} from '../lib/google-maps/server-distance.js';

test('buildCacheKey rounds lat/lng to 3 decimals (~111m grid)', () => {
  const k = buildCacheKey({
    origin: { lat: 37.123456, lng: -122.987654 },
    destination: { lat: 37.555111, lng: -122.444222, eventId: 'evt-1' },
  });
  assert.equal(k, '37.123,-122.988|37.555,-122.444|evt-1');
});

test('buildCacheKey same key for tiny lat/lng deltas', () => {
  // Plan-as-written used inputs (37.1234 / 37.1238) that straddle the
  // 3-decimal rounding boundary at .1235, producing DIFFERENT keys and
  // contradicting the test name. Adjusted to inputs that genuinely
  // round to the same 3-decimal grid (the test's intent).
  const k1 = buildCacheKey({
    origin: { lat: 37.1231, lng: -122.9878 },
    destination: { lat: 37.5552, lng: -122.4443, eventId: 'evt-1' },
  });
  const k2 = buildCacheKey({
    origin: { lat: 37.1233, lng: -122.9876 },
    destination: { lat: 37.5554, lng: -122.4441, eventId: 'evt-1' },
  });
  assert.equal(k1, k2);
});

test('recomputeETA rejects when recomputeCount >= 50', async () => {
  __resetCacheForTesting();
  const result = await recomputeETA({
    origin: { lat: 37.1, lng: -122.5 },
    destination: { lat: 37.5, lng: -122.4, eventId: 'evt-1' },
    recomputeCount: 50,
  });
  assert.equal(result.skipped, true);
  assert.equal(result.reason, 'cost_cap_reached');
});

test('recomputeETA returns cached on second call within TTL', async () => {
  __resetCacheForTesting();
  let fetchCount = 0;
  const mockFetch = async () => {
    fetchCount++;
    return {
      ok: true,
      json: async () => ({
        rows: [{ elements: [{ status: 'OK', duration_in_traffic: { value: 1800 }, distance: { value: 16093 } }] }],
      }),
    };
  };
  const args = {
    origin: { lat: 37.1, lng: -122.5 },
    destination: { lat: 37.5, lng: -122.4, eventId: 'evt-1' },
    recomputeCount: 0,
    apiKey: 'test-key',
    fetchImpl: mockFetch,
  };
  const r1 = await recomputeETA(args);
  const r2 = await recomputeETA(args);
  assert.equal(fetchCount, 1, 'second call hits cache');
  assert.equal(r1.cached, false);
  assert.equal(r2.cached, true);
  assert.ok(r1.eta_arrival_at);
  assert.equal(r1.distance_remaining_miles, 10);  // 16093m / 1609.344 ≈ 10
});
