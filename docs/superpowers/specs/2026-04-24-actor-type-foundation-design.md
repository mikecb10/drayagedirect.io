---
name: 2026-04-24-actor-type-foundation-design
description: Stream B.1d — add an `actor_type` column ('human' | 'system' | 'agent') to all 6 action-recording tables and thread it through all 4 action-recording helpers. Ensures every row records whether the action came from a real user, automation (trigger-fire / cron), or a future AI agent. Existing callers default to `'human'` — zero behavior change on current product paths. Trigger-fire writes stamp `'system'`. Adds a 6th gate to `dd-ai-ready` so future product features built during the "polish phase" can't skip actor attribution. Closes FU-067 fully. Foundation for the per-credit AI tier (Stream C) without any retrofit work.
type: spec
---

# Actor-Type Foundation — Design Spec (Stream B.1d)

## Summary

The user's product vision is a polished SaaS core with an **opt-in per-credit AI tier** layered on top. Agents live beside humans — customers choose whether to enable them, pay per agent action, and can opt out entirely. For this to work, every action recorded in the system must cleanly distinguish WHO did it (human user vs. automated system vs. AI agent). Without this distinction, UIs conflate agent actions with human ones, audit trails lie about accountability, billing-per-credit can't be metered, and "pause my agents" toggles have no row-level column to filter on.

Streams A–C have already shipped the event spine, transition helpers, trigger generalization, and the `dd-ai-ready` guardrail skill. What's missing is the actor-attribution foundation — the single `actor_type` column threaded through every row that records a decision or a state change. Without shipping this before product polish, every feature built during the polish phase creates ~5-10 new call sites that would need retrofit before Stream C can launch (hundreds of sites total across the 68 open FUs).

This spec is surgical: one migration, six tables, four helpers, one JSDoc param, one skill-gate addition. No runtime architecture. No UI. No agent-runtime work. Just the column + the plumbing that ensures every product feature built from here on records actor attribution correctly.

## Goals

