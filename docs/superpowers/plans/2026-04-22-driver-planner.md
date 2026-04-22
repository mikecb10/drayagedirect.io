# Driver Planner Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a PortPro-style "Driver Planner" tab to the dispatcher module — drivers listed down the left, their day's moves laid out in expanding Move-N columns, unassigned pool on the right in four eligibility buckets, with drag-and-drop assignment + realtime sync.

**Architecture:** Introduce URL-query-param tabs on `/dispatcher` (`?tab=planner&date=YYYY-MM-DD`). New `DriverPlannerView` consumes a single aggregated GET endpoint on mount, then keeps local state fresh via Supabase Realtime subscriptions on `order_container_moves`, `order_routing_events`, and `orders`. Four mutation endpoints (assign / unassign / dispatch / reorder) drive the grid. Bucket eligibility computed by a shared pure util used by both server (initial payload) and client (realtime deltas).

**Tech Stack:** Next.js 15 (pages router), React 19, Supabase (Postgres + Realtime), Tailwind v4, `@dnd-kit/core` + `@dnd-kit/sortable` (already installed), `lucide-react` icons, `@supabase/ssr`. No unit-test framework — verification is Chrome live-gates + code review.

**Spec:** [`docs/superpowers/specs/2026-04-22-driver-planner-design.md`](../specs/2026-04-22-driver-planner-design.md)

---

## Invariants (apply to every task)

1. **Migrations** — every SQL file wrapped in `BEGIN; … COMMIT;` and ends with `NOTIFY pgrst, 'reload schema';` per [`memory/dev_migration_template.md`](../../../memory/dev_migration_template.md).
2. **Dark mode** — every new component MUST include `dark:` variants on every `bg-*`, `text-*`, `border-*` class per [`memory/dev_dark_mode_convention.md`](../../../memory/dev_dark_mode_convention.md).
3. **API auth boilerplate** — every new `pages/api/tenant/…` handler starts with:
   ```js
   const ctx = await requireTenantUser(req, res);
   if (!ctx) return;
   const svc = getServiceClient();
   if (!requirePermission(ctx, [PERMISSIONS.DISPATCHING, PERMISSIONS.ALL], res)) return;
   ```
4. **Audit logging** — every mutation writes a row via `logTenantAction(svc, { tenantId, userId, action, entityType, entityId, metadata, ip })` from `lib/tenant-audit`.
5. **Branch scoping** — every query that reads tenant data pipes through `applyBranchFilter(query, ctx)` from `lib/branch-filter`.
6. **Tenant scoping** — every SELECT/UPDATE/DELETE includes `.eq('tenant_id', ctx.tenantId)` even though RLS enforces it; belt-and-suspenders.
7. **Commit discipline** — each task ends with a commit. Keep commit messages short and scoped: `feat(driver-planner): …`, `fix(driver-planner): …`, `spec(driver-planner): …`. Include the `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>` trailer per repo convention.
8. **Permission constant** — use `PERMISSIONS.DISPATCHING` (value = `'dispatching'`). Do not invent new permission strings.

## File map

**New files:**
```
supabase/migrations/089_driver_planner_foundations.sql
lib/dispatcher/moveBuckets.js
scripts/moveBuckets.smoke.js
pages/api/tenant/dispatcher/planner/index.js           (GET)
pages/api/tenant/dispatcher/planner/assign.js          (POST)
pages/api/tenant/dispatcher/planner/unassign.js        (POST)
pages/api/tenant/dispatcher/planner/dispatch.js        (POST)
pages/api/tenant/dispatcher/planner/reorder.js         (POST)
components/dispatcher/DispatcherTabs.jsx
components/dispatcher/planner/DriverPlannerView.jsx
components/dispatcher/planner/PlannerToolbar.jsx
components/dispatcher/planner/DriverPlannerGrid.jsx
components/dispatcher/planner/DriverRow.jsx
components/dispatcher/planner/DriverMetaCard.jsx
components/dispatcher/planner/MoveSlot.jsx
components/dispatcher/planner/MoveCell.jsx
components/dispatcher/planner/UnassignedRightRail.jsx
components/dispatcher/planner/BucketTabs.jsx
components/dispatcher/planner/UnassignedMoveCard.jsx
components/dispatcher/planner/MovePreviewPanel.jsx
hooks/useDriverPlanner.js
```

**Modified files:**
```
pages/dispatcher/index.js                              (add tab state + URL sync)
```

---

## Task 1: Audit current schema state

**Files:**
- Create: `docs/superpowers/plans/2026-04-22-driver-planner-audit.md`

This task produces a short fact-finding report the next task depends on. No code.

- [ ] **Step 1: Check current `order_container_moves.status` enum/values**

Run:
```bash
grep -rn "order_container_moves" supabase/migrations/ | grep -i "status"
```
Read every match and list the current accepted values. Paste findings into `docs/superpowers/plans/2026-04-22-driver-planner-audit.md` under a heading `## 1. order_container_moves.status`.

- [ ] **Step 2: Check existing columns on `order_container_moves`**

