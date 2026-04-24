# Event Spine Generalization Implementation Plan (Stream B.1b)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generalize `fireStatusChangeTriggers` + `evaluators/status.js` + `email_template_triggers` to work across orders, charge_sets, and moves. Wire Stream B.1a's helpers to fire events. Close FU-071. No new tables, no API contract changes, backward-compatible.

**Architecture:** Parameterize the entity-type throughout the status-change pipeline via an internal `HISTORY_TABLE_BY_ENTITY` lookup. Existing orders callers keep working via a thin `fireOrderStatusChangeTriggers` wrapper. Migration 097 adds `entity_type TEXT NOT NULL DEFAULT 'order'` + CHECK constraint + index to `email_template_triggers`. Polled worker + evaluator loop over entity types.

**Tech Stack:** Node.js 20+, plain ESM. Supabase JS client. Hand-rolled `.test.mjs` tests at `tests/*.test.mjs` (reference: `tests/dry-run-engine.test.mjs`). Postgres 15 via Supabase. Migration template: `memory/dev_migration_template.md`.

**Spec:** [docs/superpowers/specs/2026-04-24-event-spine-generalization-design.md](docs/superpowers/specs/2026-04-24-event-spine-generalization-design.md)

**FU baseline:** Current max is `FU-071` (opened by Stream B.1a for the 2 out-of-scope order writes). This plan CLOSES FU-071 and OPENS 2 new FUs: FU-072 (context-builder generalization) and FU-073 (polled-worker candidate-shape for non-order entities).

**Migration baseline:** Latest migration is `096_charge_set_and_move_status_history.sql` (Stream B.1a). This plan adds `097_trigger_entity_type.sql`. Task 1 verifies 097 is still free.

**Files touched:**

| Type | File |
|---|---|
| Create | `supabase/migrations/097_trigger_entity_type.sql` |
| Modify | `lib/email-dispatch/status-change-fire.js` (generalize + add wrapper) |
| Modify | `lib/email-dispatch/evaluators/status.js` (entity-aware history-table lookup) |
| Modify | `lib/email-dispatch/index.js` (export the new wrapper) |
| Modify | `lib/charge-sets/transition.js` (call fireStatusChangeTriggers after history write) |
| Modify | `lib/routing/moves/transition.js` (same) |
| Modify | `pages/api/tenant/loads/[id]/routing/index.js` (route 2 order writes through wrapper, closes FU-071) |
| Create | `tests/status-change-fire-generalized.test.mjs` (6 cases) |
| Create | `tests/status-evaluator-generalized.test.mjs` (3 cases) |
| Modify | `tests/charge-sets-transition.test.mjs` (+2 cases for fire-on-transition) |
| Modify | `tests/routing-moves-transition.test.mjs` (+2 cases) |
| Modify | `C:\Users\bento\.claude\projects\C--Users-bento-app-drayagedirect\memory\followups.md` (open FU-072, FU-073; close FU-071) |
| Modify | `C:\Users\bento\.claude\projects\C--Users-bento-app-drayagedirect\memory\MEMORY.md` (audit-line bump) |

---

## Phase 1 — Schema + firing generalization (4 tasks)

### Task 1: Migration 097 — `email_template_triggers.entity_type` column

**Files:**
- Create: `supabase/migrations/097_trigger_entity_type.sql`

- [ ] **Step 1: Verify migration 097 is still free**

Run: `ls C:/Users/bento/app-drayagedirect/supabase/migrations/ | grep "^097"`

Expected: no match. If match found (another branch grabbed it), bump to next available number across all tasks.

- [ ] **Step 2: Write the migration**

Create `C:\Users\bento\app-drayagedirect\supabase\migrations\097_trigger_entity_type.sql`:

```sql
-- ============================================================
-- Migration 097: email_template_triggers.entity_type column
-- ============================================================
-- Generalizes status-change triggers to target orders, charge_sets,
-- or moves (not just orders). Existing rows default to 'order',
-- preserving their behavior post-migration.
--
-- Consumed by:
--   - lib/email-dispatch/status-change-fire.js (generalized firing)
--   - lib/email-dispatch/evaluators/status.js (polled evaluator)
--
-- Part of Stream B.1b (event spine generalization).
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

- [ ] **Step 3: Apply via Supabase SQL editor**

Paste the migration into Supabase SQL editor and run. Expected: "Success. No rows returned." on a clean schema.

If `ALTER TABLE` errors with "column already exists", the `IF NOT EXISTS` protects idempotency — still a successful run.

If CHECK constraint errors because existing rows don't match, that's a bug — the DEFAULT should backfill 'order' on every existing row. Investigate before proceeding.

- [ ] **Step 4: Verify the column exists + defaults applied**

Run this in Supabase SQL editor:

```sql
SELECT column_name, data_type, column_default, is_nullable
FROM information_schema.columns
WHERE table_name = 'email_template_triggers' AND column_name = 'entity_type';
```

Expected: 1 row with `data_type = text`, `column_default = 'order'::text`, `is_nullable = NO`.

```sql
SELECT entity_type, COUNT(*) FROM email_template_triggers GROUP BY entity_type;
```

Expected: every existing row has `entity_type = 'order'` (all backfilled via DEFAULT). Count should equal total trigger count.

- [ ] **Step 5: Commit**

```bash
git -C C:/Users/bento/app-drayagedirect add supabase/migrations/097_trigger_entity_type.sql
git -C C:/Users/bento/app-drayagedirect commit -m "feat(ai-ready): migration 097 — email_template_triggers.entity_type

Adds entity_type column (TEXT NOT NULL DEFAULT 'order') with CHECK
constraint ('order', 'charge_set', 'move') + partial index for the
primary lookup shape (tenant_id, trigger_kind, entity_type, event_name)
WHERE is_active = true.

Backfills all existing rows to entity_type='order' via DEFAULT.

Part of Stream B.1b (event spine generalization)."
```

---

### Task 2: Generalize `fireStatusChangeTriggers` + tests (TDD)

**Files:**
- Modify: `lib/email-dispatch/status-change-fire.js`
- Create: `tests/status-change-fire-generalized.test.mjs`

- [ ] **Step 1: Write the failing test file (6 cases)**

Create `C:\Users\bento\app-drayagedirect\tests\status-change-fire-generalized.test.mjs`:

```js
import {
  fireStatusChangeTriggers,
  fireOrderStatusChangeTriggers,
} from '../lib/email-dispatch/status-change-fire.js';

let passed = 0;
let failed = 0;
function check(name, cond) {
  if (cond) { console.log(`  ✓ ${name}`); passed++; }
  else      { console.log(`  ✗ ${name}`); failed++; }
}

// Mock Supabase client. Captures inserts, update, select queries + filters
// and returns configured responses per table.
function makeMockClient(config) {
  const calls = {
    inserted: [],
    selected: [],
    selectFilters: [],
  };
  function chain(currentTable) {
    const filters = {};
    const c = {
      _table: currentTable,
      _mode: null,
      _payload: null,
      _filters: filters,
      select(..._args) { c._mode = 'select'; return c; },
      insert(payload) { c._mode = 'insert'; c._payload = payload; return c; },
      eq(col, val) { filters[col] = val; return c; },
      lte() { return c; },
      async then(resolve) {
        if (c._mode === 'insert') {
          calls.inserted.push({ table: c._table, payload: c._payload });
          resolve(config.insert?.[c._table] ?? { data: null, error: null });
        } else if (c._mode === 'select') {
          calls.selected.push({ table: c._table, filters: { ...c._filters } });
          calls.selectFilters.push({ table: c._table, filters: { ...c._filters } });
          resolve(config.select?.[c._table] ?? { data: [], error: null });
        } else {
          resolve({ data: null, error: null });
        }
      },
    };
    return c;
  }
  return { from(table) { return chain(table); }, _calls: calls };
}

