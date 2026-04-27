# FU-105: Sync `orders.driver_id` from Planner Move Assignments — Design

**Status:** Design approved 2026-04-25 (brainstorm)
**Tracks:** FU-105
**Discovered during:** Driver planner card redesign visual gates (2026-04-25)

## 1. Goal

Mirror move-level driver assignments from the Driver Planner to the load-level `orders.driver_id` field, so the Dispatcher Load Board's DRIVER column reflects current planner state. Reuse the existing driver-pay recalculation path so pay auto-applies when consensus exists.

## 2. Scope

**In scope**
- `assign.js` writes through to `orders.driver_id` after updating `order_container_moves.driver_id`
- `unassign.js` recomputes consensus after clearing the move's driver_id
- New shared helper for the consensus computation + pay-recalc trigger
- Reuses existing `findMatchingDriverCharges` + `applyDriverPayToLoad` (the load detail page's pay path) so behavior matches the manual edit flow

**Out of scope (deferred)**
- Multi-driver pay model — when consensus breaks (mixed drivers), `orders.driver_id` clears and no pay applies. Splitting pay across drivers per-move is a separate model that doesn't exist yet. (Future FU.)
- Stale `order_driver_pay_lines` cleanup when consensus breaks — pre-existing behavior of the system; this fix doesn't try to address it.
- `bulk-dispatch.js` — only changes status, never `driver_id`. No change needed.
- Frontend — purely backend sync.

## 3. Policy (chosen during brainstorm)

**Strict consensus over assigned non-cancelled moves:**

```
For an order O:
  assigned_drivers = {move.driver_id for move in O.moves
                      where move.status != 'cancelled' AND move.driver_id IS NOT NULL}

  if assigned_drivers is empty:
    target = NULL
  elif assigned_drivers has exactly one element D:
    target = D
  else (mixed):
    target = NULL

  if target != O.driver_id:
    UPDATE orders SET driver_id = target WHERE id = O.id
    if target IS NOT NULL AND target != previous:
      run findMatchingDriverCharges + applyDriverPayToLoad (existing path)
```

Cancelled moves are excluded. Unassigned moves don't break consensus (so partially-planned loads still get the load-level driver set). When all assigned moves leave or scatter to multiple drivers, `orders.driver_id` clears and pay logic runs (which today is a no-op for the NULL transition, but mirrors the existing manual-edit semantics).

## 4. Architecture

### 4.1 New helper

**Create:** `lib/dispatcher/sync-load-driver.js`

```js
export async function syncLoadDriverFromMoves(svc, orderId, tenantId) {
  // 1. Query non-cancelled moves on the order, select driver_id
  // 2. Compute consensus per the policy in §3
  // 3. Read current orders.driver_id
  // 4. If different from consensus → UPDATE orders.driver_id
  // 5. If new driver assigned (target IS NOT NULL AND target != previous):
  //    call findMatchingDriverCharges + applyDriverPayToLoad
  // Returns { changed: bool, prev: uuid|null, next: uuid|null }
}
```

Pure server-side function. Idempotent: callable repeatedly without side effects when nothing changed.

### 4.2 Call sites

**Modify:** `pages/api/tenant/dispatcher/planner/assign.js`

After the existing move update succeeds (around line 165), call:

```js
await syncLoadDriverFromMoves(svc, move.order_id, ctx.tenantId);
```

Wrap in `try/catch` and log on failure — sync failure should NOT break the assignment (already happened).

**Modify:** `pages/api/tenant/dispatcher/planner/unassign.js`

After the existing move update succeeds (around line 100), same call.

### 4.3 Pay path reuse

`findMatchingDriverCharges` and `applyDriverPayToLoad` already live somewhere reachable (used by `pages/api/tenant/loads/[id]/index.js:571-574`). The helper imports them from the same location. No changes to those functions.

## 5. Files Changed

| File | Change | Approx LoC |
|---|---|---|
| `lib/dispatcher/sync-load-driver.js` | New helper | +60 |
| `pages/api/tenant/dispatcher/planner/assign.js` | Call helper after move update + try/catch | +6 |
| `pages/api/tenant/dispatcher/planner/unassign.js` | Call helper after move update + try/catch | +6 |

**Total:** ~+72 LoC across 3 files. Zero migrations, zero new RPCs.

## 6. Risks & Mitigations

| Risk | Mitigation |
|---|---|
| Helper fires expensive pay-recalc on every assign click | Helper returns early when `orders.driver_id` already matches consensus — most clicks are no-ops |
| Concurrent assigns race to update `orders.driver_id` | Last-write-wins is acceptable; both writes derive consensus from the same moves table, so they converge |
| `applyDriverPayToLoad` has side effects we don't anticipate from the planner context | Read its implementation before wiring; test against the user's dev environment with one assign / one unassign / one mixed-driver scenario before shipping |
| Sync failure breaks the assignment | `try/catch` around the helper call; log on failure but return success for the assign — the move is assigned even if Load Board view is briefly stale |
| Existing manual `orders.driver_id` edits get overridden by planner | By design — planner is now the source of truth for assignment. Manual edits via Load Detail still work but will be overwritten next time a move is assigned/unassigned |
| The helper imports `applyDriverPayToLoad` from `pages/api/...` (cross-import from /pages into /lib) | If those helpers live in `lib/` already, fine. If they only live under `pages/`, may need a small refactor to extract them. Discover during planning. |

## 7. Verification Gates

1. **Single-driver load** — assign 2 moves on a load to driver A → `orders.driver_id = A`, `order_driver_pay_lines` populated.
2. **Mixed-driver load** — assign one move to A, another to B → `orders.driver_id = NULL`, no new pay lines.
3. **Single move unassign** — assign move, then unassign → `orders.driver_id = NULL`.
4. **Partial unassign** — assign 3 moves to A, unassign one → `orders.driver_id` stays at A (consensus preserved).
5. **Idempotent** — repeated assignment to the same driver doesn't keep adding pay lines (the early-return path).
6. **Visual** — Load Board's DRIVER column updates after a planner assignment without page refresh (or after refresh, if the column doesn't poll).

## 8. Commit Plan

Single feature branch `fix/fu-105-driver-sync` with 3-4 small commits:

1. `feat(dispatcher): add syncLoadDriverFromMoves helper`
2. `feat(planner-assign): write through driver to orders.driver_id`
3. `feat(planner-unassign): recompute orders.driver_id on unassign`
4. (optional) `chore: extract applyDriverPayToLoad to lib/` if cross-import needs cleanup

Final squash-merge to main with `Resolves: FU-105` in body.
