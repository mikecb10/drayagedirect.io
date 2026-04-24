---
name: 2026-04-24-non-order-trigger-completion-design
description: Stream B.1c — complete non-order trigger firing end-to-end by generalizing `buildTriggerContext` + `fireTrigger` + `polled-worker`. Closes FU-072 (context-builder entity-aware) + FU-073 (polled-worker candidate shape). Enables admins to create status triggers targeting `charge_set` or `move` entities that fire both immediately (on transition) and on delay (via cron). Removes the B.1b tactical skip. Preserves log-keying on `load_id` (orders are the parent entity for both charge_sets and moves; no log schema change). No new migrations. No UI changes (trigger-authoring UI for non-order types is separate).
type: spec
---

# Non-Order Trigger Completion — Design Spec (Stream B.1c)

## Summary

Stream B.1b generalized the status-change firing pipeline's schema (`email_template_triggers.entity_type`), helper (`fireStatusChangeTriggers`), and polled-worker evaluator — but deliberately skipped non-order *immediate* firing because `fireTrigger` + `buildTriggerContext` + the polled-worker dispatch loop all assume orders. That tactical skip was the right call to ship B.1b cleanly; it left two follow-ups (FU-072 context-builder, FU-073 polled-worker candidate shape) that together gate non-order triggers from actually firing.

This spec closes both FUs. Scope:

1. **`buildTriggerContext`** (at `lib/email-dispatch/context-builder.js`) gains an entity-aware top-level: accepts `{ tenantId, entityType, entityId, userId }`, routes to one of three sub-builders (`buildOrderTriggerContext`, `buildChargeSetTriggerContext`, `buildMoveTriggerContext`). A positional-argument shim keeps the existing `(svc, tenantId, loadId, userId)` callers working.
2. **`fireTrigger`** (at `lib/email-dispatch/dispatcher.js`) gains entity-aware entry: accepts `{ tenantId, triggerId, entityType, entityId, fireKey, userId, eventName }`. `loadId` is no longer required — the function resolves `loadId` internally by looking up the parent order for charge_set/move entities (both entities reference `orders(id)` via `order_id`). Post-fire log records continue to carry `load_id` (logs stay order-keyed; entity_type is captured in the trigger row itself, queryable via FK).
3. **A new `buildMoveTriggerContext`** function (~100 lines) — move template variables: `{{move_type}}`, `{{move_status}}`, `{{move_old_status}}`, `{{move_new_status}}`, `{{move_from_location_name}}`, `{{move_to_location_name}}`, `{{move_scheduled_at}}`, `{{move_started_at}}`, `{{move_completed_at}}` + inherited parent-order variables via order lookup.
4. **A new `buildChargeSetTriggerContext`** adapter (~30 lines) — thin wrapper around the existing `buildChargeSetContext`, returning only the template-variable subset needed for status triggers (drops invoice-specific fields not relevant to trigger emails).
5. **Polled worker** (at `lib/email-dispatch/polled-worker.js`) — dispatch loop reads `candidate.entityType` + `candidate.entityId` (preferring these over legacy `candidate.load_id` when present). Non-order candidates now actually fire instead of being silently ignored.
6. **Remove the B.1b tactical skip** (`if (entityType !== 'order') continue;` in `lib/email-dispatch/status-change-fire.js`). Immediate firing now works for all three entity types.
7. **Tests** — add integration-style coverage: charge_set immediate firing end-to-end, move immediate firing end-to-end, polled-worker dispatch for non-order delayed triggers.

Net outcome after this spec ships: admins can create an `email_template_trigger` with `entity_type='charge_set'` or `entity_type='move'` (via SQL INSERT; UI is separate), and status transitions on those entities will fire the trigger with a correctly-populated template context. Both immediate (`notify_after: 0`) and delayed (`notify_after: >0` → polled worker) paths work. FU-072 + FU-073 close.

## Goals

