---
name: 2026-04-24-event-spine-generalization-design
description: Stream B.1b — generalize `fireStatusChangeTriggers` + polled-worker status evaluator + `email_template_triggers` schema so status-change triggers can target orders, charge_sets, or moves (not just orders). Migration 097 adds `entity_type` column with default 'order' for backward compat. Stream B.1a helpers now call the generalized firing function after each status transition. Closes FU-071 by routing the 2 out-of-scope `orders.status` writes in routing/index.js through the generalized pipeline. No new events table — the per-entity `*_status_history` tables ARE the entity-scoped outboxes. No API contract changes, no UI changes. Backward-compatible: existing triggers behave identically post-migration.
type: spec
---

# Event Spine Generalization — Design Spec (Stream B.1b)

## Summary

The DrayageDirect audit identified the canonical event spine as the highest-leverage AI-readiness gap. Reading the actual code revealed that ~80% of the event spine already exists for `orders.status`: `fireStatusChangeTriggers` in `lib/email-dispatch/status-change-fire.js` writes to `order_status_history` + dispatches immediate triggers via `Promise.all` + defers delayed triggers to a polled worker (`lib/email-dispatch/polled-worker.js` via `/api/cron/evaluate-triggers`). The status evaluator at `lib/email-dispatch/evaluators/status.js` reads from `order_status_history` for delayed evaluation.

This spec generalizes that infrastructure to work across all 3 entities (orders, charge_sets, container_moves) by parameterizing three things: (a) the `fireStatusChangeTriggers` function signature to accept an `entityType` + `entityId` instead of `loadId`, (b) the status evaluator to read from the entity-specific history table, (c) the `email_template_triggers` table to carry an `entity_type` column so triggers can be scoped per entity.

Stream B.1a's two new transition helpers (`transitionChargeSetStatus`, `transitionMoveStatus`) become wired to the generalized firing function — after a successful status change, the helper calls `fireStatusChangeTriggers` for that entity type. This closes the loop: writes flow through the helper → history row written → consumers fire (immediate via inline dispatch, delayed via polled worker).

The 2 out-of-scope `orders.status` writes in `routing/index.js` (complete_load line ~716, uncomplete_load line ~743) that currently bypass `fireStatusChangeTriggers` are routed through a thin backward-compat wrapper. This closes FU-071 as a natural consequence of the generalization.

Net result: a unified status-change event pipeline for 3 entities, with consumer configs (email triggers) scopeable per entity, and Stream B.1a's helpers as the clean ingestion seams. No new tables. No API contract changes. No user-visible changes except that tenants can now create triggers scoped to charge_set or move status transitions (existing UI may not expose this yet — out of scope; add separately).

## Goals

- Generalize `fireStatusChangeTriggers` to accept `{ tenantId, entityType, entityId, oldStatus, newStatus, userId }` instead of the orders-specific `{ tenantId, loadId, oldStatus, newStatus, userId }`.
- Ship a backward-compat wrapper `fireOrderStatusChangeTriggers({ tenantId, loadId, ... })` so existing callers don't need to change in lockstep. Existing callers can migrate over time; for this spec they can stay as-is.
- Generalize the status evaluator at `lib/email-dispatch/evaluators/status.js` to read from the history table matching the trigger's `entity_type`.
- Add `entity_type TEXT NOT NULL DEFAULT 'order'` column to `email_template_triggers` (migration 097). Default preserves existing triggers' behavior.
- Wire `transitionChargeSetStatus` (Stream B.1a) to call `fireStatusChangeTriggers({ entityType: 'charge_set', ... })` after history write.
- Wire `transitionMoveStatus` (Stream B.1a) to call `fireStatusChangeTriggers({ entityType: 'move', ... })` after history write.
- Close FU-071: route the 2 `orders.status` writes in `pages/api/tenant/loads/[id]/routing/index.js` (complete_load + uncomplete_load) through the backward-compat wrapper so they produce `order_status_history` rows and fire triggers.
- Add unit tests for the generalized firing function (entity routing + correct history table + correct trigger filter).
- Add unit tests for the generalized status evaluator (reads from the correct history table based on trigger.entity_type).
- Existing orders-status tests MUST still pass unmodified (via the backward-compat wrapper).
- Zero behavior change for existing customers (existing triggers all have `entity_type='order'` after backfill).

