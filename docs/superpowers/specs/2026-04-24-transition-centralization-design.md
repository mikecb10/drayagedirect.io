---
name: 2026-04-24-transition-centralization-design
description: Stream B.1a — centralize the scattered status-update writes for `order_charge_sets` (5 sites, FU-055) and `order_container_moves` (5 sites — 2 single-move + 3 bulk — in routing/index.js, revised FU-056) into two helper functions at `lib/charge-sets/transition.js` and `lib/routing/moves/transition.js`. Mirror the existing `fireStatusChangeTriggers` pattern: helpers write a status-history row per transition. Bulk move sites fetch-then-loop through the helper for history coverage. Adds two new history tables (migration 096). Pure refactor — no events, no outbox, no API contract changes. Closes FU-055 + FU-056. Prerequisite for Stream B.1b (event spine).
type: spec
---

# Transition Centralization — Design Spec (Stream B.1a)

## Summary

The Stream B audit identified scattered status-update writes across the codebase that need centralization before the event spine can emit consistently. After reading the actual code during plan prep, the corrected picture is:

- **5 sites writing `order_charge_sets.status`** (FU-055) — all simple single-row `.update({ status })` calls.
- **5 sites writing `order_container_moves.status`** in `pages/api/tenant/loads/[id]/routing/index.js` (FU-056, revised) — 2 single-move updates (lines 659, 673) + 3 bulk updates (lines 694, 744, 752).
- **2 additional `orders.status` writes** in the same routing file (lines 702, 729) were originally mis-labeled in FU-056 as move writes. They are order-table updates, NOT move writes, and therefore out of scope for this spec. Tracked separately.

This spec ships two helper functions — `transitionChargeSetStatus()` at `lib/charge-sets/transition.js` and `transitionMoveStatus()` at `lib/routing/moves/transition.js` — that own all status-write responsibility for those two entities. Each helper mirrors the established `orders` pattern (`lib/email-dispatch/status-change-fire.js`): UPDATE the entity's status, write a history row, log errors but never bubble them.

For the 3 bulk move sites, the call sites become **fetch-then-loop-serial**: fetch the affected moves matching the WHERE filter, then iterate through `transitionMoveStatus()` per move. Loads typically have 2–6 container moves, so the DB-round-trip cost is minimal and history coverage becomes uniform.

There is **no cascade logic** to extract. Earlier drafts of this spec assumed `routing/index.js` had "if all moves complete → order complete" cascade evaluation. Reading the actual code shows `complete_load` and `uncomplete_load` are explicit user actions that write `orders.status` directly alongside the bulk move updates — not derived from move state. The helper does move-only work; no cascade return, no cascade sub-function.

The spec adds two new `*_status_history` tables via migration 096 (schemas mirror the existing `order_status_history` from migration 001). These tables are valuable independent of the event spine — they answer questions like "when did charge_set X become invoiced?" that today are unanswerable.

This is a pure refactor with one small schema addition. No new architecture. No events. No API contract changes. Closes FU-055 + FU-056. De-risks Stream B.1b (event spine) by giving it clean call sites to wrap and pre-existing audit-trail tables to emit from.

## Goals

- Centralize all `order_charge_sets.status` writes behind `transitionChargeSetStatus(svc, { tenantId, chargeSetId, newStatus, actorUserId })`.
- Centralize all `order_container_moves.status` writes behind `transitionMoveStatus(svc, { tenantId, moveId, newStatus, actorUserId })`.
- For the 3 bulk move sites in `routing/index.js` (lines 694, 744, 752), convert each from a single bulk UPDATE into **fetch-then-loop-serial** through `transitionMoveStatus`. Every moved row gets a history entry.
- Add audit-trail tables `order_charge_sets_status_history` and `order_container_moves_status_history` that mirror the existing `order_status_history` shape.
- Each helper writes a history row per successful transition (log-and-continue on history failure, same error policy as the orders pattern).
- Each helper no-ops cleanly if `newStatus === oldStatus` (mirrors `fireStatusChangeTriggers`).
- Add hand-rolled `.test.mjs` unit tests per helper (existing codebase pattern; tests live in `/tests/*.test.mjs`).
- Ship in one atomic PR that closes FU-055 and FU-056.
- Open a new follow-up FU to track the two `orders.status` writes in `routing/index.js` (lines 702, 729) that should eventually route through `fireStatusChangeTriggers` for consistency — out of scope for this spec.

