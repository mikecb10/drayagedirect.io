# Actor-Type Foundation Implementation Plan (Stream B.1d)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship migration 098 + thread `actorType` through 4 action-recording helpers + stamp `'system'` on all trigger-fire writes + extend `dd-ai-ready` skill with a 6th actor-attribution gate. Closes FU-067. Prepares for Stream C AI tier without retrofit.

**Architecture:** Additive, surgical. Migration adds `actor_type TEXT NOT NULL DEFAULT 'human'` + CHECK constraint to 6 tables; `agent_metadata JSONB` to `tenant_audit_log` only. Helpers gain optional `actorType` param (defaults `'human'`). Trigger-fire paths stamp `'system'` unconditionally. Existing callers unchanged in behavior.

**Tech Stack:** Supabase PostgreSQL migration (wrapped `BEGIN/COMMIT` + `NOTIFY pgrst`). Node.js ESM. Hand-rolled `.test.mjs` pattern. No new libraries.

**Spec:** [docs/superpowers/specs/2026-04-24-actor-type-foundation-design.md](docs/superpowers/specs/2026-04-24-actor-type-foundation-design.md)

**Commit baseline:** HEAD = `f5bfee8` (spec). Each task commits separately.

**FU outcome:** closes FU-067. FU-074/075/076 stay open.

**Files touched:**

| Type | File |
|---|---|
| Create | `supabase/migrations/098_actor_type_foundation.sql` |
| Modify | `lib/charge-sets/transition.js` (+ actorType param) |
| Modify | `lib/routing/moves/transition.js` (+ actorType param) |
| Modify | `lib/tenant-audit.js` (+ actorType + agentMetadata) |
| Modify | `lib/admin-audit.js` (+ actorType) |
| Modify | `lib/email-dispatch/status-change-fire.js` (stamp 'system' on history INSERT) |
| Modify | `lib/email-dispatch/dispatcher.js` (stamp 'system' on all 4+ email_trigger_log INSERTs) |
| Modify | `C:\Users\bento\.claude\skills\dd-ai-ready\SKILL.md` (add G6 gate) |
| Modify | `C:\Users\bento\.claude\projects\C--Users-bento-app-drayagedirect\memory\dev_ai_ready_skill.md` (reflect 6-gate checker) |
| Modify | `tests/charge-sets-transition.test.mjs` (+2 cases) |
| Modify | `tests/routing-moves-transition.test.mjs` (+2 cases) |
| Modify | `tests/status-change-fire-generalized.test.mjs` (+1 case) |
| Modify | `tests/fire-trigger-entity-aware.test.mjs` (+1 case) |
| Modify | `C:\Users\bento\.claude\projects\C--Users-bento-app-drayagedirect\memory\followups.md` (close FU-067) |
| Modify | `C:\Users\bento\.claude\projects\C--Users-bento-app-drayagedirect\memory\MEMORY.md` (audit-line bump) |

---

## Phase 1 — Schema (1 task)

### Task 1: Migration 098 — actor_type + agent_metadata

**Files:**
- Create: `supabase/migrations/098_actor_type_foundation.sql`

- [ ] **Step 1: Verify migration 098 is still free**

Run: `ls C:/Users/bento/app-drayagedirect/supabase/migrations/ | grep "^098"`

Expected: no match. If another branch grabbed 098, bump to next available across all files.

- [ ] **Step 2: Write the migration**

Create `C:\Users\bento\app-drayagedirect\supabase\migrations\098_actor_type_foundation.sql` with the SQL from the spec's Data Model section (6 tables × `actor_type` + `agent_metadata` on `tenant_audit_log`). Wrapped in `BEGIN; / COMMIT;` with `NOTIFY pgrst, 'reload schema';` before COMMIT. All columns use `IF NOT EXISTS`, constraints use `DROP CONSTRAINT IF EXISTS` + `ADD CONSTRAINT` for idempotent re-run.