- Add `actor_type TEXT NOT NULL DEFAULT 'human'` with CHECK constraint (`'human' | 'system' | 'agent'`) to the 6 action-recording tables: `tenant_audit_log`, `admin_audit_log`, `email_trigger_log`, `order_status_history`, `order_charge_sets_status_history`, `order_container_moves_status_history`.
- Add `agent_metadata JSONB` to `tenant_audit_log` only (for future Stream C intent/outcome/token/cost data; helpers don't write to it yet).
- Thread optional `actorType` param through the 4 action-recording helpers: `transitionChargeSetStatus`, `transitionMoveStatus`, `logTenantAction`, `logAdminAction`. Default `'human'` preserves existing caller behavior.
- Trigger-fire paths (`fireStatusChangeTriggers` history INSERT + `fireTrigger`'s `email_trigger_log` INSERT) stamp `actor_type: 'system'` unconditionally — these are automation, not human action.
- Add a 6th gate to the `dd-ai-ready` skill that flags any new call to the 4 helpers or any new `.insert()` to the 6 tables without `actor_type` / `actorType`.
- All existing tests pass with zero behavior change (callers default to `'human'`).
- After ship: every row in the 6 tables has an accurate actor classification from day one. Stream C agent runtime just passes `actorType: 'agent'` when it wires up later — zero retrofit.
- Closes FU-067 fully.

## Non-Goals (explicitly out of scope)

1. **No AI tier feature flag.** Per-tenant "AI agents enabled" toggle is Stream C territory — not this spec.
2. **No agent runtime.** Nothing in this spec dispatches anything; it just records.
3. **No SOP framework or schema.** Stream C.
4. **No credit/usage metering.** Stream C (billing concern).
5. **No `agent_metadata` on tables other than `tenant_audit_log`.** YAGNI until Stream C writes to it.
6. **No retroactive backfill beyond DEFAULT.** Pre-ship rows all become `'human'`. Some were actually `'system'` (trigger-fired), but historical accuracy isn't load-bearing — forward data is what matters.
7. **No FU-074 (history-write unification).** Stays open as a separate cleanup. Adding a `transitionOrderStatus` helper to unify history writing is net new scope that belongs in its own spec.
8. **No UI surface for actor_type filtering.** Future admin UI work (Trigger Activity filter, audit-log viewer, etc.).
9. **No changes to RLS / permissions.** Existing policies don't reference actor_type; they remain tenant-scoped as today.
10. **No new entity types.** Orders, charge_sets, moves, audit logs — same 6 tables as today. Adding a 4th entity type to the status-change pipeline is a separate spec.
11. **No telemetry / dashboard changes.** Observability UI over actor_type is Stream C prep.
12. **No backward-compat deprecation timer.** The `actorType` param stays optional forever; `'human'` default is correct for every current product caller (they're all API handlers triggered by authenticated users).

## Locked Decisions

| # | Decision | Rationale |
|---|---|---|
| D1 | Three values: `'human'`, `'system'`, `'agent'` — enforced by CHECK | Smallest vocabulary that covers the actual distinctions; adding a 4th later is a simple CHECK migration |
| D2 | `NOT NULL DEFAULT 'human'` on all 6 tables | DEFAULT handles backfill; NOT NULL keeps future inserts explicit |
| D3 | Helpers accept OPTIONAL `actorType` param with `'human'` default | Existing callers (all human-initiated API handlers) continue working unchanged |
| D4 | Trigger-fire paths stamp `'system'` unconditionally | Automation is not human action; distinguishes from agent-initiated triggers later |
| D5 | `agent_metadata JSONB` on `tenant_audit_log` ONLY | Other tables don't need JSONB metadata for agents yet; YAGNI |
| D6 | All existing rows backfill to `'human'` via DEFAULT | No separate UPDATE pass; no data migration script |
| D7 | `dd-ai-ready` skill gains a 6th gate (G6 — actor attribution) | Enforces the discipline on future product features without manual review |
| D8 | FU-067 closes fully (actor_type + agent_metadata both shipped on tenant_audit_log) | Matches the FU's original intent |
| D9 | FU-074 stays OPEN — history-write unification is a separate concern | Keeping B.1d tight; that unification requires `transitionOrderStatus` (net new helper) |
| D10 | Deploy order: migration 098 FIRST, then code | Safer direction — old code works with new-column-default-present; new code works with default backfill |

## Data Model

### Migration 098: `actor_type` on 6 tables + `agent_metadata` on `tenant_audit_log`

**File:** `supabase/migrations/098_actor_type_foundation.sql`

```sql
-- ============================================================
-- Migration 098: actor_type foundation
-- ============================================================
-- Adds actor_type column to every table that records an action.
-- Values: 'human' (real user), 'system' (automation — trigger-fire,
-- cron), 'agent' (future AI agent runtime, Stream C).
--
-- All existing rows default to 'human' via DEFAULT. Forward data
-- stamps accurately from the moment code is deployed.
--
-- Additionally adds agent_metadata JSONB to tenant_audit_log for
-- future Stream C intent/outcome/token/cost data. No current writer.
--
-- Part of Stream B.1d (actor-type foundation). Closes FU-067.
-- ============================================================

BEGIN;

-- tenant_audit_log: actor_type + agent_metadata
ALTER TABLE tenant_audit_log
  ADD COLUMN IF NOT EXISTS actor_type TEXT NOT NULL DEFAULT 'human';
ALTER TABLE tenant_audit_log
  DROP CONSTRAINT IF EXISTS chk_tenant_audit_log_actor_type;
ALTER TABLE tenant_audit_log
  ADD CONSTRAINT chk_tenant_audit_log_actor_type
  CHECK (actor_type IN ('human', 'system', 'agent'));
ALTER TABLE tenant_audit_log
  ADD COLUMN IF NOT EXISTS agent_metadata JSONB;

-- admin_audit_log: actor_type
ALTER TABLE admin_audit_log
  ADD COLUMN IF NOT EXISTS actor_type TEXT NOT NULL DEFAULT 'human';
ALTER TABLE admin_audit_log
  DROP CONSTRAINT IF EXISTS chk_admin_audit_log_actor_type;
ALTER TABLE admin_audit_log
  ADD CONSTRAINT chk_admin_audit_log_actor_type
  CHECK (actor_type IN ('human', 'system', 'agent'));

-- email_trigger_log: actor_type
ALTER TABLE email_trigger_log
  ADD COLUMN IF NOT EXISTS actor_type TEXT NOT NULL DEFAULT 'human';
ALTER TABLE email_trigger_log
  DROP CONSTRAINT IF EXISTS chk_email_trigger_log_actor_type;
ALTER TABLE email_trigger_log
  ADD CONSTRAINT chk_email_trigger_log_actor_type
  CHECK (actor_type IN ('human', 'system', 'agent'));

-- order_status_history: actor_type
ALTER TABLE order_status_history
  ADD COLUMN IF NOT EXISTS actor_type TEXT NOT NULL DEFAULT 'human';
ALTER TABLE order_status_history
  DROP CONSTRAINT IF EXISTS chk_order_status_history_actor_type;
ALTER TABLE order_status_history
  ADD CONSTRAINT chk_order_status_history_actor_type
  CHECK (actor_type IN ('human', 'system', 'agent'));

-- order_charge_sets_status_history: actor_type
ALTER TABLE order_charge_sets_status_history
  ADD COLUMN IF NOT EXISTS actor_type TEXT NOT NULL DEFAULT 'human';
ALTER TABLE order_charge_sets_status_history
  DROP CONSTRAINT IF EXISTS chk_cs_status_history_actor_type;
ALTER TABLE order_charge_sets_status_history
  ADD CONSTRAINT chk_cs_status_history_actor_type
  CHECK (actor_type IN ('human', 'system', 'agent'));

-- order_container_moves_status_history: actor_type
ALTER TABLE order_container_moves_status_history
  ADD COLUMN IF NOT EXISTS actor_type TEXT NOT NULL DEFAULT 'human';
ALTER TABLE order_container_moves_status_history
  DROP CONSTRAINT IF EXISTS chk_move_status_history_actor_type;
ALTER TABLE order_container_moves_status_history
  ADD CONSTRAINT chk_move_status_history_actor_type
  CHECK (actor_type IN ('human', 'system', 'agent'));

NOTIFY pgrst, 'reload schema';

COMMIT;
```

**Why TEXT not enum:** future flexibility. Adding a 4th actor_type (e.g., `'webhook'`, `'integration'`) is a CHECK migration, not a type-migration — cheaper to extend.

**Why no index:** queries filtering by actor_type alone aren't a use case today. When they become one (Stream C dashboards), add then. Premature indexing is wasteful.

## Helper Contracts

### `lib/charge-sets/transition.js` — `transitionChargeSetStatus`

**New signature:**

```js
/**
 * @param svc
 * @param {{
 *   tenantId: string,
 *   chargeSetId: string,
 *   newStatus: string,
 *   actorUserId: string | null,
 *   actorType?: 'human' | 'system' | 'agent',  // NEW — defaults to 'human'
 *   extraFields?: object,
 * }} params
 */
export async function transitionChargeSetStatus(svc, params) { /* ... */ }
```

**Behavior change:** the history INSERT stamps `actor_type` from `params.actorType ?? 'human'`. No other logic changes.

### `lib/routing/moves/transition.js` — `transitionMoveStatus`

Analogous — accepts `actorType?`, defaults `'human'`, stamps in history INSERT.

### `lib/tenant-audit.js` — `logTenantAction`

**New signature:**

```js
/**
 * @param supabase
 * @param {{
 *   tenantId: string,
 *   userId: string | null,
 *   action: string,
 *   entityType: string,
 *   entityId: string,
 *   changes?: object,
 *   ipAddress?: string,
 *   actorType?: 'human' | 'system' | 'agent',  // NEW — defaults to 'human'
 *   agentMetadata?: object,                     // NEW — stored in JSONB, future Stream C
 * }} params
 */
export async function logTenantAction(supabase, params) { /* ... */ }
```

**Behavior change:** `actor_type` + `agent_metadata` passed through to the INSERT. `agent_metadata` defaults to NULL.

### `lib/admin-audit.js` — `logAdminAction`

Analogous to `logTenantAction` but for `admin_audit_log`. Accepts `actorType?`, defaults `'human'`. No `agent_metadata` — admin actions are all human, and if agent-admin actions ever exist, add the column then.

### `lib/email-dispatch/status-change-fire.js`

**Behavior change:** the history INSERT (inside `fireStatusChangeTriggers`) stamps `actor_type: 'system'` unconditionally. This is automation — the fire is invoked by a transition helper or the polled-worker, not by a human directly.

**Side note:** the existing `userId` param continues to be stamped as `changed_by`. Same human who initiated the transition; actor_type just clarifies "this row is from the automated firing path, not the human's direct action." The double-row history issue (transition helper also writes a row) is separately tracked as FU-074; both rows will now have actor_type, with the transition helper's row being `'human'` and the fire helper's row being `'system'`. Once FU-074 ships, one row is kept — the `'human'` one, per the spec's "human actions are canonical" principle.

### `lib/email-dispatch/dispatcher.js` — `fireTrigger`

**Behavior change:** the `email_trigger_log` INSERT(s) via `finalizeErrored`, `finalizeDisabled`, `finalizeDeduped`, `finalizeFired`, `finalizeSkipped` all stamp `actor_type: 'system'`. Trigger-firing is automation.

**Future Stream C:** agents will invoke `fireTrigger` directly with `actorType: 'agent'` — that path doesn't exist yet. Helpers accept the param but don't expose it on the public surface in this spec.

## `dd-ai-ready` Skill Extension

Add a 6th gate to the existing 5-check filter in `C:\Users\bento\.claude\skills\dd-ai-ready\SKILL.md`:

**G6: Actor attribution** — Triggers when the edit:
1. Adds a new call to `logTenantAction`, `logAdminAction`, `transitionChargeSetStatus`, or `transitionMoveStatus` that doesn't pass `actorType`
2. Adds a new `.insert(...)` to `tenant_audit_log`, `admin_audit_log`, `email_trigger_log`, `order_status_history`, `order_charge_sets_status_history`, or `order_container_moves_status_history` without `actor_type` in the payload

**Adaptive finding template:**

```
[Actor-attribution] <file>:<line> — Call to <helper> doesn't pass `actorType`.
Defaults to 'human' which is correct for current product UI paths, but
if this code ever runs from an agent runtime (Stream C), it will
incorrectly record the agent as a human actor. Add `actorType` explicitly
(e.g., `actorType: 'human'` for user-initiated, `'system'` for automation).
```

The new gate is advisory (matches the skill's overall tone), but makes actor-attribution visible at every new call site. Future polish-phase work will get the "correct default" flagged — forcing developers to think about the classification rather than inherit it.

Also update:
- `dev_ai_ready_skill.md` in memory — reflects the 6-gate checker
- The skill's worked examples — add one that demonstrates G6 firing + not firing

## Testing

Hand-rolled `.test.mjs` per repo convention. Extend existing tests rather than creating new files — this spec is an additive change, not a new feature.

### `tests/charge-sets-transition.test.mjs` — existing file, add 2 cases

```js
// Case N: actorType defaults to 'human' when not provided
{
  const svc = makeMockClient({ /* ... */ });
  await transitionChargeSetStatus(svc, {
    tenantId: 't-1', chargeSetId: 'cs-default', newStatus: 'invoiced', actorUserId: 'u-1',
    // no actorType
  });
  const histInsert = svc._calls.inserted.find(i => i.table === 'order_charge_sets_status_history');
  check('default actorType: human stamped', histInsert?.payload?.actor_type === 'human');
}

// Case N+1: explicit actorType: 'agent' passes through
{
  const svc = makeMockClient({ /* ... */ });
  await transitionChargeSetStatus(svc, {
    tenantId: 't-1', chargeSetId: 'cs-agent', newStatus: 'invoiced', actorUserId: null,
    actorType: 'agent',
  });
  const histInsert = svc._calls.inserted.find(i => i.table === 'order_charge_sets_status_history');
  check('explicit agent actorType: stamped correctly', histInsert?.payload?.actor_type === 'agent');
}
```

### `tests/routing-moves-transition.test.mjs` — analogous 2 cases

### `tests/status-change-fire-generalized.test.mjs` — add 1 case

```js
// Case N: fireStatusChangeTriggers stamps actor_type: 'system' on history insert
{
  const svc = makeMockClient({ /* order entity configured */ });
  await fireStatusChangeTriggers(svc, {
    tenantId: 't-1', entityType: 'order', entityId: 'ord-sys',
    oldStatus: 'pending', newStatus: 'completed', userId: 'u-1',
  });
  const histInsert = svc._calls.inserted.find(i => i.table === 'order_status_history');
  check('fireStatusChangeTriggers: actor_type=system', histInsert?.payload?.actor_type === 'system');
}
```

### `tests/fire-trigger-entity-aware.test.mjs` — add 1 case

```js
// Case N: fireTrigger's email_trigger_log writes stamp actor_type: 'system'
{
  const svc = makeMockClient({ /* ... */ });
  await fireTrigger(svc, { /* ... */ });
  const logInsert = svc._calls.inserted.find(i => i.table === 'email_trigger_log');
  check('email_trigger_log stamps actor_type=system', logInsert?.payload?.actor_type === 'system');
}
```

### No new tests for `logTenantAction` / `logAdminAction`

There are no existing tests for these audit helpers. Adding tests just for the actorType pass-through is disproportionate. Rely on the call-site-level behavior being correct (the helpers are ~5-line DB inserts).

### Regression check

- Full suite (15 test files pre-B.1d → 15 post) passes unchanged
- New assertions (6 total: 2 charge_set + 2 move + 1 fire + 1 dispatcher) pass

## Risks

1. **Migration 098 applies cleanly on all 6 tables.** Risk: a table doesn't exist in the tenant's local DB state (e.g., a half-applied migration history). Mitigation: `IF NOT EXISTS` on column; `DROP CONSTRAINT IF EXISTS` before `ADD`. Idempotent.
2. **CHECK constraint rejects `'system'` or `'agent'` on backfill.** Impossible — DEFAULT applies `'human'` which is in the CHECK set. No row violates at migration time.
3. **Existing callers that use the `...` rest spread to pass extra fields might accidentally pass actor_type in the wrong place.** Unlikely. Mitigation: helpers explicitly destructure `{ actorType, ... }` before spreading.
4. **`dd-ai-ready` skill G6 false-positives on internal helpers (e.g., `fireStatusChangeTriggers` calling the transition helpers).** Mitigation: G6 only fires on NEW call sites, and the skill's adaptive check language explicitly says "defaults to 'human' which is fine for current paths" — the flag is informational, not blocking.
5. **`agent_metadata` JSONB column gets populated incorrectly in the future.** Not a B.1d concern — no writer exists yet. Stream C owns that.
6. **Deploy order.** Migration FIRST, then code deploy. Rollback: if code is rolled back, column stays with DEFAULT applied — safe. If migration is rolled back, new code writing `actor_type` would fail — avoid this ordering.
7. **B.1a/B.1b migrations (095–097) didn't include actor_type.** Correct — those migrations created the history tables WITHOUT the column, and this spec adds it via ALTER. Clean separation of concerns, even if ordering in retrospect would have been cleaner to include upfront.

## Open Questions (deferred to plan)

1. **Exact `logTenantAction` signature today** — plan verifies by reading `lib/tenant-audit.js`. If the current function takes positional args (not an object), add object-arg-shim treatment similar to B.1c's `buildTriggerContext` pattern.
2. **Exact trigger-fire log insert sites** — plan locates every INSERT into `email_trigger_log` in `dispatcher.js` and confirms each includes `actor_type: 'system'` in the payload.
3. **G6 adaptive check implementation** — plan describes the skill-body update as a markdown edit to `SKILL.md` + `dev_ai_ready_skill.md`. No runtime code.
4. **Migration ordering if 098 is taken** — plan verifies; bumps to 099 if needed.
5. **`order_status_history` column named `notes` still unused** — unrelated to this spec; leave alone.
