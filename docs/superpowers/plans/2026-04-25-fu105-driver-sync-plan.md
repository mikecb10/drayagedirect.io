# FU-105 Driver Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mirror move-level driver assignments from the Driver Planner to the load-level `orders.driver_id` field so the Dispatcher Load Board's DRIVER column reflects the planner's current state. Reuse the existing driver-pay recalculation path so pay auto-applies when consensus exists.

**Architecture:** New shared helper at `lib/dispatcher/sync-load-driver.js` exports `syncLoadDriverFromMoves(svc, orderId, tenantId)`. Helper queries non-cancelled moves on the order, computes "strict consensus" (single shared driver → set; mixed or none → NULL), and writes through to `orders.driver_id`. When the new value is non-null and different from the previous, it lazy-imports `findMatchingDriverCharges` + `applyDriverPayToLoad` from `lib/driver-tariff-engine` and runs the same pay path the manual Load Detail edit uses. Both `assign.js` and `unassign.js` call the helper after their move updates succeed, wrapped in `try/catch` so sync failures don't break the assignment itself.

**Tech Stack:** Next.js 14 (pages router), Supabase (service-role), `@supabase/supabase-js`. No test framework in repo — verification via `node --check` for syntax + visual + DB-query gates after merge.

**Spec:** [docs/superpowers/specs/2026-04-25-fu105-driver-sync-design.md](../specs/2026-04-25-fu105-driver-sync-design.md) (commit `142b77c`)

---

## File Structure

**Create:**
- `lib/dispatcher/sync-load-driver.js` — `syncLoadDriverFromMoves` helper (~80 LoC)

**Modify:**
- `pages/api/tenant/dispatcher/planner/assign.js` — add `order_id` to move fetch; call helper after move updates
- `pages/api/tenant/dispatcher/planner/unassign.js` — add `order_id` to move fetch; call helper after move updates

**Total:** ~+95 LoC across 3 files. Zero migrations, zero new RPCs, zero schema changes.

**Parallelizable:** None — Tasks 2 and 3 depend on Task 1 (the helper). Task 4 (verification) is sequential.

---

## Task 1: Create `syncLoadDriverFromMoves` helper

**Files:**
- Create: `lib/dispatcher/sync-load-driver.js`

**Context:** Pure server-side helper. Imports `findMatchingDriverCharges` + `applyDriverPayToLoad` from `lib/driver-tariff-engine` (lazy-loaded inside the function only when a new driver is assigned, mirroring the dynamic-import pattern at [pages/api/tenant/loads/[id]/index.js:569](../../pages/api/tenant/loads/[id]/index.js)). Idempotent — if consensus already matches the current `orders.driver_id`, returns early with no writes.

- [ ] **Step 1: Write the helper file**

Write to `lib/dispatcher/sync-load-driver.js`:

```js
/**
 * Mirror move-level driver assignments (from the Driver Planner) to the
 * load-level `orders.driver_id` field so the Dispatcher Load Board's
 * DRIVER column reflects current planner state.
 *
 * Policy — STRICT CONSENSUS over non-cancelled moves with a driver assigned:
 *   - all share one driver_id → orders.driver_id = that driver
 *   - split across drivers    → orders.driver_id = NULL
 *   - no assigned moves       → orders.driver_id = NULL
 *
 * When orders.driver_id changes to a new non-null driver, runs the same
 * driver-pay path the Load Detail manual edit uses — `findMatchingDriverCharges`
 * + `applyDriverPayToLoad` from `lib/driver-tariff-engine`.
 *
 * Idempotent: if consensus already matches the current orders.driver_id,
 * returns `{ changed: false }` without any writes.
 *
 * Throws on Supabase errors. Callers should wrap in try/catch so a sync
 * failure doesn't break the underlying move assignment.
 *
 * @param {SupabaseClient} svc       — service-role client
 * @param {string} orderId           — UUID of the order/load
 * @param {string} tenantId          — UUID of the tenant
 * @returns {Promise<{changed: boolean, prev: string|null, next: string|null}>}
 */
export async function syncLoadDriverFromMoves(svc, orderId, tenantId) {
  // 1. Read the current order row (full select for the tariff engine).
  const { data: order, error: orderErr } = await svc
    .from('orders')
    .select('*')
    .eq('id', orderId)
    .eq('tenant_id', tenantId)
    .maybeSingle();
  if (orderErr) {
    throw new Error(`syncLoadDriverFromMoves: read order failed: ${orderErr.message}`);
  }
  if (!order) {
    // Order doesn't exist or wrong tenant — nothing to sync.
    return { changed: false, prev: null, next: null };
  }

  // 2. Read all non-cancelled moves on this order.
  const { data: moves, error: movesErr } = await svc
    .from('order_container_moves')
    .select('driver_id, status')
    .eq('tenant_id', tenantId)
    .eq('order_id', orderId)
    .neq('status', 'cancelled');
  if (movesErr) {
    throw new Error(`syncLoadDriverFromMoves: read moves failed: ${movesErr.message}`);
  }

  // 3. Compute consensus over moves with a driver assigned.
  const assignedDriverIds = new Set(
    (moves || [])
      .map((m) => m.driver_id)
      .filter((id) => id != null)
  );
  let target;
  if (assignedDriverIds.size === 0) {
    target = null; // no assigned moves
  } else if (assignedDriverIds.size === 1) {
    target = [...assignedDriverIds][0]; // single shared driver
  } else {
    target = null; // mixed drivers — no consensus
  }

  // 4. Idempotent check: if target already matches, no writes.
  const prev = order.driver_id || null;
  if (target === prev) {
    return { changed: false, prev, next: target };
  }

  // 5. UPDATE orders.driver_id.
  const { error: updErr } = await svc
    .from('orders')
    .update({ driver_id: target })
    .eq('id', orderId)
    .eq('tenant_id', tenantId);
  if (updErr) {
    throw new Error(`syncLoadDriverFromMoves: update order failed: ${updErr.message}`);
  }

  // 6. If a new driver is now assigned (target non-null AND different from prev),
  //    run the same driver-pay path the Load Detail manual edit uses. Lazy-import
  //    so the heavy tariff engine isn't loaded on every request.
  if (target != null && target !== prev) {
    const { findMatchingDriverCharges, applyDriverPayToLoad } =
      await import('../driver-tariff-engine');
    const charges = await findMatchingDriverCharges(svc, order, target, tenantId);
    if (charges.length > 0) {
      await applyDriverPayToLoad(svc, orderId, target, tenantId, charges);
    }
  }

  return { changed: true, prev, next: target };
}
```

- [ ] **Step 2: Verify syntax**

Run: `node --check lib/dispatcher/sync-load-driver.js`
Expected: exits 0 with no output.

- [ ] **Step 3: Commit**

```bash
git add lib/dispatcher/sync-load-driver.js
git commit -m "feat(dispatcher): add syncLoadDriverFromMoves helper"
```

---

## Task 2: Wire helper into `assign.js`

**Files:**
- Modify: `pages/api/tenant/dispatcher/planner/assign.js`

**Context:** Two changes:
1. Add `order_id` to the move fetch select at line 46 — the helper needs it to query sibling moves.
2. Call the helper after the move updates succeed (after line 117), wrapped in `try/catch` so a sync failure doesn't break the assignment.

The natural call site is right after the move-update Promise.all completes successfully and any prior-row resequencing is done — i.e. between line 142 (end of resequencing block) and line 144 (start of `logTenantAction`).

- [ ] **Step 1: Add the import at the top of the file**

In `pages/api/tenant/dispatcher/planner/assign.js` find the existing import block at lines 1-7. Add a new import line at the end of the block:

Find:
```js
import {
  requireTenantUser,
  requirePermission,
  getServiceClient,
} from '../../../../../lib/tenant-api';
import { logTenantAction, getClientIp } from '../../../../../lib/tenant-audit';
import { PERMISSIONS } from '../../../../../lib/permissions';
```

Replace with:
```js
import {
  requireTenantUser,
  requirePermission,
  getServiceClient,
} from '../../../../../lib/tenant-api';
import { logTenantAction, getClientIp } from '../../../../../lib/tenant-audit';
import { PERMISSIONS } from '../../../../../lib/permissions';
import { syncLoadDriverFromMoves } from '../../../../../lib/dispatcher/sync-load-driver';
```

- [ ] **Step 2: Add `order_id` to the move fetch select**

Find this block at line 44-49:
```js
  const { data: move, error: moveErr } = await svc
    .from('order_container_moves')
    .select('id, tenant_id, driver_id, status, scheduled_date, sort_order')
    .eq('id', moveId)
    .eq('tenant_id', ctx.tenantId)
    .maybeSingle();
```