## Non-Goals (explicitly out of scope)

1. **No new unified `entity_events` table.** The audit suggested an outbox-style table as one option; generalizing the existing per-entity infrastructure is the chosen path. A unified table could be a future refactor (Stream C prep) but is not in this spec.
2. **No external webhooks.** The consumer model remains the existing `email_template_triggers`. Webhooks for external subscribers is explicitly Stream C territory.
3. **No new entity types beyond the 3** (orders, charge_sets, moves). Other status-bearing entities (`ar_invoices`, `driver_pay`, `credit_memos`, etc.) keep their existing status-write paths unchanged. When they're centralized later (separate specs), they can be added to the generalized pipeline the same way.
4. **No trigger UI changes.** The existing admin UI for creating status triggers may or may not expose the new `entity_type` field. Adding UI for charge_set / move triggers is tracked as a follow-up FU; this spec is backend-only.
5. **No changes to the `email_template_triggers` schema beyond the new column.** Column names, other constraints, existing indexes all preserved.
6. **No data migration for existing trigger rows.** The migration's `DEFAULT 'order'` on the new column handles backfill at schema-change time. No separate UPDATE statement.
7. **No performance tuning on the polled worker.** The worker already polls every 15 min via Vercel Cron. Generalizing means reading 3 history tables per poll instead of 1 — at current data volumes, negligible. If performance degrades at scale, a separate FU adds `(tenant_id, created_at)` indexes on the history tables.
8. **No touching the `fireTrigger` dispatcher** (`lib/email-dispatch/dispatcher.js`) — that sits below the generalization line and is entity-agnostic already (it operates on a trigger config + a fire_key, not on entity types). No changes needed there.
9. **No backward-compat shim for the polled worker.** The worker is cron-invoked; no other callers. Change in place.
10. **No new trigger kinds.** `trigger_kind='status'` is the only kind affected. Time-based triggers (`trigger_kind='schedule'`) and composite-event triggers (`trigger_kind='composite'`) are unchanged.
11. **No retroactive event emission.** Status transitions that happened before ship produce no event. History tables are forward-looking from this spec forward.

## Locked Decisions

| # | Decision | Rationale |
|---|---|---|
| D1 | Generalize in place, no new events table | Audit's "outbox table" recommendation predated seeing the existing infrastructure; 80% of the event spine already exists |
| D2 | `entity_type` column NOT NULL DEFAULT 'order' | DEFAULT handles backfill; NOT NULL keeps new inserts explicit |
| D3 | CHECK constraint on entity_type values | Enforced at DB level; prevents accidental writes of invalid types |
| D4 | Backward-compat wrapper `fireOrderStatusChangeTriggers` | Minimizes blast radius: existing callers keep working verbatim; generalization is opt-in per call site |
| D5 | Route FU-071's 2 out-of-scope order writes through the wrapper | Natural consequence of generalization; closes the FU for free |
| D6 | Internal lookup table (`HISTORY_TABLE_BY_ENTITY`) | One place maps entityType → { table, idColumn }; avoids string-building and makes adding a 4th entity trivial |
| D7 | `transitionChargeSetStatus` + `transitionMoveStatus` call firing after history write, not before | Matches the order of operations in existing `fireStatusChangeTriggers` (write history → then fire) |
| D8 | Fire failures don't throw — same fire-and-forget pattern | Status transition already succeeded; trigger firing failure is a consumer concern, not a DB-integrity concern |
| D9 | Polled worker reads each history table via separate query (not UNION) | Simpler logic; N tables × M query cost; at current scale (3 tables, 15-min cadence) the overhead is negligible |
| D10 | No trigger UI changes in this spec | Backend-only; admin-UI work for creating charge_set/move triggers is a separate scope |

## Data Model

### Migration 097: `email_template_triggers.entity_type`

**File:** `supabase/migrations/097_trigger_entity_type.sql`

