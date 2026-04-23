---
name: 2026-04-24-transition-centralization-design
description: Stream B.1a — centralize the 12 scattered status-update writes for `order_charge_sets` (5 sites, FU-055) and `order_container_moves` (7 sites + inline cascade in routing/index.js, FU-056) into two helper functions at `lib/charge-sets/transition.js` and `lib/routing/moves/transition.js`. Mirror the existing `fireStatusChangeTriggers` pattern: helpers write a status-history row per transition. Adds two new history tables (migration 096). Pure refactor — no events, no outbox, no API contract changes. Closes FU-055 + FU-056. Prerequisite for Stream B.1b (event spine).
type: spec
---

# Transition Centralization — Design Spec (Stream B.1a)

## Summary

The Stream B audit identified 12 scattered status-update writes across the codebase that need centralization before the event spine can emit consistently: 5 sites writing `order_charge_sets.status` (FU-055) and 7 sites in `pages/api/tenant/loads/[id]/routing/index.js` writing `order_container_moves.status` (FU-056), plus inline cascade logic at `routing/index.js:692-707` that sets `orders.status` based on move state.

This spec ships two helper functions — `transitionChargeSetStatus()` at `lib/charge-sets/transition.js` and `transitionMoveStatus()` at `lib/routing/moves/transition.js` — that own all status-write responsibility for those two entities. Each helper mirrors the established `orders` pattern (`lib/email-dispatch/status-change-fire.js`): UPDATE the entity's status, write a history row, log errors but never bubble them. The move helper additionally owns the order-status cascade logic (extracting it from `routing/index.js`).

The spec adds two new `*_status_history` tables via migration 096 (schemas mirror the existing `order_status_history` from migration 001). These tables are valuable independent of the event spine — they answer questions like "when did charge_set X become invoiced?" that today are unanswerable.

This is a pure refactor with one small schema addition. No new architecture. No events. No API contract changes. Closes FU-055 + FU-056. De-risks Stream B.1b (event spine) by giving it clean call sites to wrap and pre-existing audit-trail tables to emit from.

## Goals

- Centralize all `order_charge_sets.status` writes behind `transitionChargeSetStatus(svc, { tenantId, chargeSetId, newStatus, actorUserId })`.
- Centralize all `order_container_moves.status` writes behind `transitionMoveStatus(svc, { tenantId, moveId, newStatus, actorUserId })`.
- Move the inline order-status cascade from `routing/index.js:692-707` into the move helper (via an internal `_evaluateOrderCascade()` sub-function, exported for tests).
- Add audit-trail tables `order_charge_sets_status_history` and `order_container_moves_status_history` that mirror the existing `order_status_history` shape.
- Each helper writes a history row per successful transition (log-and-continue on history failure, same error policy as the orders pattern).
- Each helper no-ops cleanly if `newStatus === oldStatus` (mirrors `fireStatusChangeTriggers`).
- Add hand-rolled `.test.mjs` unit tests per helper (existing codebase pattern).
- Ship in one atomic PR that closes FU-055 and FU-056.

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
| D4 | Move helper owns order cascade | FU-056 explicitly called out the inline cascade as part of the problem; centralizing it means one seam for event-spine instrumentation |
| D5 | Cascade is an internal `_evaluateOrderCascade()` sub-function, exported for tests | Testable without making the move helper externally tri-purpose |
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
 * Owns the order-status cascade — when a move transitions, evaluates
 * whether the parent order's status should also change (was:
 * inline logic at pages/api/tenant/loads/[id]/routing/index.js:692-707).
 *
 * @param svc service-role Supabase client
 * @param {{
 *   tenantId: string,
 *   moveId: string,
 *   newStatus: string,
 *   actorUserId: string | null,
 * }} params
 * @returns {Promise<{
 *   oldStatus: string | null,
 *   newStatus: string,
 *   row: object,
 *   cascadedOrderStatus: { oldStatus: string, newStatus: string } | null
 * }>}
 * @throws on DB UPDATE failure.
 */
export async function transitionMoveStatus(svc, params) { /* ... */ }

/**
 * Exported for tests; not part of the public API.
 * Examines the current state of all moves on an order and returns
 * the order's recommended status (if a cascade should fire).
 *
 * @param svc
 * @param {{ tenantId: string, orderId: string }} params
 * @returns {Promise<{ shouldCascade: boolean, newOrderStatus: string | null }>}
 */
