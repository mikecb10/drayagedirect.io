import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { pickInterval } from '../lib/driver-app/geolocation-watcher.js';

test('pickInterval first ping → moving (60s)', () => {
  assert.equal(
    pickInterval({ lastPing: null, currentPing: { latitude: 37.1, longitude: -122.5 }, onSite: false }),
    60_000,
  );
});

test('pickInterval movement >100m → moving (60s)', () => {
  // ~111m east at lat=37
  assert.equal(
    pickInterval({
      lastPing: { latitude: 37.1, longitude: -122.5 },
      currentPing: { latitude: 37.1, longitude: -122.4988 },
      onSite: false,
    }),
    60_000,
  );
});

test('pickInterval movement <100m → stationary (180s)', () => {
  assert.equal(
    pickInterval({
      lastPing: { latitude: 37.1, longitude: -122.5 },
      currentPing: { latitude: 37.10001, longitude: -122.50001 },
      onSite: false,
    }),
    180_000,
  );
});

test('pickInterval onSite → 300s regardless of movement', () => {
  assert.equal(
    pickInterval({
      lastPing: { latitude: 37.1, longitude: -122.5 },
      currentPing: { latitude: 37.2, longitude: -122.5 },
      onSite: true,
    }),
    300_000,
  );
});