Run:
```bash
grep -rn "order_container_moves" supabase/migrations/
```
List every column currently defined on the table (look at the `CREATE TABLE` block in migration 003 and any subsequent `ALTER TABLE` statements). Confirm whether `scheduled_date` and `sort_order` already exist (they shouldn't, but verify). Paste into the audit doc under `## 2. order_container_moves columns`.

- [ ] **Step 3: Check existing columns on `orders` related to our new flags**

Run:
```bash
grep -rn "container_at_port\|empty_ready_for_return\|at_port\|empty_ready" supabase/migrations/ lib/ pages/api/
```
Note whether anything close to `container_at_port` or `empty_ready_for_return_at` already exists under a different name. Paste into audit doc under `## 3. Existing container flags`.

- [ ] **Step 4: Check `drivers.status` values and existing ELD-shaped columns**

Run:
```bash
grep -rn "drivers\." supabase/migrations/ | grep -iE "status|eld|hos|cycle|samsara|motive"
```
Confirm `drivers.status` values are exactly `'active' | 'inactive' | 'on_leave'`. Confirm no existing ELD columns. Paste into audit doc under `## 4. drivers table`.

- [ ] **Step 5: Check the most recent migration number**

Run:
```bash
ls supabase/migrations/ | tail -5
```
Confirm the next available migration number. If the latest is not `088`, update this plan's migration number to `$(latest + 1)` everywhere in this document.

- [ ] **Step 6: Commit the audit doc**

```bash
git add docs/superpowers/plans/2026-04-22-driver-planner-audit.md
git commit -m "$(cat <<'EOF'
docs(driver-planner): schema audit — findings for migration 089

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Migration 089 — driver_planner_foundations

**Files:**
- Create: `supabase/migrations/089_driver_planner_foundations.sql`

This migration is additive and reversible. Exact behavior adapts to Task 1 audit findings — if a column already exists, skip the ADD; if a CHECK constraint is already present, ALTER it. Use `IF NOT EXISTS` / `IF EXISTS` aggressively.

- [ ] **Step 1: Draft the migration**

Create `supabase/migrations/089_driver_planner_foundations.sql`:

```sql
-- Migration 089: Driver Planner foundations
--
-- Additive schema changes supporting the new Driver Planner tab on the
-- dispatcher module. Spec: docs/superpowers/specs/2026-04-22-driver-planner-design.md
--
-- - order_container_moves: ensure status enum includes all 6 v1 values;
--   add scheduled_date + sort_order for the planner grid
-- - orders: add container_at_port boolean + empty_ready_for_return_at timestamp
--   driving the right-rail bucket eligibility
-- - drivers: add eld_snapshot jsonb as empty backing store for a future
--   ELD/HOS integration (Samsara/Motive/Geotab)

BEGIN;

-- 1. order_container_moves.status — normalize to the 6 v1 values
--    If a CHECK constraint already exists with a different value set, drop it first.
ALTER TABLE order_container_moves
  DROP CONSTRAINT IF EXISTS order_container_moves_status_check;

ALTER TABLE order_container_moves
  ADD CONSTRAINT order_container_moves_status_check
  CHECK (status IN ('unassigned', 'pending', 'dispatched', 'in_progress', 'completed', 'cancelled'));

-- Backfill any legacy NULL or foreign values to 'unassigned' (if driver_id is null) or 'pending'
UPDATE order_container_moves
   SET status = CASE WHEN driver_id IS NULL THEN 'unassigned' ELSE 'pending' END
 WHERE status IS NULL
    OR status NOT IN ('unassigned', 'pending', 'dispatched', 'in_progress', 'completed', 'cancelled');

-- 2. order_container_moves.scheduled_date + sort_order
ALTER TABLE order_container_moves
  ADD COLUMN IF NOT EXISTS scheduled_date date;

ALTER TABLE order_container_moves
  ADD COLUMN IF NOT EXISTS sort_order integer;

-- Backfill scheduled_date from the earliest routing event's scheduled_at for each move
UPDATE order_container_moves m
   SET scheduled_date = sub.min_date
  FROM (
    SELECT move_id, MIN(scheduled_at)::date AS min_date
      FROM order_routing_events
     WHERE scheduled_at IS NOT NULL
     GROUP BY move_id
  ) sub
 WHERE m.id = sub.move_id
   AND m.scheduled_date IS NULL;

-- Composite index for the grid query
CREATE INDEX IF NOT EXISTS idx_ocm_planner_grid
  ON order_container_moves (tenant_id, driver_id, scheduled_date, sort_order);

-- Secondary index for the right-rail (unassigned pool)
CREATE INDEX IF NOT EXISTS idx_ocm_unassigned_pool
  ON order_container_moves (tenant_id, status, move_type)
  WHERE driver_id IS NULL;

-- 3. orders: container_at_port + empty_ready_for_return_at
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS container_at_port boolean NOT NULL DEFAULT false;

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS empty_ready_for_return_at timestamptz;

-- Bucket eligibility often checks these together with move_type via joins;
-- a supporting index on orders is sufficient:
CREATE INDEX IF NOT EXISTS idx_orders_container_at_port
  ON orders (tenant_id, container_at_port)
  WHERE container_at_port = true;

-- 4. drivers.eld_snapshot — empty JSONB backing store
ALTER TABLE drivers
  ADD COLUMN IF NOT EXISTS eld_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMIT;

NOTIFY pgrst, 'reload schema';
```

- [ ] **Step 2: Verify migration parses locally**

Run (dry-run parse via psql-style comment check):
```bash
head -100 supabase/migrations/089_driver_planner_foundations.sql
```
Expected: no obvious syntax errors visible in the file output. (Full SQL correctness is verified when the user applies it.)

- [ ] **Step 3: Commit the migration**

```bash
git add supabase/migrations/089_driver_planner_foundations.sql
git commit -m "$(cat <<'EOF'
feat(driver-planner): migration 089 — planner foundations

Adds scheduled_date/sort_order on order_container_moves, container_at_port
+ empty_ready_for_return_at on orders, eld_snapshot jsonb on drivers.
Normalizes order_container_moves.status to the 6 v1 values and backfills
scheduled_date from earliest routing-event scheduled_at.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 4: USER ACTION — apply the migration**

Stop and tell the user:
> "Migration 089 is ready. Please apply it to the Supabase DB (paste into SQL editor and run) before I continue to Task 3."

Do not proceed to Task 3 until the user confirms application.

---

## Task 3: Bucket derivation util + smoke script

**Files:**
- Create: `lib/dispatcher/moveBuckets.js`
- Create: `scripts/moveBuckets.smoke.js`

Pure function shared between server (initial GET bucketing) and client (realtime delta re-bucketing). No unit-test framework is installed; verification is a runnable Node.js smoke script that throws on mismatch.

- [ ] **Step 1: Write the bucket util**

Create `lib/dispatcher/moveBuckets.js`:

```js
// Pure bucket-derivation util for the Driver Planner right-rail.
// Used by both server (initial payload bucketing) and client
// (realtime delta re-bucketing). See
// docs/superpowers/specs/2026-04-22-driver-planner-design.md §8

/**
 * Determine which right-rail bucket an unassigned move belongs to.
 *
 * @param {object} move  An order_container_moves row plus `events`
 *                       (order_routing_events rows belonging to the move).
 * @param {object} orderFlags  { lfd, container_at_port, empty_ready_for_return_at }
 *                             from the parent orders row.
 * @returns {'atPort' | 'deliveries' | 'return' | 'other' | null}
 *          Returns null if the move is assigned (driver_id is not null).
 */
export function getBucket(move, orderFlags) {
  if (!move) throw new Error('getBucket: move is required');
  if (move.driver_id != null) return null;

  const events = Array.isArray(move.events) ? move.events : [];
  const hasEventWithAppt = (type) =>
    events.some((e) => e.event_type === type && e.scheduled_at != null);

  if (
    move.move_type === 'pickup' &&
    orderFlags?.container_at_port === true &&
    (orderFlags?.lfd != null || hasEventWithAppt('pickup'))
  ) {
    return 'atPort';
  }

  if (move.move_type === 'delivery' && hasEventWithAppt('deliver')) {
    return 'deliveries';
  }

  if (move.move_type === 'return' && orderFlags?.empty_ready_for_return_at != null) {
    return 'return';
  }

  return 'other';
}

/**
 * Group an array of unassigned moves into the four buckets.
 *
 * @param {Array<{move, orderFlags}>} items
 * @returns {{ atPort: Array, deliveries: Array, return: Array, other: Array }}
 */
export function bucketize(items) {
  const out = { atPort: [], deliveries: [], return: [], other: [] };
  for (const { move, orderFlags } of items) {
    const b = getBucket(move, orderFlags);
    if (b == null) continue; // assigned, skip
    out[b].push(move);
  }
  return out;
}
```

- [ ] **Step 2: Write the smoke script**

Create `scripts/moveBuckets.smoke.js`:

```js
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
```

- [ ] **Step 3: Run the smoke script**

Run:
```bash
node scripts/moveBuckets.smoke.js
```
Expected: `13 passed, 0 failed` and exit 0.

If any fail, fix `lib/dispatcher/moveBuckets.js` until all pass, then re-run. Do not proceed with failures.

- [ ] **Step 4: Commit**

```bash
git add lib/dispatcher/moveBuckets.js scripts/moveBuckets.smoke.js
git commit -m "$(cat <<'EOF'
feat(driver-planner): bucket derivation util + smoke script

Pure function shared server+client that maps an unassigned move to one of
atPort/deliveries/return/other based on move_type + order flags (LFD,
container_at_port, empty_ready_for_return_at) + routing-event scheduled_at.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: `GET /api/tenant/dispatcher/planner`

**Files:**
- Create: `pages/api/tenant/dispatcher/planner/index.js`

Aggregated single-day planner payload. Returns active drivers + their moves + unassigned pool (pre-bucketed via `getBucket`).

- [ ] **Step 1: Create the handler**

Create `pages/api/tenant/dispatcher/planner/index.js`:

```js
import {
  requireTenantUser,
  requirePermission,
  getServiceClient,
} from '../../../../../lib/tenant-api';
import { PERMISSIONS } from '../../../../../lib/permissions';
import { applyBranchFilter } from '../../../../../lib/branch-filter';
import { getBucket } from '../../../../../lib/dispatcher/moveBuckets';

export default async function handler(req, res) {
  const ctx = await requireTenantUser(req, res);
  if (!ctx) return;

  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!requirePermission(ctx, [PERMISSIONS.DISPATCHING, PERMISSIONS.ALL], res)) return;

  const { date, driver_search, branch_id, include_inactive } = req.query;
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return res.status(400).json({ error: 'date=YYYY-MM-DD is required' });
  }

  const svc = getServiceClient();

  // ── Drivers ───────────────────────────────────────────────────────────
  let driverQuery = svc
    .from('drivers')
    .select('id, name, first_name, last_name, phone, truck_number, status, eld_snapshot')
    .eq('tenant_id', ctx.tenantId)
    .is('deleted_at', null)
    .order('name', { ascending: true });

  driverQuery = applyBranchFilter(driverQuery, ctx);
  if (branch_id) driverQuery = driverQuery.eq('branch_id', branch_id);

  if (include_inactive !== '1') {
    driverQuery = driverQuery.eq('status', 'active');
  }
  if (driver_search && driver_search.trim()) {
    const q = driver_search.trim();
    driverQuery = driverQuery.or(
      `name.ilike.%${q}%,truck_number.ilike.%${q}%,first_name.ilike.%${q}%,last_name.ilike.%${q}%`
    );
  }

  const { data: drivers, error: driversErr } = await driverQuery;
  if (driversErr) return res.status(500).json({ error: driversErr.message });

  // ── Moves on the given date (assigned) + unassigned pool ──────────────
  // One query returns both sets; we partition after fetch.
  let moveQuery = svc
    .from('order_container_moves')
    .select(
      `
      id, tenant_id, order_id, sequence, move_type,
      driver_id, truck_id, chassis_id,
      status, started_at, completed_at, scheduled_date, sort_order,
      assigned_at,
      order:orders!order_container_moves_order_id_fkey(
        id, order_number, container_number, container_size, container_type,
        lfd, container_at_port, empty_ready_for_return_at, branch_id
      ),
      events:order_routing_events!order_routing_events_move_id_fkey(
        id, sequence, event_type, location_id, location_name, city, state,
        scheduled_at, arrived_at, departed_at
      )
      `
    )
    .eq('tenant_id', ctx.tenantId)
    .is('deleted_at', null);

  // Either: scheduled on this date (assigned moves shown on grid)
  // OR: unassigned (right-rail pool — shown regardless of scheduled_date)
  moveQuery = moveQuery.or(`scheduled_date.eq.${date},driver_id.is.null`);

  const { data: moves, error: movesErr } = await moveQuery;
  if (movesErr) return res.status(500).json({ error: movesErr.message });

  // Branch scoping via the joined orders row
  const branchScoped = (moves || []).filter((m) => {
    if (!m.order) return false;
    if (branch_id && m.order.branch_id !== branch_id) return false;
    // applyBranchFilter on the outer query only scopes drivers, not moves —
    // do the branch check on the order directly for parity. Admins (no
    // scoped branches in ctx) see all.
    if (ctx.branchIds && ctx.branchIds.length > 0) {
      return m.order.branch_id == null || ctx.branchIds.includes(m.order.branch_id);
    }
    return true;
  });

  // Partition assigned vs unassigned
  const assigned = branchScoped.filter((m) => m.driver_id != null && m.scheduled_date === date);
  const unassigned = branchScoped.filter((m) => m.driver_id == null);

  // ── Build movesByDriverId (sorted by sort_order, then sequence) ────────
  const driverIdSet = new Set(drivers.map((d) => d.id));
  const movesByDriverId = {};
  for (const d of drivers) movesByDriverId[d.id] = [];
  for (const m of assigned) {
    if (!driverIdSet.has(m.driver_id)) continue; // driver filtered out by search/inactive
    movesByDriverId[m.driver_id].push(m);
  }
  for (const arr of Object.values(movesByDriverId)) {
    arr.sort((a, b) => {
      const aa = a.sort_order ?? 1e9;
      const bb = b.sort_order ?? 1e9;
      if (aa !== bb) return aa - bb;
      return (a.sequence ?? 0) - (b.sequence ?? 0);
    });
  }

  // ── Bucket unassigned moves via the shared util ───────────────────────
  const unassignedBuckets = { atPort: [], deliveries: [], return: [], other: [] };
  for (const m of unassigned) {
    const orderFlags = m.order
      ? {
          lfd: m.order.lfd,
          container_at_port: m.order.container_at_port,
          empty_ready_for_return_at: m.order.empty_ready_for_return_at,
        }
      : {};
    const b = getBucket(m, orderFlags);
    if (b != null) unassignedBuckets[b].push(m);
  }

  // ── Derive meta (ETA / Truck / Chassis / Size) for each driver row ────
  // Rule: current = oldest in_progress move for the date; fallback = earliest pending/dispatched.
  const driversOut = drivers.map((d) => {
    const rows = movesByDriverId[d.id] || [];
    const inProgress = rows.find((m) => m.status === 'in_progress');
    const next = rows.find((m) => m.status === 'pending' || m.status === 'dispatched');
    const ref = inProgress || next || null;
    const pickup = ref?.events?.find((e) => e.event_type === 'pickup');

    return {
      id: d.id,
      name: d.name || [d.first_name, d.last_name].filter(Boolean).join(' '),
      short_code: initials(d.name || [d.first_name, d.last_name].filter(Boolean).join(' ')),
      truck_number: d.truck_number,
      status: d.status,
      current_move_id: inProgress?.id || null,
      next_move_id: next?.id || null,
      derived: {
        eta: pickup?.scheduled_at
          ? new Date(pickup.scheduled_at).toISOString().slice(11, 16) // HH:MM UTC
          : null,
        truck_number: d.truck_number || null,
        chassis_number: ref?.chassis_id || null,
        container_size: ref?.order?.container_size || null,
      },
      eld: d.eld_snapshot && Object.keys(d.eld_snapshot).length > 0 ? d.eld_snapshot : null,
    };
  });

  return res.status(200).json({
    date,
    drivers: driversOut,
    movesByDriverId,
    unassignedBuckets,
  });
}

function initials(name) {
  if (!name) return '';
  const parts = name.trim().split(/\s+/);
  return (parts[0]?.[0] || '') + (parts[parts.length - 1]?.[0] || '');
}
```

- [ ] **Step 2: Verify import paths by resolving them**

Run:
```bash
ls lib/tenant-api.js lib/permissions.js lib/branch-filter.js lib/dispatcher/moveBuckets.js
```
Expected: all 4 files listed without errors.

- [ ] **Step 3: Chrome verification — hit the endpoint with valid auth**

Start dev server if not running:
```bash
npm run dev
```

Then via Claude-in-Chrome MCP, navigate to `/dispatcher` while logged in, open DevTools, paste into console:
```js
fetch('/api/tenant/dispatcher/planner?date=2026-04-22').then(r => r.json()).then(d => console.log(d))
```
Expected: JSON response with `date`, `drivers` (array), `movesByDriverId` (object), `unassignedBuckets` (object with 4 array keys). No 401/403/500.

Also verify: `GET /api/tenant/dispatcher/planner` (no date) → 400.

- [ ] **Step 4: Commit**

```bash
git add pages/api/tenant/dispatcher/planner/index.js
git commit -m "$(cat <<'EOF'
feat(driver-planner): GET /api/tenant/dispatcher/planner endpoint

Aggregated single-day payload: active drivers + their moves (sorted by
sort_order) + unassigned pool bucketed via shared getBucket util.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: `POST /api/tenant/dispatcher/planner/assign`

**Files:**
- Create: `pages/api/tenant/dispatcher/planner/assign.js`

Assigns (or re-assigns) a move to a driver, sets `scheduled_date`, computes `sort_order`, and resequences the target driver's row.

- [ ] **Step 1: Create the handler**

Create `pages/api/tenant/dispatcher/planner/assign.js`:

```js
import {
  requireTenantUser,
  requirePermission,
  getServiceClient,
} from '../../../../../lib/tenant-api';
import { logTenantAction, getClientIp } from '../../../../../lib/tenant-audit';
import { PERMISSIONS } from '../../../../../lib/permissions';

const BLOCKED_STATUSES = new Set(['in_progress', 'completed', 'cancelled']);

export default async function handler(req, res) {
  const ctx = await requireTenantUser(req, res);
  if (!ctx) return;

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!requirePermission(ctx, [PERMISSIONS.DISPATCHING, PERMISSIONS.ALL], res)) return;

  const { moveId, driverId, truckId = null, chassisId = null, date, insertAfterMoveId = null, positionIndex = null } = req.body || {};

  if (!moveId || !driverId || !date) {
    return res.status(400).json({ error: 'moveId, driverId, and date are required' });
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return res.status(400).json({ error: 'date must be YYYY-MM-DD' });
  }
  const hasAfter = insertAfterMoveId != null;
  const hasIndex = positionIndex != null;
  if (hasAfter === hasIndex) {
    return res.status(400).json({ error: 'Exactly one of insertAfterMoveId or positionIndex is required' });
  }

  const svc = getServiceClient();

  // Load the move; check tenant + status
  const { data: move, error: moveErr } = await svc
    .from('order_container_moves')
    .select('id, tenant_id, driver_id, status, scheduled_date, sort_order')
    .eq('id', moveId)
    .eq('tenant_id', ctx.tenantId)
    .maybeSingle();
  if (moveErr) return res.status(500).json({ error: moveErr.message });
  if (!move) return res.status(404).json({ error: 'Move not found' });
  if (BLOCKED_STATUSES.has(move.status)) {
    return res.status(409).json({ error: `Cannot assign a move with status ${move.status}` });
  }

  // Verify driver exists in this tenant
  const { data: driver, error: driverErr } = await svc
    .from('drivers')
    .select('id')
    .eq('id', driverId)
    .eq('tenant_id', ctx.tenantId)
    .is('deleted_at', null)
    .maybeSingle();
  if (driverErr) return res.status(500).json({ error: driverErr.message });
  if (!driver) return res.status(404).json({ error: 'Driver not found' });

  // Compute target sort_order based on current row
  const { data: rowMoves, error: rowErr } = await svc
    .from('order_container_moves')
    .select('id, sort_order')
    .eq('tenant_id', ctx.tenantId)
    .eq('driver_id', driverId)
    .eq('scheduled_date', date)
    .is('deleted_at', null)
    .order('sort_order', { ascending: true });
  if (rowErr) return res.status(500).json({ error: rowErr.message });

  // Build target order of IDs — excluding the incoming move (if it was already in this row)
  const currentIds = (rowMoves || []).map((r) => r.id).filter((id) => id !== moveId);
  let insertAt = 0;
  if (hasAfter) {
    const idx = currentIds.indexOf(insertAfterMoveId);
    insertAt = idx < 0 ? currentIds.length : idx + 1;
  } else {
    insertAt = Math.max(0, Math.min(positionIndex, currentIds.length));
  }
  const newOrder = [...currentIds.slice(0, insertAt), moveId, ...currentIds.slice(insertAt)];

  const prevStatus = move.status;
  const newStatus =
    move.status === 'unassigned' ? 'pending' : move.status; // preserve pending/dispatched

  // Transactional-ish update: in one pass update the moved row + dense-resequence everyone.
  // Supabase JS doesn't have multi-row transactions directly; do it as an upsert per row in a Promise.all.
  const updates = newOrder.map((id, idx) => {
    const fields = { sort_order: idx };
    if (id === moveId) {
      Object.assign(fields, {
        driver_id: driverId,
        truck_id: truckId,
        chassis_id: chassisId,
        scheduled_date: date,
        status: newStatus,
        assigned_at: new Date().toISOString(),
      });
    }
    return svc
      .from('order_container_moves')
      .update(fields)
      .eq('id', id)
      .eq('tenant_id', ctx.tenantId);
  });
  const results = await Promise.all(updates);
  const anyErr = results.find((r) => r.error);
  if (anyErr) return res.status(500).json({ error: anyErr.error.message });

  await logTenantAction(svc, {
    tenantId: ctx.tenantId,
    userId: ctx.userId,
    action: 'assign',
    entityType: 'order_container_move',
    entityId: moveId,
    oldValues: { driver_id: move.driver_id, status: prevStatus, scheduled_date: move.scheduled_date, sort_order: move.sort_order },
    newValues: { driver_id: driverId, truck_id: truckId, chassis_id: chassisId, scheduled_date: date, status: newStatus, insertAfterMoveId, positionIndex },
    ipAddress: getClientIp(req),
  });

  // Return the updated move (fresh read)
  const { data: updated } = await svc
    .from('order_container_moves')
    .select('id, driver_id, truck_id, chassis_id, scheduled_date, sort_order, status, assigned_at')
    .eq('id', moveId)
    .maybeSingle();

  return res.status(200).json({ move: updated });
}
```