Replace the `.select(...)` line to include `order_id`:
```js
  const { data: move, error: moveErr } = await svc
    .from('order_container_moves')
    .select('id, tenant_id, order_id, driver_id, status, scheduled_date, sort_order')
    .eq('id', moveId)
    .eq('tenant_id', ctx.tenantId)
    .maybeSingle();
```

- [ ] **Step 3: Call the helper after move updates succeed**

Find the block at lines 142-144 (closing brace of the prior-row resequencing `if`, then a blank line, then the `await logTenantAction(...)` call):

```js
    if (priorErr) return res.status(500).json({ error: priorErr.error.message });
  }

  await logTenantAction(svc, {
```

Insert a new `try/catch` block between the closing brace and the `await logTenantAction` call so the sync runs after all move-table writes but before the audit log:

```js
    if (priorErr) return res.status(500).json({ error: priorErr.error.message });
  }

  // Mirror the move-level assignment to orders.driver_id (load-level) so
  // the Dispatcher Load Board's DRIVER column reflects planner state.
  // Wrapped in try/catch — a sync failure must NOT break the assignment.
  try {
    await syncLoadDriverFromMoves(svc, move.order_id, ctx.tenantId);
  } catch (e) {
    console.error('[planner/assign] syncLoadDriverFromMoves failed:', e?.message);
  }

  await logTenantAction(svc, {
```

- [ ] **Step 4: Verify syntax**

Run: `node --check pages/api/tenant/dispatcher/planner/assign.js`
Expected: exits 0 with no output.

- [ ] **Step 5: Commit**

```bash
git add pages/api/tenant/dispatcher/planner/assign.js
git commit -m "feat(planner-assign): write through driver to orders.driver_id"
```

---

## Task 3: Wire helper into `unassign.js`

**Files:**
- Modify: `pages/api/tenant/dispatcher/planner/unassign.js`

**Context:** Same two-part change as Task 2 — add `order_id` to the move fetch select, and call the helper after the move + prior-row resequencing complete. Natural call site: between line 82 (end of prior-row resequencing block) and line 84 (start of `logTenantAction`).

- [ ] **Step 1: Add the import at the top of the file**

In `pages/api/tenant/dispatcher/planner/unassign.js` find the existing import block at lines 1-7. Add a new import line at the end of the block:

Find:
```js
import {
  requireTenantUser,
  requirePermission,
  getServiceClient,
} from '../../../../../lib/tenant-api';
import { logTenantAction, getClientIp } from '../../../../../lib/tenant-audit';
import { PERMISSIONS } from '../../../../../lib/permissions';
```

Replace with:
```js
import {
  requireTenantUser,
  requirePermission,
  getServiceClient,
} from '../../../../../lib/tenant-api';
import { logTenantAction, getClientIp } from '../../../../../lib/tenant-audit';
import { PERMISSIONS } from '../../../../../lib/permissions';
import { syncLoadDriverFromMoves } from '../../../../../lib/dispatcher/sync-load-driver';
```

- [ ] **Step 2: Add `order_id` to the move fetch select**

Find this block at lines 27-32:
```js
  const { data: move, error: moveErr } = await svc
    .from('order_container_moves')
    .select('id, tenant_id, driver_id, scheduled_date, sort_order, status')
    .eq('id', moveId)
    .eq('tenant_id', ctx.tenantId)
    .maybeSingle();
```

Replace the `.select(...)` line to include `order_id`:
```js
  const { data: move, error: moveErr } = await svc
    .from('order_container_moves')
    .select('id, tenant_id, order_id, driver_id, scheduled_date, sort_order, status')
    .eq('id', moveId)
    .eq('tenant_id', ctx.tenantId)
    .maybeSingle();
```

- [ ] **Step 3: Call the helper after move updates succeed**

Find the block at lines 81-84 (closing brace of the prior-row resequencing block, then blank line, then `await logTenantAction(...)`):

```js
      )
    );
  }

  await logTenantAction(svc, {
```

Insert a `try/catch` block between the closing brace and the `await logTenantAction` call:

```js
      )
    );
  }

  // Mirror the unassignment to orders.driver_id (load-level). If this was
  // the last assigned move on the load, orders.driver_id will clear.
  // Wrapped in try/catch — a sync failure must NOT break the unassignment.
  try {
    await syncLoadDriverFromMoves(svc, move.order_id, ctx.tenantId);
  } catch (e) {
    console.error('[planner/unassign] syncLoadDriverFromMoves failed:', e?.message);
  }

  await logTenantAction(svc, {
```