- Extend `buildTriggerContext` to accept `entityType` + `entityId` and route to the right sub-builder; preserve the positional-argument signature as a backward-compat shim.
- Create `buildMoveTriggerContext` with move-specific template variables plus inherited parent-order context.
- Create `buildChargeSetTriggerContext` adapter over the existing `buildChargeSetContext` (already exists in `lib/email-dispatch/context-builder.js` for AR invoicing flows; reuse to avoid duplication).
- Generalize `fireTrigger` to accept `entityType` + `entityId`; resolve `loadId` via parent-order lookup for charge_set/move; preserve all log-keyed-by-load_id behavior.
- Generalize polled-worker dispatch loop to process non-order candidates, matching the evaluator's generalized output shape (`{ entityType, entityId, enteredAt }` per B.1b).
- Remove the B.1b `entityType !== 'order' continue` skip in `lib/email-dispatch/status-change-fire.js`.
- Add a thin backward-compat wrapper `fireTriggerForOrder({ ..., loadId })` for existing orders-only callers; migrate them in this spec.
- Tests: integration-style coverage for charge_set + move immediate firing, plus polled-worker non-order dispatch.
- After ship: FU-072 and FU-073 both close.

## Non-Goals (explicitly out of scope)

1. **No UI for creating non-order triggers.** The existing admin-side trigger-authoring UI (wherever that lives) does not expose `entity_type`. Admins can configure non-order triggers via SQL INSERT after this ships. UI work is a separate spec.
2. **No history-row write unification (FU-074).** The intentional duplication (transition helper writes history AND `fireStatusChangeTriggers` writes history) persists. Separate spec (B.1d or later).
3. **No new entity types beyond orders / charge_sets / moves.** Other status-bearing entities (`ar_invoices`, `driver_pay`, `credit_memos`) still use their own existing status-write paths; adding them to the trigger pipeline is a separate concern.
4. **No change to `email_template_triggers` schema.** Schema already carries `entity_type` (from migration 097, B.1b). No new columns.
5. **No change to trigger-fire log schemas.** Logs remain keyed by `load_id`; charge_set/move triggers resolve their parent order's id for log-keying purposes. Avoids a log-table migration.
6. **No template-variable standardization across entities.** Move triggers get a move-shaped context; charge_set triggers get a charge_set-shaped context. Admins writing templates pick variables appropriate to the entity_type they scoped the trigger to.
7. **No changes to `email_templates` table or rendering.** Templates are rendered by the existing pipeline; the new contexts just provide more candidate variables.
8. **No conditional logic for per-entity notify_after limits.** If an admin creates a move trigger with a 30-day `notify_after`, it fires 30 days after the move's transition. Same semantics as orders.
9. **No migration of existing orders triggers.** Existing rows in `email_template_triggers` stay at `entity_type='order'`. No data change.
10. **No retroactive firing.** Only transitions happening post-ship of this spec will fire on non-order triggers. Existing history rows (pre-ship) don't trigger evaluation.
11. **No telemetry changes.** Existing fire-log captures outcome, error, etc. — that continues unchanged. No new observability surface.
12. **No deletion of legacy signatures.** `buildTriggerContext(svc, tenantId, loadId, userId)` (positional) and `fireTrigger(svc, { ..., loadId })` (object with loadId) both continue to work. Removing them is a separate cleanup.

## Locked Decisions

| # | Decision | Rationale |
|---|---|---|
| D1 | Generalize in place; backward-compat via positional shims | Matches B.1b pattern; minimizes blast radius on 5+ existing caller files |
| D2 | Preserve log-keying on `load_id` via parent-order lookup | Avoids a log-table schema migration; non-order entities always have a parent `orders(id)` — lookup is 1 additional query at fire-time |
| D3 | `buildMoveTriggerContext` is a new function, not an adapter | Move has its own domain vocabulary (move_type, from/to locations) distinct from orders; authoring templates that reuse order variables would be confusing |
| D4 | `buildChargeSetTriggerContext` is a thin adapter over `buildChargeSetContext` | That function exists for AR invoicing flows; duplication avoided; trigger-relevant subset filtered in the adapter |
| D5 | Remove B.1b tactical skip atomically with this spec | Otherwise dead code lingers; tests in this spec cover what the skip was hiding |
| D6 | Polled-worker dispatch loop prefers `candidate.entityType` when present, falls back to `candidate.load_id` | Maintains compatibility with evaluator's dual-shape output from B.1b; migrates over time |
| D7 | Tests use the existing mock Supabase client pattern | Matches `tests/status-change-fire-generalized.test.mjs`, `tests/charge-sets-transition.test.mjs`, etc. No new test framework |
| D8 | Fire-and-forget error handling preserved — fireTrigger failures don't bubble past fireStatusChangeTriggers | Existing contract; don't change for this spec |
| D9 | Parent-order resolution happens ONCE in fireTrigger, result threaded to all downstream log writes | Single query; no duplication; keeps log-write shape intact |
| D10 | Backward-compat wrappers (`fireTriggerForOrder`, positional `buildTriggerContext`) are exported but marked as legacy in JSDoc | Encourages new callers to use the object-arg form; doesn't force immediate migration |