```sql
-- ============================================================
-- Migration 097: email_template_triggers.entity_type column
-- ============================================================
-- Generalizes status-change triggers to work across entities
-- (orders, charge_sets, moves). Existing triggers all default
-- to entity_type='order', preserving their behavior.
--
-- Part of Stream B.1b (event spine generalization). The
-- application-side change that consumes this column lives in
-- lib/email-dispatch/status-change-fire.js (firing path) and
-- lib/email-dispatch/evaluators/status.js (polled path).
-- ============================================================

BEGIN;

ALTER TABLE email_template_triggers
  ADD COLUMN IF NOT EXISTS entity_type TEXT NOT NULL DEFAULT 'order';

ALTER TABLE email_template_triggers
  DROP CONSTRAINT IF EXISTS chk_trigger_entity_type;

ALTER TABLE email_template_triggers
  ADD CONSTRAINT chk_trigger_entity_type
  CHECK (entity_type IN ('order', 'charge_set', 'move'));

CREATE INDEX IF NOT EXISTS idx_triggers_tenant_kind_entity_event
  ON email_template_triggers (tenant_id, trigger_kind, entity_type, event_name)
  WHERE is_active = true;

NOTIFY pgrst, 'reload schema';

COMMIT;
```

**Column rationale:**
- `TEXT NOT NULL DEFAULT 'order'` — DEFAULT backfills existing rows; NOT NULL keeps future inserts explicit.
- CHECK constraint enumerates valid values. Adding a 4th entity later requires a migration to extend the CHECK; intentional — new entity types are a semi-breaking change to triggers and should be explicit.
- New partial index on `(tenant_id, trigger_kind, entity_type, event_name) WHERE is_active = true` is the primary lookup shape post-generalization. Existing indexes preserved.

**No data migration needed:** the DEFAULT clause backfills all existing rows at ALTER time.

## Helper Contracts

### `lib/email-dispatch/status-change-fire.js` — generalized

**New primary export:**

```js
/**
 * Generalized status-change trigger firing.
 *
 * Writes a row to the entity's status_history table and fires any active
 * status triggers whose entity_type + event_name match newStatus.
 *
 * Mirrors the prior orders-only shape. Fire-and-forget from the caller:
 * errors are logged but never bubble up.
 *
 * @param svc service-role Supabase client
 * @param {{
 *   tenantId: string,
 *   entityType: 'order' | 'charge_set' | 'move',
 *   entityId: string,
 *   oldStatus: string | null,
 *   newStatus: string,
 *   userId: string | null,
 * }} params
 * @returns {Promise<{ firesAttempted: number, firesSucceeded: number }>}
 */
export async function fireStatusChangeTriggers(svc, params) { /* ... */ }

/**
 * Backward-compat wrapper for orders-only callers.
 * Accepts the prior `{ tenantId, loadId, oldStatus, newStatus, userId }` shape,
 * forwards to fireStatusChangeTriggers with entityType='order'.
 *
 * New callers should prefer fireStatusChangeTriggers directly.
 */
export async function fireOrderStatusChangeTriggers(svc, { tenantId, loadId, oldStatus, newStatus, userId }) {
  return fireStatusChangeTriggers(svc, {
    tenantId,
    entityType: 'order',
    entityId: loadId,
    oldStatus,
    newStatus,
    userId,
  });
}
```

**Internal lookup:**

```js
// At module top-level — single source of truth for entity → history-table mapping.
const HISTORY_TABLE_BY_ENTITY = {
  order:      { table: 'order_status_history',                  idColumn: 'order_id' },
  charge_set: { table: 'order_charge_sets_status_history',      idColumn: 'charge_set_id' },
  move:       { table: 'order_container_moves_status_history',  idColumn: 'move_id' },
};
```

**Behavior contract (unchanged from current fireStatusChangeTriggers except for entity parameterization):**

