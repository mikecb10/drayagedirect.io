# Transition Centralization Implementation Plan (Stream B.1a)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship two entity-scoped status-transition helpers (`transitionChargeSetStatus` and `transitionMoveStatus`) + one migration adding two `*_status_history` tables, then swap 10 scattered call sites through the helpers. Closes FU-055 + FU-056. Pure refactor — no architecture change, no API contract change. De-risks Stream B.1b (event spine) by giving it clean call sites to instrument.

**Architecture:** Two helper files at `lib/charge-sets/transition.js` and `lib/routing/moves/transition.js`, each exporting one async function with signature `(svc, { tenantId, entityId, newStatus, actorUserId, extraFields? }) → { oldStatus, newStatus, row }`. Each helper mirrors the existing `fireStatusChangeTriggers` pattern: UPDATE entity status + extra co-written columns, INSERT history row, log-and-continue on history failure. Bulk call sites convert to fetch-then-loop-serial through the helper.

**Tech Stack:** Node.js 20+ (no transpile), plain ESM. Supabase JS client. Hand-rolled `.test.mjs` tests run directly via `node tests/<file>.test.mjs` (existing codebase convention — see `tests/dry-run-engine.test.mjs` for reference). Postgres 15 via Supabase CLI. Migration template per `memory/dev_migration_template.md` (BEGIN/COMMIT + NOTIFY pgrst).

**Spec:** [docs/superpowers/specs/2026-04-24-transition-centralization-design.md](docs/superpowers/specs/2026-04-24-transition-centralization-design.md) (amended as of commit `5c96b34`)

**FU baseline:** current max is `FU-070`. This plan opens exactly one new FU (FU-071) in Task 12 for the 2 out-of-scope `orders.status` writes. It closes FU-055 + FU-056 via a `Resolves:` line in the final commit.

**Migration number baseline:** latest in `supabase/migrations/` is `095_invoice_rebill_lineage.sql`. This plan adds `096_charge_set_and_move_status_history.sql`. Task 1 verifies 096 is still free before writing.

**Files touched by this plan:**

| Type | File |
|---|---|
| Create | `supabase/migrations/096_charge_set_and_move_status_history.sql` |
| Create | `lib/charge-sets/transition.js` |
| Create | `lib/routing/moves/transition.js` |
| Create | `tests/charge-sets-transition.test.mjs` |
| Create | `tests/routing-moves-transition.test.mjs` |
| Modify | `pages/api/tenant/ar/invoices/index.js` (bulk site, line 457-461) |
| Modify | `pages/api/tenant/ar/invoices/[invoiceId].js` (bulk site, line 138-142) |
| Modify | `pages/api/tenant/ar/charge-sets/bulk-send-rate-con.js` (bulk site, line 272-277) |
| Modify | `pages/api/tenant/ar/charge-sets/[id]/send-rate-con-email.js` (single site, line 149-153) |
| Modify | `pages/api/tenant/loads/[id]/charge-sets/[csId].js` (single multi-field PUT, line 133-139) |
| Modify | `pages/api/tenant/loads/[id]/routing/index.js` (5 move sites) |
| Modify | `C:\Users\bento\.claude\projects\C--Users-bento-app-drayagedirect\memory\followups.md` (open FU-071, mark FU-055 + FU-056 resolved) |

**Git strategy:** One atomic PR containing all commits. Branch from current `main`. The final commit message (Task 12) resolves FU-055 + FU-056. Do NOT squash commits during the PR — each task's commit is a reviewable unit.

---

## Phase 1 — Schema + helpers (3 tasks, TDD)

### Task 1: Migration 096 — history tables

**Files:**
- Create: `supabase/migrations/096_charge_set_and_move_status_history.sql`

- [ ] **Step 1: Verify migration 096 is still free**

Run: `ls C:/Users/bento/app-drayagedirect/supabase/migrations/ | grep "^096"`

Expected: no match. If a match appears (e.g., another branch grabbed 096), bump to the next available number everywhere in this plan.

- [ ] **Step 2: Write the migration file**

Create `C:\Users\bento\app-drayagedirect\supabase\migrations\096_charge_set_and_move_status_history.sql`:

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
--
-- old_status / new_status are TEXT (not enum) on purpose: history
-- tables outlive enum evolution. Source tables keep their enum
-- columns; history is more permissive by design.
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

- [ ] **Step 3: Apply the migration to local Supabase**

Run:

```bash
cd C:/Users/bento/app-drayagedirect && npx supabase db push --include-all
```

Expected output: `Finished supabase db push` or `Applied migration 096`. If the command is `supabase db reset` or another invocation in this project, substitute; the user's preferred apply command is what they've been using for recent migrations.

If the migration errors:
- Error mentioning `tenants(id) does not exist` → unexpected, check `supabase/migrations/001_initial_schema.sql` for the tenants table. Should be line 1-20.
- Error mentioning `order_charge_sets does not exist` → verify table name with `grep -l "CREATE TABLE order_charge_sets" supabase/migrations/*.sql`. Table should be in `003_phase5b1_loads.sql` or similar.

- [ ] **Step 4: Verify tables exist**

Run:

```bash
cd C:/Users/bento/app-drayagedirect && npx supabase db remote commit --dry-run 2>&1 | grep -i "order_charge_sets_status_history\|order_container_moves_status_history" || echo "Tables verified via next grep"
grep -rE "CREATE TABLE.*(order_charge_sets_status_history|order_container_moves_status_history)" supabase/migrations/ | wc -l
```

Expected: `2` (both tables defined in migration 096).

- [ ] **Step 5: Commit**

```bash
git -C C:/Users/bento/app-drayagedirect add supabase/migrations/096_charge_set_and_move_status_history.sql
git -C C:/Users/bento/app-drayagedirect commit -m "$(cat <<'EOF'
feat(ai-ready): migration 096 — charge_set + move status history tables

Adds order_charge_sets_status_history and order_container_moves_status_history,
mirroring the existing order_status_history shape. TEXT columns for status
(intentional — more permissive than source enums, history outlives enum
evolution). Written by upcoming transition helpers.

Part of Stream B.1a (FU-055 + FU-056).
EOF
)"
```

---

### Task 2: `lib/charge-sets/transition.js` + tests (TDD)

**Files:**
- Create: `tests/charge-sets-transition.test.mjs`
- Create: `lib/charge-sets/transition.js`

- [ ] **Step 1: Write the test file with all 5 failing cases**

Create `C:\Users\bento\app-drayagedirect\tests\charge-sets-transition.test.mjs`:

```js
import { transitionChargeSetStatus } from '../lib/charge-sets/transition.js';

let passed = 0;
let failed = 0;
function check(name, cond) {
  if (cond) { console.log(`  ✓ ${name}`); passed++; }
  else      { console.log(`  ✗ ${name}`); failed++; }
}

// Minimal chainable Supabase-client mock. Each test constructs one per-call-tree.
// The mock captures .from/.select/.update/.insert/.eq/.in/.maybeSingle/.single
// and returns the configured terminal result.
function makeMockClient(config) {
  const calls = {
    selected: [],
    updated: [],
    inserted: [],
    terminals: [],
  };
  function chain(currentTable) {
    const c = {
      _table: currentTable,
      _mode: null,
      _payload: null,
      select(..._args) { return c; },
      update(payload) { c._mode = 'update'; c._payload = payload; return c; },
      insert(payload) { c._mode = 'insert'; c._payload = payload; return c; },
      eq(_col, _val) { return c; },
      in(_col, _vals) { return c; },
      async maybeSingle() {
        const r = config.fetch ?? { data: null, error: null };
        calls.terminals.push({ kind: 'maybeSingle', table: c._table });
        return r;
      },
      async single() {
        if (c._mode === 'update') {
          calls.updated.push({ table: c._table, payload: c._payload });
          const r = config.update ?? { data: c._payload, error: null };
          calls.terminals.push({ kind: 'update.single', table: c._table });
          return r;
        }
        const r = config.fetch ?? { data: null, error: null };
        calls.terminals.push({ kind: 'single', table: c._table });
        return r;
      },
      then(resolve) {
        // If the chain ends without .single() / .maybeSingle() (e.g., plain insert),
        // this acts as a thenable so `await chain...` works.
        if (c._mode === 'insert') {
          calls.inserted.push({ table: c._table, payload: c._payload });
          resolve(config.insert ?? { data: null, error: null });
        } else if (c._mode === 'update') {
          calls.updated.push({ table: c._table, payload: c._payload });
          resolve(config.update ?? { data: null, error: null });
        } else {
          resolve({ data: null, error: null });
        }
      },
    };
    return c;
  }
  return {
    from(table) { return chain(table); },
    _calls: calls,
  };
}

// --------- Test cases ---------

console.log('transitionChargeSetStatus');

// Case 1: Success (status only)
{
  const svc = makeMockClient({
    fetch: { data: { id: 'cs-1', status: 'draft' }, error: null },
    update: { data: { id: 'cs-1', status: 'invoiced' }, error: null },
    insert: { data: null, error: null },
  });
  const result = await transitionChargeSetStatus(svc, {
    tenantId: 't-1',
    chargeSetId: 'cs-1',
    newStatus: 'invoiced',
    actorUserId: 'u-1',
  });
  check('returns oldStatus=draft', result.oldStatus === 'draft');
  check('returns newStatus=invoiced', result.newStatus === 'invoiced');
  check('writes 1 update', svc._calls.updated.length === 1);
  check('update payload has status', svc._calls.updated[0]?.payload?.status === 'invoiced');
  check('writes 1 history insert', svc._calls.inserted.length === 1);
  check('history table is order_charge_sets_status_history',
    svc._calls.inserted[0]?.table === 'order_charge_sets_status_history');
}

// Case 2: Success (status + extraFields)
{
  const svc = makeMockClient({
    fetch: { data: { id: 'cs-2', status: 'approved' }, error: null },
    update: { data: { id: 'cs-2', status: 'invoiced' }, error: null },
    insert: { data: null, error: null },
  });
  await transitionChargeSetStatus(svc, {
    tenantId: 't-1',
    chargeSetId: 'cs-2',
    newStatus: 'invoiced',
    actorUserId: 'u-1',
    extraFields: { invoice_id: 'inv-99', invoiced_at: '2026-04-24T00:00:00Z' },
  });
  const payload = svc._calls.updated[0]?.payload;
  check('extraFields: status merged', payload?.status === 'invoiced');
  check('extraFields: invoice_id merged', payload?.invoice_id === 'inv-99');
  check('extraFields: invoiced_at merged', payload?.invoiced_at === '2026-04-24T00:00:00Z');
  const histPayload = svc._calls.inserted[0]?.payload;
  check('history has new_status', histPayload?.new_status === 'invoiced');
  check('history does NOT include extraFields', histPayload?.invoice_id === undefined);
}

// Case 3: No-op (same status, no extraFields)
{
  const svc = makeMockClient({
    fetch: { data: { id: 'cs-3', status: 'invoiced' }, error: null },
  });
  const result = await transitionChargeSetStatus(svc, {
    tenantId: 't-1',
    chargeSetId: 'cs-3',
    newStatus: 'invoiced',
    actorUserId: 'u-1',
  });
  check('no-op: returns oldStatus=newStatus=invoiced',
    result.oldStatus === 'invoiced' && result.newStatus === 'invoiced');
  check('no-op: no UPDATE call', svc._calls.updated.length === 0);
  check('no-op: no INSERT call', svc._calls.inserted.length === 0);
}

// Case 4: UPDATE fails → throws
{
  const svc = makeMockClient({
    fetch: { data: { id: 'cs-4', status: 'draft' }, error: null },
    update: { data: null, error: { message: 'update failed' } },
  });
  let threw = false;
  try {
    await transitionChargeSetStatus(svc, {
      tenantId: 't-1', chargeSetId: 'cs-4', newStatus: 'invoiced', actorUserId: null,
    });
  } catch { threw = true; }
  check('UPDATE error throws', threw);
  check('no history row on UPDATE failure', svc._calls.inserted.length === 0);
}

// Case 5: History INSERT fails → does NOT throw (log-and-continue)
{
  const svc = makeMockClient({
    fetch: { data: { id: 'cs-5', status: 'draft' }, error: null },
    update: { data: { id: 'cs-5', status: 'invoiced' }, error: null },
    insert: { data: null, error: { message: 'history failed' } },
  });
  let threw = false;
  let result;
  try {
    result = await transitionChargeSetStatus(svc, {
      tenantId: 't-1', chargeSetId: 'cs-5', newStatus: 'invoiced', actorUserId: null,
    });
  } catch { threw = true; }
  check('history failure does NOT throw', !threw);
  check('UPDATE still happens', svc._calls.updated.length === 1);
  check('helper returns normally', result?.newStatus === 'invoiced');
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
```

- [ ] **Step 2: Run the test file to verify it fails**

Run:

```bash
cd C:/Users/bento/app-drayagedirect && node tests/charge-sets-transition.test.mjs
```

Expected: **FAIL** with error about `transitionChargeSetStatus` not being exported / file not found.

- [ ] **Step 3: Create the helper directory and implement the helper**

Run: `mkdir -p C:/Users/bento/app-drayagedirect/lib/charge-sets`

Create `C:\Users\bento\app-drayagedirect\lib\charge-sets\transition.js`:

```js
/**
 * Charge-Set Status Transition Helper
 *
 * Centralizes all writes to order_charge_sets.status. Mirrors the
 * fireStatusChangeTriggers pattern in lib/email-dispatch/status-change-fire.js:
 * UPDATE the status (+ any extraFields co-written in the same UPDATE),
 * write a history row, log-and-continue on history-write failure.
 *
 * Called from API handlers under pages/api/tenant/ar/** and
 * pages/api/tenant/loads/[id]/charge-sets/**.
 *
 * No-op if newStatus === current status AND no extraFields provided.
 */

/**
 * @param svc service-role Supabase client
 * @param {{
 *   tenantId: string,
 *   chargeSetId: string,
 *   newStatus: string,
 *   actorUserId: string | null,
 *   extraFields?: object,
 * }} params
 * @returns {Promise<{ oldStatus: string | null, newStatus: string, row: object }>}
 * @throws on DB UPDATE failure (history-write failures are logged, not thrown).
 */
export async function transitionChargeSetStatus(svc, params) {
  const { tenantId, chargeSetId, newStatus, actorUserId, extraFields } = params;

  // 1. Fetch current state
  const { data: current, error: fetchErr } = await svc
    .from('order_charge_sets')
    .select('*')
    .eq('tenant_id', tenantId)
    .eq('id', chargeSetId)
    .maybeSingle();
  if (fetchErr) throw new Error(`charge_set fetch failed: ${fetchErr.message}`);
  if (!current) throw new Error(`charge_set ${chargeSetId} not found for tenant ${tenantId}`);

  const oldStatus = current.status;
  const hasExtraFields = extraFields && Object.keys(extraFields).length > 0;

  // 2. No-op short-circuit
  if (oldStatus === newStatus && !hasExtraFields) {
    return { oldStatus, newStatus, row: current };
  }

  // 3. UPDATE (status + extraFields merged)
  const updatePayload = { status: newStatus, ...(extraFields || {}) };
  const { data: updated, error: updErr } = await svc
    .from('order_charge_sets')
    .update(updatePayload)
    .eq('tenant_id', tenantId)
    .eq('id', chargeSetId)
    .select()
    .single();
  if (updErr) throw new Error(`charge_set update failed: ${updErr.message}`);

  // 4. History INSERT (log-and-continue; non-fatal)
  try {
    const { error: histErr } = await svc
      .from('order_charge_sets_status_history')
      .insert({
        tenant_id: tenantId,
        charge_set_id: chargeSetId,
        old_status: oldStatus ?? null,
        new_status: newStatus,
        changed_by: actorUserId ?? null,
      });
    if (histErr) {
      console.error(`charge_set history insert failed for ${chargeSetId}:`, histErr.message);
    }
  } catch (e) {
    console.error(`charge_set history insert threw for ${chargeSetId}:`, e?.message || e);
  }

  return { oldStatus, newStatus, row: updated };
}
```

- [ ] **Step 4: Run the test file to verify it passes**

Run:

```bash
cd C:/Users/bento/app-drayagedirect && node tests/charge-sets-transition.test.mjs
```

Expected: `N passed, 0 failed` with all checkmarks. Exit code 0.

If the mock chain doesn't match the helper's call pattern, iterate on either the mock or the helper until they align. Do NOT weaken test assertions.

- [ ] **Step 5: Commit**

```bash
git -C C:/Users/bento/app-drayagedirect add lib/charge-sets/transition.js tests/charge-sets-transition.test.mjs
git -C C:/Users/bento/app-drayagedirect commit -m "feat(ai-ready): transitionChargeSetStatus helper + tests

Centralizes order_charge_sets.status writes behind a helper that mirrors
fireStatusChangeTriggers: UPDATE + history + log-and-continue. Accepts
optional extraFields for co-written columns (invoice_id, invoiced_at, etc.).
No-op on same-status + no-extraFields.

5/5 tests pass.

Part of Stream B.1a (FU-055)."
```

---

### Task 3: `lib/routing/moves/transition.js` + tests (TDD)

**Files:**
- Create: `tests/routing-moves-transition.test.mjs`
- Create: `lib/routing/moves/transition.js`

- [ ] **Step 1: Write the test file with all 5 failing cases**

Create `C:\Users\bento\app-drayagedirect\tests\routing-moves-transition.test.mjs`:

```js
import { transitionMoveStatus } from '../lib/routing/moves/transition.js';

let passed = 0;
let failed = 0;
function check(name, cond) {
  if (cond) { console.log(`  ✓ ${name}`); passed++; }
  else      { console.log(`  ✗ ${name}`); failed++; }
}

// Same mock shape as tests/charge-sets-transition.test.mjs — inlined here
// (not extracted because the two tests are the only callers and
// duplication is cheaper than sharing).
function makeMockClient(config) {
  const calls = { selected: [], updated: [], inserted: [], terminals: [] };
  function chain(currentTable) {
    const c = {
      _table: currentTable, _mode: null, _payload: null,
      select(..._args) { return c; },
      update(payload) { c._mode = 'update'; c._payload = payload; return c; },
      insert(payload) { c._mode = 'insert'; c._payload = payload; return c; },
      eq() { return c; },
      in() { return c; },
      async maybeSingle() {
        calls.terminals.push({ kind: 'maybeSingle', table: c._table });
        return config.fetch ?? { data: null, error: null };
      },
      async single() {
        if (c._mode === 'update') {
          calls.updated.push({ table: c._table, payload: c._payload });
          calls.terminals.push({ kind: 'update.single', table: c._table });
          return config.update ?? { data: c._payload, error: null };
        }
        calls.terminals.push({ kind: 'single', table: c._table });
        return config.fetch ?? { data: null, error: null };
      },
      then(resolve) {
        if (c._mode === 'insert') {
          calls.inserted.push({ table: c._table, payload: c._payload });
          resolve(config.insert ?? { data: null, error: null });
        } else if (c._mode === 'update') {
          calls.updated.push({ table: c._table, payload: c._payload });
          resolve(config.update ?? { data: null, error: null });
        } else {
          resolve({ data: null, error: null });
        }
      },
    };
    return c;
  }
  return { from(table) { return chain(table); }, _calls: calls };
}

console.log('transitionMoveStatus');

// Case 1: Success (status only)
{
  const svc = makeMockClient({
    fetch: { data: { id: 'm-1', status: 'pending' }, error: null },
    update: { data: { id: 'm-1', status: 'in_progress' }, error: null },
  });
  const r = await transitionMoveStatus(svc, {
    tenantId: 't-1', moveId: 'm-1', newStatus: 'in_progress', actorUserId: 'u-1',
  });
  check('oldStatus=pending', r.oldStatus === 'pending');
  check('newStatus=in_progress', r.newStatus === 'in_progress');
  check('1 UPDATE', svc._calls.updated.length === 1);
  check('1 INSERT to history', svc._calls.inserted.length === 1);
  check('history table correct',
    svc._calls.inserted[0]?.table === 'order_container_moves_status_history');
}

// Case 2: Success (status + extraFields)
{
  const svc = makeMockClient({
    fetch: { data: { id: 'm-2', status: 'in_progress' }, error: null },
    update: { data: { id: 'm-2', status: 'completed' }, error: null },
  });
  await transitionMoveStatus(svc, {
    tenantId: 't-1', moveId: 'm-2', newStatus: 'completed', actorUserId: 'u-1',
    extraFields: { completed_at: '2026-04-24T00:00:00Z' },
  });
  const payload = svc._calls.updated[0]?.payload;
  check('payload status=completed', payload?.status === 'completed');
  check('payload completed_at merged', payload?.completed_at === '2026-04-24T00:00:00Z');
  const histPayload = svc._calls.inserted[0]?.payload;
  check('history has new_status', histPayload?.new_status === 'completed');
  check('history excludes completed_at', histPayload?.completed_at === undefined);
}

// Case 3: No-op (same status, no extraFields)
{
  const svc = makeMockClient({
    fetch: { data: { id: 'm-3', status: 'completed' }, error: null },
  });
  const r = await transitionMoveStatus(svc, {
    tenantId: 't-1', moveId: 'm-3', newStatus: 'completed', actorUserId: null,
  });
  check('no-op return', r.oldStatus === 'completed' && r.newStatus === 'completed');
  check('no UPDATE', svc._calls.updated.length === 0);
  check('no INSERT', svc._calls.inserted.length === 0);
}

// Case 4: UPDATE fails → throws
{
  const svc = makeMockClient({
    fetch: { data: { id: 'm-4', status: 'pending' }, error: null },
    update: { data: null, error: { message: 'update failed' } },
  });
  let threw = false;
  try {
    await transitionMoveStatus(svc, {
      tenantId: 't-1', moveId: 'm-4', newStatus: 'in_progress', actorUserId: null,
    });
  } catch { threw = true; }
  check('UPDATE error throws', threw);
  check('no history row on UPDATE failure', svc._calls.inserted.length === 0);
}

// Case 5: History INSERT fails → does NOT throw
{
  const svc = makeMockClient({
    fetch: { data: { id: 'm-5', status: 'pending' }, error: null },
    update: { data: { id: 'm-5', status: 'in_progress' }, error: null },
    insert: { data: null, error: { message: 'history failed' } },
  });
  let threw = false;
  let result;
  try {
    result = await transitionMoveStatus(svc, {
      tenantId: 't-1', moveId: 'm-5', newStatus: 'in_progress', actorUserId: null,
    });
  } catch { threw = true; }
  check('history failure does NOT throw', !threw);
  check('UPDATE still happens', svc._calls.updated.length === 1);
  check('helper returns normally', result?.newStatus === 'in_progress');
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
```