## Non-Goals (explicitly out of scope)

1. **No event emission.** Helpers do UPDATE + history write. They do NOT emit events or write to an outbox. That's Stream B.1b.
2. **No changes to `fireStatusChangeTriggers` or the `orders.status` flow.** The existing helper works; leave it alone. Rule-of-three on extracting a shared abstraction — wait for the event-spine spec to force the right shape.
3. **No new API endpoints.** The helpers are internal — they're called from existing API handlers. The API contract on the wire is unchanged.
4. **No RBAC changes.** Helpers trust their callers. Callers (the API handlers) already enforce RBAC before calling into `lib/*`.
5. **No status-value validation in the helper.** The DB CHECK constraints + enum types already enforce valid statuses. Don't duplicate in JavaScript.
6. **No history-table reads in this spec.** We're writing to them; we're not surfacing them in the UI or API yet. Debug/ops can query directly.
7. **No generalized "transitionAnyEntityStatus" abstraction.** Two helpers, each entity-specific. The event-spine spec is the natural forcing function for the cross-entity abstraction.
8. **No touch-up on other status-update locations.** Only the 12 sites from FU-055 + FU-056. Other entities (`ar_invoices`, `driver_pay`, `credit_memos`, etc.) stay as-is — separate FUs if we want to centralize them too.
9. **No backward-compatibility shims.** Helpers replace the old `.update()` call sites wholesale. Old sites are deleted, not deprecated.
10. **No migration of existing history data.** The new tables start empty. Historical transitions before this ship are un-recoverable from logs; that's fine — audit trail begins at ship time.

## Locked Decisions

| # | Decision | Rationale |
|---|---|---|
| D1 | Two entity-scoped helpers, not one generalized helper | Rule-of-three; differences in cascade + future email triggers don't compress cleanly yet |
| D2 | File location: `lib/charge-sets/transition.js` + `lib/routing/moves/transition.js` | Mirrors existing `lib/email-dispatch/status-change-fire.js` co-location pattern |
| D3 | Helper signature: `(svc, { tenantId, entityId, newStatus, actorUserId }) → { oldStatus, newStatus, row }` | The `oldStatus` in the return lets Stream B.1b wrap helpers to emit events without re-reading |
| D4 | Move helper has NO cascade logic | Spec amended after code reading: `complete_load` / `uncomplete_load` are explicit user actions that write `orders.status` directly — not derived from move state. No cascade to extract. |
| D5 | Bulk move sites use fetch-then-loop-serial through `transitionMoveStatus` | Preserves the centralization goal (every transition goes through the helper → every transition gets a history row). Serial avoids concurrency concerns. N is small (2–6 moves per load typical). |
| D6 | Add `*_status_history` tables now (migration 096) | Audit-trail value independent of events; mirrors existing `orders` pattern; de-risks Stream B.1b |
| D7 | Helper error handling: throw on DB errors, log-and-continue on history-write failure | Matches exactly the pattern in `fireStatusChangeTriggers` — consistent with codebase convention |
| D8 | No-op if `newStatus === oldStatus` | Mirrors `fireStatusChangeTriggers` lines 33-36; prevents spurious history rows |
| D9 | Leave `fireStatusChangeTriggers` untouched | Working code; any unified abstraction belongs in the event-spine spec |
| D10 | All-at-once PR (12 call sites + 2 helpers + 2 test files + 1 migration) | Low risk; helpers are trivial; incremental adds coordination cost for no benefit |