1. If `tenantId`, `entityId`, or `newStatus` is falsy → return `{ firesAttempted: 0, firesSucceeded: 0 }` (noop).
2. If `oldStatus === newStatus` → return `{ firesAttempted: 0, firesSucceeded: 0 }` (noop).
3. Look up `{ table, idColumn }` by `entityType`. If unknown entityType → throw `Error('unknown entityType: ...')`.
4. INSERT into the entity's history table with `{ tenant_id, [idColumn]: entityId, old_status, new_status, changed_by }`. Log-and-continue on failure (non-fatal — the status change already succeeded upstream; history write is best-effort).
5. SELECT active status triggers matching `(tenant_id, trigger_kind='status', entity_type=entityType, event_name=newStatus, is_active=true)`.
6. For each trigger with `notify_after` delay of 0 (immediate): fire via `fireTrigger(svc, { ... })` in a `Promise.all`, count successes.
7. For triggers with delay > 0 (delayed): no-op here; the polled worker picks them up from the history table.
8. Return `{ firesAttempted, firesSucceeded }`.

### `lib/email-dispatch/evaluators/status.js` — generalized

Currently reads `order_status_history`. Generalize to read the history table matching `trigger.entity_type`:

```js
export async function evaluate(svc, tenantId, trigger) {
  const targetStatus = trigger.event_name;
  if (!targetStatus) return [];

  const entityType = trigger.entity_type || 'order'; // safety: default for old rows without col
  const config = HISTORY_TABLE_BY_ENTITY[entityType];
  if (!config) {
    console.warn(`status evaluator: unknown entity_type ${entityType} on trigger ${trigger.id}`);
    return [];
  }

  // ... rest of the evaluator's cutoff-time logic is unchanged

  const { data: history, error } = await svc
    .from(config.table)
    .select(`${config.idColumn}, created_at`)
    .eq('tenant_id', tenantId)
    .eq('new_status', targetStatus)
    .lte('created_at', cutoff);

  // ... map results, using config.idColumn to access each row's entity id
}
```

The evaluator returns an array of "candidate" objects that `polled-worker.js` feeds into the dispatcher. The candidate object shape must include the entity id — for backward compat the worker expects `loadId`, so the generalized evaluator must map `config.idColumn` → `loadId` OR the worker must be updated to handle entity-type-aware candidates.

**Chosen approach:** Update the candidate shape to include both an `entityType` and `entityId`. The dispatcher (`fireTrigger`) is entity-agnostic; it takes the trigger config + a `fireKey` and operates via template variables. The `loadId` parameter currently exists in `fireTrigger`'s signature and is used for context-builder lookups. This means context-builder logic will need to be entity-aware too (at minimum: don't error on a non-order entity).

**Scope call:** for Stream B.1b, the polled worker only PROCESSES candidates for `entity_type='order'` triggers. charge_set / move triggers with delay > 0 are a deferred feature. The spec is complete without this because:
- Immediate firing works for all 3 entity types (via the generalized `fireStatusChangeTriggers`, no polled-worker dependency)
- Delayed firing for orders works as today
- Delayed firing for charge_set / move is a future feature that requires context-builder generalization — tracked as a new FU

This limits the behavior risk: the polled worker essentially ignores charge_set / move triggers with delay > 0 in this MVP. Documented as an open limitation.

### `lib/charge-sets/transition.js` — integration

After the existing history INSERT block (which Stream B.1a already guards with `if (oldStatus !== newStatus)` per the review fixes), add a call to `fireStatusChangeTriggers`:

```js
// Existing: UPDATE, no-op short-circuit, conditional history INSERT
// ...

// NEW: fire triggers for status changes (entity: charge_set)
if (oldStatus !== newStatus) {
  try {
    await fireStatusChangeTriggers(svc, {
      tenantId,
      entityType: 'charge_set',
      entityId: chargeSetId,
      oldStatus,
      newStatus,
      userId: actorUserId,
    });
  } catch (e) {
    // Fire-and-forget: firing failure is a consumer concern, not an
    // integrity concern. Log and continue.
    console.error(`charge_set trigger fire failed for ${chargeSetId}:`, e?.message || e);
  }
}

return { oldStatus, newStatus, row: updated };
```

### `lib/routing/moves/transition.js` — integration

Analogous to the charge_set change, with `entityType: 'move'` and `entityId: moveId`.

### `pages/api/tenant/loads/[id]/routing/index.js` — FU-071 closure

The 2 `orders.status` writes in `complete_load` and `uncomplete_load` currently bypass `fireStatusChangeTriggers` entirely. Route them through `fireOrderStatusChangeTriggers` (the backward-compat wrapper):