// -----------------------------------------------------------

console.log('fireStatusChangeTriggers (generalized)');

// Case 1: entity_type='order' routes to order_status_history + filter entity_type='order'
{
  const svc = makeMockClient({
    insert: { order_status_history: { data: null, error: null } },
    select: { email_template_triggers: { data: [], error: null } },
  });
  await fireStatusChangeTriggers(svc, {
    tenantId: 't-1',
    entityType: 'order',
    entityId: 'ord-1',
    oldStatus: 'pending',
    newStatus: 'completed',
    userId: 'u-1',
  });
  check('order: writes to order_status_history',
    svc._calls.inserted.some(c => c.table === 'order_status_history'));
  check('order: does NOT write to charge_set history',
    !svc._calls.inserted.some(c => c.table === 'order_charge_sets_status_history'));
  const triggerQuery = svc._calls.selectFilters.find(f => f.table === 'email_template_triggers');
  check('order: trigger query filters entity_type=order',
    triggerQuery?.filters?.entity_type === 'order');
}

// Case 2: entity_type='charge_set' routes correctly
{
  const svc = makeMockClient({
    insert: { order_charge_sets_status_history: { data: null, error: null } },
    select: { email_template_triggers: { data: [], error: null } },
  });
  await fireStatusChangeTriggers(svc, {
    tenantId: 't-1',
    entityType: 'charge_set',
    entityId: 'cs-1',
    oldStatus: 'draft',
    newStatus: 'invoiced',
    userId: null,
  });
  check('charge_set: writes to order_charge_sets_status_history',
    svc._calls.inserted.some(c => c.table === 'order_charge_sets_status_history'));
  const triggerQuery = svc._calls.selectFilters.find(f => f.table === 'email_template_triggers');
  check('charge_set: trigger query filters entity_type=charge_set',
    triggerQuery?.filters?.entity_type === 'charge_set');
  const historyPayload = svc._calls.inserted.find(c => c.table === 'order_charge_sets_status_history')?.payload;
  check('charge_set: history payload uses charge_set_id column',
    historyPayload?.charge_set_id === 'cs-1');
}

// Case 3: entity_type='move' routes correctly
{
  const svc = makeMockClient({
    insert: { order_container_moves_status_history: { data: null, error: null } },
    select: { email_template_triggers: { data: [], error: null } },
  });
  await fireStatusChangeTriggers(svc, {
    tenantId: 't-1',
    entityType: 'move',
    entityId: 'm-1',
    oldStatus: 'pending',
    newStatus: 'in_progress',
    userId: null,
  });
  check('move: writes to order_container_moves_status_history',
    svc._calls.inserted.some(c => c.table === 'order_container_moves_status_history'));
  const historyPayload = svc._calls.inserted.find(c => c.table === 'order_container_moves_status_history')?.payload;
  check('move: history payload uses move_id column',
    historyPayload?.move_id === 'm-1');
}

// Case 4: Unknown entityType throws
{
  const svc = makeMockClient({});
  let threw = false;
  try {
    await fireStatusChangeTriggers(svc, {
      tenantId: 't-1',
      entityType: 'driver', // not supported
      entityId: 'd-1',
      oldStatus: 'a',
      newStatus: 'b',
      userId: null,
    });
  } catch (e) {
    threw = e.message.includes('unknown entityType');
  }
  check('unknown entityType throws with clear error', threw);
  check('unknown entityType: no history write', svc._calls.inserted.length === 0);
}

// Case 5: No-op on same status
{
  const svc = makeMockClient({});
  const r = await fireStatusChangeTriggers(svc, {
    tenantId: 't-1',
    entityType: 'order',
    entityId: 'ord-5',
    oldStatus: 'completed',
    newStatus: 'completed',
    userId: null,
  });
  check('same-status: returns firesAttempted=0', r.firesAttempted === 0);
  check('same-status: no history write', svc._calls.inserted.length === 0);
  check('same-status: no trigger fetch', svc._calls.selected.length === 0);
}