## Helper Contracts

### `lib/email-dispatch/context-builder.js` — generalized `buildTriggerContext`

**Primary signature (new object-arg form):**

```js
/**
 * Build the template-variable context for a status trigger.
 *
 * Routes to the appropriate sub-builder based on entityType:
 *   - order      → buildOrderTriggerContext (existing logic, extracted)
 *   - charge_set → buildChargeSetTriggerContext (new adapter over buildChargeSetContext)
 *   - move       → buildMoveTriggerContext (new)
 *
 * @param svc service-role Supabase client
 * @param {{
 *   tenantId: string,
 *   entityType: 'order' | 'charge_set' | 'move',
 *   entityId: string,
 *   userId: string | null,
 * }} params
 * @returns {Promise<{ variables: Record<string, string>, orderId: string | null }>}
 *   `orderId` is the parent order's id (for charge_set/move) or entityId (for order).
 *   Returned for fireTrigger's log-keying convenience.
 */
export async function buildTriggerContext(svc, params) { /* ... */ }
```

**Backward-compat shim (positional args):**

```js
/**
 * Legacy signature — existing callers pre-B.1c. Detects positional vs.
 * object-arg invocation and routes accordingly. New code should use the
 * object-arg form above.
 *
 * @deprecated use the object-arg form above
 */
// The exported function name is still `buildTriggerContext`; it handles both shapes.
// Internal logic:
//   if (typeof arg2 === 'object' && arg2 !== null && !Array.isArray(arg2))
//     return generalizedForm(svc, arg2);
//   else
//     return generalizedForm(svc, { tenantId: arg2, entityType: 'order', entityId: arg3, userId: arg4 });
```

This dual-shape shim is messy but prevents updating every caller in lockstep. Callers migrate opportunistically.

### `lib/email-dispatch/context-builder.js` — `buildMoveTriggerContext` (new)

```js
/**
 * Build template variables for a move-scoped status trigger.
 *
 * Variables produced:
 *   {{move_id}}, {{move_type}}, {{move_status}}, {{move_old_status}}, {{move_new_status}},
 *   {{move_from_location_name}}, {{move_to_location_name}},
 *   {{move_scheduled_at}}, {{move_started_at}}, {{move_completed_at}}
 *
 * Plus inherited parent-order variables (via order lookup):
 *   {{load_number}}, {{customer_name}}, {{driver_name}}
 *
 * Plus inherited tenant variables:
 *   {{tenant_name}}, {{tenant_timezone}}
 *
 * The old_status/new_status variables require the caller to pass them
 * through — the context-builder doesn't know the transition history.
 * For now they come through the trigger context via fireTrigger's
 * `eventName` + history lookup (a SELECT from the move's history table).
 */
export async function buildMoveTriggerContext(svc, { tenantId, moveId, userId }) { /* ... */ }
```

Implementation sketch:
1. Fetch the move row (`order_container_moves` by id + tenant_id)
2. Fetch parent order (via `move.order_id`) — reuse `buildOrderTriggerContext` for the order-level variables, prefix-renaming where collision would occur (actually no collision: order variables are already prefixed with `load_` or `customer_` or `driver_`)
3. Assemble move-specific variables from the move row
4. Return combined `variables` object + `orderId` field

### `lib/email-dispatch/context-builder.js` — `buildChargeSetTriggerContext` (new adapter)

```js
/**
 * Thin adapter over existing buildChargeSetContext for status-trigger use.
 *
 * Variables produced:
 *   {{charge_set_id}}, {{charge_set_status}}, {{charge_set_old_status}}, {{charge_set_new_status}},
 *   {{charge_set_total}}, {{charge_set_reference_number}}
 *
 * Plus inherited parent-order variables (via order lookup)
 * Plus inherited tenant variables
 */
export async function buildChargeSetTriggerContext(svc, { tenantId, chargeSetId, userId }) {
  // Reuse existing buildChargeSetContext + filter to trigger-relevant subset
}
```

### `lib/email-dispatch/dispatcher.js` — generalized `fireTrigger`

**Primary signature:**