```js
// Before (complete_load, around line 711):
const { data: order, error: orderErr } = await svc
  .from('orders')
  .update({ status: 'completed', actual_delivery_at: now })
  .eq('tenant_id', ctx.tenantId)
  .eq('id', id)
  .is('deleted_at', null)
  .select()
  .single();
if (orderErr) return res.status(500).json({ error: orderErr.message });

// After:
const { data: currentOrder } = await svc
  .from('orders').select('status').eq('tenant_id', ctx.tenantId).eq('id', id).single();
const oldOrderStatus = currentOrder?.status;

const { data: order, error: orderErr } = await svc
  .from('orders')
  .update({ status: 'completed', actual_delivery_at: now })
  .eq('tenant_id', ctx.tenantId)
  .eq('id', id)
  .is('deleted_at', null)
  .select()
  .single();
if (orderErr) return res.status(500).json({ error: orderErr.message });

// Fire triggers (and write order_status_history) via the wrapper.
// Fire-and-forget; does not block the API response.
try {
  await fireOrderStatusChangeTriggers(svc, {
    tenantId: ctx.tenantId,
    loadId: id,
    oldStatus: oldOrderStatus,
    newStatus: 'completed',
    userId: ctx.userId,
  });
} catch (e) {
  console.error(`complete_load trigger fire for ${id}:`, e?.message || e);
}
```

Same shape for the `uncomplete_load` site (newStatus: 'pending_completion').

## Testing

Hand-rolled `.test.mjs` tests, following the existing `tests/dry-run-engine.test.mjs` pattern.

### `tests/status-change-fire-generalized.test.mjs` (new)

Minimum 6 cases covering the generalization:

1. **Orders entity path**: call `fireStatusChangeTriggers({ entityType: 'order', entityId: 'ord-1', oldStatus: 'pending', newStatus: 'completed' })`. Assert history INSERT targets `order_status_history`. Trigger filter query includes `entity_type='order'`.
2. **Charge_set entity path**: call with `entityType: 'charge_set', entityId: 'cs-1'`. Assert history INSERT targets `order_charge_sets_status_history`. Trigger filter includes `entity_type='charge_set'`.
3. **Move entity path**: call with `entityType: 'move', entityId: 'm-1'`. Assert history INSERT targets `order_container_moves_status_history`. Trigger filter includes `entity_type='move'`.
4. **Unknown entityType throws**: call with `entityType: 'driver'`. Assert `Error('unknown entityType: driver')` thrown. No history write, no trigger fetch.
5. **No-op on same status**: call with `oldStatus='completed', newStatus='completed'`. Returns `{ firesAttempted: 0, firesSucceeded: 0 }`. No history write, no trigger fetch.
6. **Backward-compat wrapper**: call `fireOrderStatusChangeTriggers({ tenantId, loadId: 'ord-42', ... })`. Assert it forwards to the generalized function with `entityType='order', entityId='ord-42'`.

### `tests/status-evaluator-generalized.test.mjs` (new)

Minimum 3 cases for the generalized polled-worker evaluator:

1. **Order trigger reads order_status_history**: evaluator receives a trigger with `entity_type: 'order'`. Assert the query targets `order_status_history` and selects `order_id`.
2. **Charge_set trigger reads order_charge_sets_status_history**: trigger with `entity_type: 'charge_set'`. Assert correct table + idColumn.
3. **Move trigger reads order_container_moves_status_history**: trigger with `entity_type: 'move'`. Assert correct table + idColumn.

### Existing tests (orders-only) MUST still pass

- Any existing `tests/status-change-fire*.test.mjs` (if present) — run unchanged; results identical because orders call sites go through the backward-compat wrapper.
- Any existing `tests/status-evaluator*.test.mjs` — same.
- Stream B.1a tests (`tests/charge-sets-transition.test.mjs` + `tests/routing-moves-transition.test.mjs`) — updated to expect the new `fireStatusChangeTriggers` call after history write. Add 2 new test cases per file:
  - "Fires triggers on successful transition (non-noop case)"
  - "Does NOT fire triggers on noop case"