- [ ] **Step 2: Chrome verification — assign an unassigned move**

Via DevTools console on `/dispatcher`:
```js
// 1. Find an unassigned move + a driver
const payload = await fetch('/api/tenant/dispatcher/planner?date=2026-04-22').then(r => r.json());
const move = payload.unassignedBuckets.atPort[0] || payload.unassignedBuckets.other[0];
const driver = payload.drivers[0];
console.log({ moveId: move?.id, driverId: driver?.id });

// 2. Assign
const r = await fetch('/api/tenant/dispatcher/planner/assign', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ moveId: move.id, driverId: driver.id, date: '2026-04-22', positionIndex: 0 })
}).then(r => r.json());
console.log(r);
```
Expected: `{ move: { ... driver_id: <driver.id>, scheduled_date: '2026-04-22', sort_order: 0, status: 'pending' ... } }`.

Also verify error cases:
```js
// Missing params → 400
fetch('/api/tenant/dispatcher/planner/assign', { method: 'POST', headers: {'Content-Type':'application/json'}, body: '{}' }).then(r => r.status) // 400

// Non-existent move → 404
fetch('/api/tenant/dispatcher/planner/assign', { method: 'POST', headers: {'Content-Type':'application/json'},
  body: JSON.stringify({ moveId: '00000000-0000-0000-0000-000000000000', driverId: driver.id, date: '2026-04-22', positionIndex: 0 })
}).then(r => r.status) // 404
```

- [ ] **Step 3: Commit**

```bash
git add pages/api/tenant/dispatcher/planner/assign.js
git commit -m "$(cat <<'EOF'
feat(driver-planner): POST /api/tenant/dispatcher/planner/assign

Assigns a move to a driver, sets scheduled_date, computes sort_order by
positionIndex OR insertAfterMoveId, dense-resequences the target row, and
writes an audit row. Blocks in_progress/completed/cancelled sources with 409.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: `POST /api/tenant/dispatcher/planner/unassign`

**Files:**
- Create: `pages/api/tenant/dispatcher/planner/unassign.js`

Clears driver assignment, resequences the prior row, idempotent on already-unassigned.

- [ ] **Step 1: Create the handler**

Create `pages/api/tenant/dispatcher/planner/unassign.js`:

```js
import {
  requireTenantUser,
  requirePermission,
  getServiceClient,
} from '../../../../../lib/tenant-api';
import { logTenantAction, getClientIp } from '../../../../../lib/tenant-audit';
import { PERMISSIONS } from '../../../../../lib/permissions';

const BLOCKED_STATUSES = new Set(['in_progress', 'completed', 'cancelled']);

export default async function handler(req, res) {
  const ctx = await requireTenantUser(req, res);
  if (!ctx) return;

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!requirePermission(ctx, [PERMISSIONS.DISPATCHING, PERMISSIONS.ALL], res)) return;

  const { moveId } = req.body || {};
  if (!moveId) return res.status(400).json({ error: 'moveId required' });

  const svc = getServiceClient();

  const { data: move, error: moveErr } = await svc
    .from('order_container_moves')
    .select('id, tenant_id, driver_id, scheduled_date, sort_order, status')
    .eq('id', moveId)
    .eq('tenant_id', ctx.tenantId)
    .maybeSingle();
  if (moveErr) return res.status(500).json({ error: moveErr.message });
  if (!move) return res.status(404).json({ error: 'Move not found' });

  if (BLOCKED_STATUSES.has(move.status)) {
    return res.status(409).json({ error: `Cannot unassign a move with status ${move.status}` });
  }

  // Idempotent no-op if already unassigned
  if (move.status === 'unassigned' || move.driver_id == null) {
    return res.status(200).json({ move });
  }

  const prevDriverId = move.driver_id;
  const prevDate = move.scheduled_date;

  const { error: updErr } = await svc
    .from('order_container_moves')
    .update({
      driver_id: null,
      truck_id: null,
      chassis_id: null,
      scheduled_date: null,
      sort_order: null,
      status: 'unassigned',
    })
    .eq('id', moveId)
    .eq('tenant_id', ctx.tenantId);
  if (updErr) return res.status(500).json({ error: updErr.message });

  // Dense-resequence the prior row
  if (prevDriverId && prevDate) {
    const { data: rowMoves } = await svc
      .from('order_container_moves')
      .select('id')
      .eq('tenant_id', ctx.tenantId)
      .eq('driver_id', prevDriverId)
      .eq('scheduled_date', prevDate)
      .is('deleted_at', null)
      .order('sort_order', { ascending: true });

    await Promise.all(
      (rowMoves || []).map((r, idx) =>
        svc
          .from('order_container_moves')
          .update({ sort_order: idx })
          .eq('id', r.id)
          .eq('tenant_id', ctx.tenantId)
      )
    );
  }

  await logTenantAction(svc, {
    tenantId: ctx.tenantId,
    userId: ctx.userId,
    action: 'unassign',
    entityType: 'order_container_move',
    entityId: moveId,
    oldValues: { driver_id: prevDriverId, scheduled_date: prevDate, status: move.status, sort_order: move.sort_order },
    newValues: { driver_id: null, scheduled_date: null, status: 'unassigned', sort_order: null },
    ipAddress: getClientIp(req),
  });

  const { data: updated } = await svc
    .from('order_container_moves')
    .select('id, driver_id, truck_id, chassis_id, scheduled_date, sort_order, status')
    .eq('id', moveId)
    .maybeSingle();

  return res.status(200).json({ move: updated });
}
```

- [ ] **Step 2: Chrome verification**

Via DevTools console:
```js
// 1. Unassign the move we assigned in Task 5
const moveId = /* the id from Task 5 */;
const r = await fetch('/api/tenant/dispatcher/planner/unassign', {
  method: 'POST', headers: {'Content-Type':'application/json'},
  body: JSON.stringify({ moveId })
}).then(r => r.json());
console.log(r);

// 2. Call again → idempotent 200
await fetch('/api/tenant/dispatcher/planner/unassign', {
  method: 'POST', headers: {'Content-Type':'application/json'},
  body: JSON.stringify({ moveId })
}).then(r => r.status); // 200
```
Expected: first call returns `{ move: { driver_id: null, status: 'unassigned', ... } }`. Second call also returns 200 (no-op).

- [ ] **Step 3: Commit**

```bash
git add pages/api/tenant/dispatcher/planner/unassign.js
git commit -m "$(cat <<'EOF'
feat(driver-planner): POST /api/tenant/dispatcher/planner/unassign

Clears driver/truck/chassis/scheduled_date/sort_order, transitions status
to unassigned, dense-resequences the prior row. Idempotent on already-
unassigned. Blocks in_progress/completed/cancelled with 409.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: `POST /api/tenant/dispatcher/planner/dispatch`

**Files:**
- Create: `pages/api/tenant/dispatcher/planner/dispatch.js`

Flips status `pending → dispatched`. Re-dispatch allowed (audits as `redispatch`).

- [ ] **Step 1: Create the handler**

Create `pages/api/tenant/dispatcher/planner/dispatch.js`:

```js
import {
  requireTenantUser,
  requirePermission,
  getServiceClient,
} from '../../../../../lib/tenant-api';
import { logTenantAction, getClientIp } from '../../../../../lib/tenant-audit';
import { PERMISSIONS } from '../../../../../lib/permissions';

const ALLOWED = new Set(['pending', 'dispatched']);

export default async function handler(req, res) {
  const ctx = await requireTenantUser(req, res);
  if (!ctx) return;

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!requirePermission(ctx, [PERMISSIONS.DISPATCHING, PERMISSIONS.ALL], res)) return;

  const { moveId } = req.body || {};
  if (!moveId) return res.status(400).json({ error: 'moveId required' });

  const svc = getServiceClient();

  const { data: move, error: moveErr } = await svc
    .from('order_container_moves')
    .select('id, tenant_id, driver_id, status')
    .eq('id', moveId)
    .eq('tenant_id', ctx.tenantId)
    .maybeSingle();
  if (moveErr) return res.status(500).json({ error: moveErr.message });
  if (!move) return res.status(404).json({ error: 'Move not found' });
  if (!ALLOWED.has(move.status)) {
    return res.status(409).json({ error: `Cannot dispatch a move with status ${move.status}` });
  }
  if (move.driver_id == null) {
    return res.status(409).json({ error: 'Move must be assigned to a driver before dispatch' });
  }

  const action = move.status === 'dispatched' ? 'redispatch' : 'dispatch';

  const { error: updErr } = await svc
    .from('order_container_moves')
    .update({ status: 'dispatched' })
    .eq('id', moveId)
    .eq('tenant_id', ctx.tenantId);
  if (updErr) return res.status(500).json({ error: updErr.message });

  await logTenantAction(svc, {
    tenantId: ctx.tenantId,
    userId: ctx.userId,
    action,
    entityType: 'order_container_move',
    entityId: moveId,
    oldValues: { status: move.status },
    newValues: { status: 'dispatched', driver_id: move.driver_id },
    ipAddress: getClientIp(req),
  });

  return res.status(200).json({ moveId, status: 'dispatched', action });
}
```

- [ ] **Step 2: Chrome verification**

Via DevTools console:
```js
// Assign a move first (see Task 5), then dispatch it:
const r = await fetch('/api/tenant/dispatcher/planner/dispatch', {
  method: 'POST', headers: {'Content-Type':'application/json'},
  body: JSON.stringify({ moveId })
}).then(r => r.json());
console.log(r); // { moveId, status: 'dispatched', action: 'dispatch' }

// Re-dispatch → action: 'redispatch'
const r2 = await fetch('/api/tenant/dispatcher/planner/dispatch', {
  method: 'POST', headers: {'Content-Type':'application/json'},
  body: JSON.stringify({ moveId })
}).then(r => r.json());
console.log(r2); // { ..., action: 'redispatch' }
```

- [ ] **Step 3: Commit**

```bash
git add pages/api/tenant/dispatcher/planner/dispatch.js
git commit -m "$(cat <<'EOF'
feat(driver-planner): POST /api/tenant/dispatcher/planner/dispatch

Flips status pending → dispatched (re-dispatch allowed, audits as
redispatch). Blocks unassigned moves with 409.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: `POST /api/tenant/dispatcher/planner/reorder`

**Files:**
- Create: `pages/api/tenant/dispatcher/planner/reorder.js`

Bulk resequence of moves for one driver on one date.

- [ ] **Step 1: Create the handler**

Create `pages/api/tenant/dispatcher/planner/reorder.js`:

```js
import {
  requireTenantUser,
  requirePermission,
  getServiceClient,
} from '../../../../../lib/tenant-api';
import { logTenantAction, getClientIp } from '../../../../../lib/tenant-audit';
import { PERMISSIONS } from '../../../../../lib/permissions';