## Data Model

### Migration 096: add two `*_status_history` tables

**File:** `supabase/migrations/096_charge_set_and_move_status_history.sql`

Schemas mirror the existing `order_status_history` from `migrations/001_initial_schema.sql:515-523`:

```sql
-- ============================================================
-- Migration 096: charge_set + container_move status history
-- ============================================================
-- Adds audit-trail tables for status transitions on
-- order_charge_sets and order_container_moves, mirroring the
-- shape of order_status_history (from migration 001). These tables
-- are written by the new transition helpers at
-- lib/charge-sets/transition.js and lib/routing/moves/transition.js.
--
-- Tables are valuable independent of the upcoming event spine
-- (Stream B.1b) — they answer "when did X become Y?" questions
-- that today are unanswerable.
-- ============================================================

BEGIN;

CREATE TABLE IF NOT EXISTS order_charge_sets_status_history (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  charge_set_id UUID NOT NULL REFERENCES order_charge_sets(id) ON DELETE CASCADE,
  old_status TEXT,
  new_status TEXT NOT NULL,
  changed_by UUID REFERENCES users(id),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_charge_set_status_history_tenant_cs
  ON order_charge_sets_status_history(tenant_id, charge_set_id);

CREATE TABLE IF NOT EXISTS order_container_moves_status_history (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  move_id UUID NOT NULL REFERENCES order_container_moves(id) ON DELETE CASCADE,
  old_status TEXT,
  new_status TEXT NOT NULL,
  changed_by UUID REFERENCES users(id),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_move_status_history_tenant_move
  ON order_container_moves_status_history(tenant_id, move_id);

NOTIFY pgrst, 'reload schema';

COMMIT;
```