```js
/**
 * Fire a configured trigger for a specific entity transition.
 *
 * Resolves the parent order's id for charge_set/move entities (logs are
 * order-keyed). Fetches trigger + template, builds entity-typed context,
 * renders the email, and writes a fire-log record.
 *
 * @param svc
 * @param {{
 *   tenantId: string,
 *   triggerId: string,
 *   entityType: 'order' | 'charge_set' | 'move',
 *   entityId: string,
 *   fireKey: string,
 *   userId: string | null,
 *   eventName: string,
 * }} params
 * @returns {Promise<{ outcome: 'fired' | 'skipped' | 'errored', ...existing fields }>}
 */
export async function fireTrigger(svc, params) { /* ... */ }
```

**Behavior change:**
- Early in function: resolve `loadId` for log-keying. For `entityType === 'order'`, `loadId = entityId`. For charge_set/move, SELECT `order_id` from the entity's table. If lookup fails, log and abort (skipped outcome).
- Pass `{ entityType, entityId, userId }` to `buildTriggerContext` (new signature).
- All existing fire-log writes keyed by `load_id` continue to work — they receive the resolved parent order's id.

**Backward-compat wrapper:**

```js
/**
 * Legacy orders-only wrapper. Forwards to fireTrigger with entityType='order'.
 *
 * @deprecated use fireTrigger({ entityType, entityId, ... }) directly
 */
export async function fireTriggerForOrder(svc, { tenantId, triggerId, loadId, fireKey, userId, eventName }) {
  return fireTrigger(svc, {
    tenantId,
    triggerId,
    entityType: 'order',
    entityId: loadId,
    fireKey,
    userId,
    eventName,
  });
}
```

### `lib/email-dispatch/status-change-fire.js` — remove the tactical skip