export default async function handler(req, res) {
  const ctx = await requireTenantUser(req, res);
  if (!ctx) return;

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!requirePermission(ctx, [PERMISSIONS.DISPATCHING, PERMISSIONS.ALL], res)) return;

  const { driverId, date, orderedMoveIds } = req.body || {};
  if (!driverId || !date || !Array.isArray(orderedMoveIds) || orderedMoveIds.length === 0) {
    return res.status(400).json({ error: 'driverId, date, orderedMoveIds[] required' });
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return res.status(400).json({ error: 'date must be YYYY-MM-DD' });
  }

  const svc = getServiceClient();

  // Validate that every move belongs to this driver/date/tenant
  const { data: rows, error: rowsErr } = await svc
    .from('order_container_moves')
    .select('id, driver_id, scheduled_date')
    .in('id', orderedMoveIds)
    .eq('tenant_id', ctx.tenantId);
  if (rowsErr) return res.status(500).json({ error: rowsErr.message });

  const badRow = (rows || []).find(
    (r) => r.driver_id !== driverId || r.scheduled_date !== date
  );
  if (badRow) {
    return res
      .status(400)
      .json({ error: `Move ${badRow.id} does not belong to this driver/date` });
  }
  if ((rows || []).length !== orderedMoveIds.length) {
    return res.status(400).json({ error: 'One or more moves not found' });
  }

  // Dense resequence
  await Promise.all(
    orderedMoveIds.map((id, idx) =>
      svc
        .from('order_container_moves')
        .update({ sort_order: idx })
        .eq('id', id)
        .eq('tenant_id', ctx.tenantId)
    )
  );

  await logTenantAction(svc, {
    tenantId: ctx.tenantId,
    userId: ctx.userId,
    action: 'reorder',
    entityType: 'order_container_move',
    entityId: driverId, // log against the driver + date
    oldValues: null,
    newValues: { driverId, date, orderedMoveIds },
    ipAddress: getClientIp(req),
  });

  return res.status(200).json({ ok: true, count: orderedMoveIds.length });
}
```

- [ ] **Step 2: Chrome verification**

Via DevTools console (after assigning 2+ moves to a driver):
```js
const payload = await fetch('/api/tenant/dispatcher/planner?date=2026-04-22').then(r => r.json());
const driverId = Object.keys(payload.movesByDriverId).find(k => payload.movesByDriverId[k].length >= 2);
const moves = payload.movesByDriverId[driverId];
const reversed = moves.map(m => m.id).reverse();

const r = await fetch('/api/tenant/dispatcher/planner/reorder', {
  method: 'POST', headers: {'Content-Type':'application/json'},
  body: JSON.stringify({ driverId, date: '2026-04-22', orderedMoveIds: reversed })
}).then(r => r.json());
console.log(r); // { ok: true, count: N }

// Verify order flipped
const after = await fetch('/api/tenant/dispatcher/planner?date=2026-04-22').then(r => r.json());
console.log(after.movesByDriverId[driverId].map(m => m.id)); // matches `reversed`
```

- [ ] **Step 3: Commit**

```bash
git add pages/api/tenant/dispatcher/planner/reorder.js
git commit -m "$(cat <<'EOF'
feat(driver-planner): POST /api/tenant/dispatcher/planner/reorder

Dense-resequence sort_order for a single driver+date in one shot. Validates
that every provided move belongs to that driver+date+tenant before writing.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: `DispatcherTabs` component + URL sync on `/dispatcher`

**Files:**
- Create: `components/dispatcher/DispatcherTabs.jsx`
- Modify: `pages/dispatcher/index.js` (add tab state at the top of the page)

Introduces the first tab system on the dispatcher page. Load Board is the default; Driver Planner is a placeholder "Coming soon" view that subsequent tasks replace with real content.

- [ ] **Step 1: Create the tabs component**

Create `components/dispatcher/DispatcherTabs.jsx`:

```jsx
import { useRouter } from 'next/router';

const TABS = [
  { id: 'loadBoard', label: 'Load Board' },
  { id: 'planner', label: 'Driver Planner' },
];

export default function DispatcherTabs({ activeTab }) {
  const router = useRouter();

  function selectTab(id) {
    const query = { ...router.query };
    if (id === 'loadBoard') delete query.tab;
    else query.tab = id;
    router.replace({ pathname: '/dispatcher', query }, undefined, { shallow: true });
  }

  return (
    <div className="border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900">
      <div className="flex gap-1 px-4">
        {TABS.map((t) => {
          const active = t.id === activeTab;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => selectTab(t.id)}
              className={[
                'px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors',
                active
                  ? 'border-blue-600 text-blue-600 dark:border-blue-400 dark:text-blue-400'
                  : 'border-transparent text-gray-600 hover:text-gray-900 hover:border-gray-300 dark:text-gray-400 dark:hover:text-gray-200 dark:hover:border-gray-600',
              ].join(' ')}
            >
              {t.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Wire tabs into `pages/dispatcher/index.js`**

Read the current file to find where `ModuleHeader` is rendered (around lines 564-605 per the exploration):
```bash
grep -n "ModuleHeader" pages/dispatcher/index.js
```

Add the import at the top of the file:
```js
import DispatcherTabs from '../../components/dispatcher/DispatcherTabs';
```

Inside the component body, add tab state derived from the URL:
```js
const router = useRouter();
const activeTab = router.query.tab === 'planner' ? 'planner' : 'loadBoard';
```

Render `<DispatcherTabs activeTab={activeTab} />` immediately after the `<ModuleHeader />` JSX, and wrap the rest of the page body in a conditional:
```jsx
<DispatcherTabs activeTab={activeTab} />

{activeTab === 'loadBoard' && (
  <>
    {/* existing content: date filter / KPIs / search / DispatcherBoard */}
  </>
)}

{activeTab === 'planner' && (
  <div className="p-8 text-center text-gray-500 dark:text-gray-400">
    Driver Planner — coming online in subsequent tasks.
  </div>
)}
```

(The engineer should locate the existing return's outer fragment and move its load-board-specific children inside the `loadBoard` branch. Do not duplicate `ModuleHeader`.)

- [ ] **Step 3: Chrome verification**

Start/ensure dev server is running (`npm run dev`), navigate via Claude-in-Chrome MCP to:

1. `/dispatcher` → Load Board tab active; content unchanged from before this task.
2. Click "Driver Planner" tab → URL becomes `/dispatcher?tab=planner`, content shows the placeholder text.
3. Click browser Back → URL returns to `/dispatcher`, Load Board active.
4. Paste `/dispatcher?tab=planner` directly into the address bar → planner placeholder shows on load.

Take a screenshot of the tab bar for the commit.

- [ ] **Step 4: Commit**

```bash
git add components/dispatcher/DispatcherTabs.jsx pages/dispatcher/index.js
git commit -m "$(cat <<'EOF'
feat(driver-planner): DispatcherTabs + URL query-param sync

Adds the first tab system on /dispatcher. Load Board stays the default;
Driver Planner is a placeholder that subsequent tasks fill in.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 10: `useDriverPlanner` hook — initial fetch only (no realtime yet)

**Files:**
- Create: `hooks/useDriverPlanner.js`

Fetch logic + reducer for the planner's local state. Realtime comes in Task 18.

- [ ] **Step 1: Write the hook**

Create `hooks/useDriverPlanner.js`:

```js
import { useCallback, useEffect, useReducer, useRef } from 'react';
import { useAuth } from '../contexts/AuthContext';

const initial = {
  date: null,
  drivers: [],
  movesByDriverId: {},
  unassignedBuckets: { atPort: [], deliveries: [], return: [], other: [] },
  isLoading: true,
  error: null,
};

function reducer(state, action) {
  switch (action.type) {
    case 'LOADING':
      return { ...state, isLoading: true, error: null };
    case 'HYDRATE':
      return { ...action.payload, isLoading: false, error: null };
    case 'ERROR':
      return { ...state, isLoading: false, error: action.error };
    case 'OPTIMISTIC_ASSIGN': {
      // Move `moveId` from wherever it lives (unassigned or another driver row)
      // to the target driver at the target index.
      const { move, driverId, index } = action;
      const next = cloneState(state);
      removeMoveEverywhere(next, move.id);
      const row = next.movesByDriverId[driverId] || (next.movesByDriverId[driverId] = []);
      const clone = { ...move, driver_id: driverId, status: move.status === 'unassigned' ? 'pending' : move.status };
      row.splice(Math.max(0, Math.min(index, row.length)), 0, clone);
      renumberSortOrder(row);
      return next;
    }
    case 'OPTIMISTIC_UNASSIGN': {
      const { move } = action;
      const next = cloneState(state);
      removeMoveEverywhere(next, move.id);
      // Re-bucket the now-unassigned move (use the client-side util). Caller
      // supplies the fresh orderFlags via action.orderFlags.
      const b = action.bucket; // 'atPort' | 'deliveries' | 'return' | 'other'
      if (b) next.unassignedBuckets[b].push({ ...move, driver_id: null, status: 'unassigned' });
      return next;
    }
    case 'OPTIMISTIC_DISPATCH': {
      const { moveId } = action;
      const next = cloneState(state);
      for (const arr of Object.values(next.movesByDriverId)) {
        const i = arr.findIndex((m) => m.id === moveId);
        if (i >= 0) arr[i] = { ...arr[i], status: 'dispatched' };
      }
      return next;
    }
    case 'OPTIMISTIC_REORDER': {
      const { driverId, orderedMoveIds } = action;
      const next = cloneState(state);
      const row = next.movesByDriverId[driverId] || [];
      const byId = Object.fromEntries(row.map((m) => [m.id, m]));
      next.movesByDriverId[driverId] = orderedMoveIds.map((id) => byId[id]).filter(Boolean);
      renumberSortOrder(next.movesByDriverId[driverId]);
      return next;
    }
    case 'ROLLBACK':
      return action.snapshot;
    default:
      return state;
  }
}

function cloneState(s) {
  return {
    ...s,
    movesByDriverId: Object.fromEntries(
      Object.entries(s.movesByDriverId).map(([k, v]) => [k, v.slice()])
    ),
    unassignedBuckets: {
      atPort: s.unassignedBuckets.atPort.slice(),
      deliveries: s.unassignedBuckets.deliveries.slice(),
      return: s.unassignedBuckets.return.slice(),
      other: s.unassignedBuckets.other.slice(),
    },
  };
}

function removeMoveEverywhere(state, moveId) {
  for (const arr of Object.values(state.movesByDriverId)) {
    const i = arr.findIndex((m) => m.id === moveId);
    if (i >= 0) arr.splice(i, 1);
  }
  for (const key of Object.keys(state.unassignedBuckets)) {
    const arr = state.unassignedBuckets[key];
    const i = arr.findIndex((m) => m.id === moveId);
    if (i >= 0) arr.splice(i, 1);
  }
}

function renumberSortOrder(arr) {
  arr.forEach((m, i) => (m.sort_order = i));
}

export default function useDriverPlanner({ date, driverSearch = '', branchId = null, includeInactive = false }) {
  const { supabase, tenantId } = useAuth();
  const [state, dispatch] = useReducer(reducer, initial);
  const lastSnapshotRef = useRef(null);

  const fetchPlanner = useCallback(async () => {
    if (!date) return;
    dispatch({ type: 'LOADING' });
    const qs = new URLSearchParams({ date });
    if (driverSearch) qs.set('driver_search', driverSearch);
    if (branchId) qs.set('branch_id', branchId);
    if (includeInactive) qs.set('include_inactive', '1');
    try {
      const r = await fetch(`/api/tenant/dispatcher/planner?${qs.toString()}`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const payload = await r.json();
      dispatch({ type: 'HYDRATE', payload });
    } catch (e) {
      dispatch({ type: 'ERROR', error: e });
    }
  }, [date, driverSearch, branchId, includeInactive]);

  useEffect(() => {
    fetchPlanner();
  }, [fetchPlanner]);

  // Mutation helpers — each is optimistic, rolls back on failure.
  const mutations = {
    async assign({ move, driverId, index, truckId = null, chassisId = null }) {
      lastSnapshotRef.current = state;
      dispatch({ type: 'OPTIMISTIC_ASSIGN', move, driverId, index });
      try {
        const r = await fetch('/api/tenant/dispatcher/planner/assign', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ moveId: move.id, driverId, truckId, chassisId, date, positionIndex: index }),
        });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
      } catch (e) {
        dispatch({ type: 'ROLLBACK', snapshot: lastSnapshotRef.current });
        throw e;
      }
    },
    async unassign({ move, bucket }) {
      lastSnapshotRef.current = state;
      dispatch({ type: 'OPTIMISTIC_UNASSIGN', move, bucket });
      try {
        const r = await fetch('/api/tenant/dispatcher/planner/unassign', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ moveId: move.id }),
        });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
      } catch (e) {
        dispatch({ type: 'ROLLBACK', snapshot: lastSnapshotRef.current });
        throw e;
      }
    },
    async dispatch({ moveId }) {
      lastSnapshotRef.current = state;
      dispatch({ type: 'OPTIMISTIC_DISPATCH', moveId });
      try {
        const r = await fetch('/api/tenant/dispatcher/planner/dispatch', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ moveId }),
        });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
      } catch (e) {
        dispatch({ type: 'ROLLBACK', snapshot: lastSnapshotRef.current });
        throw e;
      }
    },
    async reorder({ driverId, orderedMoveIds }) {
      lastSnapshotRef.current = state;
      dispatch({ type: 'OPTIMISTIC_REORDER', driverId, orderedMoveIds });
      try {
        const r = await fetch('/api/tenant/dispatcher/planner/reorder', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ driverId, date, orderedMoveIds }),
        });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
      } catch (e) {
        dispatch({ type: 'ROLLBACK', snapshot: lastSnapshotRef.current });
        throw e;
      }
    },
  };

  return { ...state, mutations, refetch: fetchPlanner };
}
```