- [ ] **Step 4: Verify syntax**

Run: `node --check pages/api/tenant/dispatcher/planner/unassign.js`
Expected: exits 0 with no output.

- [ ] **Step 5: Commit**

```bash
git add pages/api/tenant/dispatcher/planner/unassign.js
git commit -m "feat(planner-unassign): recompute orders.driver_id on unassign"
```

---

## Task 4: Visual verification gates (after merge)

**Files (verification only — no code changes):**
- None

**Context:** The dev server at `http://localhost:51146` is running on `main`. After merging the feature branch, the server will hot-reload with the new code. Run six verification gates against the test tenant (`Test Trucking Co`, login `test@testtruck.com` / `DrayageDirect2026!`). The test tenant has 3 drivers (Hunter Guernard, Michael Benton, Zac Bryant) and ~12 unassigned moves. Two moves were already assigned to Hunter Guernard during the previous session's testing (TEST-N000014, TEST-O000016) — these provide the starting state for some gates.

The "before" snapshot for Gate 5 (idempotent check) requires that the user has already assigned at least one move to the same driver before this fix, then re-assigns the same driver to verify no duplicate pay rows. Use `psql` or Supabase Studio to inspect `order_driver_pay_lines` row counts before and after.

- [ ] **Step 1: Reload the dev server preview after merge**

Use `preview_logs` (filter level: `error`) to scan for any compile/import errors. Expect: clean. The new module should appear in the module count delta.

- [ ] **Step 2: Gate A — single-driver consensus → orders.driver_id set, pay applied**

In the planner UI, drag any unassigned move from the right rail onto a driver row (e.g. Michael Benton). After the API call completes, query the DB:

```sql
SELECT id, order_number, driver_id
FROM orders
WHERE id = '<order_id_of_assigned_move>';
```
Expected: `driver_id` = Michael Benton's UUID.

```sql
SELECT id, driver_id, charge_set_id, total_cents
FROM order_driver_pay_lines
WHERE order_id = '<order_id>';
```
Expected: at least one pay line with `driver_id` = Michael Benton's UUID. (Zero rows if no driver tariffs match the load's pickup/delivery — that's still correct behavior, just means no auto-pay applies.)

Then visit `/dispatcher` (Load Board tab). Find the row for that load. The DRIVER column should now show Michael Benton's name (instead of the empty + assign-driver icon).

- [ ] **Step 3: Gate B — mixed-driver scenario → orders.driver_id clears**