export async function _evaluateOrderCascade(svc, params) { /* ... */ }
```

**Behavior contract:**
1. Fetch the current move row.
2. If `current.status === newStatus` → return early with `cascadedOrderStatus: null`.
3. UPDATE the move's status; throw on failure.
4. INSERT history row; log-and-continue on failure.
5. Call `_evaluateOrderCascade(svc, { tenantId, orderId: move.order_id })`.
6. If cascade should fire, call the existing `fireStatusChangeTriggers` (from `lib/email-dispatch/status-change-fire.js`) to transition the order. Pass the result's `{ oldStatus, newStatus }` back as `cascadedOrderStatus`. If no cascade, return `cascadedOrderStatus: null`.
7. Return the combined result.

**Cascade logic (the `_evaluateOrderCascade` body):**

The existing inline cascade at `routing/index.js:692-707` implements a specific rule set (e.g., "if all moves on the order are completed → order is completed"). The implementation plan must **read the existing inline code** and preserve its exact logic — not re-invent it. The spec does not prescribe the cascade rules because they're the existing behavior of the system, not a redesign.

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

### FU-056 (move status + cascade) — 7 sites + cascade block, all in `routing/index.js`

- Lines 659, 673, 694, 702, 729, 744, 752 each become `await transitionMoveStatus(svc, { ... })`.
- Lines 692–707 (the inline cascade block) are deleted — that logic now lives inside `_evaluateOrderCascade()` called internally by `transitionMoveStatus`.

**Note to the implementation plan:** before deleting the cascade block, read the exact lines carefully and document the preserved logic in `_evaluateOrderCascade()`. Do NOT paraphrase — preserve the semantics exactly.

## Testing

Follow the existing hand-rolled `.test.mjs` pattern (see `lib/load-margin.test.mjs`, `lib/dry-run-engine.test.mjs`, etc. — run via `node lib/charge-sets/transition.test.mjs`).

### `lib/charge-sets/transition.test.mjs`

Four cases, minimum:

1. **Success path** — given a charge_set with `status='draft'`, call helper with `newStatus='invoiced'`. Assert the row is updated, the return value has `oldStatus='draft'` and `newStatus='invoiced'`, and a history row exists.
2. **No-op path** — given a charge_set with `status='invoiced'`, call helper with `newStatus='invoiced'`. Assert no UPDATE and no history row. Return value reflects no-change.
3. **Update failure** — inject a Supabase error on the UPDATE. Assert the helper throws. Assert no history row written.
4. **History-write failure** — successful UPDATE, injected error on INSERT to history. Assert the helper returns normally (no throw) and logs the error.

### `lib/routing/moves/transition.test.mjs`

Six cases:

1. **Success path (no cascade)** — move transitions to a status that doesn't trigger an order cascade. Assert move updated, history row written, `cascadedOrderStatus: null`.
2. **No-op path** — same status. No UPDATE, no history, no cascade call.
3. **Success path with cascade** — move completes, triggers order-status cascade per the existing logic. Assert move updated, move history written, `fireStatusChangeTriggers` called for the order, returned `cascadedOrderStatus` reflects the order transition.
4. **Cascade evaluator only (`_evaluateOrderCascade` directly)** — given various combinations of move states on an order, assert the evaluator returns the correct `shouldCascade` + `newOrderStatus`.
5. **Update failure** — throws, no history, no cascade.
6. **History-write failure** — still returns normally, cascade still fires.

Use an in-memory Supabase mock (there's an existing pattern — follow `lib/dry-run-engine.test.mjs` as reference).

## Risks

1. **Cascade logic drift.** The current inline cascade at `routing/index.js:692-707` may have subtle semantics that get lost when extracted. Mitigation: the plan requires reading the exact lines and preserving them literally; a plan review step confirms the extraction matches the source.
2. **History-table growth.** Each status transition writes a row. High-volume tenants could grow the tables quickly. Mitigation: indexes on `(tenant_id, entity_id)` keep queries fast; retention policy is a future concern (track as a separate FU if it becomes material).
3. **`newStatus` typo causing a silent transition.** A caller passing `'invoied'` (typo) would update the row to that value, fail the DB CHECK constraint, and throw. The throw surfaces the bug — this is the desired behavior, not a risk.
4. **Concurrent transitions.** Two callers transitioning the same entity at once could race; the last writer wins. No new risk vs. the existing `.update()` call sites, which have the same behavior. Mitigation: out of scope for this spec; row-level locking is a separate concern.
5. **Test coverage for `_evaluateOrderCascade`.** The cascade's rule set is copied from existing code, not redesigned — so tests verify "matches the old inline behavior" rather than "matches a new spec." If the existing inline behavior has a bug, this spec preserves it. Mitigation: if a cascade bug is discovered during plan execution, flag as a separate FU — don't silently fix under the refactor umbrella.

## Open Questions (deferred to plan)

1. **Exact cascade rules.** The spec defers to the inline code at `routing/index.js:692-707`. The plan must read those lines and codify the exact semantics in `_evaluateOrderCascade()`.
2. **Status enum names.** The spec uses TEXT for history columns to avoid enum coupling. The source `order_charge_sets.status` and `order_container_moves.status` columns have their own enums — the plan's test setup may need to reference the exact enum names (`charge_set_status_enum`? `order_container_move_status_enum`? verify).
3. **What about transactions?** Should the UPDATE + history INSERT be in a single transaction? The existing orders pattern does NOT wrap them (the `try/catch` around history INSERT lets the UPDATE stand even if history fails). This spec mirrors that. If at some point a stronger guarantee is needed, that's an event-spine-spec concern.
4. **Migration number collision.** If any work on another branch has grabbed migration 096 in the meantime, the plan adjusts the number (097, 098, ...). Plan verifies the next-available number before writing.
5. **`notes` column usage.** The schema includes `notes TEXT` for shape-parity with `order_status_history`, but the helpers don't write to it. Should the helpers accept an optional `notes` param? Recommendation: no — YAGNI. Add when a caller needs it.
