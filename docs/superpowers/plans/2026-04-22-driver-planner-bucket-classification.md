# Driver Planner Bucket Classification Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the broken move-type/order-flag classifier in `lib/dispatcher/moveBuckets.js` with a pure events-based priority classifier so the Driver Planner right-rail stops dumping every unassigned move into "Other".

**Architecture:** Single pure function refactor. `getBucket(move)` reads `move.events[].event_type`, applies priority `pull > deliver/pickup > return > other`, and returns the bucket. Drop the `orderFlags` parameter entirely. Ripple the simpler signature to the two call sites (API endpoint + optimistic-unassign hook). No migration, no SQL, no UI changes.

**Tech Stack:** Plain ES modules, `node scripts/moveBuckets.smoke.mjs` for unit-level verification, `preview_*` MCP tools for live browser verification.

**Spec:** [docs/superpowers/specs/2026-04-22-driver-planner-bucket-classification-design.md](../specs/2026-04-22-driver-planner-bucket-classification-design.md)

---

## File Structure

Files modified (4 total) — all existing:

- `scripts/moveBuckets.smoke.mjs` — full rewrite. New contract: `getBucket(move)` with no second parameter, events-driven classification using the canonical `pull`/`deliver`/`pickup`/`drop`/`hook`/`return` vocabulary from migration 047.
- `lib/dispatcher/moveBuckets.js` — replace body of both `getBucket` and `bucketize`. Drop `orderFlags` param from `getBucket`. Change `bucketize(items)` signature from `[{move, orderFlags}]` to `[move, ...]`.
- `pages/api/tenant/dispatcher/planner/index.js` — simplify the unassigned-bucketing loop (~lines 170-182). Remove `orderFlags` construction. Keep the `SELECT` list intact (UI still reads `last_free_day`).
- `hooks/useDriverPlanner.js` — simplify the optimistic-unassign path (~lines 240-251). Remove `orderFlags` construction.

No new files. No migration. No UI component changes.

Files intentionally NOT touched:

- `components/dispatcher/planner/*` — UI reads `buckets` prop unchanged.
- `scripts/planner-bucket-audit.js` — diagnostic script stays as-is.
- `supabase/migrations/**` — no SQL change.

---

## Task 1: Rewrite smoke tests against the new events-based contract (TDD red)

**Files:**
- Rewrite: `scripts/moveBuckets.smoke.mjs`

- [ ] **Step 1: Replace the entire smoke test file**

Overwrite `scripts/moveBuckets.smoke.mjs` with:

```javascript
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
```

- [ ] **Step 2: Run smoke tests against the OLD implementation — expect RED**

Run: `node scripts/moveBuckets.smoke.mjs`

Expected: many FAIL lines. The old `getBucket(move, orderFlags)` requires `orderFlags.container_at_port` for atPort and checks `move.move_type === 'pickup'`/`'delivery'`/`'return'`; the new tests pass only `move.events` and expect events to drive classification. At minimum, expect tests 3, 4, 12-19 to fail and exit code 1.

This is the TDD red baseline. Do **not** commit yet — tests will be committed alongside the implementation in Task 2.

---

## Task 2: Rewrite `getBucket` + `bucketize` to events-only classifier (TDD green)

**Files:**
- Modify: `lib/dispatcher/moveBuckets.js` (full file rewrite)
- Modify: `pages/api/tenant/dispatcher/planner/index.js:170-182`
- Modify: `hooks/useDriverPlanner.js:240-264`
- Test: `scripts/moveBuckets.smoke.mjs` (already rewritten in Task 1)

- [ ] **Step 1: Replace `lib/dispatcher/moveBuckets.js` with the events-based classifier**

Overwrite the file with:

```javascript
// Pure bucket-derivation util for the Driver Planner right-rail.
// Classifies unassigned moves by inspecting their routing events
// (event_type: pull / deliver / pickup / drop / hook / return) instead
// of the denormalized move_type name or order-level state flags.
//
// See docs/superpowers/specs/2026-04-22-driver-planner-bucket-classification-design.md
// for the full rationale — in brief, move_type is a free-form
// routing-template name ("Pick and Run + Drop & Hook") that does not
// match the original spec's strict enum, and order flags
// (container_at_port, empty_ready_for_return_at) + event.scheduled_at
// are not populated in practice.

/**
 * Determine which right-rail bucket an unassigned move belongs to.
 *
 * Priority (first match wins):
 *   pull            → 'atPort'     port pickup (LFD/demurrage urgency)
 *   deliver|pickup  → 'deliveries' delivery leg (pickup = One Way Move template)
 *   return          → 'return'     empty/loaded return to port
 *   else            → 'other'      chassis-only, street-turn, bobtail
 *
 * @param {object} move  order_container_moves row plus an `events` array
 *                       (order_routing_events rows belonging to the move).
 * @returns {'atPort' | 'deliveries' | 'return' | 'other' | null}
 *          null if the move is assigned (driver_id != null).
 */
export function getBucket(move) {
  if (!move) throw new Error('getBucket: move is required');
  if (move.driver_id != null) return null;

  const events = Array.isArray(move.events) ? move.events : [];
  const has = (type) => events.some((e) => e?.event_type === type);

  if (has('pull')) return 'atPort';
  if (has('deliver') || has('pickup')) return 'deliveries';
  if (has('return')) return 'return';
  return 'other';
}

/**
 * Group an array of unassigned moves into the four right-rail buckets.
 * Assigned moves (driver_id != null) are skipped.
 *
 * @param {Array<object>} moves  array of move rows (each with `events`).
 * @returns {{ atPort: Array, deliveries: Array, return: Array, other: Array }}
 */
export function bucketize(moves) {
  const out = { atPort: [], deliveries: [], return: [], other: [] };
  for (const move of moves) {
    const b = getBucket(move);
    if (b == null) continue; // assigned, skip
    out[b].push(move);
  }
  return out;
}
```

- [ ] **Step 2: Simplify the planner API bucketing loop**

In `pages/api/tenant/dispatcher/planner/index.js`, replace lines 170-182 (the block starting with `// ── Bucket unassigned moves via the shared util ───`) with:

```javascript
  // ── Bucket unassigned moves via the shared util ───────────────────────
  const unassignedBuckets = { atPort: [], deliveries: [], return: [], other: [] };
  for (const m of unassigned) {
    const b = getBucket(m);
    if (b != null) unassignedBuckets[b].push(m);
  }
```

Note: leave the `SELECT` list on lines 72-77 untouched — `last_free_day` is still read by `MoveCell.jsx` and `MovePreviewPanel.jsx` for the LFD badge.

- [ ] **Step 3: Simplify the optimistic-unassign hook call site**

In `hooks/useDriverPlanner.js`, replace lines 240-252 (the `async unassign({ move }) {` block up to the `dispatch({ type: 'OPTIMISTIC_UNASSIGN', ... })` line) with:

```javascript
    async unassign({ move }) {
      const snapshot = state;
      // Compute the correct right-rail bucket for the now-unassigned move
      // so it lands in the right place optimistically — refetch confirms.
      const bucket = getBucket({ ...move, driver_id: null }) || 'other';
      dispatch({ type: 'OPTIMISTIC_UNASSIGN', move, bucket });
```

Leave the rest of the `unassign` handler (fetch call + error rollback) untouched.

- [ ] **Step 4: Run smoke tests — expect GREEN**

Run: `node scripts/moveBuckets.smoke.mjs`

Expected:

```
moveBuckets smoke tests:

  PASS  assigned move → null
  PASS  null move throws
  PASS  pull event → atPort
  ...
  PASS  bucketize: empty input → 4 empty buckets

25 passed, 0 failed
```

Exit code 0. If any test fails, fix the implementation before proceeding.

- [ ] **Step 5: Commit all four files together**

```bash
git add lib/dispatcher/moveBuckets.js scripts/moveBuckets.smoke.mjs pages/api/tenant/dispatcher/planner/index.js hooks/useDriverPlanner.js
git commit -m "$(cat <<'EOF'
fix(driver-planner): events-based bucket classifier

The right-rail bucket classifier in lib/dispatcher/moveBuckets.js was
written against an enum that does not match real drayage data:

  - move.move_type is a free-form routing-template name ("Pick and Run
    + Drop & Hook"), not the canonical 'pickup'/'delivery'/'return'.
  - orders.container_at_port is never set to true in practice.
  - orders.empty_ready_for_return_at is never populated.
  - Canonical event_type vocabulary (migration 047) is pull/deliver/
    drop/hook/return — not pickup/deliver with scheduled_at.

Result: every unassigned move fell through to 'other'. Test tenant
showed 0/0/0/7 on All/At Port/Deliveries/Return/Other.

Fix: classify entirely off move.events[].event_type with priority
pull > deliver/pickup > return > other. Drop the orderFlags parameter
and every order-level flag dependency. Predicted shift on the test
tenant: 0/0/0/7 → 4/0/3/0.

Ripple: simplify the two call sites (planner GET endpoint + optimistic
unassign hook) to drop orderFlags construction. Full rewrite of smoke
tests to cover the real event-type vocabulary — 25 assertions, all
pass.

No migration, no SQL, no UI changes.

Spec: docs/superpowers/specs/2026-04-22-driver-planner-bucket-classification-design.md

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Live verification on the test tenant

**Files:**
- None (read-only verification)

- [ ] **Step 1: Start the preview server**

Call `mcp__Claude_Preview__preview_start`. Wait for ready state.

- [ ] **Step 2: Navigate to the Driver Planner on the test tenant**

Navigate to `http://localhost:3000/dispatcher/planner?date=2026-04-22` (adjust date if needed — the planner defaults to today, so an empty query string is also acceptable).

