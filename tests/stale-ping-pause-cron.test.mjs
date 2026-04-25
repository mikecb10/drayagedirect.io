// tests/stale-ping-pause-cron.test.mjs
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { findStaleMoves, STALE_THRESHOLD_MS } from '../lib/cron/stale-ping-pause.js';

test('STALE_THRESHOLD_MS is 10 minutes', () => {
  assert.equal(STALE_THRESHOLD_MS, 10 * 60 * 1000);
});

test('findStaleMoves returns moves older than threshold', () => {
  const now = Date.now();
  const moves = [
    { id: 'a', tracking_status: 'in_transit', last_ping_at: new Date(now - 11 * 60 * 1000).toISOString() }, // stale
    { id: 'b', tracking_status: 'in_transit', last_ping_at: new Date(now - 5 * 60 * 1000).toISOString() },  // fresh
    { id: 'c', tracking_status: 'on_site', last_ping_at: new Date(now - 30 * 60 * 1000).toISOString() },    // on_site, ignored
    { id: 'd', tracking_status: 'in_transit', last_ping_at: null },                                          // no ping yet, ignored
  ];
  const stale = findStaleMoves(moves, now);
  assert.deepEqual(stale.map((m) => m.id), ['a']);
});