(Spec reference — the full SQL block is in the spec's "Data Model" section at `docs/superpowers/specs/2026-04-24-actor-type-foundation-design.md`.)

- [ ] **Step 3: Apply via Supabase SQL editor**

Paste the migration into the Supabase SQL editor. Expected: "Success. No rows returned."

- [ ] **Step 4: Verify all 6 columns + the JSONB column exist**

In Supabase SQL editor:

```sql
SELECT table_name, column_name, data_type, column_default
FROM information_schema.columns
WHERE column_name IN ('actor_type', 'agent_metadata')
ORDER BY table_name, column_name;
```

Expected: 7 rows — 6 × `actor_type text 'human'::text` + 1 × `agent_metadata jsonb NULL` (on `tenant_audit_log`).

```sql
SELECT actor_type, COUNT(*) FROM tenant_audit_log GROUP BY actor_type;
```

Expected: every existing row shows `actor_type='human'` (DEFAULT backfill).

- [ ] **Step 5: Commit**

```bash
git -C C:/Users/bento/app-drayagedirect add supabase/migrations/098_actor_type_foundation.sql
git -C C:/Users/bento/app-drayagedirect commit -m "feat(ai-ready): migration 098 — actor_type + agent_metadata

Adds actor_type TEXT NOT NULL DEFAULT 'human' with CHECK ('human', 'system',
'agent') to 6 action-recording tables: tenant_audit_log, admin_audit_log,
email_trigger_log, order_status_history, order_charge_sets_status_history,
order_container_moves_status_history.

Adds agent_metadata JSONB to tenant_audit_log only (future Stream C
intent/outcome/token/cost data; no current writer).

Part of Stream B.1d (closes FU-067)."
```

---

## Phase 2 — Helper updates (4 tasks, TDD)

### Task 2: `transitionChargeSetStatus` accepts `actorType`

**Files:**
- Modify: `lib/charge-sets/transition.js` (signature + history INSERT payload)
- Modify: `tests/charge-sets-transition.test.mjs` (+2 cases)

- [ ] **Step 1: Append 2 new test cases to `tests/charge-sets-transition.test.mjs`**

Before the final `console.log` summary, add:

```js
// Case N: actorType defaults to 'human' when not provided
{
  const svc = makeMockClient({
    fetch: { data: { id: 'cs-default', status: 'draft' }, error: null },
    update: { data: { id: 'cs-default', status: 'invoiced' }, error: null },
    insert: { data: null, error: null },
  });
  await transitionChargeSetStatus(svc, {
    tenantId: 't-1', chargeSetId: 'cs-default', newStatus: 'invoiced', actorUserId: 'u-1',
  });
  const histInsert = svc._calls.inserted.find(i => i.table === 'order_charge_sets_status_history');
  check('default actorType: human stamped on history row',
    histInsert?.payload?.actor_type === 'human');
}

// Case N+1: explicit actorType: 'agent' passes through
{
  const svc = makeMockClient({
    fetch: { data: { id: 'cs-agent', status: 'draft' }, error: null },
    update: { data: { id: 'cs-agent', status: 'invoiced' }, error: null },
    insert: { data: null, error: null },
  });
  await transitionChargeSetStatus(svc, {
    tenantId: 't-1', chargeSetId: 'cs-agent', newStatus: 'invoiced', actorUserId: null,
    actorType: 'agent',
  });
  const histInsert = svc._calls.inserted.find(i => i.table === 'order_charge_sets_status_history');
  check('explicit agent actorType: stamped on history row',
    histInsert?.payload?.actor_type === 'agent');
}
```

- [ ] **Step 2: Run tests to verify failure**

```bash
cd C:/Users/bento/app-drayagedirect && node tests/charge-sets-transition.test.mjs
```

Expected: FAIL — the helper doesn't currently stamp `actor_type` on the history INSERT.

- [ ] **Step 3: Modify `lib/charge-sets/transition.js`**

Open the file. Find the function signature (JSDoc + `export async function transitionChargeSetStatus`). Update the destructure:

```js
export async function transitionChargeSetStatus(svc, params) {
  const { tenantId, chargeSetId, newStatus, actorUserId, actorType = 'human', extraFields } = params;
  // ... rest of the function body ...
```

Find the history INSERT block (after the UPDATE + no-op check). Update the INSERT payload to include `actor_type`:

```js
// BEFORE:
const { error: histErr } = await svc
  .from('order_charge_sets_status_history')
  .insert({
    tenant_id: tenantId,
    charge_set_id: chargeSetId,
    old_status: oldStatus ?? null,
    new_status: newStatus,
    changed_by: actorUserId ?? null,
  });

// AFTER:
const { error: histErr } = await svc
  .from('order_charge_sets_status_history')
  .insert({
    tenant_id: tenantId,
    charge_set_id: chargeSetId,
    old_status: oldStatus ?? null,
    new_status: newStatus,
    changed_by: actorUserId ?? null,
    actor_type: actorType,
  });
```

Also update the JSDoc at the top to include `actorType?` in the params documentation.

- [ ] **Step 4: Run tests to verify pass**

```bash
cd C:/Users/bento/app-drayagedirect && node tests/charge-sets-transition.test.mjs
```

Expected: all cases pass (existing + 2 new).

- [ ] **Step 5: Commit**

```bash
git -C C:/Users/bento/app-drayagedirect add lib/charge-sets/transition.js tests/charge-sets-transition.test.mjs
git -C C:/Users/bento/app-drayagedirect commit -m "feat(ai-ready): transitionChargeSetStatus accepts actorType

Optional actorType param (default 'human') flows into the
order_charge_sets_status_history INSERT. Existing callers unchanged —
'human' default is correct for all current API-handler-initiated paths.

2 new test cases (default human, explicit agent). All pass.

Part of Stream B.1d."
```

---

### Task 3: `transitionMoveStatus` accepts `actorType`

**Files:**
- Modify: `lib/routing/moves/transition.js`
- Modify: `tests/routing-moves-transition.test.mjs` (+2 cases)

- [ ] **Step 1: Append 2 new test cases to `tests/routing-moves-transition.test.mjs`**

Before the final summary, add:

```js
// Case N: actorType defaults to 'human' when not provided
{
  const svc = makeMockClient({
    fetch: { data: { id: 'm-default', status: 'pending' }, error: null },
    update: { data: { id: 'm-default', status: 'in_progress' }, error: null },
    insert: { data: null, error: null },
  });
  await transitionMoveStatus(svc, {
    tenantId: 't-1', moveId: 'm-default', newStatus: 'in_progress', actorUserId: 'u-1',
  });
  const histInsert = svc._calls.inserted.find(i => i.table === 'order_container_moves_status_history');
  check('default actorType: human stamped on history row',
    histInsert?.payload?.actor_type === 'human');
}

// Case N+1: explicit actorType: 'system' passes through
{
  const svc = makeMockClient({
    fetch: { data: { id: 'm-sys', status: 'pending' }, error: null },
    update: { data: { id: 'm-sys', status: 'in_progress' }, error: null },
    insert: { data: null, error: null },
  });
  await transitionMoveStatus(svc, {
    tenantId: 't-1', moveId: 'm-sys', newStatus: 'in_progress', actorUserId: null,
    actorType: 'system',
  });
  const histInsert = svc._calls.inserted.find(i => i.table === 'order_container_moves_status_history');
  check('explicit system actorType: stamped on history row',
    histInsert?.payload?.actor_type === 'system');
}
```

- [ ] **Step 2: Run tests to verify failure**

```bash
cd C:/Users/bento/app-drayagedirect && node tests/routing-moves-transition.test.mjs
```

Expected: FAIL.

- [ ] **Step 3: Modify `lib/routing/moves/transition.js`**

Update destructure to include `actorType = 'human'`:

```js
const { tenantId, moveId, newStatus, actorUserId, actorType = 'human', extraFields } = params;
```

Update the history INSERT payload to include `actor_type: actorType`:

```js
const { error: histErr } = await svc
  .from('order_container_moves_status_history')
  .insert({
    tenant_id: tenantId,
    move_id: moveId,
    old_status: oldStatus ?? null,
    new_status: newStatus,
    changed_by: actorUserId ?? null,
    actor_type: actorType,  // NEW
  });
```

Update JSDoc to document `actorType?`.

- [ ] **Step 4: Run tests to verify pass**

```bash
cd C:/Users/bento/app-drayagedirect && node tests/routing-moves-transition.test.mjs
```

Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git -C C:/Users/bento/app-drayagedirect add lib/routing/moves/transition.js tests/routing-moves-transition.test.mjs
git -C C:/Users/bento/app-drayagedirect commit -m "feat(ai-ready): transitionMoveStatus accepts actorType

Mirror of the charge_set change: optional actorType param (default
'human') flows into order_container_moves_status_history INSERT.

2 new test cases. All pass.

Part of Stream B.1d."
```

---

### Task 4: `logTenantAction` accepts `actorType` + `agentMetadata`

**Files:**
- Modify: `lib/tenant-audit.js`

- [ ] **Step 1: Read existing signature**

Open `C:\Users\bento\app-drayagedirect\lib\tenant-audit.js`. Confirm the function uses object-arg destructuring with these params (from context):

```js
export async function logTenantAction(supabase, {
  tenantId,
  userId,
  action,
  entityType,
  entityId = null,
  oldValues = null,
  newValues = null,
  ipAddress = null,
}) { /* INSERT into tenant_audit_log */ }
```

- [ ] **Step 2: Update signature + INSERT payload**

Replace with:

```js
export async function logTenantAction(supabase, {
  tenantId,
  userId,
  action,
  entityType,
  entityId = null,
  oldValues = null,
  newValues = null,
  ipAddress = null,
  actorType = 'human',    // NEW
  agentMetadata = null,   // NEW
}) {
  const { error } = await supabase.from('tenant_audit_log').insert({
    tenant_id: tenantId,
    user_id: userId,
    action,
    entity_type: entityType,
    entity_id: entityId,
    old_values: oldValues,
    new_values: newValues,
    ip_address: ipAddress,
    actor_type: actorType,       // NEW
    agent_metadata: agentMetadata, // NEW
  });

  if (error) {
    console.error('Failed to log tenant action:', error.message);
  }
}
```

No other behavior change. `getClientIp` (the other export in the file) is untouched.

- [ ] **Step 3: Verify by reading the file back**

Run: `grep -nE "actor_type|actorType|agent_metadata|agentMetadata" C:/Users/bento/app-drayagedirect/lib/tenant-audit.js`

Expected: 4 matches (2 param-level, 2 payload-level).

- [ ] **Step 4: Commit**

```bash
git -C C:/Users/bento/app-drayagedirect add lib/tenant-audit.js
git -C C:/Users/bento/app-drayagedirect commit -m "feat(ai-ready): logTenantAction accepts actorType + agentMetadata

Optional actorType (default 'human') + agentMetadata (default null)
params flow into tenant_audit_log INSERT. 252 existing call sites
continue unchanged — default is correct for all current paths.

Part of Stream B.1d (closes FU-067 schema half)."
```

---

### Task 5: `logAdminAction` accepts `actorType`

**Files:**
- Modify: `lib/admin-audit.js`

- [ ] **Step 1: Update signature + INSERT payload**

Open `C:\Users\bento\app-drayagedirect\lib\admin-audit.js`. Replace the function with:

```js
export async function logAdminAction(supabase, {
  employeeId,
  action,
  targetTenantId = null,
  targetUserId = null,
  details = null,
  ipAddress = null,
  actorType = 'human',  // NEW
}) {
  const { error } = await supabase.from('admin_audit_log').insert({
    dd_employee_id: employeeId,
    action,
    target_tenant_id: targetTenantId,
    target_user_id: targetUserId,
    details,
    ip_address: ipAddress,
    actor_type: actorType,  // NEW
  });

  if (error) {
    console.error('Failed to log admin action:', error.message);
  }
}
```

`getClientIp` (the other export) untouched. No `agent_metadata` on `admin_audit_log` per spec D5.

- [ ] **Step 2: Commit**

```bash
git -C C:/Users/bento/app-drayagedirect add lib/admin-audit.js
git -C C:/Users/bento/app-drayagedirect commit -m "feat(ai-ready): logAdminAction accepts actorType

Optional actorType (default 'human') flows into admin_audit_log INSERT.

Part of Stream B.1d."
```

---

## Phase 3 — Automation paths stamp 'system' (2 tasks)

### Task 6: `fireStatusChangeTriggers` history INSERT stamps 'system'

**Files:**
- Modify: `lib/email-dispatch/status-change-fire.js`
- Modify: `tests/status-change-fire-generalized.test.mjs` (+1 case)

- [ ] **Step 1: Add test case**

Append to `tests/status-change-fire-generalized.test.mjs` before the final summary:

```js
// Case N: fireStatusChangeTriggers stamps actor_type: 'system' on history insert
{
  const svc = makeMockClient({
    insert: { order_status_history: { data: null, error: null } },
    select: { email_template_triggers: { data: [], error: null } },
  });
  await fireStatusChangeTriggers(svc, {
    tenantId: 't-1', entityType: 'order', entityId: 'ord-sys',
    oldStatus: 'pending', newStatus: 'completed', userId: 'u-1',
  });
  const histInsert = svc._calls.inserted.find(c => c.table === 'order_status_history');
  check('fire stamps actor_type=system on history insert',
    histInsert?.payload?.actor_type === 'system');
}
```

- [ ] **Step 2: Run tests to verify failure**

```bash
cd C:/Users/bento/app-drayagedirect && node tests/status-change-fire-generalized.test.mjs
```

Expected: FAIL.

- [ ] **Step 3: Modify `fireStatusChangeTriggers` history INSERT**

Open `C:\Users\bento\app-drayagedirect\lib\email-dispatch\status-change-fire.js`. Find the history INSERT block (around line 40-52 based on earlier reads). Update the payload to include `actor_type: 'system'`:

```js
const historyRow = {
  tenant_id: tenantId,
  [config.idColumn]: entityId,
  old_status: oldStatus || null,
  new_status: newStatus,
  changed_by: userId || null,
  actor_type: 'system',  // NEW — trigger-fire is automation, not human action
};
```

Note the inline comment explaining why `'system'` — a future reader will understand this without context.

- [ ] **Step 4: Run tests to verify pass**

```bash
cd C:/Users/bento/app-drayagedirect && node tests/status-change-fire-generalized.test.mjs
```

Expected: all pass (including the new case).

- [ ] **Step 5: Commit**

```bash
git -C C:/Users/bento/app-drayagedirect add lib/email-dispatch/status-change-fire.js tests/status-change-fire-generalized.test.mjs
git -C C:/Users/bento/app-drayagedirect commit -m "feat(ai-ready): fireStatusChangeTriggers history stamps actor_type=system

Trigger-firing is automation, not human action. Every *_status_history
row written from this path stamps actor_type='system'. Distinguishes
from human-initiated transitions (via the transition helpers, which
default to 'human').

Part of Stream B.1d."
```

---

### Task 7: `fireTrigger` email_trigger_log INSERTs stamp 'system'

**Files:**
- Modify: `lib/email-dispatch/dispatcher.js` (4 INSERT sites: lines ~672, 719, 790, 838 — verify)
- Modify: `tests/fire-trigger-entity-aware.test.mjs` (+1 case)

- [ ] **Step 1: Add test case**

Append to `tests/fire-trigger-entity-aware.test.mjs` before the final summary:

```js
// Case N: fireTrigger email_trigger_log writes stamp actor_type: 'system'
{
  const svc = makeMockClient({
    email_template_triggers: {
      id: 'trig-sys', tenant_id: 't-1', event_name: 'completed',
      entity_type: 'order', is_active: true, conditions: {}, template: null,
    },
    orders: { id: 'ord-sys', tenant_id: 't-1', load_number: 'LD-SYS', customer: null, driver: null, pickup_org: null, delivery_org: null, return_org: null, final_delivery_org: null, container_owner: null },
    tenants: { id: 't-1', name: 'TestCorp' },
    tenant_format_preferences: { tenant_id: 't-1' },
  });
  await fireTrigger(svc, {
    tenantId: 't-1', triggerId: 'trig-sys',
    entityType: 'order', entityId: 'ord-sys',
    fireKey: 'key-sys', userId: null, eventName: 'completed',
  });
  const logInsert = svc._calls.inserted.find(i => i.table === 'email_trigger_log');
  check('email_trigger_log stamps actor_type=system',
    logInsert?.payload?.actor_type === 'system');
}
```

- [ ] **Step 2: Run tests to verify failure**

```bash
cd C:/Users/bento/app-drayagedirect && node tests/fire-trigger-entity-aware.test.mjs
```

Expected: FAIL.

- [ ] **Step 3: Find all `email_trigger_log` INSERT sites in `dispatcher.js`**

Run:

```bash
grep -nE "from\(['\"]email_trigger_log['\"]\)\.insert" C:/Users/bento/app-drayagedirect/lib/email-dispatch/dispatcher.js
```

Expected: 4 lines (~672, 719, 790, 838). If the count differs, process every match.

- [ ] **Step 4: Add `actor_type: 'system'` to each INSERT payload**

For each INSERT site, read the surrounding code and add `actor_type: 'system'` to the payload object. The payloads vary in shape (some have `outcome`, `outcome_detail`, etc.) — add the new field to each without disturbing others.

Example pattern (one of the sites):

```js
// BEFORE:
await svc.from('email_trigger_log').insert({
  tenant_id: tenantId,
  trigger_id: triggerId,
  template_id: templateId,
  load_id: loadId,
  event_name: eventName,
  fire_key: fireKey,
  outcome: 'fired',
  outcome_detail: null,
  // ... other fields ...
});

// AFTER:
await svc.from('email_trigger_log').insert({
  tenant_id: tenantId,
  trigger_id: triggerId,
  template_id: templateId,
  load_id: loadId,
  event_name: eventName,
  fire_key: fireKey,
  outcome: 'fired',
  outcome_detail: null,
  // ... other fields ...
  actor_type: 'system',  // trigger-fire is automation
});
```

Process all 4+ sites. Add the same inline comment at each to explain why `'system'`.

- [ ] **Step 5: Run tests to verify pass**

```bash
cd C:/Users/bento/app-drayagedirect && node tests/fire-trigger-entity-aware.test.mjs
```

Expected: all pass.

- [ ] **Step 6: Run full test suite for regression check**

```bash
cd C:/Users/bento/app-drayagedirect && for f in tests/*.test.mjs; do [ -f "$f" ] && (echo "=== $f ===" && node "$f" 2>&1 | tail -1); done
```

Expected: every file green.

- [ ] **Step 7: Commit**

```bash
git -C C:/Users/bento/app-drayagedirect add lib/email-dispatch/dispatcher.js tests/fire-trigger-entity-aware.test.mjs
git -C C:/Users/bento/app-drayagedirect commit -m "feat(ai-ready): fireTrigger email_trigger_log writes stamp actor_type=system

All ~4 email_trigger_log INSERT sites in dispatcher.js
(finalizeFired/Errored/Disabled/Deduped/Skipped) stamp actor_type='system'
— trigger-fire is automation, not human action.

Part of Stream B.1d."
```

---

## Phase 4 — dd-ai-ready skill + ledger (2 tasks)

### Task 8: Extend `dd-ai-ready` skill with G6 (actor-attribution gate)

**Files:**
- Modify: `C:\Users\bento\.claude\skills\dd-ai-ready\SKILL.md` (add G6 to gate table + adaptive check)
- Modify: `C:\Users\bento\.claude\projects\C--Users-bento-app-drayagedirect\memory\dev_ai_ready_skill.md` (reflect 6-gate checker)

- [ ] **Step 1: Read the current skill body**

Open `C:\Users\bento\.claude\skills\dd-ai-ready\SKILL.md`. Locate:
- The gate table (5 rows, G1–G5)
- The adaptive-check sections (one per gate)

- [ ] **Step 2: Add G6 to the gate table**

Append a 6th row to the table:

```markdown
| G6 | **Actor attribution** | Edit adds a new call to `logTenantAction`, `logAdminAction`, `transitionChargeSetStatus`, or `transitionMoveStatus` WITHOUT passing `actorType` — OR adds a new `.insert()` to one of 6 action-recording tables (`tenant_audit_log`, `admin_audit_log`, `email_trigger_log`, `order_status_history`, `order_charge_sets_status_history`, `order_container_moves_status_history`) WITHOUT `actor_type` in the payload |
```

- [ ] **Step 3: Add the G6 adaptive check section**

After the existing G5 (Rules-engine) branch, add:

```markdown
### Actor-attribution branch (triggered by G6)

For every new call/insert caught by G6, emit a finding with this template:

> [Actor-attribution] `<file>`:`<line>` — Call to `<helper>` doesn't pass `actorType`. Defaults to `'human'`, which is correct for current product UI paths, but if this code ever runs from an agent runtime (Stream C), it will incorrectly record the agent as a human actor. Add `actorType` explicitly: `actorType: 'human'` for user-initiated paths, `'system'` for automation (cron / trigger-fired), `'agent'` for future agent-runtime code.

Severity: **minor** (informational). The default is correct for current callers; the finding makes the classification visible to future readers.

If the edit is adding a FIRE or CRON path, the recommendation changes to `'system'` instead. If the edit is inside agent-runtime code (Stream C), recommend `'agent'`.
```

- [ ] **Step 4: Update the skill's top-level summary**

Find the "5-check gate" reference in the skill's opening description and change to "6-check gate."

- [ ] **Step 5: Update `dev_ai_ready_skill.md`**

Open `C:\Users\bento\.claude\projects\C--Users-bento-app-drayagedirect\memory\dev_ai_ready_skill.md`. Find references to the "5-check gate" and update to "6-check gate." Add G6 to whichever gate list appears there.

- [ ] **Step 6: No commit — these files are outside the repo**

Skill files and memory files live under `~/.claude/`. No `git add`. Just save via Edit/Write.

---

### Task 9: Close FU-067, open none, bump MEMORY.md

**Files:**
- Modify: `C:\Users\bento\.claude\projects\C--Users-bento-app-drayagedirect\memory\followups.md` (move FU-067 to Recently Resolved)
- Modify: `C:\Users\bento\.claude\projects\C--Users-bento-app-drayagedirect\memory\MEMORY.md` (audit-line bump)

- [ ] **Step 1: Get current HEAD SHA**

```bash
git -C C:/Users/bento/app-drayagedirect rev-parse --short HEAD
```

Capture the SHA (this is the last code commit — Task 7's).

- [ ] **Step 2: Move FU-067 to Recently Resolved in `followups.md`**

Find FU-067 in the Open section:

```markdown
### FU-067: [ai-ready] Cross-cutting: Extend tenant_audit_log with actor_type + agent_metadata columns
... (existing entry)
```

Move to `## Recently Resolved`:

```markdown
### FU-067: [ai-ready] Cross-cutting: Extend tenant_audit_log with actor_type + agent_metadata columns
- Source: docs/superpowers/audits/2026-04-24-ai-readiness-audit.md
- Resolved: 2026-04-24 in <SHA from Step 1>
- Area: infra
- Intent: (original Intent preserved)
- Notes: Shipped via Stream B.1d. Migration 098 added actor_type (NOT NULL DEFAULT 'human') to all 6 action-recording tables AND agent_metadata (JSONB) to tenant_audit_log. Helpers plumb actorType + agentMetadata through. Trigger-fire paths stamp 'system'. dd-ai-ready skill extended with G6 actor-attribution gate. Foundation for Stream C agent runtime with zero retrofit required.
```

Replace `<SHA from Step 1>` with the actual SHA.

- [ ] **Step 3: Update `MEMORY.md` audit-line**

Count current Open FU entries:

```bash
grep -cE "^### FU-[0-9]+" C:/Users/bento/.claude/projects/C--Users-bento-app-drayagedirect/memory/followups.md
```

Previous count was 68 (post-B.1c). New count = 68 - 1 (FU-067 closed) = 67.

Get HEAD SHA again (same as Step 1).

Find the audit-line in `MEMORY.md` (around line 11):

```markdown
- **[followups.md](followups.md) — open follow-ups across all sessions. Check FIRST.** Last audited 2026-04-24 (HEAD `<old SHA>`). 68 open, ~20 recently-resolved.
```

Update to:

```markdown
- **[followups.md](followups.md) — open follow-ups across all sessions. Check FIRST.** Last audited 2026-04-24 (HEAD `<new SHA>`). 67 open, ~21 recently-resolved.
```

- [ ] **Step 4: Verify**

```bash
grep -nE "^### FU-067" C:/Users/bento/.claude/projects/C--Users-bento-app-drayagedirect/memory/followups.md
```

Expected: exactly 1 match, under the `## Recently Resolved` section.

```bash
grep -nE "Last audited" C:/Users/bento/.claude/projects/C--Users-bento-app-drayagedirect/memory/MEMORY.md
```

Expected: 1 match with updated SHA + count.

- [ ] **Step 5: No commit — files outside repo**

Memory files don't go through git. Just save.

- [ ] **Step 6: Final report to controller**

Summarize:
- All 9 tasks completed (7 code commits + 2 ledger-only updates)
- Commit SHAs from Tasks 1, 2, 3, 4, 5, 6, 7 (7 total)
- Tests: full suite green, new cases pass
- Migration 098 applied via Supabase SQL editor
- FU-067 closed in `<SHA>`
- MEMORY.md bumped to `<SHA>`, 67 open
- Anything unexpected during execution

---

## Rollout note

After this plan ships:
- Every new row in the 6 action-recording tables carries actor classification
- Product polish can proceed confidently — every feature automatically inherits actor_type='human' (correct for human-initiated paths)
- Stream C agent runtime drops in with zero schema retrofit — agents just pass `actorType: 'agent'` when calling the helpers
- `dd-ai-ready` skill catches any new product-feature call site that forgets to think about actor attribution

**Deploy order:** migration 098 FIRST, then code deploy. Both directions safe (DEFAULT 'human' backfills existing rows; no-op if code reverted).

## Open questions — addressed by this plan

1. **Helper signatures verified** — both `logTenantAction` and `logAdminAction` use object-arg destructuring; no positional shim needed.
2. **email_trigger_log INSERT sites enumerated** — Task 7 Step 3 grep locates all 4+ sites; Step 4 instructs adding `actor_type: 'system'` to each.
3. **dd-ai-ready skill update mechanism** — Task 8 specifies editing `SKILL.md` in place (6-row gate table + new adaptive-check section).
4. **No migration number collision** — Task 1 Step 1 verifies; bumps if taken.

## Risks during plan execution

1. **Missing an email_trigger_log INSERT site** — grep pattern in Task 7 Step 3 is tight. If any site is missed, that log row would have NULL actor_type which the NOT NULL constraint REJECTS. Mitigation: migration DEFAULT means existing behavior without actor_type stays 'human' (NOT NULL with DEFAULT is satisfied on INSERT even if the payload doesn't include the column). Actually wait — DEFAULT applies when column is absent from INSERT. So missing a site is NOT a runtime error; it just means that site's rows silently default to 'human' instead of the intended 'system'. Flag is: spec says all trigger-fire should be 'system'. Mitigation: Task 7's test case verifies by checking one log insert. Plus Step 6's full regression check surfaces any unrelated breakage.
2. **New test cases reference fields the existing mock doesn't support** — mitigation: review existing mock in each test file before writing new cases; they already handle the basic `.insert()` path.
3. **FU-067 wording mismatch** — the actual FU-067 entry in followups.md may have slightly different text than my Task 9 Step 2 template. Implementer should preserve the existing Intent verbatim and just add the Resolved line.
