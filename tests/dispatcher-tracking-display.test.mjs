import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import {
  fmtRelativeETA,
  fmtAbsoluteETA,
  fmtOnSiteDuration,
  freshnessColor,
} from '../lib/dispatcher/tracking-display.js';

test('fmtRelativeETA — under 60 minutes', () => {
  const future = new Date(Date.now() + 30 * 60 * 1000).toISOString();
  assert.match(fmtRelativeETA(future), /^30m$/);
});

test('fmtRelativeETA — over 60 minutes', () => {
  const future = new Date(Date.now() + (2 * 60 + 14) * 60 * 1000).toISOString();
  assert.match(fmtRelativeETA(future), /^2h 14m$/);
});

test('fmtRelativeETA — past time → "now"', () => {
  const past = new Date(Date.now() - 60 * 1000).toISOString();
  assert.equal(fmtRelativeETA(past), 'now');
});

test('fmtAbsoluteETA returns HH:MM in 24h format', () => {
  const eta = new Date('2026-04-24T14:32:00Z').toISOString();
  // We render in local time; assert format only.
  assert.match(fmtAbsoluteETA(eta), /^\d{2}:\d{2}$/);
});

test('fmtOnSiteDuration mm:ss for <1h, h:mm:ss for >1h', () => {
  const t45m = new Date(Date.now() - 45 * 60 * 1000).toISOString();
  assert.match(fmtOnSiteDuration(t45m), /^\d{1,2}:\d{2}$/);   // 45:00 (within hour)

  const t75m = new Date(Date.now() - 75 * 60 * 1000).toISOString();
  assert.match(fmtOnSiteDuration(t75m), /^1:\d{2}:\d{2}$/);
});

test('freshnessColor green/amber/red thresholds', () => {
  const now = Date.now();
  assert.equal(freshnessColor(new Date(now - 30 * 1000).toISOString()), 'green');
  assert.equal(freshnessColor(new Date(now - 5 * 60 * 1000).toISOString()), 'amber');
  assert.equal(freshnessColor(new Date(now - 15 * 60 * 1000).toISOString()), 'red');
  assert.equal(freshnessColor(null), 'red');
});
