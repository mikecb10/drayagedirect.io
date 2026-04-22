# Driver Planner — Bucket Classification Fix

**Date:** 2026-04-22
**Related spec:** [2026-04-22-driver-planner-design.md](./2026-04-22-driver-planner-design.md)
**Problem:** All 7 unassigned moves on the test tenant fall into the "Other"
bucket. The right-rail counts show All (7) / At Port (0) / Deliveries (0) /
Return (0) / Other (7) for a tenant whose unassigned pool is clearly a mix
of port pickups, deliveries, and returns.

---

## 1. Context

`lib/dispatcher/moveBuckets.js` classifies each unassigned move into one of
four right-rail buckets: `atPort`, `deliveries`, `return`, or `other`. The
original ship spec assumed three signals:

1. `move.move_type` is a canonical enum: `'pickup' | 'delivery' | 'return' |
   'chassis_reposition' | 'street_turn'`.
2. `orders.container_at_port` + `orders.last_free_day` flag "at port"
   pickups.
3. `orders.empty_ready_for_return_at` flags returns; `order_routing_events`
   with `event_type='pickup'` / `'deliver'` and a populated `scheduled_at`
   back up the pickup/delivery classifications.

Real drayage data on the test tenant breaks all three assumptions.

## 2. Root cause — data audit

Audit script `scripts/planner-bucket-audit.js` dumped the 7 unassigned moves
on the test tenant (`c7c483bf-...`) within the planner's 30-day window.

### 2.1 `move_type` is a free-form routing-template name

| Value | Count |
|---|---|
| `"Pick and Run + Drop & Hook"` | 5 |
| `"Export — Pick Empty + Live Load + Deliver"` | 1 |
| `"null"` (literal string) | 1 |
| `'pickup'` / `'delivery'` / `'return'` (canonical enum) | **0** |

`order_container_moves.move_type` is `TEXT NOT NULL` with no CHECK
constraint. Real rows store the routing-template name directly — see
`supabase/migrations/047_routing_templates_final_12.sql` which enumerates
12 canonical templates. Strict equality against `'pickup'`/`'delivery'`/
`'return'` never matches in drayage.

### 2.2 `orders.container_at_port` is never `true`

All 7 rows have `container_at_port = false`. The flag was added in
migration 090 but no code path actively sets it to `true`. The atPort
branch depends on this flag, so it never fires.

### 2.3 `orders.empty_ready_for_return_at` is never populated

All 7 rows = null. The return branch requires this column, so it never
fires.

### 2.4 Canonical `event_type` vocabulary is `pull`/`deliver`/`drop`/
`hook`/`return` — not `pickup`/`delivery`

Migration 047 defines the 12 routing templates via `event_sequence` JSONB
arrays. The event types in those arrays are:

- `pull` — port pickup (drayage inbound)
- `deliver` — delivery to customer
- `drop` — drop loaded/empty at a yard
- `hook` — hook from yard
- `return` — return to port (empty or loaded for export)
- `pickup` — **only** used by the single "One Way Move" road template

The existing `getBucket` and its smoke tests check for
`event_type === 'pickup'`, which never matches the drayage templates that
make up the vast majority of real moves.

### 2.5 `scheduled_at` on events is never populated

Zero of 17 events on the 7 unassigned moves have `scheduled_at` set. The
`hasEventWithAppt(type)` helper (requires `scheduled_at != null`) returns
`false` for everything, so even if move_type and event_type vocabulary
were correct, the appt-gating would still exclude every move.

### 2.6 Net effect

Every branch in the current `getBucket` classifier fails for drayage data.
All 7 moves fall through to the `return 'other'` default.

## 3. Proposed approach — events-based classification

Reclassify **entirely off the move's `events` array.** Drop every other
signal (`move_type`, `container_at_port`, `last_free_day`,
`empty_ready_for_return_at`, `scheduled_at`). Use a priority ordering
that reflects dispatcher urgency.

