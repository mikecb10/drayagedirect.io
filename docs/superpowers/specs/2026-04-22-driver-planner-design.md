# Driver Planner — Design Spec

- **Date:** 2026-04-22
- **Author:** Mike (mikecb2010) + Claude (brainstorming session)
- **Status:** Draft — pending user review, then implementation-plan generation

---

## 1. Overview

Add a **Driver Planner** tab to the dispatcher module that gives dispatchers a PortPro-style day-at-a-glance grid for planning driver work. Drivers are listed down the left; their assigned moves for a selected date are laid out chronologically in expanding `Move 1…Move N` columns; unassigned moves sit in a right-rail pool, grouped into four eligibility buckets.

The planner is the second tab under the dispatcher module (after the existing Load Board). It introduces tab navigation to the dispatcher page for the first time and lays the groundwork for future tabs in this module (Driver Itinerary, Dual Transactions, Street Turns, Problem Containers, Trips).

### Why this exists

- Dispatchers currently plan drivers from the Load Board's 63-column grid, which is oriented around loads, not drivers. Assigning a driver to a move requires opening Load Detail for each load.
- A driver-first planner lets dispatchers plan a whole shift at a glance, drag unassigned moves into driver rows, dispatch work to the driver's (future) mobile app, and reconcile across multiple concurrent dispatchers in real time.
- This is a foundational piece for the future driver mobile app — once the planner is shipping `dispatched` status to moves, the mobile app has a clean read-side contract.

---

## 2. Scope

### In scope for v1