- [ ] **Step 2: Run tests to verify failure**

Run: `cd C:/Users/bento/app-drayagedirect && node tests/routing-moves-transition.test.mjs`
Expected: **FAIL** (`transitionMoveStatus` not defined).

- [ ] **Step 3: Create the helper directory and implement**

Run: `mkdir -p C:/Users/bento/app-drayagedirect/lib/routing/moves`

Create `C:\Users\bento\app-drayagedirect\lib\routing\moves\transition.js`:

```js
/**
 * Container-Move Status Transition Helper
 *
 * Centralizes all writes to order_container_moves.status. Mirrors
 * transitionChargeSetStatus: UPDATE + history + log-and-continue.
 *
 * No cascade logic — complete_load / uncomplete_load in
 * pages/api/tenant/loads/[id]/routing/index.js are explicit user
 * actions that write orders.status directly, not derived from move state.
 *
 * For bulk operations, callers fetch affected moves first then
 * loop-serial through this helper (see routing/index.js:692-707 + 742-756).
 */

/**
 * @param svc service-role Supabase client
 * @param {{
 *   tenantId: string,
 *   moveId: string,
 *   newStatus: string,
 *   actorUserId: string | null,
 *   extraFields?: object,
 * }} params
 * @returns {Promise<{ oldStatus: string | null, newStatus: string, row: object }>}
 * @throws on DB UPDATE failure.
 */
export async function transitionMoveStatus(svc, params) {
  const { tenantId, moveId, newStatus, actorUserId, extraFields } = params;

  const { data: current, error: fetchErr } = await svc
    .from('order_container_moves')
    .select('*')
    .eq('tenant_id', tenantId)
    .eq('id', moveId)
    .maybeSingle();
  if (fetchErr) throw new Error(`move fetch failed: ${fetchErr.message}`);
  if (!current) throw new Error(`move ${moveId} not found for tenant ${tenantId}`);

  const oldStatus = current.status;
  const hasExtraFields = extraFields && Object.keys(extraFields).length > 0;

  if (oldStatus === newStatus && !hasExtraFields) {
    return { oldStatus, newStatus, row: current };
  }

  const updatePayload = { status: newStatus, ...(extraFields || {}) };
  const { data: updated, error: updErr } = await svc
    .from('order_container_moves')
    .update(updatePayload)
    .eq('tenant_id', tenantId)
    .eq('id', moveId)
    .select()
    .single();
  if (updErr) throw new Error(`move update failed: ${updErr.message}`);

  try {
    const { error: histErr } = await svc
      .from('order_container_moves_status_history')
      .insert({
        tenant_id: tenantId,
        move_id: moveId,
        old_status: oldStatus ?? null,
        new_status: newStatus,
        changed_by: actorUserId ?? null,
      });
    if (histErr) {
      console.error(`move history insert failed for ${moveId}:`, histErr.message);
    }
  } catch (e) {
    console.error(`move history insert threw for ${moveId}:`, e?.message || e);
  }

  return { oldStatus, newStatus, row: updated };
}
```

- [ ] **Step 4: Run tests to verify pass**

Run: `cd C:/Users/bento/app-drayagedirect && node tests/routing-moves-transition.test.mjs`
Expected: `N passed, 0 failed`, exit 0.

- [ ] **Step 5: Commit**

```bash
git -C C:/Users/bento/app-drayagedirect add lib/routing/moves/transition.js tests/routing-moves-transition.test.mjs
git -C C:/Users/bento/app-drayagedirect commit -m "feat(ai-ready): transitionMoveStatus helper + tests

Centralizes order_container_moves.status writes. Same shape as
transitionChargeSetStatus: UPDATE + extraFields + history + log-and-continue.
No cascade — orders.status writes in complete_load/uncomplete_load are
explicit and remain inline (tracked as separate follow-up).

5/5 tests pass.

Part of Stream B.1a (FU-056)."
```

---

## Phase 2 — Call-site refactors (5 tasks)

Each Phase 2 task touches one source file, runs tests to confirm nothing broke, commits. Small, reviewable units.

### Task 4: Refactor FU-055 bulk site #1 — `pages/api/tenant/ar/invoices/index.js`

**Files:**
- Modify: `pages/api/tenant/ar/invoices/index.js` (around lines 456-461)

- [ ] **Step 1: Read the current block**

Open `C:\Users\bento\app-drayagedirect\pages\api\tenant\ar\invoices\index.js` and find:

```js
// Update charge sets to 'invoiced' status and link invoice_id
await svc
  .from('order_charge_sets')
  .update({ status: 'invoiced', invoice_id: invoice.id, invoiced_at: new Date().toISOString() })
  .eq('tenant_id', ctx.tenantId)
  .in('id', charge_set_ids);
```

Note the exact line number and the surrounding function (for context on `ctx`, `charge_set_ids`, `invoice.id`).

- [ ] **Step 2: Add the helper import at the top of the file**

Add to the import block at the top of `pages/api/tenant/ar/invoices/index.js`:

```js
import { transitionChargeSetStatus } from '../../../../../lib/charge-sets/transition.js';
```

The relative path goes up 5 levels from `pages/api/tenant/ar/invoices/` to the project root, then down to `lib/charge-sets/transition.js`. Verify with: the file is at `pages/api/tenant/ar/invoices/index.js` — `../../../../../` = project root.

- [ ] **Step 3: Replace the bulk UPDATE with a loop through the helper**

Replace:

```js
// Update charge sets to 'invoiced' status and link invoice_id
await svc
  .from('order_charge_sets')
  .update({ status: 'invoiced', invoice_id: invoice.id, invoiced_at: new Date().toISOString() })
  .eq('tenant_id', ctx.tenantId)
  .in('id', charge_set_ids);
```

with:

```js
// Update charge sets to 'invoiced' status and link invoice_id.
// Loop-serial through transitionChargeSetStatus so each transition
// gets a history row. N is small (1-10 charge_sets per invoice typical).
const invoicedAt = new Date().toISOString();
for (const chargeSetId of charge_set_ids) {
  await transitionChargeSetStatus(svc, {
    tenantId: ctx.tenantId,
    chargeSetId,
    newStatus: 'invoiced',
    actorUserId: ctx.userId,
    extraFields: { invoice_id: invoice.id, invoiced_at: invoicedAt },
  });
}
```

- [ ] **Step 4: Run the helper tests to confirm no regression**

Run:

```bash
cd C:/Users/bento/app-drayagedirect && node tests/charge-sets-transition.test.mjs && node tests/routing-moves-transition.test.mjs
```

Expected: both pass with 0 failures.

- [ ] **Step 5: Commit**

```bash
git -C C:/Users/bento/app-drayagedirect add pages/api/tenant/ar/invoices/index.js
git -C C:/Users/bento/app-drayagedirect commit -m "refactor(ai-ready): route invoices create through transitionChargeSetStatus

Bulk site #1 of FU-055. Each charge_set now gets a history row on the
'invoiced' transition. No behavior change from the caller's perspective.

Part of Stream B.1a (FU-055)."
```

---

### Task 5: Refactor FU-055 remaining 4 sites (single file each)

**Files:**
- Modify: `pages/api/tenant/ar/invoices/[invoiceId].js`
- Modify: `pages/api/tenant/ar/charge-sets/bulk-send-rate-con.js`
- Modify: `pages/api/tenant/ar/charge-sets/[id]/send-rate-con-email.js`
- Modify: `pages/api/tenant/loads/[id]/charge-sets/[csId].js`

Each file gets its own sub-step with commit. This task is 4 sub-tasks; the implementer can break them across commits if desired.

- [ ] **Step 1: Refactor `pages/api/tenant/ar/invoices/[invoiceId].js` (bulk, around line 138-142)**

Add import (path `../../../../../lib/charge-sets/transition.js`).

Find the block:

```js
await svc
  .from('order_charge_sets')
  .update({ status: 'approved', invoice_id: null })
  .eq('tenant_id', ctx.tenantId)
  .in('id', junctions.map((j) => j.charge_set_id));
```

Replace with:

```js
for (const { charge_set_id } of junctions) {
  await transitionChargeSetStatus(svc, {
    tenantId: ctx.tenantId,
    chargeSetId: charge_set_id,
    newStatus: 'approved',
    actorUserId: ctx.userId,
    extraFields: { invoice_id: null },
  });
}
```

Run helper tests. Commit: `refactor(ai-ready): route invoice void through transitionChargeSetStatus (FU-055)`.

- [ ] **Step 2: Refactor `pages/api/tenant/ar/charge-sets/bulk-send-rate-con.js` (bulk, around line 272-277)**

Add import (path `../../../../../lib/charge-sets/transition.js`).

Find:

```js
const { error: updErr } = await svc
  .from('order_charge_sets')
  .update({ status: 'rate_con_sent', send_claimed_at: null })
  .eq('tenant_id', ctx.tenantId)
  .in('id', sendableCsIds);
if (updErr) throw new Error(`status update: ${updErr.message}`);
```

Replace with:

```js
for (const chargeSetId of sendableCsIds) {
  try {
    await transitionChargeSetStatus(svc, {
      tenantId: ctx.tenantId,
      chargeSetId,
      newStatus: 'rate_con_sent',
      actorUserId: ctx.userId,
      extraFields: { send_claimed_at: null },
    });
  } catch (err) {
    throw new Error(`status update (${chargeSetId}): ${err.message}`);
  }
}
```

Note: the try/catch preserves the existing "wrap the error with context" semantics.

Run helper tests. Commit: `refactor(ai-ready): route bulk-send-rate-con through transitionChargeSetStatus (FU-055)`.

- [ ] **Step 3: Refactor `pages/api/tenant/ar/charge-sets/[id]/send-rate-con-email.js` (single, around line 149-153)**

Add import (path `../../../../../../lib/charge-sets/transition.js` — 6 levels up because the file is one more dir deep).

Find:

```js
const { error: updErr } = await svc
  .from('order_charge_sets')
  .update({ status: 'rate_con_sent' })
  .eq('id', id)
  .eq('tenant_id', ctx.tenantId);
if (updErr) {
  console.error(`Charge set ${id}: email sent but status update failed:`, updErr.message);
  return res.status(500).json({
    error: `Email sent but status update failed: ${updErr.message}`,
    stage: 'status_update',
    rate_con_pdf_url: pdfStoragePath,
    // ... rest of the error object
```

Replace with (preserving the error-return semantics):

```js
try {
  await transitionChargeSetStatus(svc, {
    tenantId: ctx.tenantId,
    chargeSetId: id,
    newStatus: 'rate_con_sent',
    actorUserId: ctx.userId,
  });
} catch (updErr) {
  console.error(`Charge set ${id}: email sent but status update failed:`, updErr.message);
  return res.status(500).json({
    error: `Email sent but status update failed: ${updErr.message}`,
    stage: 'status_update',
    rate_con_pdf_url: pdfStoragePath,
    // ... rest of the error object (preserve exactly as the original)
```

Make sure to read the original's full error object shape and preserve it — the helper throws on UPDATE failure, so the try/catch around the helper call is functionally identical to the previous `if (updErr)` branch.

Run helper tests. Commit: `refactor(ai-ready): route single rate-con send through transitionChargeSetStatus (FU-055)`.

- [ ] **Step 4: Refactor `pages/api/tenant/loads/[id]/charge-sets/[csId].js` (single multi-field PUT, around line 133-139)**

Add import (path `../../../../../../lib/charge-sets/transition.js` — 6 levels up).

This site is trickier because the existing code builds an `updates` map incrementally through a multi-branch PUT handler. Refactor pattern:

Find the final UPDATE call (around line 133-139):

```js
const { data, error } = await svc
  .from('order_charge_sets')
  .update(updates)
  .eq('tenant_id', ctx.tenantId)
  .eq('order_id', id)
  .eq('id', csId)
  .select()
  .single();
```

Replace with:

```js
let data;
let error;
if (updates.status !== undefined) {
  // Status changed — route through helper for history coverage
  const { status: newStatus, ...extraFields } = updates;
  try {
    const result = await transitionChargeSetStatus(svc, {
      tenantId: ctx.tenantId,
      chargeSetId: csId,
      newStatus,
      actorUserId: ctx.userId,
      extraFields,
    });
    data = result.row;
  } catch (err) {
    error = { message: err.message };
  }
} else {
  // No status change — direct UPDATE for non-status fields only
  const res_ = await svc
    .from('order_charge_sets')
    .update(updates)
    .eq('tenant_id', ctx.tenantId)
    .eq('order_id', id)
    .eq('id', csId)
    .select()
    .single();
  data = res_.data;
  error = res_.error;
}
```

Important: this site has extra WHERE `.eq('order_id', id)` filter. The helper only filters by `tenant_id + id`. In practice this site's `order_id` filter is a belt-and-suspenders check — the `csId` alone is unique — but if there's any concern, verify by reading the helper usage context. The `order_id` check is removed by using the helper; this is acceptable because `(tenant_id, csId)` is the primary scoping.