Use `mcp__Claude_Preview__preview_eval` with:
```javascript
window.location.href = '/dispatcher/planner?date=2026-04-22'
```

Then wait ~1s for the page to load. Use `mcp__Claude_Preview__preview_snapshot` to confirm the page rendered.

- [ ] **Step 3: Capture right-rail bucket counts**

Use `mcp__Claude_Preview__preview_eval`:
```javascript
(() => {
  const tabs = Array.from(document.querySelectorAll('[data-bucket-tab]'));
  if (!tabs.length) {
    // Fallback: read from button labels
    const labels = Array.from(document.querySelectorAll('button'))
      .map(b => b.textContent?.trim())
      .filter(t => t && /^(All|At Port|Deliveries|Return|Other)\s*\(\d+\)/.test(t));
    return labels;
  }
  return tabs.map(t => ({ bucket: t.dataset.bucketTab, text: t.textContent.trim() }));
})()
```

Expected output reflecting the predicted classification on the test tenant's 7 unassigned moves:

```
All (7)
At Port (4)
Deliveries (0)
Return (3)
Other (0)
```

If the snapshot shows `0/0/0/7` still, the change did not take effect — hot-reload may have missed the file; restart the preview server. If the counts differ from `4/0/3/0` but are **not** all in Other, re-run the audit script (Step 6) and update the spec's predicted table in the follow-up commit if the actual live data has shifted since the audit was taken.

- [ ] **Step 4: Screenshot the planner for the commit evidence log**

Use `mcp__Claude_Preview__preview_screenshot` to capture the right rail with the new bucket distribution. Save the screenshot for the session recap.

- [ ] **Step 5: Click each bucket tab and confirm cards render**

Use `mcp__Claude_Preview__preview_click` on the "At Port" tab, then `preview_snapshot` — confirm 4 move cards visible. Repeat for "Return" (expect 3 cards). "Deliveries" and "Other" should show the empty-state copy from `UnassignedRightRail.jsx:62-73`.

- [ ] **Step 6: Re-run the audit script to cross-check**

Run: `node scripts/planner-bucket-audit.js`

Expected (bottom of output):
```
─── What the buckets WOULD be if we used event-based classification ───
  atPort     4
  deliveries 0
  return     3
  other      0
```

If this matches both the live UI and the spec's predicted table, live verification is complete.

- [ ] **Step 7: Re-run the smoke tests one last time**

Run: `node scripts/moveBuckets.smoke.mjs`

Expected: `25 passed, 0 failed`, exit code 0.

- [ ] **Step 8: Stop the preview server**

Call `mcp__Claude_Preview__preview_stop`.

No commit in Task 3 — live verification just produces evidence, not code. If live verification surfaces a bug, return to Task 2 to fix it and commit separately.

---

## Self-Review

**Spec coverage:**

| Spec section | Task |
|---|---|
| §3 events-based classifier | Task 2 step 1 |
| §3.1/§3.3 rejected alternatives | n/a (prose only) |
| §4 out-of-scope (street turns, chassis) | n/a — tests 18-20 confirm the classifier ignores free-form `move_type` |
| §5 predicted outcome 4/0/3/0 | Task 3 steps 3, 6 |
| §6.1 getBucket body + drop orderFlags | Task 2 step 1 |
| §6.2 bucketize signature change | Task 2 step 1 |
| §6.3 call-site ripples | Task 2 steps 2, 3 |
| §6.4 smoke-test rewrite (~20 cases) | Task 1 step 1 (25 cases) |
| §6.5 keep audit script | n/a — untouched |
| §6.6 no migration | n/a — confirmed no SQL |
| §7 live verification steps | Task 3 |
| §8 single-commit rollout | Task 2 step 5 |
| §9 risk — 0-deliveries correctness | Task 3 step 5 (confirms empty state renders) |

**Placeholder scan:** No TBD/TODO/"add appropriate". Every step shows the full code or command.

**Type/signature consistency:** `getBucket(move)` signature used consistently in Task 1 tests (single arg, no orderFlags), Task 2 impl, Task 2 call sites (planner + hook), and Task 3 audit-script cross-check. `bucketize(moves)` signature matches. No drift.

Plan complete and saved to [docs/superpowers/plans/2026-04-22-driver-planner-bucket-classification.md](../plans/2026-04-22-driver-planner-bucket-classification.md).