```js
export function getBucket(move) {
  if (!move) throw new Error('getBucket: move is required');
  if (move.driver_id != null) return null;

  const events = Array.isArray(move.events) ? move.events : [];
  const has = (t) => events.some((e) => e?.event_type === t);

  // Priority order reflects dispatcher urgency:
  // - pull wins because port pickup carries the hardest deadline
  //   (last-free-day / demurrage). A combo move that starts at port
  //   belongs in "At Port" regardless of later legs.
  // - deliver/pickup is next (pickup covers the lone road-move template).
  // - return is last — it implies upstream legs already ran.
  // - other is the catch-all for chassis-only / street-turn / empty moves.
  if (has('pull')) return 'atPort';
  if (has('deliver') || has('pickup')) return 'deliveries';
  if (has('return')) return 'return';
  return 'other';
}
```

### 3.1 Why events are the right signal

- `order_routing_events` is the **authoritative** source of what actions a
  move performs. It's populated at load creation by the routing-template
  expansion and is required for leg-distance calculation and for the
  planner UI to render events at all.
- `move_type` is a denormalized copy of the template name — useful for
  display, useless for classification.
- The order-level flags (`container_at_port`, `empty_ready_for_return_at`)
  are state mirrors that nothing writes to yet. Making them prerequisites
  guarantees empty buckets.

### 3.2 Rejected: fuzzy `move_type` matching

`move.move_type.toLowerCase().includes('pickup')` gives false signals on
combo templates. "Pick and Run + Drop & Hook" literally contains
"Pick" but the move also delivers and returns — matching on the name
alone can't produce a clean single-bucket classification. Events
unambiguously enumerate what the move does.

### 3.3 Rejected: data backfill migration

Populating `container_at_port` from pickup-location `facility_type` and
`empty_ready_for_return_at` from scheduled return-event times would
rescue the current classifier without changing the code. Rejected
because:

- We're dropping the dependency on those columns entirely. Backfilling
  data we don't read is wasted work.
- The columns may still have future value (state tracking, filtering)
  but their population belongs to separate workstreams, not the bucket
  classifier.

## 4. Out of scope

- **Street turns** — `move_type='street_turn'` support is a separate
  workstream Mike has flagged for a dedicated build. The current
  classifier will send street turns to whatever bucket their events
  imply (usually `deliveries` or `other`).
- **Chassis moves / transfers / splits** — same. Chassis-only moves
  with only `hook` / `drop` events will land in `other`, which is
  correct for today.
- **`container_at_port` / `empty_ready_for_return_at` population** —
  the columns exist in the schema and may be useful later (e.g., for
  filtering "show me only containers whose empty has been dumped"). Not
  addressed here.
- **Populating `scheduled_at` on events** — the appointment-scheduling
  UX is a separate feature. Today events are created without
  appointments and get their schedules assigned later; the classifier
  no longer depends on this.
- **Load Margin % AR filter** — unrelated workstream.

## 5. Predicted outcome on the test tenant

Rerun of `planner-bucket-audit.js` after the fix (predicted from the
current data dump):

| Move | Events | Current bucket | New bucket |
|---|---|---|---|
| ORD-M000009 seq=1 | hook, return | other | **return** |
| ORD-M000008 seq=0 | pull, deliver, drop | other | **atPort** |
| ORD-M000008 seq=1 | hook, return | other | **return** |
| ORD-M000003 seq=2 | return, hook | other | **return** |
| ORD-M000010 seq=0 | return, pull | other | **atPort** |
| ORD-E000002 seq=0 | pull, deliver, deliver | other | **atPort** |
| ORD-M000009 seq=0 | pull, deliver, drop | other | **atPort** |