Pick a load that has at least 2 moves (TEST-O000016 might work — has 3 events across an Outbound flow). Assign one move to Driver A and another move on the SAME LOAD to Driver B. (If the test tenant doesn't have a multi-move load, create one by approving a charge set with 2+ legs.)

After both assignments:
```sql
SELECT id, driver_id FROM orders WHERE id = '<order_id>';
```
Expected: `driver_id` = NULL (no consensus).

Load Board DRIVER column should show empty / + assign-driver icon for that load.

- [ ] **Step 4: Gate C — full unassign clears `orders.driver_id`**

For the load from Gate A (single driver, fully assigned), unassign EVERY move via the planner (drag back to the right rail or use the unassign button on the cell). After all unassignments:
```sql
SELECT id, driver_id FROM orders WHERE id = '<order_id>';
```
Expected: `driver_id` = NULL.

Load Board DRIVER column → empty.

- [ ] **Step 5: Gate D — partial unassign preserves consensus**

Set up: a load with 3 moves all assigned to driver A (so `orders.driver_id = A`). Unassign ONE of the three moves (the other two stay on A).

```sql
SELECT id, driver_id FROM orders WHERE id = '<order_id>';
```
Expected: `driver_id` STILL equals A (consensus preserved over the remaining 2 assigned moves).

- [ ] **Step 6: Gate E — idempotent (re-assign same driver, no duplicate pay)**

Snapshot before:
```sql
SELECT COUNT(*) AS pay_count FROM order_driver_pay_lines WHERE order_id = '<order_id>';
```

Re-assign the same driver to a move that's already assigned to that driver (e.g. drag the cell within the same row, or click and drop in the same position). The API still fires (assigns) — the question is whether the helper triggers a duplicate pay line.

Snapshot after the same query. Expected: `pay_count` UNCHANGED (helper short-circuits when target == prev, no pay path runs).

- [ ] **Step 7: Gate F — sync failure isolation (manual probe)**

Optional but valuable. To exercise the try/catch path: temporarily inject a transient error into the helper (e.g. by passing a non-existent tenant id via a curl probe directly to the API, or by editing the helper locally to throw). Verify:
1. The API still returns 200 (assignment itself succeeded).
2. The error is logged to the dev server console as `[planner/assign] syncLoadDriverFromMoves failed: ...`.
3. The move's `driver_id` field on `order_container_moves` IS updated correctly (the assign part worked).

Revert any temporary instrumentation before continuing.

- [ ] **Step 8: Commit only if any fixes needed**

If all gates pass, no commit. If a fix was needed (e.g. wrong import path, missing column in select), commit:

```bash
git add <fixed files>
git commit -m "fix(planner-driver-sync): <bug description>"
```

---

## Task 5: Final ship — `Resolves: FU-105` commit

**Files:**
- None (commit message body only)

**Context:** Verify the branch is clean and route the FU closure.

- [ ] **Step 1: Review the commit series**

Run `git log --oneline main..HEAD` to list the commits. Expected: 3 commits (one per Task 1-3), or 4 if Task 4 needed fixes.

- [ ] **Step 2: Run `dd-qa` skill**

Invoke the `dd-qa` skill to validate field consistency, enum alignment, routing logic, UI pattern compliance.

- [ ] **Step 3: Confirm no stray debug or commented code**

Run:
```bash
git diff main..HEAD -- pages/api/tenant/dispatcher/planner/ lib/dispatcher/ | grep -E '^\+.*(console\.log|debugger|TODO|XXX|FIXME)'
```
Expected: only the intentional `console.error(...)` lines from Tasks 2 and 3 (sync failure logging). Anything else → remove.

- [ ] **Step 4: Final merge to main**

If on a feature branch: open PR `fix(planner): sync orders.driver_id from move assignments (FU-105)`. Body summary + `Resolves: FU-105`.

If committing directly: amend the LAST commit body to include `Resolves: FU-105` if a tracking FU exists, OR squash-merge with the closing line.

- [ ] **Step 5: Verify ledger closure**

The `update-followups` skill will move FU-105 to "Recently resolved" via SHA match on the closing commit's `Resolves:` marker. Spot-check after merge:

```bash
git log --grep="FU-105" --oneline | head -3
```

---

## Self-Review

**Spec coverage check:**

- §2 In Scope: helper module → Task 1 ✓; assign.js write-through → Task 2 ✓; unassign.js write-through → Task 3 ✓; pay-recalc reuse → Task 1 Step 1 (lazy-imports `findMatchingDriverCharges` + `applyDriverPayToLoad`) ✓
- §2 Out of Scope: multi-driver pay, stale pay-line cleanup, bulk-dispatch.js, frontend — none of these are touched by any task ✓
- §3 Policy (strict consensus): Task 1 Step 1 implements the exact algorithm with the empty/single/mixed branches ✓
- §4.1 Helper signature `syncLoadDriverFromMoves(svc, orderId, tenantId) → { changed, prev, next }` → Task 1 ✓
- §4.2 Both call sites with try/catch → Tasks 2, 3 ✓
- §4.3 Pay-path reuse (lazy import from `lib/driver-tariff-engine`) → Task 1 Step 1 ✓
- §6 Risks: idempotent early-return → Task 1 Step 1 (line "if (target === prev)") ✓; try/catch around helper → Tasks 2/3 Step 3 ✓
- §7 Verification gates 1-6 → Task 4 covers Gate A (single-driver), Gate B (mixed), Gate C (full unassign), Gate D (partial unassign), Gate E (idempotent), plus Gate F (failure isolation, bonus) ✓
- §8 Commit plan: 3 main commits (helper + assign wiring + unassign wiring) — matches Tasks 1-3 ✓

**Placeholder scan:** No "TBD", "TODO", or "implement appropriate" in any task. Every code step has the literal code. Every command has expected output stated.

**Type consistency:**
- Helper exported as `syncLoadDriverFromMoves` in Task 1; imported by exact same name in Tasks 2, 3 ✓
- Helper takes `(svc, orderId, tenantId)`; callers pass `(svc, move.order_id, ctx.tenantId)` ✓
- `move.order_id` is selected via Tasks 2 and 3 Step 2 — necessary precondition for the call ✓
- Return shape `{ changed, prev, next }` not consumed by callers — they fire-and-log, which is fine ✓

No issues found.
