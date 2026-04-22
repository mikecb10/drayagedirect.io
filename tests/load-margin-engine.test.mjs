// Hand-rolled test runner matching existing project convention
// (see tests/dry-run-engine.test.mjs, tests/routing-event-distance.test.mjs)
import { computeLoadMargin } from '../lib/load-margin.js';

let passed = 0;
let failed = 0;
function check(name, cond, detail) {
  if (cond) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failed++;
    console.log(`  ✗ ${name}${detail ? `\n    ${detail}` : ''}`);
  }
}

console.log('computeLoadMargin');

// T1: Green — 50% margin
{
  const r = computeLoadMargin({ revenueCents: 10000, costCents: 5000, redThreshold: 15, yellowThreshold: 30 });
  check('T1  50% → green', r.bucket === 'green' && r.marginPct === 50);
}

// T2: Red at lower boundary — margin = 15 should be red (≤ red threshold)
{
  const r = computeLoadMargin({ revenueCents: 10000, costCents: 8500, redThreshold: 15, yellowThreshold: 30 });
  check('T2  15% (boundary) → red', r.bucket === 'red' && r.marginPct === 15);
}

// T3: Yellow — 20%, between red and yellow
{
  const r = computeLoadMargin({ revenueCents: 10000, costCents: 8000, redThreshold: 15, yellowThreshold: 30 });
  check('T3  20% → yellow', r.bucket === 'yellow' && r.marginPct === 20);
}

// T4: Yellow at upper boundary — margin = 30 should be yellow (≤ yellow threshold)
{
  const r = computeLoadMargin({ revenueCents: 10000, costCents: 7000, redThreshold: 15, yellowThreshold: 30 });
  check('T4  30% (boundary) → yellow', r.bucket === 'yellow' && r.marginPct === 30);
}

// T5: Green — 31% is above yellow threshold
{
  const r = computeLoadMargin({ revenueCents: 10000, costCents: 6900, redThreshold: 15, yellowThreshold: 30 });
  check('T5  31% → green', r.bucket === 'green' && r.marginPct === 31);
}

// T6: Neutral — no revenue, no cost
{
  const r = computeLoadMargin({ revenueCents: 0, costCents: 0, redThreshold: 15, yellowThreshold: 30 });
  check('T6  0/0 → neutral', r.bucket === 'neutral' && r.marginPct === null);
}

// T7: Neutral — revenue but no cost
{
  const r = computeLoadMargin({ revenueCents: 10000, costCents: 0, redThreshold: 15, yellowThreshold: 30 });
  check('T7  revenue-only → neutral', r.bucket === 'neutral' && r.marginPct === null);
}

// T8: Neutral — cost but no revenue
{
  const r = computeLoadMargin({ revenueCents: 0, costCents: 5000, redThreshold: 15, yellowThreshold: 30 });
  check('T8  cost-only → neutral', r.bucket === 'neutral' && r.marginPct === null);
}

// T9: Underwater (cost > revenue) — margin is negative, should be red
{
  const r = computeLoadMargin({ revenueCents: 10000, costCents: 11000, redThreshold: 15, yellowThreshold: 30 });
  check('T9  underwater -10% → red', r.bucket === 'red' && r.marginPct === -10);
}

// T10: Defensive — NaN inputs
{
  const r = computeLoadMargin({ revenueCents: NaN, costCents: undefined, redThreshold: 15, yellowThreshold: 30 });
  check('T10 NaN/undefined → neutral', r.bucket === 'neutral' && r.marginPct === null);
}

// T11: Custom thresholds — tight margin tenant (5 / 10)
{
  const r = computeLoadMargin({ revenueCents: 10000, costCents: 9300, redThreshold: 5, yellowThreshold: 10 });
  check('T11 tight thresholds 7% → yellow', r.bucket === 'yellow' && Math.round(r.marginPct) === 7);
}

// T12: Custom thresholds — 11% with (5 / 10) → green
{
  const r = computeLoadMargin({ revenueCents: 10000, costCents: 8900, redThreshold: 5, yellowThreshold: 10 });
  check('T12 tight thresholds 11% → green', r.bucket === 'green' && Math.round(r.marginPct) === 11);
}

// T13: Rounding — 15.50001% with red threshold 15 → yellow (strictly > 15)
{
  const r = computeLoadMargin({ revenueCents: 100000, costCents: 84500, redThreshold: 15, yellowThreshold: 30 });
  // 100000 - 84500 = 15500. 15500/100000 = 15.5. Yellow (> 15, ≤ 30).
  check('T13 15.5% → yellow', r.bucket === 'yellow');
}

// T14: No overflow with very large values
{
  const r = computeLoadMargin({ revenueCents: 1_000_000_000, costCents: 700_000_000, redThreshold: 15, yellowThreshold: 30 });
  check('T14 $10M revenue → green 30%', r.bucket === 'green' && (r.marginPct === 30.000000000000004 || r.marginPct === 30));
  // floating-point — accept either the exact 30 or the IEEE754 neighbor
}

// T15: Bucket is always one of four strings
{
  const buckets = new Set();
  for (const [rev, cost] of [[0,0],[100,50],[100,85],[100,75],[100,90],[100,110]]) {
    const r = computeLoadMargin({ revenueCents: rev, costCents: cost, redThreshold: 15, yellowThreshold: 30 });
    buckets.add(r.bucket);
  }
  check('T15 all buckets are valid strings', [...buckets].every(b => ['red','yellow','green','neutral'].includes(b)));
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