**Column choices:**
- `old_status` / `new_status` as **TEXT, not enum** — Stream B.1b may extend status vocabularies, and TEXT avoids enum-migration churn on history tables. The source tables keep their enum columns; history is more permissive by design. (The existing `order_status_history` uses `order_status_enum` — a minor inconsistency, but the TEXT choice here is forward-looking and the plan's self-review will flag it.)
- `notes` is nullable + unused by the helpers in this spec; included because `order_status_history` has it, so schemas match shape.
- No `reason_code` or `agent_metadata` columns — those belong to the event-spine spec, not this one (YAGNI).

**Verification the implementer must do during plan execution:**
1. Confirm `order_charge_sets(id)` and `order_container_moves(id)` exist with `UUID` PKs (they do per audit findings but verify).
2. Confirm neither table already has a `*_status_history` sibling (search migrations for `CREATE TABLE.*charge_sets.*history` and `CREATE TABLE.*moves.*history`).

## Helper Contracts

### `lib/charge-sets/transition.js`

**Exports:**

```js
/**
 * Transition an order_charge_set's status.
 *
 * Mirrors the pattern from lib/email-dispatch/status-change-fire.js:
 * updates the entity's status, writes a history row, logs errors but
 * never bubbles history-write failures.
 *
 * @param svc service-role Supabase client
 * @param {{
 *   tenantId: string,
 *   chargeSetId: string,
 *   newStatus: string,
 *   actorUserId: string | null,
 * }} params
 * @returns {Promise<{ oldStatus: string | null, newStatus: string, row: object }>}
 *   oldStatus is null if the charge_set was created with newStatus (no-op case still returns the row).
 * @throws on DB UPDATE failure (history-write failures are logged, not thrown).
 */
export async function transitionChargeSetStatus(svc, params) { /* ... */ }
```

**Behavior contract:**
1. Fetch the current row (`SELECT status, ...`).
2. If `current.status === newStatus` → return `{ oldStatus: currentStatus, newStatus, row: currentRow }` without UPDATE or history write. No-op.
3. `UPDATE order_charge_sets SET status = newStatus, updated_at = now() WHERE id = chargeSetId AND tenant_id = tenantId`. Throw if the update fails or affects 0 rows.
4. `INSERT INTO order_charge_sets_status_history ...`. Log and continue on failure (non-fatal — the status change has already been written).
5. Return `{ oldStatus, newStatus, row }` where `row` is the updated charge_set.

### `lib/routing/moves/transition.js`

**Exports:**

```js
/**
 * Transition an order_container_move's status.
 *
 * Mirrors transitionChargeSetStatus — UPDATE + history write + log-and-continue.
 * No cascade logic: the `orders.status` writes in complete_load/uncomplete_load
 * are explicit user actions owned by the API handler, not derived from move state.
 *
 * @param svc service-role Supabase client
 * @param {{
 *   tenantId: string,
 *   moveId: string,
 *   newStatus: string,
 *   actorUserId: string | null,
 *   extraFields?: { started_at?: string | null, completed_at?: string | null }
 * }} params
 *   `extraFields` lets callers set timestamps in the same UPDATE (e.g., `started_at`
 *   when starting, `completed_at: null` when reopening). Keeps bulk-call-site semantics intact.
 * @returns {Promise<{ oldStatus: string | null, newStatus: string, row: object }>}
 * @throws on DB UPDATE failure (history failures are logged, not thrown).
 */
export async function transitionMoveStatus(svc, params) { /* ... */ }
```

**Behavior contract:**
1. Fetch the current move row by `id + tenant_id`.
2. If `current.status === newStatus` AND no `extraFields` specified → return early with the current row (no-op).
3. UPDATE the move's `status` and any provided `extraFields` (e.g., `started_at`, `completed_at`) in one statement. Throw on failure.
4. INSERT history row; log-and-continue on failure.
5. Return `{ oldStatus, newStatus, row }` where `row` is the updated move.

**Why `extraFields`:** the real call sites set `started_at` / `completed_at` in the same UPDATE as `status`. Forcing callers into two separate UPDATEs would be gratuitous churn. Keeping `extraFields` in the helper is a pragmatic compromise — it's the only shape parameter the helper accepts, and it's plumbed through to the UPDATE verbatim.

**Bulk-site usage pattern:**

For the 3 bulk sites in `routing/index.js`, the call becomes a two-step: (1) SELECT the affected moves by the current WHERE filter, (2) loop-serial calling `transitionMoveStatus` per move.

```js
// Before (line ~692, complete_load bulk):
await svc.from('order_container_moves').update({ completed_at: now, status: 'completed' })
  .eq('tenant_id', ctx.tenantId).eq('order_id', id)
  .is('completed_at', null).not('started_at', 'is', null);

// After:
const { data: movesToComplete } = await svc.from('order_container_moves')
  .select('id')
  .eq('tenant_id', ctx.tenantId).eq('order_id', id)
  .is('completed_at', null).not('started_at', 'is', null);
for (const { id: moveId } of (movesToComplete || [])) {
  await transitionMoveStatus(svc, {
    tenantId: ctx.tenantId, moveId,
    newStatus: 'completed',
    actorUserId: ctx.userId,
    extraFields: { completed_at: now },
  });
}
```

**Out of scope for this helper:** the two `orders.status` writes in `routing/index.js` (lines 702, 729 of `complete_load` and `uncomplete_load`) remain inline. Those are order-table concerns, not move-table concerns. A separate follow-up FU tracks routing them through `fireStatusChangeTriggers` for consistency.

## Call-Site Swap List

All 12 call sites become one-line invocations of the appropriate helper. The before/after shape is illustrative — exact code depends on surrounding context (transactions, error handling, etc.).

### FU-055 (charge_set status) — 5 sites

| # | File | Current status write | New call |
|---|---|---|---|
| 1 | `pages/api/tenant/ar/invoices/index.js:459` | `await svc.from('order_charge_sets').update({ status: 'invoiced' }).eq('id', ...)` | `await transitionChargeSetStatus(svc, { tenantId, chargeSetId, newStatus: 'invoiced', actorUserId })` |
| 2 | `pages/api/tenant/ar/invoices/[invoiceId].js:140` | same "invoiced" write | same helper call |
| 3 | `pages/api/tenant/ar/charge-sets/bulk-send-rate-con.js:274` | `status: 'rate_con_sent'` write | helper call with `newStatus: 'rate_con_sent'` |
| 4 | `pages/api/tenant/ar/charge-sets/[id]/send-rate-con-email.js:151` | same "rate_con_sent" write | same helper call |
| 5 | `pages/api/tenant/loads/[id]/charge-sets/[csId].js` | status transition on edit | helper call with the specific newStatus |

### FU-056 (move status) — 5 sites in `routing/index.js`

**Single-move sites** (2 — direct one-to-one helper call):

| Line | Context | New call |
|---|---|---|
| 659 | `start_move` — sets `started_at` + `status='in_progress'` | `await transitionMoveStatus(svc, { tenantId, moveId, newStatus: 'in_progress', actorUserId, extraFields: { started_at: now } })` |
| 673 | `complete_move` — sets `completed_at` + `status='completed'` | `await transitionMoveStatus(svc, { tenantId, moveId, newStatus: 'completed', actorUserId, extraFields: { completed_at: now } })` |

**Bulk-move sites** (3 — fetch-then-loop-serial through helper):

| Line | Context | Treatment |
|---|---|---|
| 694 | `complete_load` — bulk update all started-but-not-completed moves to `completed` | Fetch matching moves; loop-serial call helper with `newStatus: 'completed'`, `extraFields: { completed_at: now }` |
| 744 | `uncomplete_load` — bulk revert started+completed moves to `in_progress` | Fetch matching moves; loop-serial call helper with `newStatus: 'in_progress'`, `extraFields: { completed_at: null }` |
| 752 | `uncomplete_load` — bulk revert unstarted+completed moves to `pending` | Fetch matching moves; loop-serial call helper with `newStatus: 'pending'`, `extraFields: { completed_at: null }` |

**Out of scope (stay inline, tracked as separate follow-up):**

| Line | What it does | Why out of scope |
|---|---|---|
| 702 | `complete_load` — `UPDATE orders SET status='completed', actual_delivery_at=now` | Order-table write, not a move write. Belongs with `fireStatusChangeTriggers`-style routing, not move centralization. |
| 729 | `uncomplete_load` — `UPDATE orders SET status='pending_completion', actual_delivery_at=null` | Same — order table, not move table. |

A new FU entry (allocated by the plan) tracks routing these two sites through `fireStatusChangeTriggers` so they get `order_status_history` rows + email-trigger evaluation. That's for a later session; this spec does not touch them.

## Testing

Follow the existing hand-rolled `.test.mjs` pattern (see `lib/load-margin.test.mjs`, `lib/dry-run-engine.test.mjs`, etc. — run via `node lib/charge-sets/transition.test.mjs`).

### `tests/charge-sets-transition.test.mjs`

Four cases, minimum:

1. **Success path** — given a charge_set with `status='draft'`, call helper with `newStatus='invoiced'`. Assert the row is updated, the return value has `oldStatus='draft'` and `newStatus='invoiced'`, and a history row exists.
2. **No-op path** — given a charge_set with `status='invoiced'`, call helper with `newStatus='invoiced'`. Assert no UPDATE and no history row. Return value reflects no-change.
3. **Update failure** — inject a Supabase error on the UPDATE. Assert the helper throws. Assert no history row written.
4. **History-write failure** — successful UPDATE, injected error on INSERT to history. Assert the helper returns normally (no throw) and logs the error.

### `tests/routing-moves-transition.test.mjs`

Five cases, minimum:

1. **Success path (status only)** — move transitions from `pending` to `in_progress`. Assert move row updated, history row written with correct `old_status` / `new_status`.
2. **Success path (status + extraFields)** — move transitions with `extraFields: { started_at: ISO }`. Assert `status` AND `started_at` both updated in one write.
3. **No-op path** — same status, no extraFields. No UPDATE, no history row.
4. **Update failure** — inject UPDATE error. Assert throw, no history row written.
5. **History-write failure** — successful UPDATE, inject INSERT error on history. Assert helper returns normally (no throw), move row reflects the update.

Follow the existing pattern at `tests/dry-run-engine.test.mjs` — top-of-file `check()` helper, `passed`/`failed` counters, run via `node tests/routing-moves-transition.test.mjs`. No test framework. Mock Supabase client inline per test using the minimal chainable shape the helper uses (`.from().update().eq().eq().select().single()` etc.).

## Risks

1. **Bulk-site semantics drift.** The 3 bulk move sites (694, 744, 752) become fetch-then-loop instead of single bulk UPDATE. A subtle difference: the bulk UPDATE is atomic from Postgres's perspective; fetch-then-loop is N separate statements. Mitigation: `complete_load` / `uncomplete_load` are user-initiated actions, not concurrent-write hot paths. Rare concurrent execution would result in interleaved transitions — same as two admin users clicking the same button twice, already possible today. Track as FU if observed.
2. **History-table growth.** Each status transition writes a row. High-volume tenants could grow the tables quickly. Mitigation: indexes on `(tenant_id, entity_id)` keep queries fast; retention policy is a future concern (track as a separate FU if it becomes material).
3. **`newStatus` typo causing a silent transition.** A caller passing `'invoied'` (typo) would try to UPDATE and either fail the DB CHECK constraint or silently succeed (if the enum is permissive). The throw surfaces the bug in the strict-enum case — desired. In the permissive-column case the typo persists; discoverable via tests and log review.
4. **Concurrent transitions.** Two callers transitioning the same entity at once could race; the last writer wins. No new risk vs. the existing `.update()` call sites. Out of scope for this spec.
5. **N+1 on bulk sites for loads with many moves.** If a load has 20+ moves, `complete_load` does 1 SELECT + 20 UPDATEs + 20 INSERTs instead of 1 bulk UPDATE. For typical 2–6 move counts this is a non-issue. Mitigation: monitor. If a tenant reports slow `complete_load`, revisit with a batch-insert history + bulk UPDATE pattern (tracked separately if needed).
6. **2 out-of-scope order writes stay inconsistent.** Until the follow-up FU ships, `complete_load` and `uncomplete_load` will write `orders.status` without generating `order_status_history` rows or firing email triggers — the existing gap is preserved, not introduced. Mitigation: the follow-up FU exists so we don't forget; no regression vs. today.

## Open Questions (deferred to plan)

1. **Status enum names.** The spec uses TEXT for history columns to avoid enum coupling. The source `order_charge_sets.status` and `order_container_moves.status` columns have their own enums — the plan's test setup may need to reference the exact enum names. Plan verifies via `grep "CREATE TYPE.*status" supabase/migrations/*.sql`.
2. **Transactions.** Should the UPDATE + history INSERT be in a single transaction? The existing orders pattern does NOT wrap them (the `try/catch` around history INSERT lets the UPDATE stand even if history fails). This spec mirrors that for consistency.
3. **Migration number collision.** If any work on another branch has grabbed migration 096 in the meantime, the plan adjusts the number (097, 098, ...). Plan verifies the next-available number before writing.
4. **`notes` column usage.** The schema includes `notes TEXT` for shape-parity with `order_status_history`, but the helpers don't write to it. Helpers do NOT accept an optional `notes` param — YAGNI. Add when a caller needs it.
5. **New follow-up FU for the 2 `orders.status` writes** (`routing/index.js:702, 729`). Plan allocates the next available FU number and opens the entry in `followups.md` with the `[ai-ready]` prefix, category `State`, pointing to this spec's amendment as source.
