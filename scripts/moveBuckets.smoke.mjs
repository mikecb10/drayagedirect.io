#!/usr/bin/env node
// Runnable smoke test for lib/dispatcher/moveBuckets.js — exits 0 on all
// pass, 1 on any fail. No test framework required.
//
// Tests the events-based priority classifier. See:
// docs/superpowers/specs/2026-04-22-driver-planner-bucket-classification-design.md

import { getBucket, bucketize } from '../lib/dispatcher/moveBuckets.js';

let passed = 0;
let failed = 0;

function check(label, actual, expected) {
  if (actual === expected) {
    passed++;
    console.log(`  PASS  ${label}`);
  } else {
    failed++;
    console.log(`  FAIL  ${label}  —  got: ${JSON.stringify(actual)}, want: ${JSON.stringify(expected)}`);
  }
}

console.log('moveBuckets smoke tests:\n');

// ── Guard clauses ──────────────────────────────────────────────────────

// 1. Assigned move → null (excluded from buckets)
check(
  'assigned move → null',
  getBucket({ driver_id: 'abc-123', events: [{ event_type: 'pull' }] }),
  null
);

// 2. null move → throws
try {
  getBucket(null);
  failed++;
  console.log('  FAIL  null move should throw');
} catch (e) {
  passed++;
  console.log('  PASS  null move throws');
}

// ── Single-event classification ────────────────────────────────────────

// 3. Pure pull → atPort
check(
  'pull event → atPort',
  getBucket({ driver_id: null, events: [{ event_type: 'pull' }] }),
  'atPort'
);

// 4. Pure deliver → deliveries
check(
  'deliver event → deliveries',
  getBucket({ driver_id: null, events: [{ event_type: 'deliver' }] }),
  'deliveries'
);

// 5. Legacy pickup (One Way Move road template) → deliveries
check(
  'pickup event (road template) → deliveries',
  getBucket({ driver_id: null, events: [{ event_type: 'pickup' }] }),
  'deliveries'
);

// 6. Pure return → return
check(
  'return event → return',
  getBucket({ driver_id: null, events: [{ event_type: 'return' }] }),
  'return'
);

// 7. Hook-only (yard move) → other
check(
  'hook-only → other',
  getBucket({ driver_id: null, events: [{ event_type: 'hook' }] }),
  'other'
);

// 8. Drop-only → other
check(
  'drop-only → other',
  getBucket({ driver_id: null, events: [{ event_type: 'drop' }] }),
  'other'
);

// 9. Empty events → other
check(
  'empty events array → other',
  getBucket({ driver_id: null, events: [] }),
  'other'
);

// 10. Undefined events → other (graceful fallback)
check(
  'undefined events → other',
  getBucket({ driver_id: null }),
  'other'
);

// 11. Non-array events → other (graceful fallback)
check(
  'non-array events → other',
  getBucket({ driver_id: null, events: 'not-an-array' }),
  'other'
);

// ── Combo classification (priority: pull > deliver/pickup > return) ─────

// 12. Full combo pull+deliver+return → atPort (pull wins)
check(
  'pull+deliver+return combo → atPort (pull wins)',
  getBucket({
    driver_id: null,
    events: [
      { event_type: 'pull' },
      { event_type: 'deliver' },
      { event_type: 'return' },
    ],
  }),
  'atPort'
);

// 13. Drop & Hook combo pull+deliver+drop → atPort
check(
  'pull+deliver+drop combo → atPort',
  getBucket({
    driver_id: null,
    events: [
      { event_type: 'pull' },
      { event_type: 'deliver' },
      { event_type: 'drop' },
    ],
  }),
  'atPort'
);

// 14. Deliver+return (pull already happened upstream) → deliveries
check(
  'deliver+return combo → deliveries',
  getBucket({
    driver_id: null,
    events: [
      { event_type: 'deliver' },
      { event_type: 'return' },
    ],
  }),
  'deliveries'
);

// 15. Hook+return (export delivery leg) → return
check(
  'hook+return combo → return',
  getBucket({
    driver_id: null,
    events: [
      { event_type: 'hook' },
      { event_type: 'return' },
    ],
  }),
  'return'
);

// 16. Return+hook (order-agnostic, has return) → return
check(
  'return+hook combo → return',
  getBucket({
    driver_id: null,
    events: [
      { event_type: 'return' },
      { event_type: 'hook' },
    ],
  }),
  'return'
);

// 17. Pickup+return (hypothetical road move) → deliveries
// pickup is in the deliveries branch; no pull means pull doesn't win.
check(
  'pickup+return combo → deliveries',
  getBucket({
    driver_id: null,
    events: [
      { event_type: 'pickup' },
      { event_type: 'return' },
    ],
  }),
  'deliveries'
);

// ── move_type is ignored ───────────────────────────────────────────────

// 18. Free-form move_type with pull event → atPort
check(
  'free-form move_type ignored — pull event drives atPort',
  getBucket({
    driver_id: null,
    move_type: 'Pick and Run + Drop & Hook',
    events: [{ event_type: 'pull' }, { event_type: 'deliver' }],
  }),
  'atPort'
);

// 19. Literal string "null" move_type with return event → return
check(
  'literal "null" move_type ignored — return event drives return',
  getBucket({
    driver_id: null,
    move_type: 'null',
    events: [{ event_type: 'return' }],
  }),
  'return'
);

// 20. move_type='chassis_reposition' with hook/drop only → other
check(
  'chassis_reposition with hook/drop only → other',
  getBucket({
    driver_id: null,
    move_type: 'chassis_reposition',
    events: [{ event_type: 'hook' }, { event_type: 'drop' }],
  }),
  'other'
);

// ── bucketize ──────────────────────────────────────────────────────────

// 21. bucketize: mixed array, all 4 buckets populated + 1 assigned skipped
const mixed = bucketize([
  { driver_id: null, events: [{ event_type: 'pull' }] },
  { driver_id: null, events: [{ event_type: 'deliver' }] },
  { driver_id: null, events: [{ event_type: 'return' }] },
  { driver_id: null, events: [{ event_type: 'hook' }] },
  { driver_id: 'assigned-1', events: [{ event_type: 'pull' }] }, // skipped
]);
check('bucketize: atPort has 1', mixed.atPort.length, 1);
check('bucketize: deliveries has 1', mixed.deliveries.length, 1);
check('bucketize: return has 1', mixed.return.length, 1);
check('bucketize: other has 1', mixed.other.length, 1);

// 22. bucketize: empty input → all 4 buckets empty
const empty = bucketize([]);
check(
  'bucketize: empty input → 4 empty buckets',
  empty.atPort.length === 0 && empty.deliveries.length === 0 &&
    empty.return.length === 0 && empty.other.length === 0,
  true
);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