- Existing polled-worker tests: verify still pass, potentially extending to cover the multi-entity case (deferred to plan).

### Integration smoke test (manual)

After migration applies and code deploys:
1. Create a test charge_set with `status='draft'` in a dev tenant.
2. Create an email trigger with `trigger_kind='status', entity_type='charge_set', event_name='invoiced', notify_after={days:0}`.
3. Call `transitionChargeSetStatus(svc, { ... newStatus: 'invoiced' })`.
4. Verify: (a) `order_charge_sets_status_history` row written, (b) email_template_trigger fires (check trigger-fire logs), (c) email dispatcher attempted delivery.

This is not an automated test — operator verification before marking the feature complete.

## Risks

1. **Existing orders triggers regress post-migration.** The generalized query adds an `entity_type='order'` filter that must match the default-backfilled column value. Mitigation: migration tests in a staging environment before prod apply; deploy order is (a) migration 097 → (b) code deploy. In that order, rollback is safe: if code is reverted, the column with DEFAULT persists but is ignored by old code.
2. **Context-builder crash on non-order entity.** `fireTrigger` dispatches to an email template + context-builder. Context-builder today assumes orders. If a charge_set or move trigger fires, context-building may crash. Mitigation: for this MVP, immediate firing happens for all 3 entity types, but context-builder failures are caught in `fireTrigger` and logged as dispatch failures (existing behavior). A charge_set trigger configured in practice requires templates that work with charge_set context variables — which admins don't have a UI to build. This is a known limitation; document as open. The tests pass because they mock the dispatcher.
3. **Polled worker candidate shape incompatibility.** The evaluator returns candidate objects; the worker feeds them to the dispatcher. Changing candidate shape (to include entityType + entityId) may break the worker loop. Mitigation: the generalization keeps existing shape for `entity_type='order'` candidates (returning `loadId`); charge_set / move evaluators return candidates but the worker ignores non-order entity_types in this MVP (documented limitation). A follow-up FU generalizes the worker's processing loop.
4. **Scope creep risk.** A reader sees "event spine generalization" and wants to add webhooks, a unified events table, or agent subscription APIs. Hard no. Non-goals list is explicit. Enforce at review.
5. **Migration 097 number collision.** If another worktree/branch grabbed 097, the plan bumps to 098. Low likelihood; one active branch per session.
6. **Fire-and-forget swallows real errors.** The try/catch around the helper calls in `transition.js` (and the routing/index.js sites) log but don't bubble. If trigger firing consistently fails, nothing surfaces to the caller. Mitigation: existing behavior — `fireStatusChangeTriggers` already swallows errors. Operational observability comes from the trigger-fire log table, which Stream C will likely generalize further. For this spec, preserve the existing contract.
7. **Backward-compat wrapper never gets removed.** Technical debt. Mitigation: documented as a cleanup FU for whenever the existing orders callers are touched for other reasons. Not blocking.

## Open Questions (deferred to plan)

1. **Does `trigger.entity_type` have safety defaults if the column is missing from a read result?** The JS safety net (`trigger.entity_type || 'order'`) handles edge cases during deploy windows where code is post-migration but reads older rows. Plan verifies the fallback.
2. **What's the exact field name used for the candidate's entity id?** Current orders code uses `loadId` for historical reasons (loads and orders are the same table). Plan verifies the worker's consumption signature and decides whether candidates return `loadId` for order entities or a unified `entityId`. Recommendation: keep `loadId` for order entities (minimize diff), add `entityId` for non-order entities.
3. **Does the polled worker need special handling for when the status evaluator returns charge_set / move candidates but can't dispatch?** Yes — log a "candidate found but dispatcher not yet entity-aware" warning and skip. Plan adds this log line.
4. **Migration order with production deploys.** Deploy sequence: apply migration 097 FIRST, then deploy code. Old code reading from new-column-default is safe (existing code never reads the column). New code reading from old-column-default-backfill is safe (DEFAULT='order' means every row has a valid value). Plan documents the order.
5. **Should the spec reserve FU numbers now for the context-builder generalization + worker candidate-shape update?** Or wait for them to be discovered in practice? Recommendation: open two FUs at ship time. Plan allocates.