- [ ] **Step 2: Commit (no UI verification yet — hook is wired in Task 11)**

```bash
git add hooks/useDriverPlanner.js
git commit -m "$(cat <<'EOF'
feat(driver-planner): useDriverPlanner hook — fetch + reducer + optimistic mutations

Manages planner client state: initial GET, four optimistic mutation helpers
(assign/unassign/dispatch/reorder) with snapshot-rollback on error. Realtime
subscription is added in a later task.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 11: `DriverPlannerView` + `PlannerToolbar` shell

**Files:**
- Create: `components/dispatcher/planner/DriverPlannerView.jsx`
- Create: `components/dispatcher/planner/PlannerToolbar.jsx`
- Modify: `pages/dispatcher/index.js` (replace "coming soon" placeholder with `<DriverPlannerView />`)

Renders the top-level planner shell. Does not yet implement the grid or right-rail — those come in Tasks 12-13 and 16. Uses `useDriverPlanner` for state.

- [ ] **Step 1: PlannerToolbar**

Create `components/dispatcher/planner/PlannerToolbar.jsx`:

```jsx
import { useRouter } from 'next/router';
import { Search } from 'lucide-react';

function todayIso() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

export default function PlannerToolbar({ date, driverSearch, onDriverSearchChange, includeInactive, onIncludeInactiveChange }) {
  const router = useRouter();

  function setDate(next) {
    const query = { ...router.query, tab: 'planner', date: next };
    router.replace({ pathname: '/dispatcher', query }, undefined, { shallow: true });
  }

  return (
    <div className="flex items-center gap-4 px-4 py-3 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-950">
      <label className="flex items-center gap-2">
        <span className="text-sm text-gray-600 dark:text-gray-400">Date</span>
        <input
          type="date"
          value={date || todayIso()}
          onChange={(e) => setDate(e.target.value)}
          className="px-2 py-1 rounded border border-gray-300 bg-white text-gray-900 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
        />
      </label>

      <div className="relative flex-1 max-w-sm">
        <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
        <input
          type="text"
          placeholder="Search drivers by name or truck #"
          value={driverSearch}
          onChange={(e) => onDriverSearchChange(e.target.value)}
          className="w-full pl-8 pr-2 py-1 rounded border border-gray-300 bg-white text-gray-900 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
        />
      </div>

      <label className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400">
        <input
          type="checkbox"
          checked={includeInactive}
          onChange={(e) => onIncludeInactiveChange(e.target.checked)}
          className="rounded"
        />
        Include inactive drivers
      </label>
    </div>
  );
}
```

- [ ] **Step 2: DriverPlannerView**

Create `components/dispatcher/planner/DriverPlannerView.jsx`:

```jsx
import { useState } from 'react';
import { useRouter } from 'next/router';
import useDriverPlanner from '../../../hooks/useDriverPlanner';
import PlannerToolbar from './PlannerToolbar';