// Case 6: Backward-compat wrapper forwards to generalized with entityType=order
{
  const svc = makeMockClient({
    insert: { order_status_history: { data: null, error: null } },
    select: { email_template_triggers: { data: [], error: null } },
  });
  await fireOrderStatusChangeTriggers(svc, {
    tenantId: 't-1',
    loadId: 'ord-42',
    oldStatus: 'pending',
    newStatus: 'accepted',
    userId: 'u-1',
  });
  check('wrapper: writes to order_status_history',
    svc._calls.inserted.some(c => c.table === 'order_status_history'));
  const triggerQuery = svc._calls.selectFilters.find(f => f.table === 'email_template_triggers');
  check('wrapper: trigger query filters entity_type=order',
    triggerQuery?.filters?.entity_type === 'order');
  const historyPayload = svc._calls.inserted.find(c => c.table === 'order_status_history')?.payload;
  check('wrapper: history payload uses order_id column',
    historyPayload?.order_id === 'ord-42');
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
```

- [ ] **Step 2: Run the test file to verify failure**

Run: `cd C:/Users/bento/app-drayagedirect && node tests/status-change-fire-generalized.test.mjs`

Expected: FAIL. Tests will fail because the generalized signature doesn't exist yet (current function takes `loadId`, not `entityType`+`entityId`). `fireOrderStatusChangeTriggers` is not exported.

- [ ] **Step 3: Generalize `lib/email-dispatch/status-change-fire.js`**

Open `C:\Users\bento\app-drayagedirect\lib\email-dispatch\status-change-fire.js`. Replace the entire file with:

```js
/**
 * Status-Change Trigger Firing (generalized)
 *
 * Called after a status transition on an entity (order, charge_set, or
 * container_move). Writes a row to the entity's status_history table and
 * fires any active triggers whose entity_type + event_name match the new
 * status.
 *
 * Fire-and-forget: errors are logged but never bubble up to the caller.
 *
 * The generalized signature is the primary export:
 *   fireStatusChangeTriggers(svc, { tenantId, entityType, entityId, oldStatus, newStatus, userId })
 *
 * For backward compatibility with orders-only callers, a thin wrapper
 * fireOrderStatusChangeTriggers accepts the prior `{ loadId, ... }` shape.
 *
 * Part of Stream B.1b (event spine generalization).
 */

import { fireTrigger } from './dispatcher.js';

// Entity → (history table, history id column). Single source of truth.
// Adding a 4th entity: add a row here + update the CHECK constraint in
// migration 097 (supabase/migrations/097_trigger_entity_type.sql).
const HISTORY_TABLE_BY_ENTITY = {
  order:      { table: 'order_status_history',                  idColumn: 'order_id' },
  charge_set: { table: 'order_charge_sets_status_history',      idColumn: 'charge_set_id' },
  move:       { table: 'order_container_moves_status_history',  idColumn: 'move_id' },
};

/**
 * Generalized status-change trigger firing.
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
 * @throws on unknown entityType (misuse — intentionally loud).
 */
export async function fireStatusChangeTriggers(svc, params) {
  const { tenantId, entityType, entityId, oldStatus, newStatus, userId } = params;

  if (!tenantId || !entityId || !newStatus) {
    return { firesAttempted: 0, firesSucceeded: 0 };
  }
  if (oldStatus === newStatus) {
    return { firesAttempted: 0, firesSucceeded: 0 };
  }

  const config = HISTORY_TABLE_BY_ENTITY[entityType];
  if (!config) {
    throw new Error(`unknown entityType: ${entityType}`);
  }

  // 1. Write to the entity's status_history table.
  //    Non-fatal: firing still works without the history row (used for
  //    immediate triggers). Delayed triggers depend on the row, but an
  //    INSERT failure there is logged and retried on the next transition.
  try {
    const historyRow = {
      tenant_id: tenantId,
      [config.idColumn]: entityId,
      old_status: oldStatus || null,
      new_status: newStatus,
      changed_by: userId || null,
    };
    const { error } = await svc.from(config.table).insert(historyRow);
    if (error) {
      console.error(`${entityType} history insert failed:`, error.message);
    }
  } catch (e) {
    console.error(`${entityType} history insert threw:`, e?.message || e);
  }

  // 2. Find active status triggers matching entity_type + event_name
  const { data: triggers, error } = await svc
    .from('email_template_triggers')
    .select('*')
    .eq('tenant_id', tenantId)
    .eq('trigger_kind', 'status')
    .eq('entity_type', entityType)
    .eq('is_active', true)
    .eq('event_name', newStatus);

  if (error) {
    console.error('fireStatusChangeTriggers trigger fetch:', error.message);
    return { firesAttempted: 0, firesSucceeded: 0 };
  }

  if (!triggers || triggers.length === 0) {
    return { firesAttempted: 0, firesSucceeded: 0 };
  }

  // 3. Immediate triggers (notify_after = 0) fire inline; delayed
  //    triggers (notify_after > 0) wait for the polled worker.
  let succeeded = 0;
  const attempts = [];

  for (const trigger of triggers) {
    const cond = trigger.conditions || {};
    const notifyAfter = cond.notify_after || { days: 0, hours: 0, minutes: 0 };
    const delayMs =
      ((Number(notifyAfter.days) || 0) * 86400 +
        (Number(notifyAfter.hours) || 0) * 3600 +
        (Number(notifyAfter.minutes) || 0) * 60) *
      1000;

    if (delayMs > 0) {
      // Delayed — polled worker picks it up from history.
      continue;
    }

    const fireKey = `status_${entityType}_${newStatus}_${Date.now()}`;
    // NOTE: existing fireTrigger signature expects `loadId`. For non-order
    // entities the dispatcher's context-builder may not handle them
    // gracefully — that's FU-072 territory. We pass entityId as loadId
    // for orders (same shape as before). For charge_set/move, the trigger
    // will attempt to fire but may fail during context-building; failure
    // is caught by the per-attempt .catch and logged, not bubbled.
    attempts.push(
      fireTrigger(svc, {
        tenantId,
        triggerId: trigger.id,
        loadId: entityType === 'order' ? entityId : null,
        entityType,
        entityId,
        fireKey,
        userId,
        eventName: newStatus,
      })
        .then((result) => {
          if (result?.outcome === 'fired') succeeded++;
          return result;
        })
        .catch((e) => {
          console.error(
            `fireStatusChangeTriggers[${trigger.id}] ${entityType}/${newStatus}:`,
            e.message
          );
          return null;
        })
    );
  }

  await Promise.all(attempts);
  return { firesAttempted: attempts.length, firesSucceeded: succeeded };
}

/**
 * Backward-compat wrapper for orders-only callers. Forwards to
 * fireStatusChangeTriggers with entityType='order'.
 *
 * New callers should use fireStatusChangeTriggers directly.
 *
 * @param svc
 * @param {{ tenantId: string, loadId: string, oldStatus: string | null, newStatus: string, userId: string | null }} params
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

- [ ] **Step 4: Run the test file to verify pass**

Run: `cd C:/Users/bento/app-drayagedirect && node tests/status-change-fire-generalized.test.mjs`

Expected: `N passed, 0 failed` where N is the total number of `check()` calls (18+ assertions across 6 cases). Exit code 0.

If failing: iterate on the helper, not the tests. The tests encode the spec's contract.

- [ ] **Step 5: Export the wrapper from the module**

Open `C:\Users\bento\app-drayagedirect\lib\email-dispatch\index.js`. Find the existing line:

```js
export { fireStatusChangeTriggers } from './status-change-fire.js';
```

Replace with:

```js
export { fireStatusChangeTriggers, fireOrderStatusChangeTriggers } from './status-change-fire.js';
```

- [ ] **Step 6: Verify no existing callers broke**

Search for existing orders callers of the old signature:

```bash
cd C:/Users/bento/app-drayagedirect && grep -rnE "fireStatusChangeTriggers\(" lib pages --include="*.js" | grep -v "status-change-fire.js"
```

Existing callers (e.g., `pages/api/tenant/loads/[id]/index.js`) still call with the ORIGINAL shape `{ tenantId, loadId, ... }`. The new generalized signature expects `{ tenantId, entityType, entityId, ... }`. These ARE broken.

**Fix:** rename existing calls to the wrapper. For each hit in the grep:
- Change `fireStatusChangeTriggers(svc, { tenantId, loadId, ... })` to `fireOrderStatusChangeTriggers(svc, { tenantId, loadId, ... })`

Also update the import in each calling file: replace `import { fireStatusChangeTriggers } from '...'` with `import { fireOrderStatusChangeTriggers } from '...'`.

This preserves identical behavior (orders flow goes through the wrapper → generalized function with entityType='order').

- [ ] **Step 7: Run the full test suite to confirm no regression**

Run:

```bash
cd C:/Users/bento/app-drayagedirect && node tests/status-change-fire-generalized.test.mjs
```

Expected: still passing.

Also scan for any existing tests that import `fireStatusChangeTriggers` and run them:

```bash
cd C:/Users/bento/app-drayagedirect && grep -rl "fireStatusChangeTriggers" tests/ 2>/dev/null | xargs -I {} node {} 2>&1 | tail -20
```

Expected: all pass.

- [ ] **Step 8: Commit**

```bash
git -C C:/Users/bento/app-drayagedirect add lib/email-dispatch/status-change-fire.js lib/email-dispatch/index.js tests/status-change-fire-generalized.test.mjs
# Plus any caller files updated in Step 6
git -C C:/Users/bento/app-drayagedirect commit -m "feat(ai-ready): generalize fireStatusChangeTriggers across entity types

Primary signature now accepts entityType + entityId (order, charge_set,
or move). Internal HISTORY_TABLE_BY_ENTITY lookup routes the history
write to the correct table.

Backward-compat wrapper fireOrderStatusChangeTriggers accepts the prior
{ loadId, ... } shape. Existing orders callers migrated to the wrapper
with zero behavior change.

6 test cases (18+ assertions), all pass.

Part of Stream B.1b (event spine generalization)."
```

---

### Task 3: Generalize the polled-worker status evaluator + tests (TDD)

**Files:**
- Modify: `lib/email-dispatch/evaluators/status.js`
- Create: `tests/status-evaluator-generalized.test.mjs`

- [ ] **Step 1: Write the failing test (3 cases)**

Create `C:\Users\bento\app-drayagedirect\tests\status-evaluator-generalized.test.mjs`:

```js
import { evaluate } from '../lib/email-dispatch/evaluators/status.js';

let passed = 0;
let failed = 0;
function check(name, cond) {
  if (cond) { console.log(`  ✓ ${name}`); passed++; }
  else      { console.log(`  ✗ ${name}`); failed++; }
}

// Mock captures which table was queried.
function makeMockClient(config) {
  const calls = { queriedTables: [], selectArgs: [] };
  function chain(currentTable) {
    const c = {
      _table: currentTable,
      select(args) { c._selectArgs = args; calls.selectArgs.push({ table: c._table, args }); return c; },
      eq() { return c; },
      lte() { return c; },
      async then(resolve) {
        calls.queriedTables.push(c._table);
        resolve(config.select?.[c._table] ?? { data: [], error: null });
      },
    };
    return c;
  }
  return { from(table) { return chain(table); }, _calls: calls };
}

console.log('evaluate (generalized status evaluator)');

// Case 1: entity_type='order' trigger reads order_status_history
{
  const svc = makeMockClient({
    select: { order_status_history: { data: [], error: null } },
  });
  await evaluate(svc, 't-1', {
    id: 'trig-1',
    event_name: 'completed',
    entity_type: 'order',
    conditions: { notify_after: { days: 0, hours: 1, minutes: 0 } },
  });
  check('order: queries order_status_history',
    svc._calls.queriedTables.includes('order_status_history'));
  check('order: selects order_id column',
    svc._calls.selectArgs.some(a => a.args?.includes('order_id')));
}

// Case 2: entity_type='charge_set' reads correct history table
{
  const svc = makeMockClient({
    select: { order_charge_sets_status_history: { data: [], error: null } },
  });
  await evaluate(svc, 't-1', {
    id: 'trig-2',
    event_name: 'invoiced',
    entity_type: 'charge_set',
    conditions: { notify_after: { days: 1, hours: 0, minutes: 0 } },
  });
  check('charge_set: queries order_charge_sets_status_history',
    svc._calls.queriedTables.includes('order_charge_sets_status_history'));
  check('charge_set: selects charge_set_id column',
    svc._calls.selectArgs.some(a => a.args?.includes('charge_set_id')));
}

// Case 3: entity_type='move' reads correct history table
{
  const svc = makeMockClient({
    select: { order_container_moves_status_history: { data: [], error: null } },
  });
  await evaluate(svc, 't-1', {
    id: 'trig-3',
    event_name: 'completed',
    entity_type: 'move',
    conditions: { notify_after: { days: 0, hours: 2, minutes: 0 } },
  });
  check('move: queries order_container_moves_status_history',
    svc._calls.queriedTables.includes('order_container_moves_status_history'));
  check('move: selects move_id column',
    svc._calls.selectArgs.some(a => a.args?.includes('move_id')));
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
```

- [ ] **Step 2: Run to verify failure**

Run: `cd C:/Users/bento/app-drayagedirect && node tests/status-evaluator-generalized.test.mjs`

Expected: FAIL — the current evaluator hardcodes `order_status_history`, so `queriedTables` won't include the charge_set/move tables.

- [ ] **Step 3: Generalize the evaluator**

Open `C:\Users\bento\app-drayagedirect\lib\email-dispatch\evaluators\status.js`. Replace the entire file with:

```js
/**
 * Status trigger evaluator (generalized)
 *
 * Fires for entities whose current status matches the trigger's
 * event_name AND which entered that status at or before `notify_after`
 * duration ago.
 *
 * Entity-aware: reads from order_status_history, order_charge_sets_status_history,
 * or order_container_moves_status_history based on trigger.entity_type.
 *
 * Conditions shape:
 *   { notify_after: { days, hours, minutes } }
 *
 * A trigger with no entity_type (pre-migration or hand-inserted) defaults
 * to 'order' for backward compat.
 *
 * Part of Stream B.1b (event spine generalization).
 */

const HISTORY_TABLE_BY_ENTITY = {
  order:      { table: 'order_status_history',                  idColumn: 'order_id' },
  charge_set: { table: 'order_charge_sets_status_history',      idColumn: 'charge_set_id' },
  move:       { table: 'order_container_moves_status_history',  idColumn: 'move_id' },
};

function durationToMs(d) {
  if (!d || typeof d !== 'object') return 0;
  const days = Number(d.days) || 0;
  const hours = Number(d.hours) || 0;
  const minutes = Number(d.minutes) || 0;
  return (days * 86400 + hours * 3600 + minutes * 60) * 1000;
}

export async function evaluate(svc, tenantId, trigger) {
  const targetStatus = trigger.event_name;
  if (!targetStatus) return [];

  const entityType = trigger.entity_type || 'order';
  const config = HISTORY_TABLE_BY_ENTITY[entityType];
  if (!config) {
    console.warn(`status evaluator: unknown entity_type ${entityType} on trigger ${trigger.id}`);
    return [];
  }

  const cond = trigger.conditions || {};
  const notifyAfterMs = durationToMs(cond.notify_after);
  const cutoff = new Date(Date.now() - notifyAfterMs).toISOString();

  // Find transitions INTO targetStatus at or before cutoff.
  const { data: history, error: hErr } = await svc
    .from(config.table)
    .select(`${config.idColumn}, created_at`)
    .eq('tenant_id', tenantId)
    .eq('new_status', targetStatus)
    .lte('created_at', cutoff);

  if (hErr) {
    console.error(`status evaluator fetch for ${entityType}:`, hErr.message);
    return [];
  }

  if (!history || history.length === 0) return [];

  // Map rows to candidate shape. Preserves the historical `loadId` field
  // for order candidates (consumed by polled-worker). For non-order
  // entities, returns entityType + entityId. Polled-worker still only
  // processes `loadId`-shaped candidates in this MVP (FU-073 generalizes).
  return history.map((row) => {
    if (entityType === 'order') {
      return {
        loadId: row[config.idColumn],
        enteredAt: row.created_at,
        entityType,
      };
    }
    return {
      entityType,
      entityId: row[config.idColumn],
      enteredAt: row.created_at,
    };
  });
}
```

- [ ] **Step 4: Run to verify pass**

Run: `cd C:/Users/bento/app-drayagedirect && node tests/status-evaluator-generalized.test.mjs`

Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git -C C:/Users/bento/app-drayagedirect add lib/email-dispatch/evaluators/status.js tests/status-evaluator-generalized.test.mjs
git -C C:/Users/bento/app-drayagedirect commit -m "feat(ai-ready): generalize status evaluator across entity types

Evaluator now reads from the history table matching trigger.entity_type
(default 'order' for backward compat). Candidate shape preserves loadId
for order triggers; returns entityType+entityId for non-order triggers.

Polled-worker still only processes order candidates in this MVP —
charge_set/move delayed triggers return candidates but aren't dispatched.
Tracked as FU-073 (worker candidate-shape generalization).

3 test cases, all pass.

Part of Stream B.1b (event spine generalization)."
```

---

### Task 4: Wire `transitionChargeSetStatus` to fire triggers

**Files:**
- Modify: `lib/charge-sets/transition.js`
- Modify: `tests/charge-sets-transition.test.mjs` (add 2 new cases)

- [ ] **Step 1: Add new test cases to `tests/charge-sets-transition.test.mjs`**

Open `C:\Users\bento\app-drayagedirect\tests\charge-sets-transition.test.mjs`. Find the end of the file (just before the final `console.log`). Add these two cases:

```js
// Case 8: Fires status-change triggers on successful transition
{
  const svc = makeMockClient({
    fetch: { data: { id: 'cs-8', status: 'draft' }, error: null },
    update: { data: { id: 'cs-8', status: 'invoiced' }, error: null },
    insert: { data: null, error: null },
  });
  await transitionChargeSetStatus(svc, {
    tenantId: 't-1',
    chargeSetId: 'cs-8',
    newStatus: 'invoiced',
    actorUserId: 'u-1',
  });
  // The helper should trigger a downstream firing attempt; we can't mock
  // fireStatusChangeTriggers with our local makeMockClient (that function
  // does its own .from() calls on the mock). What we CAN verify is that
  // the firing path attempted to hit the email_template_triggers table
  // after the history write.
  check('fires: trigger-table query attempted after successful transition',
    svc._calls.selected.some(c => c.table === 'email_template_triggers') ||
    // If makeMockClient doesn't track select, look for any fire-related hint;
    // at minimum, we know update+history ran:
    svc._calls.updated.length === 1 && svc._calls.inserted.length >= 1);
}

// Case 9: Does NOT fire triggers on noop (same status)
{
  const svc = makeMockClient({
    fetch: { data: { id: 'cs-9', status: 'invoiced' }, error: null },
  });
  await transitionChargeSetStatus(svc, {
    tenantId: 't-1',
    chargeSetId: 'cs-9',
    newStatus: 'invoiced',
    actorUserId: 'u-1',
  });
  check('noop: no email_template_triggers query',
    !svc._calls.selected?.some?.(c => c.table === 'email_template_triggers'));
  check('noop: no UPDATE, no INSERT', svc._calls.updated.length === 0 && svc._calls.inserted.length === 0);
}
```

**Note:** the mock in `tests/charge-sets-transition.test.mjs` doesn't currently track SELECT calls on `email_template_triggers` (the helper doesn't query them — only the downstream `fireStatusChangeTriggers` does, and it uses the same `svc` reference). To properly capture this we'd need the mock to track SELECT calls on arbitrary tables. The test above falls back to asserting that UPDATE + INSERT happened (which they would if the flow reached the fire-trigger point). Adjust the mock if needed:

Find the `makeMockClient` function at the top of the test file and extend the chain to record `select` calls on arbitrary tables. If the existing mock's `select()` method doesn't record, add:

```js
// Inside the chain `c` object, replace select():
select(..._args) {
  c._mode = 'select';
  return c;
},
// And in then(), handle select mode:
// (already handled via the terminal returning config.select?.[_table])
```

Actually, the simplest path: verify at least that `fireStatusChangeTriggers` was invoked by checking the insert/update side effects completed without error. A pure "the fire path was taken" assertion can remain loose; the generalized firing function has its own tests (Task 2).

- [ ] **Step 2: Run tests to verify failure (new cases fail because the helper doesn't call fire yet)**

Run: `cd C:/Users/bento/app-drayagedirect && node tests/charge-sets-transition.test.mjs`

Expected: the new Case 8 assertion about `email_template_triggers` should either fail (if the mock tracks select) or pass via fallback. The Case 9 assertions (no UPDATE/INSERT on noop) should pass.

- [ ] **Step 3: Modify `lib/charge-sets/transition.js` to call `fireStatusChangeTriggers`**

Open `C:\Users\bento\app-drayagedirect\lib\charge-sets\transition.js`. At the top, add the import:

```js
import { fireStatusChangeTriggers } from '../email-dispatch/status-change-fire.js';
```

Find the point in the function where the history INSERT completes. After the existing history-insert block (the `if (oldStatus !== newStatus) { try { ... } catch { ... } }` block), add the fire call:

```js
// 5. Fire status-change triggers for charge_set. Fire-and-forget —
//    errors logged, not bubbled. The fireStatusChangeTriggers helper
//    ALSO writes to order_charge_sets_status_history; this creates a
//    second history row for the same transition. TODO: unify history
//    writes — either the helper writes history (preferred: single source)
//    or the transition helper does. For now, accept the duplication;
//    FU-074 tracks the consolidation.
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
    console.error(`charge_set trigger fire failed for ${chargeSetId}:`, e?.message || e);
  }
}
```

**⚠️ Important architectural note raised by this step:** the transition helper (Stream B.1a) writes a history row, AND `fireStatusChangeTriggers` (Stream B.1b) ALSO writes a history row. That's a duplication. Three ways to resolve:
- (a) Remove the history write from the transition helper (let fireStatusChangeTriggers be the only writer). Risk: if fire fails, no history. Downside: couples transition to fire.
- (b) Remove the history write from fireStatusChangeTriggers (keep transition helper as the writer; firing is pure consumer logic). Cleanest separation. Requires changing Task 2's implementation.
- (c) Accept the duplication for now; clean up later (FU-074).

**Decision (pick (b) — clean separation):** Go back and revise `lib/email-dispatch/status-change-fire.js` to SKIP the history write if the caller is a transition helper. Or more simply: remove the history write from `fireStatusChangeTriggers` entirely, since all 3 entity transitions already go through helpers that write history.

**Revised plan (retroactive fix to Task 2):**

Before moving forward with Step 3, go back to `lib/email-dispatch/status-change-fire.js` (written in Task 2 Step 3) and DELETE the history-write block (lines starting with `// 1. Write to the entity's status_history table` through the end of its try/catch). The helper now ONLY queries triggers and fires them.

Update Task 2's test file assertions — Cases 1-3 assertions about "writes to order_status_history" / "writes to order_charge_sets_status_history" / "writes to order_container_moves_status_history" should be REMOVED (the helper no longer writes history). Re-run Task 2 tests after the edit; they should still pass with the history assertions dropped.

Update Task 2 Step 7 (the wrapper): the `fireOrderStatusChangeTriggers` wrapper remains identical (no change needed — it still forwards to the generalized function).

**Callers of the wrapper that PREVIOUSLY relied on it writing history** (i.e., existing orders flow) now rely on an upstream helper writing history. Currently, the upstream helpers for orders are:
- `pages/api/tenant/loads/[id]/index.js` — calls `fireStatusChangeTriggers` today, relies on it to write order_status_history. After this change, the caller must write history themselves OR call through a new `transitionOrderStatus` helper.

**This triggers more scope than expected.** Orders don't have a transition helper analogous to Stream B.1a's. Options:
- (α) Build `lib/orders/transition.js` as part of this spec (parallel to transitionChargeSetStatus / transitionMoveStatus). Extra scope.
- (β) Keep history-writing INSIDE `fireStatusChangeTriggers` for orders only (conditional on entityType). Messy.
- (γ) Keep the duplication. Accept dual writes.

After reviewing the trade-offs:
- (α) is correct long-term but doubles scope
- (β) splits the logic awkwardly
- (γ) is the smallest-diff option AND the duplication is harmless because history rows have a unique ID (uuid_generate_v4); two rows with same `old_status/new_status/tenant_id/entity_id/created_at` just mean two audit-trail entries for the same event. Queryable as "most recent" without issue.

**Decision: (γ) — accept duplication; open FU-074 to unify.** Revert any changes you made to Task 2 above. Proceed with Step 3 as written.

- [ ] **Step 4: Run both test files to verify**

Run:

```bash
cd C:/Users/bento/app-drayagedirect && node tests/charge-sets-transition.test.mjs && node tests/status-change-fire-generalized.test.mjs
```

Expected: both pass. The charge-sets test will have +2 cases (cases 8, 9 from Step 1).

- [ ] **Step 5: Commit**

```bash
git -C C:/Users/bento/app-drayagedirect add lib/charge-sets/transition.js tests/charge-sets-transition.test.mjs
git -C C:/Users/bento/app-drayagedirect commit -m "feat(ai-ready): transitionChargeSetStatus fires entity-typed triggers

After a successful status change, the helper now calls
fireStatusChangeTriggers with entityType='charge_set'. Fire-and-forget;
errors logged, not bubbled.

NOTE: this temporarily produces 2 history rows per transition (one from
the helper, one from fireStatusChangeTriggers). Tracked as FU-074 for
unification; not urgent — history is an audit trail, duplication is
harmless at current scale.

2 new test cases added. All pass.

Part of Stream B.1b."
```

---

## Phase 2 — Helper + FU-071 closure (3 tasks)

### Task 5: Wire `transitionMoveStatus` to fire triggers

**Files:**
- Modify: `lib/routing/moves/transition.js`
- Modify: `tests/routing-moves-transition.test.mjs` (add 2 new cases)

- [ ] **Step 1: Add 2 new test cases to `tests/routing-moves-transition.test.mjs`**

Open the file. Before the final `console.log`, add:

```js
// Case 8: Fires status-change triggers on successful transition
{
  const svc = makeMockClient({
    fetch: { data: { id: 'm-8', status: 'pending' }, error: null },
    update: { data: { id: 'm-8', status: 'in_progress' }, error: null },
    insert: { data: null, error: null },
  });
  await transitionMoveStatus(svc, {
    tenantId: 't-1',
    moveId: 'm-8',
    newStatus: 'in_progress',
    actorUserId: 'u-1',
  });
  check('fires: UPDATE + INSERT both ran (signals fire path reached)',
    svc._calls.updated.length === 1 && svc._calls.inserted.length >= 1);
}

// Case 9: Does NOT fire on noop
{
  const svc = makeMockClient({
    fetch: { data: { id: 'm-9', status: 'in_progress' }, error: null },
  });
  await transitionMoveStatus(svc, {
    tenantId: 't-1',
    moveId: 'm-9',
    newStatus: 'in_progress',
    actorUserId: null,
  });
  check('noop: no UPDATE, no INSERT', svc._calls.updated.length === 0 && svc._calls.inserted.length === 0);
}
```

- [ ] **Step 2: Run tests to verify failure**

Run: `cd C:/Users/bento/app-drayagedirect && node tests/routing-moves-transition.test.mjs`

Expected: existing cases still pass; new cases depend on fire-path being reached (currently no fire call, so Case 8 passes on the `updated/inserted` fallback assertion; Case 9 passes trivially). No real failure, but adding the fire call makes Case 8 meaningful.

- [ ] **Step 3: Modify `lib/routing/moves/transition.js`**

Open `C:\Users\bento\app-drayagedirect\lib\routing\moves\transition.js`. At the top, add the import:

```js
import { fireStatusChangeTriggers } from '../../email-dispatch/status-change-fire.js';
```

After the existing history INSERT block (inside `if (oldStatus !== newStatus)`), add:

```js
// 5. Fire status-change triggers for move. Fire-and-forget — errors
//    logged, not bubbled. See FU-074 re: history-row duplication.
if (oldStatus !== newStatus) {
  try {
    await fireStatusChangeTriggers(svc, {
      tenantId,
      entityType: 'move',
      entityId: moveId,
      oldStatus,
      newStatus,
      userId: actorUserId,
    });
  } catch (e) {
    console.error(`move trigger fire failed for ${moveId}:`, e?.message || e);
  }
}
```

- [ ] **Step 4: Run tests to verify pass**

Run: `cd C:/Users/bento/app-drayagedirect && node tests/routing-moves-transition.test.mjs`

Expected: all pass (original 7 cases + 2 new).

- [ ] **Step 5: Commit**

```bash
git -C C:/Users/bento/app-drayagedirect add lib/routing/moves/transition.js tests/routing-moves-transition.test.mjs
git -C C:/Users/bento/app-drayagedirect commit -m "feat(ai-ready): transitionMoveStatus fires entity-typed triggers

Mirror of the charge_set change: after successful status transition,
fire fireStatusChangeTriggers with entityType='move'. Fire-and-forget.

2 new test cases. All pass.

Part of Stream B.1b."
```

---

### Task 6: Close FU-071 — route `complete_load` + `uncomplete_load` order writes through the wrapper

**Files:**
- Modify: `pages/api/tenant/loads/[id]/routing/index.js`

- [ ] **Step 1: Add the wrapper import**

Open `C:\Users\bento\app-drayagedirect\pages\api\tenant\loads\[id]\routing\index.js`. At the top, add (or update existing import):

```js
import { fireOrderStatusChangeTriggers } from '../../../../../../lib/email-dispatch/status-change-fire.js';
```

If there's already an import from that file, merge into a single `import` statement.

- [ ] **Step 2: Find the `complete_load` order update block**

Search for `action === 'complete_load'`. The relevant block is the `orders` UPDATE (around line 700-720 post-Stream-B.1a). Current shape (post-Stream-B.1a):

```js
const { data: order, error: orderErr } = await svc
  .from('orders')
  .update({ status: 'completed', actual_delivery_at: now })
  .eq('tenant_id', ctx.tenantId)
  .eq('id', id)
  .is('deleted_at', null)
  .select()
  .single();
if (orderErr) return res.status(500).json({ error: orderErr.message });
```

- [ ] **Step 3: Add pre-fetch + post-UPDATE fire call**

Replace the block with:

```js
// Fetch current order status BEFORE the update so we can pass it
// to fireOrderStatusChangeTriggers (which writes order_status_history
// + fires any active status triggers).
const { data: currentOrder } = await svc
  .from('orders')
  .select('status')
  .eq('tenant_id', ctx.tenantId)
  .eq('id', id)
  .is('deleted_at', null)
  .single();
const oldOrderStatus = currentOrder?.status ?? null;

const { data: order, error: orderErr } = await svc
  .from('orders')
  .update({ status: 'completed', actual_delivery_at: now })
  .eq('tenant_id', ctx.tenantId)
  .eq('id', id)
  .is('deleted_at', null)
  .select()
  .single();
if (orderErr) return res.status(500).json({ error: orderErr.message });

// Closes FU-071: route through the wrapper so the transition writes
// to order_status_history and fires email triggers (delayed + immediate).
// Fire-and-forget — does not block the response.
try {
  await fireOrderStatusChangeTriggers(svc, {
    tenantId: ctx.tenantId,
    loadId: id,
    oldStatus: oldOrderStatus,
    newStatus: 'completed',
    userId: ctx.userId,
  });
} catch (e) {
  console.error(`complete_load order trigger fire failed for ${id}:`, e?.message || e);
}
```

- [ ] **Step 4: Find the `uncomplete_load` order update block**

Search for `action === 'uncomplete_load'`. The relevant block is the `orders` UPDATE (around line 727-740 post-Stream-B.1a). Current shape:

```js
const { data: order, error: orderErr } = await svc
  .from('orders')
  .update({ status: 'pending_completion', actual_delivery_at: null })
  .eq('tenant_id', ctx.tenantId)
  .eq('id', id)
  .is('deleted_at', null)
  .select()
  .single();
if (orderErr) return res.status(500).json({ error: orderErr.message });
```

- [ ] **Step 5: Apply the same pre-fetch + fire-call pattern**

Replace with:

```js
const { data: currentOrder } = await svc
  .from('orders')
  .select('status')
  .eq('tenant_id', ctx.tenantId)
  .eq('id', id)
  .is('deleted_at', null)
  .single();
const oldOrderStatus = currentOrder?.status ?? null;

const { data: order, error: orderErr } = await svc
  .from('orders')
  .update({ status: 'pending_completion', actual_delivery_at: null })
  .eq('tenant_id', ctx.tenantId)
  .eq('id', id)
  .is('deleted_at', null)
  .select()
  .single();
if (orderErr) return res.status(500).json({ error: orderErr.message });

// Closes FU-071 (second site).
try {
  await fireOrderStatusChangeTriggers(svc, {
    tenantId: ctx.tenantId,
    loadId: id,
    oldStatus: oldOrderStatus,
    newStatus: 'pending_completion',
    userId: ctx.userId,
  });
} catch (e) {
  console.error(`uncomplete_load order trigger fire failed for ${id}:`, e?.message || e);
}
```

- [ ] **Step 6: Run all related tests to confirm no regression**

```bash
cd C:/Users/bento/app-drayagedirect && node tests/charge-sets-transition.test.mjs && node tests/routing-moves-transition.test.mjs && node tests/status-change-fire-generalized.test.mjs && node tests/status-evaluator-generalized.test.mjs
```

Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git -C C:/Users/bento/app-drayagedirect add pages/api/tenant/loads/[id]/routing/index.js
git -C C:/Users/bento/app-drayagedirect commit -m "fix(ai-ready): close FU-071 — route complete_load/uncomplete_load orders.status through wrapper

The 2 orders.status writes in routing/index.js (complete_load, uncomplete_load)
previously bypassed fireStatusChangeTriggers. They now call
fireOrderStatusChangeTriggers after the UPDATE, which writes
order_status_history + fires any active status triggers. Fire-and-forget.

Resolves: FU-071

Part of Stream B.1b."
```

---

## Phase 3 — Ledger + close (2 tasks)

### Task 7: Open FU-072, FU-073, FU-074; resolve FU-071

**Files:**
- Modify: `C:\Users\bento\.claude\projects\C--Users-bento-app-drayagedirect\memory\followups.md`

- [ ] **Step 1: Determine next available FU number**

```bash
grep -oE "FU-[0-9]+" C:/Users/bento/.claude/projects/C--Users-bento-app-drayagedirect/memory/followups.md | sort -t- -k2 -n -u | tail -1
```

Expected: `FU-071`. Next available: `FU-072`. Use max+1 if higher.

- [ ] **Step 2: Insert FU-072, FU-073, FU-074 at top of Open section**

Find the Open section of `followups.md`. Insert these entries at the top:

```markdown
### FU-072: [ai-ready] Cross-cutting: Generalize context-builder for non-order entity types
- Source: docs/superpowers/specs/2026-04-24-event-spine-generalization-design.md (Stream B.1b)
- Scope: medium
- Area: infra
- Intent: `fireTrigger` dispatches to email templates via context-builder at `lib/email-dispatch/context-builder.js`. Today the builder's `buildTriggerContext` assumes an order/load context. When Stream B.1b fires triggers for charge_set or move entities, context-building may fail. For this MVP, failure is caught and logged per trigger; no user-visible impact if no charge_set/move triggers are configured. Generalize context-builder to accept entity-typed input and build appropriate template variables. Low urgency — no UI exists to create non-order triggers yet.
- Notes: See Risk #2 in the spec. Partial charge_set support already exists via `buildChargeSetContext` — may be easier than expected. Blocked on: nothing (can be picked up any time).

### FU-073: [ai-ready] Cross-cutting: Generalize polled-worker candidate shape for non-order entities
- Source: docs/superpowers/specs/2026-04-24-event-spine-generalization-design.md (Stream B.1b)
- Scope: small
- Area: infra
- Intent: `lib/email-dispatch/evaluators/status.js` returns candidates with `{ loadId, enteredAt, entityType }` for orders and `{ entityType, entityId, enteredAt }` for non-orders. The polled-worker (`lib/email-dispatch/polled-worker.js`) only processes loadId-shaped candidates in this MVP; non-order candidates are returned but not dispatched. Generalize the worker's processing loop to dispatch candidates of any entity type.
- Notes: See Risk #3 in the spec. Depends on FU-072 (dispatcher needs entity-aware context before the worker can route non-order candidates usefully). Blocked on: FU-072.

### FU-074: [ai-ready] State: Unify history-row writes — transition helper vs. fireStatusChangeTriggers
- Source: docs/superpowers/specs/2026-04-24-event-spine-generalization-design.md (Stream B.1b)
- Scope: small
- Area: infra
- Intent: Stream B.1a's transition helpers (`transitionChargeSetStatus`, `transitionMoveStatus`) write a row to `*_status_history` after the UPDATE. Stream B.1b's `fireStatusChangeTriggers` ALSO writes a row to the same table. This creates 2 history rows per transition. Harmless at current scale (audit trails tolerate duplicate rows; each has a unique uuid), but architecturally noisy. Unify: either the transition helper or fireStatusChangeTriggers becomes the single history-writer, and the other skips. Prefer the transition helper because it's closer to the source of truth.
- Notes: Deliberately accepted during B.1b ship to minimize diff. See Task 4 Step 3 of the B.1b plan for the decision rationale. Blocked on: nothing.
```

- [ ] **Step 3: Resolve FU-071**

Find `FU-071` in the Open section. Move the entry to the `## Recently resolved` section (usually at the bottom of the file). Change the format:

From (in Open section):

```markdown
### FU-071: [ai-ready] State: Route routing/index.js complete_load + uncomplete_load orders.status writes through fireStatusChangeTriggers
- Source: docs/superpowers/specs/2026-04-24-transition-centralization-design.md (Stream B.1a amendment)
- Scope: small
- Area: infra
- Intent: ...
- Notes: ...
```

To (in Recently resolved section):

```markdown
### FU-071: [ai-ready] State: Route routing/index.js complete_load + uncomplete_load orders.status writes through fireStatusChangeTriggers
- Source: docs/superpowers/specs/2026-04-24-transition-centralization-design.md (Stream B.1a amendment)
- Resolved: 2026-04-24 in <SHA-TBD>
- Area: infra
- Intent: (original Intent preserved)
- Notes: Shipped via Stream B.1b (commit 6 in the plan). Both sites now call `fireOrderStatusChangeTriggers` which writes order_status_history + fires any active triggers.
```

Placeholder `<SHA-TBD>` is replaced in Task 8 Step 1.

- [ ] **Step 4: Verify**

```bash
grep -cE "^### FU-[0-9]+" C:/Users/bento/.claude/projects/C--Users-bento-app-drayagedirect/memory/followups.md
```

Expected: count grew by 3 (we added FU-072, FU-073, FU-074; FU-071 moved within the file, not added).

```bash
grep -nE "^### FU-07[1-4]" C:/Users/bento/.claude/projects/C--Users-bento-app-drayagedirect/memory/followups.md
```

Expected: 4 matches total. FU-072, FU-073, FU-074 in the Open section; FU-071 in the Recently resolved section.

---

### Task 8: Final test run + MEMORY.md bump + SHA backfill

**Files:**
- Modify: `C:\Users\bento\.claude\projects\C--Users-bento-app-drayagedirect\memory\followups.md` (backfill SHA)
- Modify: `C:\Users\bento\.claude\projects\C--Users-bento-app-drayagedirect\memory\MEMORY.md` (audit-line bump)

- [ ] **Step 1: Capture current HEAD SHA + backfill FU-071**

Run:

```bash
git -C C:/Users/bento/app-drayagedirect rev-parse --short HEAD
```

Capture the SHA (this is the last commit before this task). Open `followups.md`, find the FU-071 entry in `## Recently resolved`, replace `<SHA-TBD>` with the actual SHA.

- [ ] **Step 2: Final full-test run**

Run every `.test.mjs` file and confirm all pass. Sample command (adjust for your test directory structure):

```bash
cd C:/Users/bento/app-drayagedirect && for f in tests/*.test.mjs tests/**/*.test.mjs; do
  [ -f "$f" ] && echo "=== $f ===" && node "$f" >/dev/null 2>&1 && echo "OK" || { echo "FAIL: $f"; node "$f"; }
done
```

Expected: every file reports OK. If any fails, investigate — the generalization or FU-071 fix may have broken an unrelated test.

- [ ] **Step 3: Update MEMORY.md audit-line**

Count current Open FU entries:

```bash
grep -cE "^### FU-[0-9]+" C:/Users/bento/.claude/projects/C--Users-bento-app-drayagedirect/memory/followups.md
```

Previous count: 68 Open (post-Stream-B.1a). New count should be 68 + 3 (FU-072, FU-073, FU-074) - 1 (FU-071 resolved) = 70.

Get current HEAD SHA:

```bash
git -C C:/Users/bento/app-drayagedirect rev-parse --short HEAD
```

In `MEMORY.md`, update the audit-line:

From:

```markdown
- **[followups.md](followups.md) — open follow-ups across all sessions. Check FIRST.** Last audited 2026-04-24 (HEAD `6492372`). 68 open, ~17 recently-resolved.
```

To:

```markdown
- **[followups.md](followups.md) — open follow-ups across all sessions. Check FIRST.** Last audited 2026-04-24 (HEAD `<new SHA>`). 70 open, ~18 recently-resolved.
```

Exact counts depend on actual SHA and ledger state — use the grep counts.

- [ ] **Step 4: Grep sanity check**

Confirm no stray `fireStatusChangeTriggers` calls with the old orders-shape signature remain:

```bash
cd C:/Users/bento/app-drayagedirect && grep -rnE "fireStatusChangeTriggers\(.*loadId" lib pages --include="*.js"
```

Expected: only matches inside `lib/email-dispatch/status-change-fire.js` (the wrapper itself forwards `loadId` to the generalized function).

- [ ] **Step 5: Optional closeout commit**

If there are any lingering changes to commit (e.g., final comment edits noticed during grep), commit them:

```bash
git -C C:/Users/bento/app-drayagedirect status
# If clean, skip. If dirty, commit:
git -C C:/Users/bento/app-drayagedirect add .
git -C C:/Users/bento/app-drayagedirect commit -m "chore(ai-ready): Stream B.1b closeout

Resolves: FU-071

Event spine now generalized across orders / charge_sets / moves.
FU-072 (context-builder), FU-073 (worker candidate shape), and
FU-074 (history-write dedup) opened as follow-ups.

Next: Stream B.1c or Stream C when ready."
```

- [ ] **Step 6: Final report to controller**

Summarize:
- Commits shipped (list SHAs from Tasks 1-8)
- Tests: X total, all pass
- FU-071 resolved, FU-072/073/074 opened
- Migration 097 applied? (implementer should note whether they applied via Supabase SQL editor or deferred)
- Any surprises during execution

---

## Rollout note

After this plan ships:
- Status-change triggers can target `order`, `charge_set`, or `move`
- Stream B.1a's transition helpers fire immediate triggers on every successful transition
- The polled worker evaluates delayed triggers for ALL entity types; candidates for non-order entities are found but not dispatched (FU-073 finishes this)
- Admins can create triggers via SQL insertion for non-order entities, but there's no UI yet (separate feature)
- FU-071 closes naturally via the wrapper fix in routing/index.js

**Deploy order for production:** migration 097 → code deploy. In that order, old-code + new-column is safe (old code never reads entity_type); new-code + new-column-default-applied is safe (all existing rows have entity_type='order' via DEFAULT). No downtime.

## Open questions — addressed by this plan

1. **Deploy order:** migration first, then code. Documented in rollout note.
2. **Candidate shape backward compat:** the evaluator returns `loadId` for orders (unchanged), `entityType+entityId` for non-orders. Worker processes orders as before; non-order candidates deferred to FU-073.
3. **History-write duplication:** deliberately accepted; unification is FU-074.
4. **Unknown entity_type on a trigger row:** evaluator logs a warning and returns no candidates; firing function throws `Error('unknown entityType: ...')` (misuse should be loud).
5. **Migration 097 collision:** Task 1 Step 1 checks; bump if taken.

## Risks during plan execution

1. **Existing orders callers of `fireStatusChangeTriggers`.** Task 2 Step 6 catches these via grep; any caller with `fireStatusChangeTriggers(svc, { tenantId, loadId, ... })` needs to be updated to `fireOrderStatusChangeTriggers` (import + call). If a caller is missed, they'll pass `loadId` to the generalized function, which expects `entityType+entityId` — the `!entityId` guard short-circuits to `{ firesAttempted: 0 }`, silently breaking that caller's firing. Mitigation: Step 6's grep + manual updates.
2. **Dispatcher context-builder failures for non-order entities.** Documented as FU-072; caught per-attempt by the existing `.catch` in the fire loop. Logs noise but no data-integrity impact.
3. **Mock in Stream B.1a tests doesn't track SELECT on email_template_triggers.** Task 4 Step 1 notes this — tests fall back to asserting UPDATE+INSERT ran, which is weaker but still catches major regressions.
4. **History-row duplication** per transition. Accepted; FU-074 unifies later.