**Remove these lines** (added in B.1b's fix pass):

```js
// Non-order immediate firing deferred to FU-072 (dispatcher
// generalization): fireTrigger currently requires loadId (see
// dispatcher.js:56-58) and the context-builder assumes order-shaped
// data. Rather than throw + log on every non-order transition, we
// skip here. The history row is still written above, so delayed
// triggers work via the polled worker once FU-073 ships.
if (entityType !== 'order') {
  continue;
}
```

Replace by passing `entityType` + `entityId` through to the now-generalized `fireTrigger`:

```js
// All 3 entity types fire via generalized fireTrigger (B.1c closes the
// dispatcher/context-builder gaps FU-072/073 tracked).
attempts.push(
  fireTrigger(svc, {
    tenantId,
    triggerId: trigger.id,
    entityType,
    entityId,
    fireKey,
    userId,
    eventName: newStatus,
  }).then(/* unchanged */).catch(/* unchanged */)
);
```

### `lib/email-dispatch/polled-worker.js` — dispatch loop

Currently reads `candidate.load_id` when building a fireTrigger call. Generalize to:

```js
// Prefer entity-typed candidate shape (from B.1b evaluator for non-orders);
// fall back to load_id for legacy orders candidates.
const entityType = candidate.entityType || 'order';
const entityId = candidate.entityId || candidate.load_id;

await fireTrigger(svc, {
  tenantId,
  triggerId: trigger.id,
  entityType,
  entityId,
  fireKey,
  userId: null, // polled worker has no user context
  eventName: trigger.event_name,
});
```

The fireTrigger signature changes cover all callers — polled worker just reads the new shape.

## Testing

All tests use the existing hand-rolled `.test.mjs` pattern at `tests/*.test.mjs`.

### `tests/trigger-context-generalized.test.mjs` (new)

Minimum 4 cases:

1. **Order entity path**: call `buildTriggerContext(svc, { tenantId: 't-1', entityType: 'order', entityId: 'ord-1', userId: 'u-1' })`. Assert `variables.load_number` is populated, `variables.customer_name` is populated.
2. **Charge_set entity path**: call with `entityType: 'charge_set', entityId: 'cs-1'`. Assert `variables.charge_set_id === 'cs-1'`, `variables.load_number` is populated (inherited from parent order).
3. **Move entity path**: call with `entityType: 'move', entityId: 'm-1'`. Assert `variables.move_type` is populated, `variables.load_number` is populated (inherited).
4. **Positional-shim (legacy)**: call `buildTriggerContext(svc, 't-1', 'ord-1', 'u-1')`. Assert it still works, produces order-context output.

### `tests/fire-trigger-entity-aware.test.mjs` (new)

Minimum 3 cases:

1. **Order trigger fires**: call `fireTrigger(svc, { entityType: 'order', entityId: 'ord-1', ... })`. Assert log record written with `load_id: 'ord-1'`.
2. **Charge_set trigger resolves parent order for logs**: call with `entityType: 'charge_set', entityId: 'cs-1'`. Assert parent-order SELECT happened, log record has `load_id: 'ord-parent-1'`.
3. **Move trigger resolves parent order for logs**: similar for moves.

### `tests/status-change-fire-generalized.test.mjs` (extend existing)

Remove the Case that relies on the tactical skip (if any). Add:

- **Charge_set trigger fires immediate**: configure a mock charge_set trigger with `notify_after: 0`, call `fireStatusChangeTriggers`, assert `fireTrigger` was invoked (not skipped).

### `tests/status-evaluator-generalized.test.mjs` (extend existing)

Current 10 assertions still pass. No new cases strictly needed; the polled-worker dispatch change is covered by a new worker test below.

### `tests/polled-worker-entity-aware.test.mjs` (new)

Minimum 2 cases:

1. **Worker dispatches order candidate**: worker receives `{ load_id: 'ord-1', reason: '...' }` (legacy shape), passes to fireTrigger with `entityType: 'order'`.
2. **Worker dispatches charge_set candidate**: worker receives `{ entityType: 'charge_set', entityId: 'cs-1', enteredAt: '...' }`, passes to fireTrigger with the new shape.

### Existing tests — regression check

- `tests/status-change-fire-generalized.test.mjs` — all prior cases still pass
- `tests/status-evaluator-generalized.test.mjs` — all prior cases still pass
- `tests/charge-sets-transition.test.mjs` — all prior cases still pass (helper call paths unchanged)
- `tests/routing-moves-transition.test.mjs` — same
- Full repo suite — no regressions

## Risks

1. **Backward-compat shim for `buildTriggerContext` positional-args is brittle.** The shim detects "is arg2 an object?" — but if a caller passes `null` or a non-plain-object, detection could misfire. Mitigation: strict check for plain object + no `entityType` property being absent as orders-legacy indicator. Migrate callers to object-arg form in this spec to reduce the shim's surface.
2. **Parent-order lookup adds 1 query per fire.** For charge_set/move entities, `fireTrigger` now SELECTs from `order_charge_sets` or `order_container_moves` to get `order_id`. At current volumes (immediate fires are on transition, not hot path), negligible. If scale becomes a concern, the lookup can be batched later.
3. **Move template variables are my best guess.** Real admins writing move-status templates may want different variables than `{{move_type}}`, `{{move_from_location_name}}`, etc. Mitigation: document the available variables in the spec + in an in-code JSDoc block; admins discover them via trial. Add more if requested.
4. **Removing the B.1b tactical skip breaks if any non-order trigger is configured BEFORE FU-072's context-builder code actually works.** Mitigation: ship order matters — context-builder + dispatcher generalization lands first, THEN the skip removal. Tests catch this: if removal lands before the context-builder ships, the tests fail. Plan sequences tasks correctly.
5. **Polled-worker now dispatches non-order candidates — if context-builder has a bug for a specific entity type, every polled-evaluation of that type errors.** Mitigation: per-candidate error boundaries (existing `.catch` in the worker) — a single failing candidate doesn't halt the sweep.
6. **Fire-log's `load_id` column is NOT NULL.** For charge_set/move entities, we resolve parent-order id. What if the entity has no parent (orphaned)? For charge_sets, `order_id` is NOT NULL (migration 003). For moves, same. So orphaned doesn't happen in practice. If a soft-deleted parent? The lookup returns null → fireTrigger records the trigger as `outcome: 'skipped'` with reason `'parent order not found'`.
7. **`buildChargeSetContext` exists for AR invoicing flows with a specific shape.** The adapter extracts a subset; if the AR shape changes, the adapter may need updating. Document the coupling.

## Open Questions — addressed in plan

1. **Exact move template variables** — plan enumerates them explicitly (spec-level list above is proposed; plan verifies against what admins would want).
2. **Positional-shim detection logic** — plan specifies the exact `typeof` / property-presence checks.
3. **Parent-order lookup: via service client with RLS bypass?** — yes, all existing code in `dispatcher.js` uses `svc` (service-role client). Same pattern.
4. **Which existing callers of `fireTrigger` / `buildTriggerContext` get migrated to object-arg form in this spec vs. stay on legacy shim?** — plan identifies all callers via grep; migrates the ones touched by this change, leaves others on the shim for future cleanup.
5. **Polled-worker's fireTrigger invocation currently lives where?** — plan locates the exact call site (`lib/email-dispatch/polled-worker.js` dispatch loop).
