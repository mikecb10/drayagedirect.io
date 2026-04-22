#!/usr/bin/env node
// Runnable smoke test for lib/dispatcher/moveBuckets.js — exits 0 on all pass,
// 1 on any fail. No test framework required.

import { getBucket } from '../lib/dispatcher/moveBuckets.js';

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

// 1. Pickup with LFD + container_at_port = true → atPort
check(
  'pickup + LFD + container_at_port → atPort',
  getBucket(
    { driver_id: null, move_type: 'pickup', events: [] },
    { lfd: '2026-04-14', container_at_port: true, empty_ready_for_return_at: null }
  ),
  'atPort'
);

// 2. Pickup with appt but container_at_port = false → other
check(
  'pickup + pickup appt but container_at_port = false → other',
  getBucket(
    { driver_id: null, move_type: 'pickup', events: [{ event_type: 'pickup', scheduled_at: '2026-04-14T10:00:00Z' }] },
    { lfd: null, container_at_port: false, empty_ready_for_return_at: null }
  ),
  'other'
);

// 3. Pickup with container_at_port=true but no LFD and no appt → other
check(
  'pickup + container_at_port=true, no LFD, no appt → other',
  getBucket(
    { driver_id: null, move_type: 'pickup', events: [] },
    { lfd: null, container_at_port: true, empty_ready_for_return_at: null }
  ),
  'other'
);

// 4. Pickup with container_at_port=true + pickup appt (no LFD) → atPort
check(
  'pickup + container_at_port=true + pickup appt (no LFD) → atPort',
  getBucket(
    { driver_id: null, move_type: 'pickup', events: [{ event_type: 'pickup', scheduled_at: '2026-04-14T10:00:00Z' }] },
    { lfd: null, container_at_port: true, empty_ready_for_return_at: null }
  ),
  'atPort'
);

// 5. Delivery with deliver appt → deliveries
check(
  'delivery + deliver appt → deliveries',
  getBucket(
    { driver_id: null, move_type: 'delivery', events: [{ event_type: 'deliver', scheduled_at: '2026-04-14T14:00:00Z' }] },
    { lfd: null, container_at_port: false, empty_ready_for_return_at: null }
  ),
  'deliveries'
);

// 6. Delivery without any scheduled_at → other
check(
  'delivery, no scheduled_at → other',
  getBucket(
    { driver_id: null, move_type: 'delivery', events: [{ event_type: 'deliver', scheduled_at: null }] },
    { lfd: null, container_at_port: false, empty_ready_for_return_at: null }
  ),
  'other'
);

// 7. Return + empty_ready_for_return_at set → return
check(
  'return + empty_ready_for_return_at set → return',
  getBucket(
    { driver_id: null, move_type: 'return', events: [] },
    { lfd: null, container_at_port: false, empty_ready_for_return_at: '2026-04-14T18:00:00Z' }
  ),
  'return'
);

// 8. Return without empty_ready_for_return_at → other
check(
  'return, no empty_ready → other',
  getBucket(
    { driver_id: null, move_type: 'return', events: [] },
    { lfd: null, container_at_port: false, empty_ready_for_return_at: null }
  ),
  'other'
);

// 9. Chassis reposition unassigned → other
check(
  'chassis_reposition unassigned → other',
  getBucket(
    { driver_id: null, move_type: 'chassis_reposition', events: [] },
    { lfd: null, container_at_port: false, empty_ready_for_return_at: null }
  ),
  'other'
);

// 10. Street turn unassigned → other
check(
  'street_turn unassigned → other',
  getBucket(
    { driver_id: null, move_type: 'street_turn', events: [] },
    { lfd: null, container_at_port: false, empty_ready_for_return_at: null }
  ),
  'other'
);

// 11. Any move with driver_id != null → null (assigned, excluded from buckets)
check(
  'assigned move → null',
  getBucket(
    { driver_id: 'abc-123', move_type: 'pickup', events: [] },
    { lfd: '2026-04-14', container_at_port: true, empty_ready_for_return_at: null }
  ),
  null
);

// 12. Multiple deliver events, only first has scheduled_at → deliveries
check(
  'delivery + mixed events (first has appt) → deliveries',
  getBucket(
    { driver_id: null, move_type: 'delivery', events: [
      { event_type: 'deliver', scheduled_at: '2026-04-14T09:00:00Z' },
      { event_type: 'deliver', scheduled_at: null },
    ] },
    { lfd: null, container_at_port: false, empty_ready_for_return_at: null }
  ),
  'deliveries'
);

// 13. null move → throws
try {
  getBucket(null, {});
  failed++;
  console.log('  FAIL  null move should throw');
} catch (e) {
  passed++;
  console.log('  PASS  null move throws');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