**Count shift: (0/0/0/7) → (4/0/3/0).** The 0 for deliveries is correct
for today's data — none of the 7 moves are standalone delivery legs
(they're all combo moves dominated by pull or return). This will shift
as Drop & Hook workflows split moves into pull-leg + deliver-leg pairs
in the future.

## 6. Implementation scope

### 6.1 `lib/dispatcher/moveBuckets.js`

- Drop the `orderFlags` parameter from `getBucket(move, orderFlags)` —
  new signature is `getBucket(move)`.
- Replace the body with the events-based priority classifier above.
- Remove the `VALID_MOVE_TYPES` set (no longer a documentation anchor
  since `move_type` isn't read).
- Keep: `driver_id != null → null`, `null move → throw`, graceful
  `events` fallback to `[]`, `bucketize(items)` helper (see 6.4).

### 6.2 `bucketize(items)` helper

Current signature is `bucketize([{ move, orderFlags }])`. Simplify to
`bucketize(moves)` — an array of move objects, no second field. Update
the two call sites.

### 6.3 Call sites

**`pages/api/tenant/dispatcher/planner/index.js`** (line ~170) — simplify
to call `getBucket(m)` directly. Remove the `orderFlags` construction
block. The `m.order` join is still needed for lifecycle and branch
filtering, just not for bucket classification.

**`hooks/useDriverPlanner.js`** (line ~240) — same simplification.
Remove the `orderFlags` construction in the `unassign` optimistic path.

### 6.4 `scripts/moveBuckets.smoke.mjs`

Full rewrite. Existing tests use `event_type='pickup'` / `'deliver'`
with `scheduled_at` — all obsolete. New tests cover:

1. Assigned move → null
2. null move → throws
3. `events: [{event_type: 'pull'}]` → atPort (no flags needed)
4. `events: [{event_type: 'pull'}, {event_type: 'deliver'}, {event_type: 'return'}]` (full combo) → atPort (priority)
5. `events: [{event_type: 'deliver'}]` → deliveries
6. `events: [{event_type: 'deliver'}, {event_type: 'return'}]` → deliveries (deliver beats return)
7. `events: [{event_type: 'return'}]` → return
8. `events: [{event_type: 'return'}, {event_type: 'hook'}]` → return
9. `events: [{event_type: 'hook'}]` → other (chassis/yard move)
10. `events: [{event_type: 'drop'}]` → other
11. `events: []` → other
12. `events: undefined` → other (graceful fallback)
13. Free-form `move_type: "Pick and Run + Drop & Hook"` with pull event → atPort (confirm move_type is ignored)
14. Free-form `move_type: "null"` with return event → return
15. Legacy event `event_type: 'pickup'` (One Way Move template) → deliveries
16. Mixed pull/pickup → atPort (pull wins)
17. `bucketize([...])` with mixed events → correct disjoint counts
18. `bucketize([])` → all 4 buckets empty

Target: ~20 assertions covering the real vocabulary.

### 6.5 Audit script

`scripts/planner-bucket-audit.js` is a one-shot investigation tool and
should stay in the repo as a diagnostic. Keep as-is.

### 6.6 No migration

No SQL changes. The fix is pure JavaScript.

## 7. Live verification

1. Reload the planner at `/dispatcher/planner?date=<today>` on the test
   tenant.
2. Confirm right-rail counts shift from `All (7) / At Port (0) /
   Deliveries (0) / Return (0) / Other (7)` to approximately
   `All (7) / At Port (4) / Deliveries (0) / Return (3) / Other (0)`.
3. Click each bucket tab and verify the listed moves match the
   predicted classification table in §5.
4. Drag an unassigned move onto a driver row — confirm the move leaves
   the bucket and reappears in the correct bucket if unassigned again
   (tests `getBucket` via `useDriverPlanner` optimistic path).
5. Rerun `node scripts/moveBuckets.smoke.mjs` — all assertions pass.
6. Rerun `node scripts/planner-bucket-audit.js` — confirm "what the
   buckets WOULD be" section matches the right-rail render.

## 8. Rollout

Single commit on `main` (or a short branch if we want a PR checkpoint).
No migration, no data backfill, no user-facing copy changes. Impact is
limited to the Driver Planner right-rail counts.

## 9. Risk

- **Low.** The fix only changes classification of moves that are
  already returned by the planner endpoint — the query, the lifecycle
  filter, the branch scoping, and the UI all stay identical.
- **The 0-deliveries outcome is correct for today's data** but would
  look suspicious to a dispatcher expecting the bucket to populate.
  Mitigation: rely on §5 prediction table for verification, document
  that the bucket will populate when Drop & Hook workflows split moves
  into distinct legs (future workstream).