function todayIso() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export default function DriverPlannerView() {
  const router = useRouter();
  const date = router.query.date || todayIso();

  const [driverSearch, setDriverSearch] = useState('');
  const [includeInactive, setIncludeInactive] = useState(false);

  const { drivers, movesByDriverId, unassignedBuckets, isLoading, error, mutations, refetch } =
    useDriverPlanner({ date, driverSearch, includeInactive });

  return (
    <div className="flex flex-col h-full">
      <PlannerToolbar
        date={date}
        driverSearch={driverSearch}
        onDriverSearchChange={setDriverSearch}
        includeInactive={includeInactive}
        onIncludeInactiveChange={setIncludeInactive}
      />

      <div className="flex-1 flex overflow-hidden">
        <div className="flex-1 overflow-auto p-4 bg-white dark:bg-gray-900">
          {isLoading && <div className="text-gray-500 dark:text-gray-400">Loading…</div>}
          {error && (
            <div className="text-red-600 dark:text-red-400">
              Error loading planner: {String(error.message || error)}
            </div>
          )}
          {!isLoading && !error && (
            <div className="text-sm text-gray-600 dark:text-gray-400">
              {drivers.length} drivers · {Object.values(movesByDriverId).flat().length} assigned moves · {Object.values(unassignedBuckets).flat().length} unassigned
            </div>
          )}
          {/* Grid added in Task 12 */}
        </div>

        <aside className="w-[360px] border-l border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-950 overflow-auto">
          {/* Right-rail added in Task 16 */}
          <div className="p-4 text-sm text-gray-500 dark:text-gray-400">Unassigned pool — coming in Task 16.</div>
        </aside>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Swap placeholder on `pages/dispatcher/index.js`**

Replace the Task 9 placeholder:
```jsx
{activeTab === 'planner' && (
  <div className="p-8 text-center text-gray-500 dark:text-gray-400">
    Driver Planner — coming online in subsequent tasks.
  </div>
)}
```

With:
```jsx
{activeTab === 'planner' && <DriverPlannerView />}
```

And add the import at the top:
```js
import DriverPlannerView from '../../components/dispatcher/planner/DriverPlannerView';
```

- [ ] **Step 4: Chrome verification**

Navigate to `/dispatcher?tab=planner&date=2026-04-22`. Expected:
- Toolbar renders with a date picker (set to the URL date), a search box, and the "Include inactive" checkbox.
- Under the toolbar: a status line like `N drivers · M assigned moves · K unassigned`.
- Right-side rail shows the "coming in Task 16" placeholder.
- Changing the date via the picker updates the URL AND the status-line counts.

Inspect DevTools → Network: exactly one `GET /api/tenant/dispatcher/planner?date=…` fires per date change.

- [ ] **Step 5: Commit**

```bash
git add components/dispatcher/planner/DriverPlannerView.jsx components/dispatcher/planner/PlannerToolbar.jsx pages/dispatcher/index.js
git commit -m "$(cat <<'EOF'
feat(driver-planner): DriverPlannerView shell + PlannerToolbar

Top-level planner shell renders toolbar + two-column layout; grid and
right-rail come in subsequent tasks. Toolbar syncs date to URL and drives
driver search + include-inactive filters.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 12: `DriverPlannerGrid` + `DriverRow` + `DriverMetaCard`

**Files:**
- Create: `components/dispatcher/planner/DriverPlannerGrid.jsx`
- Create: `components/dispatcher/planner/DriverRow.jsx`
- Create: `components/dispatcher/planner/DriverMetaCard.jsx`
- Modify: `components/dispatcher/planner/DriverPlannerView.jsx` (render the grid)

Renders the grid: sticky driver meta column on the left, expanding Move-N columns. Moves themselves are placeholder text until Task 13.

- [ ] **Step 1: DriverMetaCard**

Create `components/dispatcher/planner/DriverMetaCard.jsx`:

```jsx
export default function DriverMetaCard({ driver }) {
  const { derived, eld } = driver;

  const Row = ({ label, value }) => (
    <div className="flex justify-between text-xs">
      <span className="text-gray-500 dark:text-gray-400">{label}</span>
      <span className="text-gray-900 dark:text-gray-100">{value ?? '—'}</span>
    </div>
  );

  return (
    <div className="w-[220px] p-3 bg-white dark:bg-gray-900 border-r border-gray-200 dark:border-gray-700">
      <div className="flex items-center gap-2 mb-2">
        <span className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-blue-100 text-blue-700 text-xs font-semibold dark:bg-blue-900 dark:text-blue-200">
          {driver.short_code || '—'}
        </span>
        <div className="min-w-0">
          <div className="text-sm font-medium truncate text-gray-900 dark:text-gray-100">
            {driver.truck_number ? `${driver.truck_number} — ${driver.name}` : driver.name}
          </div>
          <div className="text-xs text-gray-500 dark:text-gray-400">{driver.status}</div>
        </div>
      </div>

      <div className="mb-3 space-y-0.5">
        <Row label="ETA" value={derived.eta} />
        <Row label="Truck #" value={derived.truck_number} />
        <Row label="Chassis #" value={derived.chassis_number} />
        <Row label="Size" value={derived.container_size} />
      </div>

      <div className="pt-2 border-t border-gray-200 dark:border-gray-700 space-y-0.5">
        <Row label="Cycle" value={eld?.cycle_remaining_s ? fmtHrs(eld.cycle_remaining_s) : null} />
        <Row label="Drive" value={eld?.drive_remaining_s ? fmtHrs(eld.drive_remaining_s) : null} />
        <Row label="Shift" value={eld?.shift_remaining_s ? fmtHrs(eld.shift_remaining_s) : null} />
        <Row label="Break" value={eld?.break_in_s ? fmtHrs(eld.break_in_s) : null} />
      </div>
    </div>
  );
}

function fmtHrs(s) {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${h}h ${m}m`;
}
```

- [ ] **Step 2: DriverRow**

Create `components/dispatcher/planner/DriverRow.jsx`:

```jsx
import DriverMetaCard from './DriverMetaCard';

const MIN_SLOTS = 8;

export default function DriverRow({ driver, moves }) {
  const slotCount = Math.max(MIN_SLOTS, moves.length + 1); // +1 blank drop target past the last populated move

  return (
    <div className="flex border-b border-gray-200 dark:border-gray-700">
      <div className="sticky left-0 z-10 bg-white dark:bg-gray-900">
        <DriverMetaCard driver={driver} />
      </div>
      <div className="flex">
        {Array.from({ length: slotCount }).map((_, i) => {
          const move = moves[i];
          return (
            <div
              key={i}
              className="w-[260px] min-h-[140px] p-2 border-r border-gray-100 dark:border-gray-800"
            >
              {move ? (
                <div className="text-xs text-gray-600 dark:text-gray-400 p-2 rounded bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700">
                  {move.order?.order_number || move.id.slice(0, 8)}  {/* placeholder — MoveCell in Task 13 */}
                </div>
              ) : (
                <div className="h-full rounded border border-dashed border-gray-300 dark:border-gray-700 text-xs text-gray-400 dark:text-gray-500 flex items-center justify-center">
                  —
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: DriverPlannerGrid**

Create `components/dispatcher/planner/DriverPlannerGrid.jsx`:

```jsx
import DriverRow from './DriverRow';

export default function DriverPlannerGrid({ drivers, movesByDriverId }) {
  if (drivers.length === 0) {
    return <div className="p-8 text-center text-gray-500 dark:text-gray-400">No drivers match your filters.</div>;
  }

  return (
    <div className="overflow-auto">
      <div className="min-w-max">
        {drivers.map((d) => (
          <DriverRow key={d.id} driver={d} moves={movesByDriverId[d.id] || []} />
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Wire grid into DriverPlannerView**

In `components/dispatcher/planner/DriverPlannerView.jsx`, replace the status-line `div` (the temporary `N drivers · …` line) with:
```jsx
<DriverPlannerGrid drivers={drivers} movesByDriverId={movesByDriverId} />
```

Add import:
```js
import DriverPlannerGrid from './DriverPlannerGrid';
```

- [ ] **Step 5: Chrome verification**

Navigate to `/dispatcher?tab=planner&date=2026-04-22`. Expected:
- Each active driver renders one row with meta card + 8 empty dashed slots (minimum).
- Drivers with assigned moves show the move's order number in the corresponding slot (placeholder, not the full MoveCell yet).
- If a driver has ≥ 8 moves, a 9th blank slot appears at the end; ≥ 9 moves → 10th; etc.
- Horizontal scroll works when rows are wider than the viewport; meta card stays sticky on the left.
- ELD rows show `—` for every driver (empty `eld_snapshot`).

- [ ] **Step 6: Commit**

```bash
git add components/dispatcher/planner/DriverPlannerGrid.jsx components/dispatcher/planner/DriverRow.jsx components/dispatcher/planner/DriverMetaCard.jsx components/dispatcher/planner/DriverPlannerView.jsx
git commit -m "$(cat <<'EOF'
feat(driver-planner): grid shell with sticky driver meta column

Renders driver rows with 8-slot minimum + 1 blank drop target past the last
populated move. Move cells are placeholder text; MoveCell with full content
lands in the next task.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 13: `MoveCell` + `MoveSlot` (display-only, no DnD yet)

**Files:**
- Create: `components/dispatcher/planner/MoveCell.jsx`
- Create: `components/dispatcher/planner/MoveSlot.jsx`
- Modify: `components/dispatcher/planner/DriverRow.jsx` (use MoveSlot/MoveCell)

Full move cell per spec §4. DnD comes in Task 14; action chips in Task 15.

- [ ] **Step 1: MoveCell**

Create `components/dispatcher/planner/MoveCell.jsx`:

```jsx
import { Check, X } from 'lucide-react';

const STATUS_BG = {
  unassigned: 'bg-gray-100 dark:bg-gray-800',
  pending: 'bg-blue-50 dark:bg-blue-950',
  dispatched: 'bg-indigo-50 dark:bg-indigo-950',
  in_progress: 'bg-amber-50 dark:bg-amber-950',
  completed: 'bg-green-50 dark:bg-green-950',
  cancelled: 'bg-gray-100 dark:bg-gray-800 line-through',
};

const EVENT_LABEL = {
  pickup: 'Pick Up Container',
  deliver: 'Deliver Container',
  return: 'Return Container',
};

const EVENT_COLOR = {
  pickup: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
  deliver: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
  return: 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200',
};

function fmtApt(iso) {
  if (!iso) return null;
  try {
    const d = new Date(iso);
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    const hh = String(d.getHours()).padStart(2, '0');
    const mi = String(d.getMinutes()).padStart(2, '0');
    return `${mm}/${dd} ${hh}:${mi}`;
  } catch {
    return null;
  }
}

export default function MoveCell({ move, onClickPreview, onDispatch, onUnassign }) {
  const order = move.order || {};
  const bg = STATUS_BG[move.status] || STATUS_BG.pending;

  return (
    <div
      className={`flex flex-col h-full rounded border border-gray-200 dark:border-gray-700 ${bg} cursor-pointer hover:shadow-sm`}
      onClick={onClickPreview}
      data-move-id={move.id}
    >
      <div className="flex items-center justify-between px-2 py-1.5 border-b border-gray-200 dark:border-gray-700">
        <a
          href={`/loads/${order.id || move.order_id}`}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="text-xs font-medium text-blue-600 hover:underline dark:text-blue-400"
        >
          {order.order_number || move.id.slice(0, 8)}
        </a>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onDispatch?.(move); }}
            disabled={!['pending', 'dispatched'].includes(move.status)}
            className={[
              'w-5 h-5 rounded flex items-center justify-center',
              move.status === 'dispatched'
                ? 'bg-green-600 text-white'
                : 'border border-green-600 text-green-600 hover:bg-green-50 dark:border-green-500 dark:text-green-400 dark:hover:bg-green-950',
              !['pending', 'dispatched'].includes(move.status) && 'opacity-40 cursor-not-allowed',
            ].filter(Boolean).join(' ')}
            title={move.status === 'dispatched' ? 'Re-send to driver mobile app' : 'Dispatch to driver mobile app'}
          >
            <Check className="w-3 h-3" />
          </button>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onUnassign?.(move); }}
            disabled={!['pending', 'dispatched'].includes(move.status)}
            className={[
              'w-5 h-5 rounded flex items-center justify-center border border-red-600 text-red-600 hover:bg-red-50 dark:border-red-500 dark:text-red-400 dark:hover:bg-red-950',
              !['pending', 'dispatched'].includes(move.status) && 'opacity-40 cursor-not-allowed',
            ].filter(Boolean).join(' ')}
            title="Unassign driver"
          >
            <X className="w-3 h-3" />
          </button>
        </div>
      </div>

      <div className="px-2 py-1 text-[11px] text-gray-600 dark:text-gray-400">
        {[order.container_number, order.container_size, order.container_type].filter(Boolean).join(' · ') || '—'}
      </div>

      {move.assigned_at && (
        <div className="px-2 pb-1 text-[10px] text-gray-500 dark:text-gray-500">
          Assigned: {fmtApt(move.assigned_at)}
        </div>
      )}

      <div className="flex-1 px-2 pb-2 space-y-1">
        {(move.events || []).map((e) => (
          <div key={e.id} className="text-[11px]">
            <span className={`inline-block px-1.5 py-0.5 rounded ${EVENT_COLOR[e.event_type] || 'bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-200'}`}>
              {EVENT_LABEL[e.event_type] || e.event_type}
            </span>
            <div className="text-gray-700 dark:text-gray-300">{e.location_name || 'No Location Provided'}</div>
            {e.scheduled_at && (
              <div className="text-gray-500 dark:text-gray-500">Apt: {fmtApt(e.scheduled_at)}</div>
            )}
          </div>
        ))}
        {(!move.events || move.events.length === 0) && (
          <div className="text-[11px] text-gray-400 dark:text-gray-500 italic">No events scheduled yet</div>
        )}
      </div>

      {order.lfd && (
        <div className="px-2 py-1 text-[10px] text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-950 border-t border-amber-200 dark:border-amber-900">
          LFD: {order.lfd}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: MoveSlot**

Create `components/dispatcher/planner/MoveSlot.jsx`:

```jsx
import MoveCell from './MoveCell';

export default function MoveSlot({ move, onClickPreview, onDispatch, onUnassign }) {
  if (move) {
    return (
      <div className="w-[260px] min-h-[140px] p-2 border-r border-gray-100 dark:border-gray-800">
        <MoveCell move={move} onClickPreview={onClickPreview} onDispatch={onDispatch} onUnassign={onUnassign} />
      </div>
    );
  }

  return (
    <div className="w-[260px] min-h-[140px] p-2 border-r border-gray-100 dark:border-gray-800">
      <div className="h-full rounded border border-dashed border-gray-300 dark:border-gray-700 text-xs text-gray-400 dark:text-gray-500 flex items-center justify-center">
        + Drop a move here
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Update DriverRow to use MoveSlot**

In `components/dispatcher/planner/DriverRow.jsx`, replace the inline slot rendering with:

```jsx
import DriverMetaCard from './DriverMetaCard';
import MoveSlot from './MoveSlot';

const MIN_SLOTS = 8;

export default function DriverRow({ driver, moves, onClickPreview, onDispatch, onUnassign }) {
  const slotCount = Math.max(MIN_SLOTS, moves.length + 1);

  return (
    <div className="flex border-b border-gray-200 dark:border-gray-700">
      <div className="sticky left-0 z-10 bg-white dark:bg-gray-900">
        <DriverMetaCard driver={driver} />
      </div>
      <div className="flex">
        {Array.from({ length: slotCount }).map((_, i) => (
          <MoveSlot
            key={i}
            move={moves[i]}
            onClickPreview={onClickPreview}
            onDispatch={onDispatch}
            onUnassign={onUnassign}
          />
        ))}
      </div>
    </div>
  );
}
```

And propagate the callbacks through `DriverPlannerGrid.jsx`:

```jsx
import DriverRow from './DriverRow';

export default function DriverPlannerGrid({ drivers, movesByDriverId, onClickPreview, onDispatch, onUnassign }) {
  if (drivers.length === 0) {
    return <div className="p-8 text-center text-gray-500 dark:text-gray-400">No drivers match your filters.</div>;
  }
  return (
    <div className="overflow-auto">
      <div className="min-w-max">
        {drivers.map((d) => (
          <DriverRow
            key={d.id}
            driver={d}
            moves={movesByDriverId[d.id] || []}
            onClickPreview={onClickPreview}
            onDispatch={onDispatch}
            onUnassign={onUnassign}
          />
        ))}
      </div>
    </div>
  );
}
```

In `DriverPlannerView.jsx`, wire the callbacks:

```jsx
<DriverPlannerGrid
  drivers={drivers}
  movesByDriverId={movesByDriverId}
  onClickPreview={(m) => setPreviewMove(m)}
  onDispatch={(m) => mutations.dispatch({ moveId: m.id }).catch((e) => alert(`Dispatch failed: ${e.message}`))}
  onUnassign={(m) => mutations.unassign({ move: m, bucket: 'other' /* re-bucket on realtime refetch */ }).catch((e) => alert(`Unassign failed: ${e.message}`))}
/>
```

Add at the top of `DriverPlannerView`:
```js
const [previewMove, setPreviewMove] = useState(null);
```
(The preview panel itself is wired in Task 17.)

- [ ] **Step 4: Chrome verification**

Navigate to `/dispatcher?tab=planner&date=2026-04-22`. Expected:
- Each assigned move cell now shows: order # link, container info, event pills, LFD badge where present.
- Empty slots show `+ Drop a move here`.
- Clicking the order # opens Load Detail in a new tab (verify `target="_blank"`).
- Clicking the body of the cell currently is a no-op (preview panel not wired yet — Task 17).
- Clicking green ✓ fires `/dispatch` and the cell's ✓ flips to solid green. Verify status in DB or via a re-fetch.
- Clicking red ✗ fires `/unassign` and the move disappears from the row.

- [ ] **Step 5: Commit**

```bash
git add components/dispatcher/planner/MoveCell.jsx components/dispatcher/planner/MoveSlot.jsx components/dispatcher/planner/DriverRow.jsx components/dispatcher/planner/DriverPlannerGrid.jsx components/dispatcher/planner/DriverPlannerView.jsx
git commit -m "$(cat <<'EOF'
feat(driver-planner): MoveCell + MoveSlot with action chips

Renders move cell per spec §4: load # link, container info, event pills with
locations + appointments, LFD badge. Green check dispatches via API; red X
unassigns. Preview panel wiring comes in the preview-panel task.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 14: Drag-and-drop — assign + reorder + cross-driver move

**Files:**
- Modify: `components/dispatcher/planner/DriverPlannerView.jsx` (wrap in DndContext)
- Modify: `components/dispatcher/planner/MoveSlot.jsx` (make slots droppable)
- Modify: `components/dispatcher/planner/MoveCell.jsx` (make cells draggable)
- Create: `components/dispatcher/planner/UnassignedMoveCard.jsx` (draggable card; preview of what Task 16 builds out)

Uses `@dnd-kit/core` (already installed; see [`package.json:12`](../../../package.json)).

- [ ] **Step 1: Create `UnassignedMoveCard` as a draggable source**

Create `components/dispatcher/planner/UnassignedMoveCard.jsx`:

```jsx
import { useDraggable } from '@dnd-kit/core';

export default function UnassignedMoveCard({ move }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `unassigned:${move.id}`,
    data: { type: 'unassigned-move', move },
  });

  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      className={[
        'p-2 rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 cursor-grab active:cursor-grabbing',
        isDragging && 'opacity-50',
      ].filter(Boolean).join(' ')}
    >
      <div className="text-xs font-medium text-gray-900 dark:text-gray-100">
        {move.order?.order_number || move.id.slice(0, 8)}
      </div>
      <div className="text-[11px] text-gray-600 dark:text-gray-400">
        {[move.order?.container_number, move.order?.container_size, move.order?.container_type].filter(Boolean).join(' · ')}
      </div>
      {(move.events || [])[0]?.scheduled_at && (
        <div className="text-[10px] text-gray-500 dark:text-gray-500 mt-1">
          {move.events[0].location_name || 'No Location Provided'}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Make MoveSlot droppable**

In `components/dispatcher/planner/MoveSlot.jsx`, wrap with `useDroppable`:

```jsx
import { useDroppable } from '@dnd-kit/core';
import MoveCell from './MoveCell';

export default function MoveSlot({ driverId, index, move, onClickPreview, onDispatch, onUnassign }) {
  const { setNodeRef, isOver } = useDroppable({
    id: `slot:${driverId}:${index}`,
    data: { type: 'slot', driverId, index },
  });

  return (
    <div
      ref={setNodeRef}
      className={[
        'w-[260px] min-h-[140px] p-2 border-r border-gray-100 dark:border-gray-800',
        isOver && 'bg-blue-50 dark:bg-blue-950',
      ].filter(Boolean).join(' ')}
    >
      {move ? (
        <MoveCell move={move} onClickPreview={onClickPreview} onDispatch={onDispatch} onUnassign={onUnassign} />
      ) : (
        <div className="h-full rounded border border-dashed border-gray-300 dark:border-gray-700 text-xs text-gray-400 dark:text-gray-500 flex items-center justify-center">
          + Drop a move here
        </div>
      )}
    </div>
  );
}
```

Update `DriverRow.jsx` to pass `driverId` + `index` to each slot:
```jsx
{Array.from({ length: slotCount }).map((_, i) => (
  <MoveSlot
    key={i}
    driverId={driver.id}
    index={i}
    move={moves[i]}
    onClickPreview={onClickPreview}
    onDispatch={onDispatch}
    onUnassign={onUnassign}
  />
))}
```

- [ ] **Step 3: Make MoveCell draggable (for cross-driver and reorder)**

In `components/dispatcher/planner/MoveCell.jsx`, add `useDraggable` at the top of the component:

```jsx
import { useDraggable } from '@dnd-kit/core';

export default function MoveCell({ move, onClickPreview, onDispatch, onUnassign }) {
  const draggable = useDraggable({
    id: `assigned:${move.id}`,
    data: { type: 'assigned-move', move },
    disabled: ['in_progress', 'completed', 'cancelled'].includes(move.status),
  });

  // ... rest unchanged, except the root <div>:
  return (
    <div
      ref={draggable.setNodeRef}
      {...draggable.attributes}
      {...draggable.listeners}
      className={[
        'flex flex-col h-full rounded border border-gray-200 dark:border-gray-700 cursor-grab active:cursor-grabbing',
        STATUS_BG[move.status] || STATUS_BG.pending,
        draggable.isDragging && 'opacity-50',
      ].join(' ')}
      onClick={onClickPreview}
      data-move-id={move.id}
    >
      {/* ... existing header/body unchanged ... */}
    </div>
  );
}
```

IMPORTANT: the action chips (`✓` and `✗`) already stop propagation via `e.stopPropagation()` — they will NOT initiate a drag since they have their own click handlers. Verify visually in Step 5.

- [ ] **Step 4: Wrap DriverPlannerView in DndContext and handle drops**

In `components/dispatcher/planner/DriverPlannerView.jsx`:

```jsx
import { DndContext, PointerSensor, KeyboardSensor, useSensor, useSensors, closestCenter } from '@dnd-kit/core';

export default function DriverPlannerView() {
  // ... existing state ...

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor)
  );

  async function handleDragEnd(ev) {
    const { active, over } = ev;
    if (!over) return;
    if (over.data?.current?.type !== 'slot') return;
    const { driverId, index } = over.data.current;

    const sourceType = active.data?.current?.type;
    if (sourceType !== 'unassigned-move' && sourceType !== 'assigned-move') return;
    const move = active.data.current.move;

    // Guard: in_progress/completed/cancelled cannot be moved — useDraggable
    // already disables these for assigned-moves, but belt-and-suspenders:
    if (['in_progress', 'completed', 'cancelled'].includes(move.status)) {
      alert("Can't move a job that's already in progress. Reverse status on the Load Detail page first.");
      return;
    }

    try {
      await mutations.assign({ move, driverId, index });
    } catch (e) {
      alert(`Assign failed: ${e.message}`);
    }
  }

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <div className="flex flex-col h-full">
        {/* toolbar + grid + rail — existing */}
      </div>
    </DndContext>
  );
}
```

- [ ] **Step 5: Add an interim flat render of UnassignedMoveCards in the aside**

Task 16 replaces the aside with the full `UnassignedRightRail`, but for Task 14 to be end-to-end verifiable, render a flat list here temporarily. In `DriverPlannerView.jsx`, replace the placeholder aside content with:

```jsx
<aside className="w-[360px] border-l border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-950 overflow-auto">
  <div className="p-2 text-xs text-gray-500 dark:text-gray-400">
    Unassigned (interim flat list — replaced by buckets in Task 16)
  </div>
  <div className="p-2 space-y-2">
    {[...unassignedBuckets.atPort, ...unassignedBuckets.deliveries, ...unassignedBuckets.return, ...unassignedBuckets.other].map((m) => (
      <UnassignedMoveCard key={m.id} move={m} />
    ))}
  </div>
</aside>
```
Add import:
```js
import UnassignedMoveCard from './UnassignedMoveCard';
```

- [ ] **Step 6: Chrome verification**

Ensure at least one unassigned move exists on the selected date (seed if needed). Then via Claude-in-Chrome MCP:

1. **Drag unassigned → driver row** — drag an `UnassignedMoveCard` from the interim flat list onto an empty `MoveSlot`. Cell appears on the row; right-rail item disappears. Verify via Network tab: one `POST /api/tenant/dispatcher/planner/assign`.
2. **Drag cell → different driver row** — drag a placed `MoveCell` onto another driver's empty slot. Cell moves; original driver's row condenses. Verify: one `POST /assign`.
3. **Drag cell → same driver, different slot** — moves to new position within the same row (reorder). Currently this also fires `assign`; that's acceptable because the assign endpoint dense-resequences as part of placement.
4. **Drag cell with status `in_progress`** — drag handle is disabled (`cursor` stays default; pointer doesn't pick it up). If you attempt via keyboard, the guard toast fires.
5. **Click chips during cell drag attempts** — ✓ and ✗ still work normally (not captured by drag).

Take a screenshot demonstrating drop-zone highlight + after-drop state.

- [ ] **Step 7: Commit**

```bash
git add components/dispatcher/planner/UnassignedMoveCard.jsx components/dispatcher/planner/MoveSlot.jsx components/dispatcher/planner/MoveCell.jsx components/dispatcher/planner/DriverRow.jsx components/dispatcher/planner/DriverPlannerView.jsx
git commit -m "$(cat <<'EOF'
feat(driver-planner): drag-and-drop with dnd-kit

Right-rail → driver row, driver row → another driver (cross-driver), and
intra-row reorder all route through POST /assign which dense-resequences
on placement. Guards in_progress/completed/cancelled from drag; chip
clicks remain isolated from drag handlers.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 15: Guard the red ✗ chip on `in_progress` / `completed` — UX polish

**Files:**
- Modify: `components/dispatcher/planner/MoveCell.jsx` (tighten tooltip + disabled styling)

Cell chips are already wired in Task 13, but the tooltip copy needs to match the spec's block message when disabled.

- [ ] **Step 1: Update the chip tooltips**

In `components/dispatcher/planner/MoveCell.jsx`, replace the red X button block with:

```jsx
<button
  type="button"
  onClick={(e) => { e.stopPropagation(); onUnassign?.(move); }}
  disabled={!['pending', 'dispatched'].includes(move.status)}
  className={[
    'w-5 h-5 rounded flex items-center justify-center border border-red-600 text-red-600 hover:bg-red-50 dark:border-red-500 dark:text-red-400 dark:hover:bg-red-950',
    !['pending', 'dispatched'].includes(move.status) && 'opacity-40 cursor-not-allowed',
  ].filter(Boolean).join(' ')}
  title={
    ['in_progress', 'completed'].includes(move.status)
      ? "Can't unassign — move is already in progress. Reverse status on the Load Detail page first."
      : move.status === 'cancelled'
      ? 'Cancelled moves cannot be unassigned.'
      : 'Unassign driver'
  }
>
  <X className="w-3 h-3" />
</button>
```

Replace the green check button similarly with a status-aware tooltip.

- [ ] **Step 2: Chrome verification**

Hover the red ✗ on a move with status `in_progress` (seed one manually if needed). Expected: the full tooltip text appears. Click is blocked.

- [ ] **Step 3: Commit**

```bash
git add components/dispatcher/planner/MoveCell.jsx
git commit -m "$(cat <<'EOF'
feat(driver-planner): chip tooltip copy matches spec block message

Dispatcher now sees the explicit 'reverse status on Load Detail' hint when
hovering the disabled ✗ chip on in_progress moves.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 16: `UnassignedRightRail` + `BucketTabs`

**Files:**
- Create: `components/dispatcher/planner/BucketTabs.jsx`
- Create: `components/dispatcher/planner/UnassignedRightRail.jsx`
- Modify: `components/dispatcher/planner/DriverPlannerView.jsx` (swap the rail placeholder for `UnassignedRightRail`)

- [ ] **Step 1: BucketTabs**

Create `components/dispatcher/planner/BucketTabs.jsx`:

```jsx
const TABS = [
  { id: 'all', label: 'All' },
  { id: 'atPort', label: 'At Port' },
  { id: 'deliveries', label: 'Deliveries' },
  { id: 'return', label: 'Return' },
  { id: 'other', label: 'Other' },
];

export default function BucketTabs({ counts, active, onChange }) {
  return (
    <div className="flex gap-1 p-2 border-b border-gray-200 dark:border-gray-700 overflow-x-auto">
      {TABS.map((t) => {
        const count = t.id === 'all'
          ? counts.atPort + counts.deliveries + counts.return + counts.other
          : counts[t.id];
        const isActive = t.id === active;
        return (
          <button
            key={t.id}
            type="button"
            onClick={() => onChange(t.id)}
            className={[
              'px-2.5 py-1 text-xs font-medium rounded whitespace-nowrap',
              isActive
                ? 'bg-blue-600 text-white dark:bg-blue-500'
                : 'bg-white text-gray-700 border border-gray-200 hover:bg-gray-50 dark:bg-gray-900 dark:text-gray-300 dark:border-gray-700 dark:hover:bg-gray-800',
            ].join(' ')}
          >
            {t.label} <span className="opacity-70">({count})</span>
          </button>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 2: UnassignedRightRail**

Create `components/dispatcher/planner/UnassignedRightRail.jsx`:

```jsx
import { useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import BucketTabs from './BucketTabs';
import UnassignedMoveCard from './UnassignedMoveCard';

export default function UnassignedRightRail({ buckets }) {
  const [active, setActive] = useState('all');
  const [search, setSearch] = useState('');

  const counts = {
    atPort: buckets.atPort.length,
    deliveries: buckets.deliveries.length,
    return: buckets.return.length,
    other: buckets.other.length,
  };

  const items = useMemo(() => {
    const source =
      active === 'all'
        ? [...buckets.atPort, ...buckets.deliveries, ...buckets.return, ...buckets.other]
        : buckets[active] || [];
    const q = search.trim().toLowerCase();
    if (!q) return source;
    return source.filter((m) => {
      const order = m.order || {};
      const firstEvent = (m.events || [])[0];
      return (
        (order.order_number || '').toLowerCase().includes(q) ||
        (order.container_number || '').toLowerCase().includes(q) ||
        (firstEvent?.location_name || '').toLowerCase().includes(q)
      );
    });
  }, [buckets, active, search]);

  return (
    <div className="flex flex-col h-full">
      <div className="p-2 border-b border-gray-200 dark:border-gray-700">
        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
          <input
            type="text"
            placeholder="Search unassigned…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-7 pr-2 py-1 text-xs rounded border border-gray-300 bg-white text-gray-900 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
          />
        </div>
      </div>

      <BucketTabs counts={counts} active={active} onChange={setActive} />

      <div className="flex-1 overflow-auto p-2 space-y-2">
        {items.length === 0 && (
          <div className="text-xs text-gray-500 dark:text-gray-400 p-4 text-center">
            {active === 'atPort'
              ? 'No containers at port for this date.'
              : active === 'deliveries'
              ? 'No deliveries scheduled.'
              : active === 'return'
              ? 'No containers ready for return.'
              : active === 'other'
              ? 'No other unassigned moves.'
              : 'No unassigned moves.'}
          </div>
        )}
        {items.map((m) => (
          <UnassignedMoveCard key={m.id} move={m} />
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Wire into `DriverPlannerView`**

Replace the placeholder aside with:
```jsx
<aside className="w-[360px] border-l border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-950 overflow-hidden flex flex-col">
  <UnassignedRightRail buckets={unassignedBuckets} />
</aside>
```
Add import:
```js
import UnassignedRightRail from './UnassignedRightRail';
```

- [ ] **Step 4: Chrome verification**

Navigate to `/dispatcher?tab=planner&date=<today>`. Expected:
- Right-rail shows 5 bucket tabs with live counts.
- Cards in the rail are draggable into driver slots (Task 14 flow works end-to-end now).
- Switching buckets filters the list; "All" = union.
- Search filters within the current bucket.
- Empty-bucket message appears when filtered results are zero.

Test the full drag loop: drag an At-Port card → drop onto a driver slot → count decrements + card disappears + cell appears on the driver row.

- [ ] **Step 5: Commit**

```bash
git add components/dispatcher/planner/BucketTabs.jsx components/dispatcher/planner/UnassignedRightRail.jsx components/dispatcher/planner/DriverPlannerView.jsx
git commit -m "$(cat <<'EOF'
feat(driver-planner): unassigned right-rail with 5 bucket tabs + search

Drag source for the Task-14 assign flow. Buckets pre-computed server-side
via shared getBucket util; counts live. Search filters within the active
bucket by order #, container #, or first event's location.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 17: `MovePreviewPanel` slide-over

**Files:**
- Create: `components/dispatcher/planner/MovePreviewPanel.jsx`
- Modify: `components/dispatcher/planner/DriverPlannerView.jsx` (render the panel + wire close/open)

Read-only side-panel that appears when a cell is clicked.

- [ ] **Step 1: MovePreviewPanel**

Create `components/dispatcher/planner/MovePreviewPanel.jsx`:

```jsx
import { X, ExternalLink } from 'lucide-react';

export default function MovePreviewPanel({ move, onClose }) {
  if (!move) return null;
  const order = move.order || {};
  const driverLine = move.driver_id ? `Assigned driver: ${move.driver_id.slice(0, 8)}…` : 'Unassigned';

  return (
    <div className="fixed inset-y-0 right-0 w-[420px] bg-white dark:bg-gray-900 shadow-2xl border-l border-gray-200 dark:border-gray-700 z-40 flex flex-col">
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-gray-700">
        <div>
          <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">
            {order.order_number || move.id.slice(0, 8)}
          </div>
          <div className="text-xs text-gray-500 dark:text-gray-400">Move preview</div>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-500 dark:text-gray-400"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="flex-1 overflow-auto p-4 space-y-4 text-sm">
        <section>
          <h3 className="text-xs font-semibold uppercase text-gray-500 dark:text-gray-400 mb-1">Container</h3>
          <div className="text-gray-900 dark:text-gray-100">
            {[order.container_number, order.container_size, order.container_type].filter(Boolean).join(' · ') || '—'}
          </div>
        </section>

        <section>
          <h3 className="text-xs font-semibold uppercase text-gray-500 dark:text-gray-400 mb-1">Assignment</h3>
          <div className="text-gray-900 dark:text-gray-100">{driverLine}</div>
          <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">Status: {move.status}</div>
        </section>

        <section>
          <h3 className="text-xs font-semibold uppercase text-gray-500 dark:text-gray-400 mb-1">Events</h3>
          {(move.events || []).length === 0 && (
            <div className="text-gray-500 dark:text-gray-400 text-xs italic">No events scheduled yet</div>
          )}
          <ul className="space-y-2">
            {(move.events || []).map((e) => (
              <li key={e.id} className="border-l-2 border-blue-200 dark:border-blue-900 pl-2">
                <div className="text-gray-900 dark:text-gray-100 capitalize">{e.event_type}</div>
                <div className="text-xs text-gray-600 dark:text-gray-400">{e.location_name || 'No Location Provided'}</div>
                {e.scheduled_at && (
                  <div className="text-xs text-gray-500 dark:text-gray-500">Appt: {new Date(e.scheduled_at).toLocaleString()}</div>
                )}
              </li>
            ))}
          </ul>
        </section>

        {order.lfd && (
          <section>
            <h3 className="text-xs font-semibold uppercase text-gray-500 dark:text-gray-400 mb-1">LFD</h3>
            <div className="text-gray-900 dark:text-gray-100">{order.lfd}</div>
          </section>
        )}
      </div>

      <div className="border-t border-gray-200 dark:border-gray-700 p-3">
        <a
          href={`/loads/${order.id || move.order_id}`}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded bg-blue-600 text-white text-sm hover:bg-blue-700 dark:bg-blue-500 dark:hover:bg-blue-400"
        >
          Open Load <ExternalLink className="w-3.5 h-3.5" />
        </a>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Wire panel into `DriverPlannerView`**

At the bottom of the `DndContext` children, add:
```jsx
<MovePreviewPanel move={previewMove} onClose={() => setPreviewMove(null)} />
```
Add import:
```js
import MovePreviewPanel from './MovePreviewPanel';
```

(`setPreviewMove` + `previewMove` state were added in Task 13.)

- [ ] **Step 3: Chrome verification**

Click a move cell (body, not the chips). Expected: panel slides in from the right with move details, close button (X), and "Open Load" button linking to `/loads/<id>` in a new tab. Press Escape or click ✕ to close.

- [ ] **Step 4: Commit**

```bash
git add components/dispatcher/planner/MovePreviewPanel.jsx components/dispatcher/planner/DriverPlannerView.jsx
git commit -m "$(cat <<'EOF'
feat(driver-planner): MovePreviewPanel slide-over

Read-only side-panel with move summary, events timeline, LFD badge, and
an Open Load button to jump to full Load Detail in a new tab.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 18: Realtime subscriptions in `useDriverPlanner`

**Files:**
- Modify: `hooks/useDriverPlanner.js` (add Supabase channel subscription)

Follows the pattern in [`hooks/useRealtimeLoads.js`](../../../hooks/useRealtimeLoads.js). Three subscriptions on one channel: `order_container_moves`, `order_routing_events`, `orders`.

- [ ] **Step 1: Add realtime inside the hook**

Append to `hooks/useDriverPlanner.js` after the existing `useEffect` that runs `fetchPlanner`, and add a second `useEffect` for realtime:

```js
  // ── Realtime subscription ────────────────────────────────────────────
  useEffect(() => {
    if (!supabase || !tenantId || !date) return;

    const channel = supabase
      .channel(`dispatcher_planner:${tenantId}:${date}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'order_container_moves', filter: `tenant_id=eq.${tenantId}` },
        () => {
          // Simple strategy for v1: refetch on any move change. Avoids the
          // complexity of client-side delta reconciliation. Debounced below.
          scheduleRefetch();
        }
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'order_routing_events', filter: `tenant_id=eq.${tenantId}` },
        () => scheduleRefetch()
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'orders', filter: `tenant_id=eq.${tenantId}` },
        (payload) => {
          // Only refetch if bucket-relevant columns changed
          const old = payload.old || {};
          const nw = payload.new || {};
          if (
            old.container_at_port !== nw.container_at_port ||
            old.empty_ready_for_return_at !== nw.empty_ready_for_return_at ||
            old.lfd !== nw.lfd
          ) {
            scheduleRefetch();
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [supabase, tenantId, date, scheduleRefetch]);
```

And add the debounced refetch near the top of the hook, just after `dispatch`:

```js
  const refetchTimerRef = useRef(null);
  const scheduleRefetch = useCallback(() => {
    if (refetchTimerRef.current) clearTimeout(refetchTimerRef.current);
    refetchTimerRef.current = setTimeout(() => {
      fetchPlanner();
    }, 300);
  }, [fetchPlanner]);
```

- [ ] **Step 2: Chrome verification — two-tab realtime test**

1. Open `/dispatcher?tab=planner&date=<today>` in Tab A.
2. Open the same URL in Tab B.
3. In Tab A, drag an unassigned move onto a driver.
4. Within ~2 seconds, Tab B should show the move on the same driver (via realtime → debounced refetch).
5. In Tab B, click the green ✓ to dispatch. Tab A's chip should flip to solid green.

- [ ] **Step 3: Commit**

```bash
git add hooks/useDriverPlanner.js
git commit -m "$(cat <<'EOF'
feat(driver-planner): Supabase Realtime — refetch on bucket-relevant changes

Subscribes to order_container_moves (any change), order_routing_events
(UPDATE), and orders (UPDATE — filtered to container_at_port /
empty_ready_for_return_at / lfd). Uses debounced full-refetch instead of
delta reconciliation for v1 simplicity; matches useRealtimeLoads pattern.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 19: Periodic refetch + visibility handling

**Files:**
- Modify: `hooks/useDriverPlanner.js` (add 60s visibility-aware periodic refetch)

Covers the cross-date edge case documented in spec §10.3.

- [ ] **Step 1: Add periodic refetch effect**

Append to `useDriverPlanner`:

```js
  // ── Periodic refetch (60s) while the page is visible ────────────────
  useEffect(() => {
    if (!date) return;
    let intervalId = null;

    function start() {
      if (intervalId != null) return;
      intervalId = setInterval(() => {
        if (document.visibilityState === 'visible') fetchPlanner();
      }, 60_000);
    }
    function stop() {
      if (intervalId != null) clearInterval(intervalId);
      intervalId = null;
    }

    function onVis() {
      if (document.visibilityState === 'visible') {
        // Refetch immediately + ensure the timer runs
        fetchPlanner();
        start();
      } else {
        stop();
      }
    }

    start();
    document.addEventListener('visibilitychange', onVis);
    return () => {
      stop();
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [date, fetchPlanner]);
```

- [ ] **Step 2: Chrome verification**

Open `/dispatcher?tab=planner&date=<today>`, Network tab → filter to `planner`. Wait 60 seconds. Expected: one additional `GET /api/tenant/dispatcher/planner?date=…` appears.

Switch to another tab for 2+ minutes, then return. Expected: one `GET` fires on visibility return (not 2+ accumulated from background).

- [ ] **Step 3: Commit**

```bash
git add hooks/useDriverPlanner.js
git commit -m "$(cat <<'EOF'
feat(driver-planner): 60s visibility-aware periodic refetch

Belt-and-suspenders against the cross-date Realtime edge case (spec §10.3):
when a move's scheduled_date changes off today, today's filtered
subscription misses the UPDATE. The timer pauses on tab hidden and fires
once on return.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 20: End-to-end Chrome verification — all 12 spec gates

**Files:** none (verification only)

Run every gate from spec §13. Record findings in a PR comment or commit message if issues surface. This task does not ship code unless a regression is found — in which case, file a fix as a sub-task.

- [ ] **Gate 1: Initial render**

Navigate to `/dispatcher?tab=planner&date=<today>`. Expected: grid renders; drivers listed; right-rail bucket counts visible and non-zero for at least one bucket (seed if needed).

- [ ] **Gate 2: Drag unassigned → driver**

Drag an At-Port card onto a driver's empty slot. Expected: cell appears on row; bucket count decrements; Network shows one `POST /assign`.

- [ ] **Gate 3: Green ✓ dispatch**

Click the ✓ on the newly-placed move. Expected: chip flips to solid green; audit log row written. Verify via Supabase SQL editor:
```sql
SELECT * FROM tenant_audit_log WHERE entity_id = '<moveId>' ORDER BY created_at DESC LIMIT 5;
```

- [ ] **Gate 4: Red ✗ unassign**

Click the ✗ on a `pending` move. Expected: move animates back to right-rail; driver slot empties.

- [ ] **Gate 5: Two-tab realtime**

Open planner in Tab A + Tab B. Assign a move in Tab A → shows in Tab B within 2 seconds.

- [ ] **Gate 6: In-progress block**

Manually set a move's status to `in_progress` via Supabase SQL:
```sql
UPDATE order_container_moves SET status = 'in_progress' WHERE id = '<moveId>';
```
Refresh the planner; attempt to drag the move. Expected: drag handle does not pick up the cell. Click ✗ → disabled with the spec tooltip.

- [ ] **Gate 7: Click → preview panel**

Click a move cell (body). Expected: preview panel slides in; Open Load button opens Load Detail in new tab.

- [ ] **Gate 8: Date switch**

Change the date to tomorrow via toolbar. Expected: grid re-populates with tomorrow's moves; bucket counts update; URL reflects `?date=<tomorrow>`.

- [ ] **Gate 9: Driver search**

Type part of a driver name into the search box. Expected: grid filters to matching drivers; bucket counts stay global.

- [ ] **Gate 10: URL deep-link**

Paste `/dispatcher?tab=planner&date=2026-04-23` directly. Expected: planner opens on that exact date with tab active.

- [ ] **Gate 11: Re-dispatch**

Click ✓ on a move whose status is already `dispatched`. Expected: audit row records `redispatch`; chip flashes briefly:
```sql
SELECT action FROM tenant_audit_log WHERE entity_id = '<moveId>' ORDER BY created_at DESC LIMIT 2;
-- Should show 'redispatch' most recent, 'dispatch' earlier
```

- [ ] **Gate 12: Cross-driver drag**

Drag a placed move from Driver A to Driver B. Expected: cell moves; Driver A's row condenses; Driver B's row expands. One `POST /assign`.

- [ ] **Step 13: Record results**

If all 12 gates pass, commit a verification-note file:

```bash
cat > docs/superpowers/plans/2026-04-22-driver-planner-verification.md <<'EOF'
# Driver Planner — Chrome Verification Results

Date: 2026-04-22
All 12 gates from spec §13 passed.

(Per-gate notes or screenshots captured during the session are linked here.)
EOF
git add docs/superpowers/plans/2026-04-22-driver-planner-verification.md
git commit -m "$(cat <<'EOF2'
docs(driver-planner): Chrome verification — all 12 gates passing

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF2
)"
```

If any gate fails, stop and fix before proceeding to Task 21.

---

## Task 21: Code review + dd-qa + final ship commit

**Files:** none (review + audit)

- [ ] **Step 1: Run `superpowers:code-reviewer`**

Dispatch the reviewer subagent against the full diff on this branch:
- Scope: every new/modified file from Tasks 1–20.
- Focus areas: tenant scoping on all queries, permission checks on all 4 mutation endpoints, dark-mode compliance on all new components, audit-log payloads for assign/unassign/dispatch/reorder.

Address each finding inline (one commit per fix with a clear message).

- [ ] **Step 2: Run `dd-qa` skill**

The skill validates field consistency across sidebar, dispatcher board, API, pickers, filters, enum/reference data alignment. Address any misalignments.

- [ ] **Step 3: Final ship commit**

If tasks 1-20 have been committed individually, no additional ship commit is required — the feature is already merged into `main` via those commits. If anything was amended in Steps 1-2 above, push those as normal commits with `fix(driver-planner): …` messages.

Update `memory/MEMORY.md` with a new entry referencing the completed feature (follow the pattern of existing entries under `session_2026_04_22_*` files).

---

## Completion criteria

All of the following must be true before marking the plan done:

- [ ] Migration 089 applied to the live DB (user action in Task 2).
- [ ] All 21 tasks committed.
- [ ] All 12 Chrome verification gates pass.
- [ ] Code reviewer has no unaddressed findings.
- [ ] `dd-qa` passes.
- [ ] `memory/MEMORY.md` updated with the session recap entry.