- New tab `/dispatcher?tab=planner` alongside the existing Load Board tab.
- Date-driven single-day grid view (`?date=YYYY-MM-DD`).
- Driver rows showing meta fields: ETA, Truck #, Chassis #, Size (derived from current/next load) + ELD fields Cycle, Drive, Shift, Break (rendered as placeholder dashes in v1).
- Dynamic Move-N columns — start at 8 visible, grow indefinitely (empty `+1` slot always available past the last populated column).
- Right-rail pool of unassigned moves bucketed into: **Containers At Port / Deliveries Scheduled / Containers To Return / Other** (chassis repositioning + street turns + anything not fitting the first three).
- Drag-and-drop: right-rail → driver row; intra-row reorder; driver-row → another driver-row.
- Per-cell action chips: **green ✓** (dispatch to driver's mobile app — status flip `pending → dispatched`) and **red ✗** (unassign driver, move returns to right-rail).
- Click-into-cell → side-panel preview (read-only summary + "Open Load" link to Load Detail in a new tab).
- Realtime updates via a Supabase Realtime channel on `order_container_moves`, `order_routing_events`, and `orders`.
- Permission gating: view requires `dispatcher.view`; assign/reorder/dispatch/unassign requires `dispatcher.edit` (same gate as the existing Load Board).

### Out of scope for v1 (tracked as follow-ups)

- **Truck-mode toggle.** The PortPro `[Driver] [Truck]` control's correct semantic is an "assignment-mode switcher" — same grid of drivers on the left, but the toggle changes whether the drag-drop operation binds a driver or a truck to the move. Deferred; toggle hidden in v1. When implemented, it reuses the same grid, writes either `driver_id` or `truck_id` on the `order_container_moves` row (or both), and keeps the rest of the UX identical.
- **Real ELD integration.** Samsara / Motive / Geotab / similar. Requires OAuth + webhook + ingestion sub-project. `drivers.eld_snapshot` JSONB column is added in v1's migration as a backing store; the planner renders dashes until populated.
- **Driver mobile-app push notification.** The green ✓ in v1 flips `order_container_moves.status` from `pending` → `dispatched` and writes an audit row. The mobile app (future sub-project) reads that status change. No SMS / push / email in v1.
- **Multi-day / week view** — v1 is strictly single-day.
- **Planner-specific KPI strip**, column customization, printing/exporting — may follow dispatcher-board patterns in a later pass.

---

## 3. URL & navigation

- `/dispatcher` → default tab (Load Board), unchanged behavior.
- `/dispatcher?tab=planner` → Driver Planner (defaults to today's date in the tenant's timezone).
- `/dispatcher?tab=planner&date=2026-04-23` → Driver Planner for the given date. Shareable / bookmarkable.
- `/dispatcher?tab=loadBoard` → explicit Load Board tab (no-op alias that makes URLs round-trippable).

Tab state + date are URL-driven. Browser back/forward, direct links, and cross-dispatcher link sharing all work.

A new `DispatcherTabs` component renders just below the existing `ModuleHeader` on `pages/dispatcher/index.js`. It mirrors the `DetailTabs` idiom already used by `components/loads/LoadDetailLayout.js:25-36`, keeping one tab-bar idiom across the app. The `TABS` array is future-proofed for additional dispatcher tabs.

---

## 4. Page layout

### Visual

```
┌─────────────────────────────────────────────────────────────────────────┐
│  ModuleHeader   (reused — Columns / Filters / Export / + New Load)       │
├─────────────────────────────────────────────────────────────────────────┤
│  DispatcherTabs   [ Load Board ] [ Driver Planner ]  (active)            │
├────────────────────────────────────────────────┬────────────────────────┤
│  PlannerToolbar                                │  RightRail header      │
│   Date picker · Search driver · Filter button  │  [ All · At Port ·     │
│                                                │    Deliveries · Return │
│                                                │    · Other ]           │
├────────────────────────────────────────────────┤                        │
│  DriverPlannerGrid                             │  UnassignedMovesList   │
│   ┌──────────────┬────────┬────────┬────────┐ │   bucket-grouped       │
│   │ Driver card  │ Move 1 │ Move 2 │ Move 3 │ │   scrollable cards     │
│   ├──────────────┼────────┼────────┼────────┤ │                        │
│   │ Driver card  │ Move 1 │ Move 2 │   ∅    │ │                        │
│   ├──────────────┼────────┼────────┼────────┤ │                        │
│   │ Driver card  │   ∅    │   ∅    │   ∅    │ │                        │
│   └──────────────┴────────┴────────┴────────┘ │                        │
│                 (horizontal scroll if needed)  │                        │
└────────────────────────────────────────────────┴────────────────────────┘
```

Side-panel preview slides in from the right when a cell is clicked (the right-rail shifts but remains visible).

### Driver meta card (left-most column of each row)

Two stacked sub-cards:

- **Load-derived:** `ETA`, `Truck #`, `Chassis #`, `Size` — from the driver's current or next move on the selected date (see §6 for the exact rule).
- **ELD-derived:** `Cycle`, `Drive`, `Shift`, `Break` — from `drivers.eld_snapshot` JSONB (rendered as `—` when empty).

Driver avatar + name + short-code initials (e.g., `1S  1002 - PAUL SINGH`) follow the PortPro reference.

### Move cell content

- **Header row:** clickable load # → opens Load Detail in a new tab. Action chips on the right: green ✓ (dispatch) and red ✗ (unassign).
- **Sub-line:** container # · size · type (e.g., `UMXU123321 · 53' · ST`).
- **`Assigned: MM/DD HH:mm`** timestamp.
- **Event pills stack** — one pill per `order_routing_events` row belonging to this move. Each pill shows event label + location + appointment time + LFD/per-diem badges inline where relevant.
- **Status strip** at bottom: background color matches the Load Board's existing status palette (pending / dispatched / in_progress / completed / cancelled).

### Empty slot

Dashed-border placeholder with muted text. When the dispatcher is mid-drag, empty slots highlight as drop targets.

### Right-rail unassigned pool

- Segmented tabs: **All (n) · At Port (n) · Deliveries (n) · Return (n) · Other (n)**. Counts are live.
- Each card shows: order #, container # · size · type, earliest event location + appt, LFD / empty-ready badge if present.
- Search box at the top filters across all buckets by order #, container #, or delivery location.
- Empty bucket: inline placeholder ("No containers at port for this date").

---

## 5. Component tree & file layout

### Component tree

```
pages/dispatcher/index.js                          (existing — add tab state + URL sync)
└── DispatcherTabs                                  (new)
    ├── LoadBoardView                               (existing DispatcherBoard, extracted if needed)
    └── DriverPlannerView                           (new — top-level planner)
        ├── PlannerToolbar                           (date picker · driver search · filter)
        ├── DriverPlannerGrid
        │   ├── DriverRow                            (× N drivers)
        │   │   ├── DriverMetaCard                   (left column — load + ELD fields)
        │   │   └── MoveSlot                         (× dynamic column count)
        │   │       └── MoveCell                     (renders if assigned, else DropZone)
        │   └── DriverRow.Empty                      (no drivers match search)
        └── UnassignedRightRail
            ├── BucketTabs                            (All / AtPort / Deliveries / Return / Other)
            ├── UnassignedMoveCard                   (× N unassigned moves)
            └── EmptyBucket                           (bucket empty placeholder)

components/dispatcher/planner/MovePreviewPanel.jsx   (slide-over preview)
```

### File layout

```
pages/dispatcher/index.js                          (modified — tab + URL state)
components/dispatcher/DispatcherTabs.jsx           (new)
components/dispatcher/planner/
    DriverPlannerView.jsx                          (top-level planner page)
    PlannerToolbar.jsx
    DriverPlannerGrid.jsx
    DriverRow.jsx
    DriverMetaCard.jsx
    MoveSlot.jsx
    MoveCell.jsx
    UnassignedRightRail.jsx
    UnassignedMoveCard.jsx
    MovePreviewPanel.jsx
    useDriverPlanner.js                            (fetch + realtime + mutations hook)
lib/dispatcher/moveBuckets.js                      (pure bucket-derivation util)
lib/dispatcher/moveBuckets.test.js                 (bucket-util unit tests)
pages/api/tenant/dispatcher/planner/
    index.js                                        (GET)
    assign.js                                       (POST)
    unassign.js                                     (POST)
    dispatch.js                                     (POST)
    reorder.js                                      (POST)
supabase/migrations/089_driver_planner_foundations.sql   (new migration)
```

All new components follow the project-wide dark-mode convention: every new `bg-*`, `text-*`, `border-*` class must include a `dark:` variant. See `memory/dev_dark_mode_convention.md`.

---

## 6. Data model changes — migration 089

Migration 089 is wrapped in `BEGIN; … COMMIT;` and ends with `NOTIFY pgrst, 'reload schema';` per `memory/dev_migration_template.md`. All schema changes are additive and reversible.

### 6.1 `order_container_moves.status`

Current values need verification. Normalize to the following enum via a CHECK constraint (added if not present, otherwise no-op):

```
'unassigned' | 'pending' | 'dispatched' | 'in_progress' | 'completed' | 'cancelled'
```

Default: `'unassigned'` when `driver_id IS NULL`, else `'pending'`.

### 6.2 `order_container_moves.scheduled_date`

- **Type:** `date` (nullable).
- **Purpose:** denormalized date the dispatcher is planning the move for; primary filter for the planner grid.
- **Populated:** set to the selected date when a move is assigned via the planner; derived fallback backfill from the earliest `order_routing_events.scheduled_at::date` for the move.
- **Backfill:** one-time UPDATE at migration time for existing rows.

### 6.3 `order_container_moves.sort_order`

- **Type:** `integer` (nullable).
- **Purpose:** per-driver per-date ordinal for "Move 1 / Move 2 / …".
- **Behavior:** renumbered on drag-reorder via the `/reorder` endpoint. Sparse integers (gap-of-10) are NOT used — we always write a dense 0,1,2,… sequence in the reorder transaction. Predictable, avoids edge cases.

Composite index `(tenant_id, driver_id, scheduled_date, sort_order)` supports the grid query.

### 6.4 `orders.container_at_port` + `orders.empty_ready_for_return_at`

- `container_at_port` — `boolean`, default `false`. Indicates the container is discharged and physically at port ready for pickup. Source of truth today = manual; future source = railroad/terminal API integrations (see `memory/project_api_integrations.md`).
- `empty_ready_for_return_at` — `timestamptz`, nullable. Set when the container is empty and ready for return (manual today; future automation possible).

These two flags drive the right-rail bucket eligibility rules.

### 6.5 `drivers.eld_snapshot`

- **Type:** `jsonb`, default `'{}'::jsonb`.
- **Shape (when populated):**
  ```json
  {
    "cycle_remaining_s": 28800,
    "drive_remaining_s": 14400,
    "shift_remaining_s": 28800,
    "break_in_s": 7200,
    "provider": "samsara",
    "last_synced_at": "2026-04-22T14:02:17Z"
  }
  ```
- **v1 behavior:** always `{}`. UI renders dashes.
- **Future integration:** a separate sub-project will ingest webhook / poll data and write here.

### 6.6 Audit-log support

No schema change — existing `audit_log` table handles planner mutations. The API handlers write rows with:

- `actor_id`, `actor_email`
- `entity_type = 'order_container_move'`
- `entity_id = move_id`
- `action ∈ {'assign', 'unassign', 'dispatch', 'redispatch', 'reorder'}`
- `before_json`, `after_json`

---

## 7. API contract

All endpoints under `pages/api/tenant/dispatcher/planner/`. All require the dispatcher permission gate (view or edit).

### 7.1 `GET /api/tenant/dispatcher/planner`

**Query params:**

| Param | Type | Required | Notes |
|---|---|---|---|
| `date` | `YYYY-MM-DD` | yes | Single-day window (tenant TZ). |
| `driver_search` | string | no | Filter drivers by name/id/truck# substring. |
| `branch_id` | uuid | no | Scope to branch. Follows existing branch scoping patterns. |
| `include_inactive` | `0`/`1` | no | If `1`, include drivers with `status ∈ {inactive, on_leave}` (rendered greyed). |

**Response:**

```jsonc
{
  "date": "2026-04-23",
  "drivers": [
    {
      "id": "uuid",
      "name": "Paul Singh",
      "short_code": "1S",
      "truck_number": "1002",
      "status": "active",
      "current_move_id": "uuid-or-null",
      "next_move_id": "uuid-or-null",
      "derived": {
        "eta": "08:15",
        "truck_number": "1002",
        "chassis_number": "ACME1234",
        "container_size": "53'"
      },
      "eld": null
    }
  ],
  "movesByDriverId": {
    "driver-uuid": [
      { /* MoveWithEvents, ordered by sort_order */ }
    ]
  },
  "unassignedBuckets": {
    "atPort":     [ /* MoveWithEvents[] */ ],
    "deliveries": [ /* MoveWithEvents[] */ ],
    "return":     [ /* MoveWithEvents[] */ ],
    "other":      [ /* MoveWithEvents[] */ ]
  }
}
```

**`MoveWithEvents` shape:**

```jsonc
{
  "id": "uuid",
  "order_id": "uuid",
  "order_number": "SUNRB_M100192",
  "driver_id": "uuid|null",
  "truck_id": "uuid|null",
  "chassis_id": "uuid|null",
  "status": "pending",
  "move_type": "pickup|delivery|return|chassis_reposition|street_turn|other",
  "sort_order": 0,
  "scheduled_date": "2026-04-23",
  "container_number": "UMXU123321",
  "container_size": "53'",
  "container_type": "ST",
  "assigned_at": "2026-04-22T14:02:00Z|null",
  "events": [
    { "id": "uuid", "event_type": "pickup|deliver|return|...", "sequence": 1,
      "location_id": "uuid|null", "location_name": "UP LATHROP: French Camp, CA",
      "scheduled_at": "2026-04-23T08:00:00Z|null",
      "arrived_at": "...", "departed_at": "..." }
  ],
  "order_flags": {
    "lfd": "2026-04-14|null",
    "container_at_port": true,
    "empty_ready_for_return_at": "2026-04-22T18:00:00Z|null"
  }
}
```

### 7.2 `POST /api/tenant/dispatcher/planner/assign`

**Body:**
```jsonc
{
  "moveId": "uuid",
  "driverId": "uuid",
  "truckId": "uuid|null",
  "chassisId": "uuid|null",
  "date": "YYYY-MM-DD",
  "insertAfterMoveId": "uuid|null",   // OR
  "positionIndex": 0                   // one of the two must be provided
}
```

**Preconditions:** exactly one of `insertAfterMoveId` or `positionIndex` must be provided (server rejects with 400 if both or neither).

**Allowed source statuses:** `unassigned`, `pending`, `dispatched`. Any other status → 409.

**Behavior:**
- Sets `driver_id`, `truck_id`, `chassis_id`, `scheduled_date = date`.
- Computes `sort_order`: places immediately after `insertAfterMoveId` if provided, else at `positionIndex`. All subsequent moves on that driver/date shift down (dense resequence).
- Status transition: `unassigned → pending`. If already `pending` or `dispatched` (i.e., just moving between drivers or reordering via drag), status is preserved.
- Writes audit row.
- Fires Realtime change (automatic via Postgres subscription).

**Response:** the updated `MoveWithEvents`.

**Errors:**
- `400` — body validation (missing positional arg, both supplied, unknown driver, etc.).
- `403` — permission denied.
- `404` — move or driver not found.
- `409` — source status is `in_progress`, `completed`, or `cancelled`. Dispatcher must reverse the status on Load Detail first.

### 7.3 `POST /api/tenant/dispatcher/planner/unassign`

**Body:** `{ "moveId": "uuid" }`.

**Allowed source statuses:** `pending`, `dispatched`, and `unassigned` (idempotent no-op). Any other status → 409.

**Behavior:**
- If source status = `unassigned`: return 200 with the current move state (no-op). No audit row written.
- Else: clears `driver_id`, `truck_id`, `chassis_id`, `scheduled_date`, `sort_order`.
- Status transition: `pending/dispatched → unassigned`.
- Resequences remaining moves on the prior driver/date (dense 0..N-1).
- Writes audit row.

**Errors:** `403`, `404`, `409` (source status ∈ {`in_progress`, `completed`, `cancelled`}).

### 7.4 `POST /api/tenant/dispatcher/planner/dispatch`

**Body:** `{ "moveId": "uuid" }`.

**Behavior:**
- Requires move status = `pending` (or `dispatched` for a re-dispatch).
- Status transition: `pending → dispatched`. Re-dispatch: `dispatched → dispatched` (audit records `redispatch`).
- Writes audit row with `dispatch` or `redispatch`.
- Future mobile app reads this status to pull the driver's work queue.

**Errors:** `403`, `404`, `409` (if status is `in_progress` or `completed` — already past the dispatch stage).

### 7.5 `POST /api/tenant/dispatcher/planner/reorder`

**Body:**
```jsonc
{
  "driverId": "uuid",
  "date": "YYYY-MM-DD",
  "orderedMoveIds": [ "uuid", "uuid", "uuid" ]
}
```

**Behavior:**
- Validates all moves belong to the same `driverId` + `scheduled_date`.
- Writes dense `sort_order` 0..N-1 in a single transaction.
- Writes one audit row summarizing the reorder.

---

## 8. Bucket derivation — `lib/dispatcher/moveBuckets.js`

Pure function, shared between server (initial GET payload) and client (realtime delta re-bucketing).

```ts
function getBucket(
  move: MoveWithEvents,
  order: { lfd, container_at_port, empty_ready_for_return_at }
): 'atPort' | 'deliveries' | 'return' | 'other';
```

### Rules

- **`atPort`** — `move.driver_id == null` AND `move.move_type === 'pickup'` AND `order.container_at_port === true` AND (`order.lfd != null` OR any pickup event has `scheduled_at != null`).
- **`deliveries`** — `move.driver_id == null` AND `move.move_type === 'delivery'` AND at least one event of type `deliver` has `scheduled_at != null`.
- **`return`** — `move.driver_id == null` AND `move.move_type === 'return'` AND `order.empty_ready_for_return_at != null`.
- **`other`** — any other unassigned move (chassis_reposition, street_turn, or a pickup/delivery/return that doesn't satisfy the eligibility criteria above).

Assigned moves (driver_id != null) are excluded from all buckets — they belong on a driver row, not the pool.

### Tests

`lib/dispatcher/moveBuckets.test.js` covers at minimum:

1. Pickup with LFD + container_at_port = true → `atPort`.
2. Pickup with appt but container_at_port = false → `other`.
3. Pickup with container_at_port = true but no LFD and no scheduled_at → `other`.
4. Delivery with delivery event scheduled_at → `deliveries`.
5. Delivery without any scheduled_at → `other`.
6. Return with empty_ready_for_return_at set → `return`.
7. Return without empty_ready_for_return_at → `other`.
8. Chassis reposition unassigned → `other`.
9. Street turn unassigned → `other`.
10. Any move with driver_id != null → returns `null` / throws (test both error modes).
11. Pickup eligible for `atPort` but move_type spelled differently (`'PICKUP'`, whitespace) — confirm we rely on the canonical lowercase value (raise on mismatch or normalize — prefer raise).
12. Edge: multiple events on a delivery, only first has scheduled_at → `deliveries`.

---

## 9. Interactions

### 9.1 Drag-and-drop (dnd-kit, matching the existing dispatcher columns pattern)

- **Source A** — unassigned move card in the right-rail.
  - **Target** — any `MoveSlot` in a `DriverRow` (empty or occupied).
  - Empty slot → `assign` with `positionIndex = slot index`.
  - Occupied slot → insert before the occupying move (all subsequent moves shift right).
- **Source B** — an already-placed `MoveCell` on a driver row.
  - **Target** — another `MoveSlot` on the same OR a different driver row.
    - Same driver → `reorder`.
    - Different driver → `assign` to the new driver (keeps `scheduled_date`, recomputes `sort_order`).
  - Drop outside any row → no-op. (Unassigning uses the ✗ chip; drag-to-trash is not supported to avoid accidents.)
- **Guard** — dragging a move with status `in_progress` or `completed` is blocked with a toast ("Can't move a job that's already in progress. Reverse status on the Load Detail page first.").
- **Keyboard / a11y** — dnd-kit's keyboard sensors: space to pick, arrows to navigate, space to drop. ARIA labels describe source + target.

### 9.2 Green ✓ (Dispatch to driver's mobile app)

- Enabled for status `pending` or `dispatched` (re-dispatch allowed).
- Click → optimistic `dispatched` UI update, fire `/dispatch`, on success chip flips from outlined green to solid green with label "Sent" (or "Re-sent" for redispatch).
- Mobile-app delivery is out-of-v1; the status flip is the contract the future mobile app will read.

### 9.3 Red ✗ (Unassign)

- Enabled for status `pending` or `dispatched`.
- Disabled (greyed) + tooltip for `in_progress` and `completed`.
- Click → optimistic animation: move slides from the driver row to the right-rail matching bucket. Fires `/unassign`. Rollback + toast on failure.

### 9.4 Click-to-preview side panel

- Clicking anywhere on the move cell EXCEPT the ✓ / ✗ chips and the load-# link opens `MovePreviewPanel`.
- Slide-over from the right edge of the content area; right-rail shifts to accommodate.
- Contents: move summary, events timeline with appointments, container/chassis/truck info, linked charges (read-only), and an **Open Load** button → `target="_blank"` link to Load Detail.

### 9.5 Right-rail filter UX

- Bucket tabs: **All / At Port / Deliveries / Return / Other**. Active tab highlighted with tenant primary color.
- Counts on tabs reflect the selected date's unassigned pool.
- Search box filters within the currently-selected bucket by order #, container #, or delivery location.

---

## 10. Realtime + state management

### 10.1 Client hook — `useDriverPlanner`

Signature: `useDriverPlanner({ date, driverSearch, branchId, includeInactive })`.

Returns:
```ts
{
  drivers, movesByDriverId, unassignedBuckets,
  mutations: { assign, unassign, dispatch, reorder },
  isLoading, error,
  refetch
}
```

Internal state: a `useReducer`-backed store (no new state library). Matches the existing Load Board's in-page state pattern.

### 10.2 Initial load

1. Mount → `GET /api/tenant/dispatcher/planner?date=&driver_search=&branch_id=&include_inactive=`.
2. Hydrate reducer.
3. Open Supabase Realtime channel `dispatcher_planner:{tenant_id}:{date}`.

### 10.3 Realtime subscriptions

Three Postgres subscriptions on the channel, all filtered by tenant:

- `order_container_moves` (INSERT / UPDATE / DELETE) — two subscriptions per date: `scheduled_date = <date>` (grid changes) and `driver_id is null` (right-rail additions even before a `scheduled_date` is set).
- `order_routing_events` (UPDATE) — appointment-time changes affect bucket eligibility.
- `orders` (UPDATE) — we care about three columns (`container_at_port`, `empty_ready_for_return_at`, `lfd`). Supabase doesn't support column-level filters on Realtime, so we subscribe broadly (filtered by tenant) and inspect column changes client-side.

**Known edge case — cross-date moves.** Supabase Realtime filters match on the row's NEW state for UPDATEs. If a move's `scheduled_date` changes from today → tomorrow, today's planner does **not** receive the UPDATE (because today's subscription filter no longer matches). The move would remain stuck on today's grid until the next refetch. Mitigation in v1: a lightweight periodic refetch every 60s while the page is visible (in addition to the reconnection refetch in §10.6). A tighter fix (subscribe unfiltered per-tenant and filter client-side, or emit a broadcast "move-left-date" signal) is a follow-up.

### 10.4 Delta handling

- **Move INSERT with driver_id** → place on driver row at the new `sort_order`.
- **Move INSERT with driver_id = null** → re-bucket via `getBucket()`, add to the right-rail bucket.
- **Move UPDATE** (status change, driver change, sort_order change, scheduled_date change) → reconcile in place. If driver changed, move between rows. If `scheduled_date` changed off-day, remove from grid (it's no longer on this page's date).
- **Move DELETE** (soft-delete or hard delete) → remove everywhere.
- **Routing event UPDATE** → re-derive bucket for the parent move; re-bucket if needed.
- **Order UPDATE** (bucket-relevant columns) → re-derive bucket for every unassigned move on that order.

### 10.5 Optimistic mutations

All four mutations (`assign`, `unassign`, `dispatch`, `reorder`) update the reducer first, then fire the API call. On success: reconcile with returned server state. On failure: roll back + show toast with the reason.

### 10.6 Reconnection & periodic refetch

- **Reconnection:** if the Realtime channel drops, the hook does a full `GET` refetch on reconnect (debounced 500ms). No delta-replay needed.
- **Periodic refetch:** while the page is visible, a background `GET` refetch runs every 60s as a belt-and-suspenders measure against the cross-date edge case in §10.3 and any other missed deltas. Paused when the document is hidden (`document.visibilityState !== 'visible'`) to avoid burning tenant quota on background tabs.

---

## 11. Permissions

- **View** (`/dispatcher?tab=planner` loads): same gate as the existing Load Board — whatever role grants access to `/dispatcher` today also grants access to the Planner tab.
- **Edit** (assign / reorder / dispatch / unassign): same gate as the existing Load Board's edit actions (e.g., bulk-assign driver, reassign via Load Detail). Read-only users see cells but drag handles and chips are disabled with explanatory tooltips.
- No new role primitives are introduced. Inherits the existing RBAC system.
- **Implementation note:** the plan's first step should grep for the exact permission-check calls used in `pages/api/tenant/loads/*.js` and `pages/dispatcher/index.js` and reuse the same helper / role string, rather than inventing new names.

Per `memory/project_vision.md`, permissions flow through tenant-scoped RBAC; no cross-tenant reads are possible.

---

## 12. Edge cases

1. **Driver has 0 moves for the date** — row renders with 8 empty slots; meta card shows `-` for ETA / Truck # / Chassis # / Size. Drag targets still work.
2. **Move has 0 routing events** — cell shows the move header + a "No events scheduled yet" placeholder. Still draggable / dispatchable.
3. **Move is assigned but `scheduled_date` is NULL** (legacy data) — migration 089 backfills via earliest event's `scheduled_at::date`. Any mutation touching the move also sets `scheduled_date`.
4. **Driver is `inactive` or `on_leave`** — hidden by default; revealed (greyed, read-only) when `include_inactive=1` is set via the toolbar toggle.
5. **Two dispatchers assign the same move concurrently** — last write wins at the DB layer (single `UPDATE`); Realtime propagates the final state to both clients. The "losing" client sees a toast: "This move was just assigned to {driver} by {user}."
6. **Dispatcher drops a move whose order was cancelled between fetch and drop** — server rejects with 409; client rolls back + toast.
7. **Unassigning a move that has non-zero charges** — allowed. Charges live on the order (not the move); no AR mutation.
8. **Move with multiple events, only some `scheduled_at` set** — bucket derivation uses the highest-priority event of the matching type (pickup for `atPort`, deliver for `deliveries`). Missing = falls to `other`.
9. **Move crosses midnight** (pickup late today, deliver early tomorrow) — `scheduled_date` is the dispatcher-assigned plan date, not the derived earliest-event date. Dispatcher owns the call.
10. **Horizontal scroll performance** with 30+ move columns — virtualization is deferred to a follow-up; first pass relies on CSS horizontal scroll with `position: sticky` on the driver meta column. If performance suffers we can add `react-window`.

---

## 13. Testing strategy

### Unit tests (Jest, co-located)

- `lib/dispatcher/moveBuckets.test.js` — the 12 cases in §8.
- `components/dispatcher/planner/useDriverPlanner.test.js` — reducer tests for every delta type + optimistic rollback on error.
- API handler tests per endpoint (`pages/api/tenant/dispatcher/planner/*.test.js`) — happy path + `in_progress` block + permission denied + cross-tenant rejection.

### Chrome live-verification gates (via Claude-in-Chrome MCP)

1. Load `/dispatcher?tab=planner&date=<today>` — grid renders, drivers listed, right-rail bucket counts visible.
2. Drag an unassigned "At Port" move onto a driver's empty slot — cell appears on the row, bucket count decrements.
3. Click green ✓ — chip flips to "Sent", audit row written (verify via DB query).
4. Click red ✗ on a `pending` move — move animates back to the right-rail bucket, driver slot empties.
5. Open planner in a second browser; assign a move in tab 1 → observe it in tab 2 within 2 seconds (Realtime).
6. Drag a move whose status = `in_progress` → blocked with toast (set up a test move in that state manually).
7. Click a move cell → side-panel preview opens; click "Open Load" → Load Detail opens in a new tab.
8. Change date to tomorrow → grid re-populates with tomorrow's moves; right-rail bucket counts change accordingly.
9. Search driver by name — grid filters; bucket counts remain global (not filtered).
10. Reload page with `?tab=planner&date=2026-04-23` → state reflects URL exactly.
11. Re-dispatch a `dispatched` move — chip flips briefly + audit row records `redispatch`.
12. Drag a move from one driver to another — moves between rows; resequences on both sides.

### Code-review gate

Run `superpowers:code-reviewer` subagent against the diff, then `dd-qa` for field-consistency checks, before the final ship commit.

---

## 14. Follow-ups (not blockers)

1. **Truck-mode toggle** — assign-mode switcher described in §2.
2. **ELD integration** — Samsara / Motive / Geotab ingestion; populates `drivers.eld_snapshot`.
3. **Driver mobile app** — reads `order_container_moves.status = 'dispatched' AND driver_id = me`.
4. **Multi-day view** — week-at-a-glance grid variant.
5. **Planner KPI strip** — if useful; follows the Load Board's pattern.
6. **Row virtualization** — if horizontal-scroll performance degrades at scale.
7. **Planner-specific column customization** — e.g., hiding Chassis # on drivers who don't use chassis.
8. **Future dispatcher tabs** — Driver Itinerary, Dual Transactions, Street Turns, Problem Containers, Trips per `memory/project_portpro_reference.md`.

---

## 15. Open questions left in the design (for the implementation-plan stage)

- Exact current enum values on `order_container_moves.status` — need to grep the codebase during plan-writing. If some of our target values already exist, migration 089 just normalizes; if all are new, we add them.
- Whether `orders` already has something equivalent to `container_at_port` under a different name. If so, we alias rather than add.
- Whether the existing dispatcher uses a Realtime channel we can share or extend vs. opening a new one.
- Whether `drivers.status` values include exactly `'active' | 'inactive' | 'on_leave'` (verified in exploration, but double-check at plan time).

These don't change the design — they refine the migration. The implementation plan will start by verifying each.