Run helper tests. Commit: `refactor(ai-ready): route load charge-set PUT through transitionChargeSetStatus (FU-055)`.

- [ ] **Step 5 (verification): Final grep to confirm no orphaned `.update({ status` patterns remain for charge_sets**

Run:

```bash
cd C:/Users/bento/app-drayagedirect && grep -rnE "from\('order_charge_sets'\)\s*\.update\(\{[^}]*status" pages/api lib --include="*.js"
```

Expected: **no matches**, OR only matches inside `lib/charge-sets/transition.js` itself (the helper's own UPDATE).

If matches remain in `pages/api/**`, investigate — either the grep found a pattern the audit missed, or a refactor was incomplete. Flag and address before proceeding.

---

### Task 6: Refactor FU-056 single-move sites (659, 673)

**Files:**
- Modify: `pages/api/tenant/loads/[id]/routing/index.js` (lines 657-665 + 671-679)

- [ ] **Step 1: Add the helper import**

At the top of `pages/api/tenant/loads/[id]/routing/index.js`, add:

```js
import { transitionMoveStatus } from '../../../../../../lib/routing/moves/transition.js';
```

Path: `pages/api/tenant/loads/[id]/routing/index.js` → up 6 levels → `lib/routing/moves/transition.js`.

- [ ] **Step 2: Refactor the `start_move` block (around line 655-666)**

Find:

```js
// Start a move — sets started_at + status='in_progress'
if (action === 'start_move') {
  if (!body.move_id) return res.status(400).json({ error: 'move_id required' });
  const { data, error } = await svc
    .from('order_container_moves')
    .update({ started_at: new Date().toISOString(), status: 'in_progress' })
    .eq('tenant_id', ctx.tenantId)
    .eq('id', body.move_id)
    .select()
    .single();
  if (error) return res.status(500).json({ error: error.message });
  return res.status(200).json({ move: data });
}
```

Replace with:

```js
if (action === 'start_move') {
  if (!body.move_id) return res.status(400).json({ error: 'move_id required' });
  try {
    const { row } = await transitionMoveStatus(svc, {
      tenantId: ctx.tenantId,
      moveId: body.move_id,
      newStatus: 'in_progress',
      actorUserId: ctx.userId,
      extraFields: { started_at: new Date().toISOString() },
    });
    return res.status(200).json({ move: row });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
```

- [ ] **Step 3: Refactor the `complete_move` block (around line 668-680)**

Find:

```js
// Complete a single move
if (action === 'complete_move') {
  if (!body.move_id) return res.status(400).json({ error: 'move_id required' });
  const { data, error } = await svc
    .from('order_container_moves')
    .update({ completed_at: new Date().toISOString(), status: 'completed' })
    .eq('tenant_id', ctx.tenantId)
    .eq('id', body.move_id)
    .select()
    .single();
  if (error) return res.status(500).json({ error: error.message });
  return res.status(200).json({ move: data });
}
```

Replace with:

```js
if (action === 'complete_move') {
  if (!body.move_id) return res.status(400).json({ error: 'move_id required' });
  try {
    const { row } = await transitionMoveStatus(svc, {
      tenantId: ctx.tenantId,
      moveId: body.move_id,
      newStatus: 'completed',
      actorUserId: ctx.userId,
      extraFields: { completed_at: new Date().toISOString() },
    });
    return res.status(200).json({ move: row });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
```

- [ ] **Step 4: Run tests + grep for regressions**

```bash
cd C:/Users/bento/app-drayagedirect && node tests/routing-moves-transition.test.mjs
```

Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git -C C:/Users/bento/app-drayagedirect add pages/api/tenant/loads/[id]/routing/index.js
git -C C:/Users/bento/app-drayagedirect commit -m "refactor(ai-ready): route start_move / complete_move through helper

Single-move sites #1+#2 of FU-056. Each transition gets a history row.
Error semantics preserved (500 with error.message on failure).

Part of Stream B.1a (FU-056)."
```

---

### Task 7: Refactor FU-056 bulk-move sites (complete_load + uncomplete_load)

**Files:**
- Modify: `pages/api/tenant/loads/[id]/routing/index.js` (lines ~690-720 + ~740-760)

- [ ] **Step 1: Refactor the `complete_load` bulk move update (around line 690-698)**

Find:

```js
if (action === 'complete_load') {
  const now = new Date().toISOString();
  await svc
    .from('order_container_moves')
    .update({ completed_at: now, status: 'completed' })
    .eq('tenant_id', ctx.tenantId)
    .eq('order_id', id)
    .is('completed_at', null)
    .not('started_at', 'is', null);

  const { data: order, error: orderErr } = await svc
```

Replace the bulk move update (but leave the `orders` UPDATE below it untouched — it's out of scope per spec):

```js
if (action === 'complete_load') {
  const now = new Date().toISOString();

  // Fetch eligible moves first, then loop-serial through the helper so
  // each move transition gets a history row. Eligible = started_at set
  // AND not yet completed.
  const { data: eligibleMoves } = await svc
    .from('order_container_moves')
    .select('id')
    .eq('tenant_id', ctx.tenantId)
    .eq('order_id', id)
    .is('completed_at', null)
    .not('started_at', 'is', null);

  for (const { id: moveId } of (eligibleMoves || [])) {
    await transitionMoveStatus(svc, {
      tenantId: ctx.tenantId,
      moveId,
      newStatus: 'completed',
      actorUserId: ctx.userId,
      extraFields: { completed_at: now },
    });
  }

  // NOTE: the orders.status UPDATE below is intentionally left inline.
  // Out of scope for moves-centralization (FU-056). Tracked as FU-071
  // for a later session to route through fireStatusChangeTriggers.
  const { data: order, error: orderErr } = await svc
```

(The rest of `complete_load` — the `orders` update at line 700-707 and the `logTenantAction` call — stays as-is.)

- [ ] **Step 2: Refactor the `uncomplete_load` bulk move updates (around line 740-756)**

Find:

```js
// Reopen any completed moves. We do this in two passes:
//   1. Moves that WERE started → revert to 'in_progress'
//   2. Moves that were never started but somehow got completed (e.g.
//      from the old complete_load bug that stamped every move) →
//      revert to 'pending' so they don't show a bogus "completed" pill.
await svc
  .from('order_container_moves')
  .update({ completed_at: null, status: 'in_progress' })
  .eq('tenant_id', ctx.tenantId)
  .eq('order_id', id)
  .not('started_at', 'is', null)
  .not('completed_at', 'is', null);

await svc
  .from('order_container_moves')
  .update({ completed_at: null, status: 'pending' })
  .eq('tenant_id', ctx.tenantId)
  .eq('order_id', id)
  .is('started_at', null)
  .not('completed_at', 'is', null);

await logTenantAction(svc, {
```

Replace with:

```js
// Reopen any completed moves. We do this in two passes:
//   1. Moves that WERE started → revert to 'in_progress'
//   2. Moves that were never started but somehow got completed (e.g.
//      from the old complete_load bug that stamped every move) →
//      revert to 'pending' so they don't show a bogus "completed" pill.
//
// Now routed through transitionMoveStatus per move so each reopen
// writes a history row.

// Pass 1: started + completed moves → in_progress
const { data: startedCompletedMoves } = await svc
  .from('order_container_moves')
  .select('id')
  .eq('tenant_id', ctx.tenantId)
  .eq('order_id', id)
  .not('started_at', 'is', null)
  .not('completed_at', 'is', null);

for (const { id: moveId } of (startedCompletedMoves || [])) {
  await transitionMoveStatus(svc, {
    tenantId: ctx.tenantId,
    moveId,
    newStatus: 'in_progress',
    actorUserId: ctx.userId,
    extraFields: { completed_at: null },
  });
}

// Pass 2: unstarted + completed moves → pending (cleanup for old bug)
const { data: unstartedCompletedMoves } = await svc
  .from('order_container_moves')
  .select('id')
  .eq('tenant_id', ctx.tenantId)
  .eq('order_id', id)
  .is('started_at', null)
  .not('completed_at', 'is', null);

for (const { id: moveId } of (unstartedCompletedMoves || [])) {
  await transitionMoveStatus(svc, {
    tenantId: ctx.tenantId,
    moveId,
    newStatus: 'pending',
    actorUserId: ctx.userId,
    extraFields: { completed_at: null },
  });
}

await logTenantAction(svc, {
```

(The `orders` update at line 727-735 stays as-is — out of scope.)

- [ ] **Step 3: Run helper tests + verify grep**

```bash
cd C:/Users/bento/app-drayagedirect && node tests/routing-moves-transition.test.mjs
```

Expected: all pass.

Then confirm no stray move status writes remain:

```bash
grep -rnE "from\('order_container_moves'\)\s*\.update\(\{[^}]*status" C:/Users/bento/app-drayagedirect/pages/api C:/Users/bento/app-drayagedirect/lib --include="*.js"
```

Expected: the only match is inside `lib/routing/moves/transition.js` (the helper's own UPDATE).

- [ ] **Step 4: Commit**

```bash
git -C C:/Users/bento/app-drayagedirect add pages/api/tenant/loads/[id]/routing/index.js
git -C C:/Users/bento/app-drayagedirect commit -m "refactor(ai-ready): route complete_load + uncomplete_load bulk moves through helper

Bulk-move sites #1-3 of FU-056. Fetch-then-loop-serial pattern: each move
transition gets a history row. N small (2-6 moves per load typical).
The orders.status writes at lines ~702 and ~729 stay inline — out of scope
per spec (tracked as FU-071 for later).

Part of Stream B.1a (FU-056)."
```

---

## Phase 3 — Verification + ledger (2 tasks)

### Task 8: Full-test run + smoke test

**Files:**
- none modified (verification only)

- [ ] **Step 1: Run all transition-related tests**

```bash
cd C:/Users/bento/app-drayagedirect && node tests/charge-sets-transition.test.mjs && node tests/routing-moves-transition.test.mjs
```

Expected: both files, all tests pass. Exit code 0.

- [ ] **Step 2: Re-run existing test suite to confirm no regression**

If there's a top-level test runner script, run it. Otherwise, run each `.test.mjs` file in `tests/`:

```bash
cd C:/Users/bento/app-drayagedirect && for f in tests/*.test.mjs tests/**/*.test.mjs; do
  [ -f "$f" ] && echo "=== $f ===" && node "$f" && echo "OK" || echo "FAIL: $f"
done
```

Expected: every test file passes. If any existing test fails, investigate — the refactor may have broken a test that touched the centralized code paths.

- [ ] **Step 3: Grep spot-check for orphaned direct status writes**

```bash
# Charge sets
grep -rnE "from\('order_charge_sets'\)\s*\.update\(" C:/Users/bento/app-drayagedirect/pages/api --include="*.js" | grep -v "transitionChargeSetStatus" | head -20

# Container moves
grep -rnE "from\('order_container_moves'\)\s*\.update\(" C:/Users/bento/app-drayagedirect/pages/api --include="*.js" | grep -v "transitionMoveStatus" | head -20
```

Expected: both return minimal output. Any remaining matches should be non-status updates (e.g., updating only `notes` or `bill_to_customer_id`) — acceptable, the helper is status-specific.

If a status-write remains outside the helper, investigate. It's either a site the audit missed (add to plan) or something in the test fixtures (ignore).

- [ ] **Step 4: Manual smoke test (optional, defer if local DB setup is awkward)**

In a dev environment:
1. Create or use an existing charge_set in `draft` status for a test tenant.
2. Hit an API path that transitions it (e.g., POST to `/api/tenant/ar/invoices` to create an invoice).
3. Query `order_charge_sets_status_history` for that charge_set_id — expect exactly 1 new row with `new_status='invoiced'`.

This is the ultimate proof that the helper is correctly wired. Skip if local Supabase isn't running; the unit tests cover the helper behavior in isolation.

If any regression found in Steps 1-3, fix before proceeding. Do not continue to Task 9 with failing tests.

---

### Task 9: Open FU-071 + resolve FU-055 + FU-056

**Files:**
- Modify: `C:\Users\bento\.claude\projects\C--Users-bento-app-drayagedirect\memory\followups.md`
- Modify: `C:\Users\bento\.claude\projects\C--Users-bento-app-drayagedirect\memory\MEMORY.md` (audit-line bump)

- [ ] **Step 1: Determine next available FU number**

```bash
grep -oE "FU-[0-9]+" C:/Users/bento/.claude/projects/C--Users-bento-app-drayagedirect/memory/followups.md \
  | sort -t- -k2 -n -u | tail -1
```

Expected: `FU-070`. Next available: `FU-071`. If something higher exists (parallel session opened entries), use `max+1`.

- [ ] **Step 2: Insert FU-071 at the top of the Open section**

Add this entry to `followups.md` at the very top of the Open section (above FU-046, or whatever is currently on top):

```markdown
### FU-071: [ai-ready] State: Route routing/index.js complete_load + uncomplete_load orders.status writes through fireStatusChangeTriggers
- Source: docs/superpowers/specs/2026-04-24-transition-centralization-design.md (Stream B.1a amendment)
- Scope: small
- Area: infra
- Intent: `pages/api/tenant/loads/[id]/routing/index.js` writes `orders.status` at two sites (complete_load ~line 702, uncomplete_load ~line 729) with a direct `.update()` call, bypassing `fireStatusChangeTriggers`. Consequence: no `order_status_history` row written, no `email_template_triggers` evaluated on these transitions. Route both through `fireStatusChangeTriggers` for consistency with the rest of the orders.status flow.
- Notes: Out of scope for Stream B.1a (transition centralization for moves). Added after code reading revealed these were mis-labeled as move writes in the original FU-056. Post-refactor file state: the adjacent move transitions now go through `transitionMoveStatus`; the order writes on the next lines remain inline — make the orders pattern consistent. Blocked on: nothing — can pick up any time.
```

- [ ] **Step 3: Move FU-055 and FU-056 to the "Recently resolved" section**

The current `FU-055` and `FU-056` entries in the Open section move down to the `## Recently resolved` section. The final commit SHA isn't known yet (it'll be from Task 10); for now, use a placeholder and update in Task 10 Step 3.

Actual edit — find the two entries in the Open section and modify them:

```markdown
### FU-055: [ai-ready] State: Centralize order_charge_sets.status updates (5 locations)
- Source: docs/superpowers/audits/2026-04-24-ai-readiness-audit.md (audit run 2026-04-24)
- Resolved: 2026-04-24 in <SHA-TBD>
- Area: infra
- Intent: (original intent preserved)
- Notes: Shipped via Stream B.1a. `lib/charge-sets/transition.js` + 5 call-site refactors. See docs/superpowers/plans/2026-04-24-transition-centralization.md.

### FU-056: [ai-ready] State: Centralize order_container_moves.status fanout in routing/index.js
- Source: docs/superpowers/audits/2026-04-24-ai-readiness-audit.md (audit run 2026-04-24)
- Resolved: 2026-04-24 in <SHA-TBD>
- Area: infra
- Intent: (original intent preserved)
- Notes: Shipped via Stream B.1a. `lib/routing/moves/transition.js` + 5 call-site refactors (2 single + 3 bulk via fetch-then-loop). 2 mis-labeled `orders.status` writes at routing/index.js:702,729 re-filed as FU-071.
```

Move both to the `## Recently resolved` section (usually at the bottom of the file).

- [ ] **Step 4: Bump `MEMORY.md` audit-line**

Current state (per Stream B ship): `HEAD f83c049` (before audit) + `45 open` → `HEAD 9a89bb4` after Stream B (`69 open`). Now Stream B.1a ships:

Count current Open FU entries:

```bash
grep -cE "^### FU-[0-9]+" C:/Users/bento/.claude/projects/C--Users-bento-app-drayagedirect/memory/followups.md
```

Get current HEAD:

```bash
git -C C:/Users/bento/app-drayagedirect rev-parse --short HEAD
```

Update the line in `MEMORY.md`:

```markdown
- **[followups.md](followups.md) — open follow-ups across all sessions. Check FIRST.** Last audited 2026-04-24 (HEAD `<new SHA>`). `<new count>` open, ~17 recently-resolved.
```

(The count of "recently-resolved" bumps by 2 because FU-055 + FU-056 just moved there.)

- [ ] **Step 5: Commit**

```bash
git -C C:/Users/bento/app-drayagedirect add C:/Users/bento/.claude/projects/C--Users-bento-app-drayagedirect/memory/followups.md C:/Users/bento/.claude/projects/C--Users-bento-app-drayagedirect/memory/MEMORY.md
```

Wait — these files are outside the project repo. They're under `~/.claude/projects/`. They don't need a git commit; they're saved directly to disk.

Skip the `git add`. The followups + MEMORY edits are just Write operations.

---

## Phase 4 — Final PR commit (1 task)

### Task 10: Final wrap-up commit with `Resolves:` line

**Files:**
- Modify: `C:\Users\bento\.claude\projects\C--Users-bento-app-drayagedirect\memory\followups.md` (backfill the resolved SHA)

- [ ] **Step 1: Capture the SHA of the previous (last) commit**

```bash
git -C C:/Users/bento/app-drayagedirect rev-parse --short HEAD
```

Capture the SHA. This is the SHA Task 9 Step 3's `<SHA-TBD>` placeholders should reference.

- [ ] **Step 2: Replace `<SHA-TBD>` placeholders in followups.md**

Find the two `Resolved: 2026-04-24 in <SHA-TBD>` lines under FU-055 and FU-056 in the `## Recently resolved` section. Replace `<SHA-TBD>` with the actual SHA from Step 1.

- [ ] **Step 3: Create a lightweight closeout commit (optional)**

If there are any meaningful follow-on files to commit (e.g., if you noticed a small typo during review), commit them now with a commit message like:

```
chore(ai-ready): Stream B.1a closeout

Resolves: FU-055, FU-056

Transition centralization shipped:
 - 2 new helpers (lib/charge-sets/transition.js, lib/routing/moves/transition.js)
 - Migration 096 adds two *_status_history tables
 - 10 call sites refactored (5 charge_set + 5 move, 6 bulk fetch-then-loop + 4 direct)
 - 2 test files, 10 tests total, all passing
 - FU-071 opened for 2 mis-labeled orders.status writes in routing/index.js

Next up: Stream B.1b (event spine — generalize fireStatusChangeTriggers
and add outbox + consumer, reading from the new history tables).
```

If there's nothing to commit (all changes already committed across Tasks 1-7), skip this — the earlier commits already mention `Part of Stream B.1a (FU-055/FU-056)` and that's sufficient.

The main value of this task is backfilling the `<SHA-TBD>` placeholders in the ledger, which is a file write only (no git commit needed).

- [ ] **Step 4: Final report**

Summarize for the controller:
- Commits shipped (list SHAs from Tasks 1-7 + this one if non-empty)
- Tests: X total, all passing
- Call sites refactored: 5 (FU-055) + 5 (FU-056) = 10 total
- FU-055 + FU-056 resolved
- FU-071 opened for the 2 mis-labeled order writes
- Any notable surprises

---

## Rollout note

After this plan ships, the codebase has:
- Two helper functions that centralize `order_charge_sets.status` + `order_container_moves.status` writes
- Two new history tables accumulating audit-trail data from the moment of ship
- 10 refactored call sites all flowing through the helpers
- One remaining open gap (FU-071 — the 2 `orders.status` writes in `complete_load`/`uncomplete_load`) that Stream B.1b will naturally address as part of the event-spine generalization

**Stream B.1a is done. Stream B.1b (event spine MVP) is the next brainstorm: generalize `fireStatusChangeTriggers` across all 3 entities (orders, charge_sets, moves), add an outbox table, wire one consumer pattern.** The helpers shipped here are the seams that event-spine instrumentation will wrap.

## Risks during plan execution

1. **Migration number collision.** If migration 096 is taken, Task 1 Step 1 catches it and the implementer bumps the number everywhere. Low likelihood; single person on main typically.
2. **Import path errors.** Each call-site refactor needs the right relative path to `lib/charge-sets/transition.js` or `lib/routing/moves/transition.js`. The plan gives the specific paths; if a path is wrong, Node will throw "module not found" on first test run.
3. **Supabase chain mock diverges from helper call pattern.** If the helper does a chain pattern the mock doesn't support (e.g., `.order()`), tests will fail with `undefined is not a function`. Fix: add the missing method to the mock (return `this`).
4. **Existing tests break.** If any existing test touched the refactored call sites' behavior, it may fail. Task 8 Step 2 catches this. Mitigation: investigate the failure (is it a real regression or is the test stale?). Don't weaken tests to pass.
5. **The `charge-sets/[csId].js` refactor is the most delicate** — multi-branch PUT handler with locks, invoice numbering, rebill counters. The refactor separates status from non-status updates; verify by reading the full handler (the plan extracts only the `UPDATE` at the end, but the surrounding logic that builds `updates` must stay intact).

## Open questions — addressed by this plan

1. **Status enum names:** plan uses TEXT for history columns (per spec); test mocks use string literals that don't depend on exact enum values. Enum names are verified only if real DB calls are made during smoke test.
2. **Accurate file paths for imports:** plan specifies relative path per refactored file (3 out of 5 levels deep → 5 or 6 `../` prefixes).
3. **Running the test suite:** plan uses direct `node tests/foo.test.mjs` invocation matching existing codebase convention (`tests/dry-run-engine.test.mjs` etc.).
4. **FU-071 description:** plan allocates + drafts the entry in Task 9 Step 2.
