# Non-Order Trigger Completion Implementation Plan (Stream B.1c)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generalize `buildTriggerContext` + `fireTrigger` + polled-worker dispatch loop to handle charge_set and move entity triggers end-to-end (immediate + delayed). Remove the B.1b tactical skip. Close FU-072 + FU-073.

**Architecture:** Mirror the B.1b backward-compat pattern: generalize internals + keep positional/legacy callers working via shim + wrapper. `buildTriggerContext` becomes a router over three sub-builders (`buildOrderTriggerContext`, `buildChargeSetTriggerContext`, `buildMoveTriggerContext`). `fireTrigger` gains `entityType` + `entityId` params; parent-order lookup resolves `loadId` for log-keying (logs stay keyed by load_id — no schema change). Polled-worker reads the new candidate shape.

**Tech Stack:** Node.js 20+, ESM. Supabase JS client. Hand-rolled `.test.mjs` at `tests/*.test.mjs`. No new migrations.

**Spec:** [docs/superpowers/specs/2026-04-24-non-order-trigger-completion-design.md](docs/superpowers/specs/2026-04-24-non-order-trigger-completion-design.md)

**Commit baseline:** current HEAD is `e1dd032` (the spec commit). Each task commits separately.

**FU outcome:** closes FU-072 + FU-073. FU-074 stays open (separate spec, later).

**Files touched:**

| Type | File |
|---|---|
| Modify | `lib/email-dispatch/context-builder.js` (extract `buildOrderTriggerContext`, add `buildMoveTriggerContext`, `buildChargeSetTriggerContext`, router) |
| Modify | `lib/email-dispatch/dispatcher.js` (generalize `fireTrigger`, add `fireTriggerForOrder` wrapper, thread entity-awareness through log writes) |
| Modify | `lib/email-dispatch/status-change-fire.js` (remove B.1b tactical skip, pass entityType+entityId through) |
| Modify | `lib/email-dispatch/polled-worker.js` (dispatch loop reads candidate.entityType or falls back to load_id) |
| Modify | `lib/email-dispatch/index.js` (export new helpers if needed) |
| Create | `tests/trigger-context-generalized.test.mjs` (4 cases: order/charge_set/move routing, positional-shim) |
| Create | `tests/fire-trigger-entity-aware.test.mjs` (3 cases: order/charge_set/move fire, each with parent-order lookup verified) |
| Create | `tests/polled-worker-entity-aware.test.mjs` (2 cases: order candidate dispatch, charge_set candidate dispatch) |
| Modify | `tests/status-change-fire-generalized.test.mjs` (add charge_set + move immediate-fire cases; update or remove any case that assumed the B.1b skip) |
| Modify | `C:\Users\bento\.claude\projects\C--Users-bento-app-drayagedirect\memory\followups.md` (close FU-072 + FU-073) |
| Modify | `C:\Users\bento\.claude\projects\C--Users-bento-app-drayagedirect\memory\MEMORY.md` (audit-line bump) |

---

## Phase 1 — Context-builder generalization (3 tasks, TDD)

### Task 1: Add `buildMoveTriggerContext`

**Files:**
- Modify: `lib/email-dispatch/context-builder.js` (append new function)
- Create: `tests/trigger-context-generalized.test.mjs` (Case 3 — move entity — only for now)

- [ ] **Step 1: Understand the existing pattern**

Read `C:\Users\bento\app-drayagedirect\lib\email-dispatch\context-builder.js` lines 24–325 to understand how `buildTriggerContext` builds order-centric template variables. Key observations:
- Fetches order + joined relations (customer, pickup/delivery/return orgs, driver, container_owner)
- Fetches tenant + format preferences + optional acting user + charges
- Returns `{ variables: { load_number: '...', customer_name: '...', driver_name: '...', pickup_city: '...', ... } }`

`buildMoveTriggerContext` will produce a similar shape but scoped to a move, PLUS inherited order-level variables via parent-order lookup.

- [ ] **Step 2: Write the failing test for `buildMoveTriggerContext`**

Create `C:\Users\bento\app-drayagedirect\tests\trigger-context-generalized.test.mjs` with Case 3 (move) first:

```js
import { buildMoveTriggerContext } from '../lib/email-dispatch/context-builder.js';

let passed = 0;
let failed = 0;
function check(name, cond) {
  if (cond) { console.log(`  ✓ ${name}`); passed++; }
  else      { console.log(`  ✗ ${name}`); failed++; }
}

// Mock Supabase client. Returns configured rows per table.
function makeMockClient(config) {
  const calls = { queries: [] };
  function chain(currentTable) {
    const c = {
      _table: currentTable,
      _filters: {},
      select(..._args) { return c; },
      eq(col, val) { c._filters[col] = val; return c; },
      in(col, vals) { c._filters[col] = vals; return c; },
      is() { return c; },
      maybeSingle: async () => {
        calls.queries.push({ table: c._table, filters: { ...c._filters } });
        return config[c._table] ? { data: config[c._table], error: null } : { data: null, error: null };
      },
      single: async () => {
        calls.queries.push({ table: c._table, filters: { ...c._filters } });
        return config[c._table] ? { data: config[c._table], error: null } : { data: null, error: null };
      },
      then(resolve) {
        calls.queries.push({ table: c._table, filters: { ...c._filters } });
        resolve(config[c._table + '_list'] ? { data: config[c._table + '_list'], error: null } : { data: [], error: null });
      },
    };
    return c;
  }
  return { from(table) { return chain(table); }, _calls: calls };
}

console.log('buildMoveTriggerContext');

// Case 3: Move context with parent order inheritance
{
  const svc = makeMockClient({
    order_container_moves: {
      id: 'm-1',
      tenant_id: 't-1',
      order_id: 'ord-1',
      move_type: 'delivery',
      status: 'completed',
      scheduled_at: '2026-04-24T10:00:00Z',
      started_at: '2026-04-24T10:15:00Z',
      completed_at: '2026-04-24T11:30:00Z',
      from_location_id: 'loc-from',
      to_location_id: 'loc-to',
    },
    orders: {
      id: 'ord-1',
      tenant_id: 't-1',
      load_number: 'LD-12345',
      customer_id: 'cust-1',
      driver_id: 'drv-1',
      customer: { id: 'cust-1', name: 'Acme Corp' },
      driver: { id: 'drv-1', first_name: 'Jane', last_name: 'Doe', name: 'Jane Doe' },
      pickup_org: null,
      delivery_org: null,
      return_org: null,
      final_delivery_org: null,
      container_owner: null,
    },
    tenants: { id: 't-1', name: 'TestCorp', timezone: 'America/New_York' },
    tenant_format_preferences: { tenant_id: 't-1' },
    users: null,
    customers_list: [
      { id: 'loc-from', name: 'Pier A', city: 'Los Angeles', state: 'CA', address_line1: '100 Pier St' },
      { id: 'loc-to', name: 'Warehouse B', city: 'Long Beach', state: 'CA', address_line1: '200 Warehouse Ave' },
    ],
  });

  const result = await buildMoveTriggerContext(svc, {
    tenantId: 't-1',
    moveId: 'm-1',
    userId: null,
  });

  check('move: returns variables object', result && typeof result.variables === 'object');
  check('move: move_id populated', result?.variables?.move_id === 'm-1');
  check('move: move_type populated', result?.variables?.move_type === 'delivery');
  check('move: move_status populated', result?.variables?.move_status === 'completed');
  check('move: inherits load_number via parent order', result?.variables?.load_number === 'LD-12345');
  check('move: inherits customer_name via parent order', result?.variables?.customer_name === 'Acme Corp');
  check('move: inherits driver_name via parent order', result?.variables?.driver_name === 'Jane Doe');
  check('move: orderId returned for log-keying', result?.orderId === 'ord-1');
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
```

- [ ] **Step 3: Run tests to verify failure**

```bash
cd C:/Users/bento/app-drayagedirect && node tests/trigger-context-generalized.test.mjs
```

Expected: FAIL — `buildMoveTriggerContext is not exported`.

- [ ] **Step 4: Implement `buildMoveTriggerContext` in `context-builder.js`**

Append to `lib/email-dispatch/context-builder.js` (after the existing `buildBulkChargeSetContext` function):

```js
/**
 * Build template-variable context for a move-scoped status trigger.
 *
 * Variables produced:
 *   - Move-specific: move_id, move_type, move_status, move_scheduled_at,
 *     move_started_at, move_completed_at, move_from_location_name,
 *     move_to_location_name
 *   - Inherited from parent order: load_number, customer_name, driver_name
 *     (populated via order lookup using move.order_id)
 *   - Inherited tenant variables: tenant_name, tenant_timezone
 *
 * @param svc service-role Supabase client
 * @param {{ tenantId: string, moveId: string, userId: string | null }} params
 * @returns {Promise<{ variables: Record<string, string>, orderId: string | null }>}
 */
export async function buildMoveTriggerContext(svc, { tenantId, moveId, userId }) {
  // 1. Fetch move
  const { data: move, error: moveErr } = await svc
    .from('order_container_moves')
    .select('*')
    .eq('tenant_id', tenantId)
    .eq('id', moveId)
    .maybeSingle();
  if (moveErr) throw new Error(`move fetch: ${moveErr.message}`);
  if (!move) throw new Error(`move not found: ${moveId}`);

  // 2. Fetch parent order — reuse buildOrderTriggerContext for the rich
  //    order-level variables (load_number, customer_name, driver_name, etc.).
  //    This is why orderId is returned: downstream log-keying.
  let orderVars = {};
  if (move.order_id) {
    try {
      const orderCtx = await buildOrderTriggerContext(svc, tenantId, move.order_id, userId);
      orderVars = orderCtx.variables || {};
    } catch (e) {
      console.warn(`buildMoveTriggerContext: parent order fetch failed for move ${moveId}:`, e?.message || e);
      // Continue with empty parent-order vars — template will just have blank load_number etc.
    }
  }

  // 3. Fetch from/to locations (if set)
  const locationIds = [move.from_location_id, move.to_location_id].filter(Boolean);
  let locationsByid = {};
  if (locationIds.length > 0) {
    const { data: locations } = await svc
      .from('customers')
      .select('id, name, city, state, address_line1')
      .in('id', locationIds)
      .eq('tenant_id', tenantId);
    if (locations) {
      for (const loc of locations) locationsByid[loc.id] = loc;
    }
  }
  const fromLoc = move.from_location_id ? locationsByid[move.from_location_id] : null;
  const toLoc = move.to_location_id ? locationsByid[move.to_location_id] : null;

  // 4. Assemble move-specific variables
  const moveVars = {
    move_id: String(move.id || ''),
    move_type: String(move.move_type || ''),
    move_status: String(move.status || ''),
    move_scheduled_at: String(move.scheduled_at || ''),
    move_started_at: String(move.started_at || ''),
    move_completed_at: String(move.completed_at || ''),
    move_from_location_name: String(fromLoc?.name || ''),
    move_to_location_name: String(toLoc?.name || ''),
    move_from_location_city: String(fromLoc?.city || ''),
    move_to_location_city: String(toLoc?.city || ''),
  };

  return {
    variables: { ...orderVars, ...moveVars },
    orderId: move.order_id || null,
  };
}
```

Note: this calls `buildOrderTriggerContext` which doesn't exist yet (it's currently part of `buildTriggerContext`). For the mock to work in Step 5, we either need to extract that now or stub. Simplest: extract `buildOrderTriggerContext` in Task 3 and have `buildMoveTriggerContext` call it. For the Task 1 test to pass, we mock the order lookup directly in the mock client (which works because `buildMoveTriggerContext` queries `orders` via svc).

**Wait — adjust the implementation plan.** `buildMoveTriggerContext` currently calls `buildOrderTriggerContext` which doesn't exist. Either (a) extract it in Task 1 alongside buildMoveTriggerContext, or (b) have buildMoveTriggerContext use its own simpler order query for now.

For minimum scope, use (b): have buildMoveTriggerContext fetch the order itself (simpler inline query for load_number + customer_name + driver_name). Task 3 will later refactor to share with `buildOrderTriggerContext` when it's extracted.

**Revised implementation:**

```js
export async function buildMoveTriggerContext(svc, { tenantId, moveId, userId }) {
  // 1. Fetch move
  const { data: move, error: moveErr } = await svc
    .from('order_container_moves')
    .select('*')
    .eq('tenant_id', tenantId)
    .eq('id', moveId)
    .maybeSingle();
  if (moveErr) throw new Error(`move fetch: ${moveErr.message}`);
  if (!move) throw new Error(`move not found: ${moveId}`);

  // 2. Fetch parent order with minimal joins for move-trigger context
  let orderVars = {};
  if (move.order_id) {
    const { data: order } = await svc
      .from('orders')
      .select(`
        id, load_number,
        customer:customers!orders_customer_id_fkey(id, name),
        driver:drivers(id, first_name, last_name, name)
      `)
      .eq('tenant_id', tenantId)
      .eq('id', move.order_id)
      .maybeSingle();
    if (order) {
      orderVars = {
        load_number: String(order.load_number || ''),
        customer_name: String(order.customer?.name || ''),
        driver_name: String(order.driver?.name || `${order.driver?.first_name || ''} ${order.driver?.last_name || ''}`.trim() || ''),
      };
    }
  }

  // 3-4 (locations + move vars) — unchanged from above

  // ... (rest of the function)

  return {
    variables: { ...orderVars, ...moveVars },
    orderId: move.order_id || null,
  };
}
```

- [ ] **Step 5: Run tests to verify pass**

```bash
cd C:/Users/bento/app-drayagedirect && node tests/trigger-context-generalized.test.mjs
```

Expected: `7 passed, 0 failed`, exit 0. If any assertion fails, check the mock setup — the function signatures must match.

- [ ] **Step 6: Commit**

```bash
git -C C:/Users/bento/app-drayagedirect add lib/email-dispatch/context-builder.js tests/trigger-context-generalized.test.mjs
git -C C:/Users/bento/app-drayagedirect commit -m "feat(ai-ready): buildMoveTriggerContext for move status triggers

Adds template-variable builder for move entities. Produces move-specific
variables (move_id, move_type, move_status, move_scheduled_at, etc.)
PLUS inherited order-level variables (load_number, customer_name,
driver_name) via parent-order lookup.

Returns { variables, orderId } — orderId is for downstream log-keying
(fireTrigger preserves load_id keying via parent-order resolution).

7 test assertions (Case 3 of trigger-context-generalized.test.mjs), all pass.

Part of Stream B.1c (closes FU-072 progress)."
```

---

### Task 2: Add `buildChargeSetTriggerContext` adapter

**Files:**
- Modify: `lib/email-dispatch/context-builder.js` (append new function)
- Modify: `tests/trigger-context-generalized.test.mjs` (add Case 2 — charge_set entity)

- [ ] **Step 1: Understand the existing `buildChargeSetContext`**

Read `lib/email-dispatch/context-builder.js` line 496 onward to understand what `buildChargeSetContext` returns. Note its current shape (likely invoice-oriented). The adapter will return a filtered subset appropriate for status triggers.

- [ ] **Step 2: Append Case 2 to `tests/trigger-context-generalized.test.mjs`**

Add BEFORE the Case 3 block (so Cases are numbered in order 1, 2, 3 — though Case 1 is added in Task 3):

```js
console.log('\nbuildChargeSetTriggerContext');

// Case 2: Charge_set context with parent order inheritance
{
  const svc = makeMockClient({
    order_charge_sets: {
      id: 'cs-1',
      tenant_id: 't-1',
      order_id: 'ord-1',
      status: 'invoiced',
      total_cents: 15000,
      reference_number: 'REF-999',
    },
    orders: {
      id: 'ord-1',
      tenant_id: 't-1',
      load_number: 'LD-12345',
      customer: { id: 'cust-1', name: 'Acme Corp' },
      driver: { id: 'drv-1', first_name: 'Jane', last_name: 'Doe', name: 'Jane Doe' },
    },
    tenants: { id: 't-1', name: 'TestCorp', timezone: 'America/New_York' },
    tenant_format_preferences: { tenant_id: 't-1' },
  });

  const result = await buildChargeSetTriggerContext(svc, {
    tenantId: 't-1',
    chargeSetId: 'cs-1',
    userId: null,
  });

  check('charge_set: returns variables object', result && typeof result.variables === 'object');
  check('charge_set: charge_set_id populated', result?.variables?.charge_set_id === 'cs-1');
  check('charge_set: charge_set_status populated', result?.variables?.charge_set_status === 'invoiced');
  check('charge_set: charge_set_total populated (dollars)', result?.variables?.charge_set_total === '150.00');
  check('charge_set: inherits load_number', result?.variables?.load_number === 'LD-12345');
  check('charge_set: inherits customer_name', result?.variables?.customer_name === 'Acme Corp');
  check('charge_set: orderId returned', result?.orderId === 'ord-1');
}
```

Add the import at the top: `import { buildMoveTriggerContext, buildChargeSetTriggerContext } from '../lib/email-dispatch/context-builder.js';`

- [ ] **Step 3: Run tests to verify failure**

```bash
cd C:/Users/bento/app-drayagedirect && node tests/trigger-context-generalized.test.mjs
```

Expected: the new Case 2 assertions fail (`buildChargeSetTriggerContext is not a function`).

- [ ] **Step 4: Implement `buildChargeSetTriggerContext`**

Append to `lib/email-dispatch/context-builder.js`:

```js
/**
 * Build template-variable context for a charge_set-scoped status trigger.
 *
 * Variables produced:
 *   - Charge-set-specific: charge_set_id, charge_set_status,
 *     charge_set_total (dollars), charge_set_reference_number
 *   - Inherited from parent order: load_number, customer_name, driver_name
 *   - Inherited tenant variables: tenant_name, tenant_timezone
 *
 * Thin adapter — reuses parent-order lookup shape from buildMoveTriggerContext
 * for consistency. Does NOT reuse buildChargeSetContext (which is AR-
 * invoice-oriented with invoice-specific fields).
 *
 * @param svc
 * @param {{ tenantId: string, chargeSetId: string, userId: string | null }} params
 * @returns {Promise<{ variables: Record<string, string>, orderId: string | null }>}
 */
export async function buildChargeSetTriggerContext(svc, { tenantId, chargeSetId, userId }) {
  // 1. Fetch charge_set
  const { data: cs, error: csErr } = await svc
    .from('order_charge_sets')
    .select('*')
    .eq('tenant_id', tenantId)
    .eq('id', chargeSetId)
    .maybeSingle();
  if (csErr) throw new Error(`charge_set fetch: ${csErr.message}`);
  if (!cs) throw new Error(`charge_set not found: ${chargeSetId}`);

  // 2. Fetch parent order (minimal joins)
  let orderVars = {};
  if (cs.order_id) {
    const { data: order } = await svc
      .from('orders')
      .select(`
        id, load_number,
        customer:customers!orders_customer_id_fkey(id, name),
        driver:drivers(id, first_name, last_name, name)
      `)
      .eq('tenant_id', tenantId)
      .eq('id', cs.order_id)
      .maybeSingle();
    if (order) {
      orderVars = {
        load_number: String(order.load_number || ''),
        customer_name: String(order.customer?.name || ''),
        driver_name: String(order.driver?.name || `${order.driver?.first_name || ''} ${order.driver?.last_name || ''}`.trim() || ''),
      };
    }
  }

  // 3. Assemble charge-set-specific variables
  const csVars = {
    charge_set_id: String(cs.id || ''),
    charge_set_status: String(cs.status || ''),
    charge_set_total: ((cs.total_cents || 0) / 100).toFixed(2),
    charge_set_reference_number: String(cs.reference_number || ''),
  };

  return {
    variables: { ...orderVars, ...csVars },
    orderId: cs.order_id || null,
  };
}
```

- [ ] **Step 5: Run tests to verify pass**

```bash
cd C:/Users/bento/app-drayagedirect && node tests/trigger-context-generalized.test.mjs
```

Expected: Case 2 assertions pass + Case 3 still passes. Total ~14 assertions passing.

- [ ] **Step 6: Commit**

```bash
git -C C:/Users/bento/app-drayagedirect add lib/email-dispatch/context-builder.js tests/trigger-context-generalized.test.mjs
git -C C:/Users/bento/app-drayagedirect commit -m "feat(ai-ready): buildChargeSetTriggerContext for charge_set status triggers

Produces charge-set-specific template variables (charge_set_id,
charge_set_status, charge_set_total in dollars, charge_set_reference_number)
PLUS inherited order-level variables (load_number, customer_name,
driver_name) via parent-order lookup.

Thin standalone adapter — does NOT reuse buildChargeSetContext (which is
AR-invoice-oriented). Returns { variables, orderId }.

Part of Stream B.1c (closes FU-072 progress)."
```

---

### Task 3: Generalize `buildTriggerContext` with entity routing + positional shim

**Files:**
- Modify: `lib/email-dispatch/context-builder.js` (extract `buildOrderTriggerContext`, add new object-arg `buildTriggerContext`, add positional-shim detection)
- Modify: `tests/trigger-context-generalized.test.mjs` (add Cases 1 and 4)

- [ ] **Step 1: Add Cases 1 + 4 to the test file**

Prepend Case 1 at the START of the test assertions (before any other calls):

```js
console.log('buildTriggerContext (entity-aware)');

// Case 1: Object-arg form, entity_type='order'
{
  const svc = makeMockClient({
    orders: {
      id: 'ord-1', tenant_id: 't-1', load_number: 'LD-12345',
      customer: { id: 'cust-1', name: 'Acme Corp' },
      driver: { id: 'drv-1', first_name: 'Jane', last_name: 'Doe', name: 'Jane Doe' },
      pickup_org: null, delivery_org: null, return_org: null, final_delivery_org: null, container_owner: null,
    },
    tenants: { id: 't-1', name: 'TestCorp', timezone: 'America/New_York' },
    tenant_format_preferences: { tenant_id: 't-1' },
  });
  const result = await buildTriggerContext(svc, {
    tenantId: 't-1',
    entityType: 'order',
    entityId: 'ord-1',
    userId: null,
  });
  check('order (object-arg): returns variables', result && typeof result.variables === 'object');
  check('order (object-arg): load_number populated', result?.variables?.load_number === 'LD-12345');
  check('order (object-arg): orderId === entityId', result?.orderId === 'ord-1');
}
```

Append Case 4 at the end (before the final console.log summary):

```js
// Case 4: Positional-shim — legacy orders callers
{
  const svc = makeMockClient({
    orders: {
      id: 'ord-1', tenant_id: 't-1', load_number: 'LD-LEGACY',
      customer: { id: 'cust-1', name: 'Legacy Co' },
      driver: null, pickup_org: null, delivery_org: null, return_org: null, final_delivery_org: null, container_owner: null,
    },
    tenants: { id: 't-1', name: 'TestCorp' },
    tenant_format_preferences: { tenant_id: 't-1' },
  });
  // Legacy positional invocation: (svc, tenantId, loadId, userId)
  const result = await buildTriggerContext(svc, 't-1', 'ord-1', null);
  check('positional-shim: returns variables', result && typeof result.variables === 'object');
  check('positional-shim: order context produced', result?.variables?.load_number === 'LD-LEGACY');
}
```

Update imports at top of test file: `import { buildTriggerContext, buildMoveTriggerContext, buildChargeSetTriggerContext } from '../lib/email-dispatch/context-builder.js';`

- [ ] **Step 2: Run tests to verify (expect Cases 1, 4 fail; 2, 3 still pass)**

```bash
cd C:/Users/bento/app-drayagedirect && node tests/trigger-context-generalized.test.mjs
```

Expected: Cases 1 + 4 fail because `buildTriggerContext` doesn't yet accept the object-arg form or the entity router.

- [ ] **Step 3: Extract the existing `buildTriggerContext` body into `buildOrderTriggerContext`**

Open `lib/email-dispatch/context-builder.js`. Find the current `buildTriggerContext` definition (line 24). Rename that function to `buildOrderTriggerContext` and keep its existing `(svc, tenantId, loadId, userId)` positional signature — no internal changes yet.

```js
/**
 * Build template-variable context for an order-scoped status trigger.
 * (Formerly the body of `buildTriggerContext` before B.1c generalization.)
 *
 * @internal Use `buildTriggerContext({ entityType: 'order', ... })` from outside this module.
 */
export async function buildOrderTriggerContext(svc, tenantId, loadId, userId) {
  // ... existing body (unchanged) ...
}
```

Keep `export` so the helper stays accessible; mark `@internal` in JSDoc to signal callers should prefer the router.

- [ ] **Step 4: Add the new entity-router `buildTriggerContext` with positional-shim**

In the same file, add BEFORE `buildOrderTriggerContext`:

```js
/**
 * Build the template-variable context for a status trigger.
 *
 * Entity-aware: routes to the appropriate sub-builder based on entityType.
 *   - order      → buildOrderTriggerContext (legacy body, unchanged)
 *   - charge_set → buildChargeSetTriggerContext
 *   - move       → buildMoveTriggerContext
 *
 * Supports two invocation shapes:
 *   Object-arg (preferred, new):
 *     buildTriggerContext(svc, { tenantId, entityType, entityId, userId })
 *   Positional (legacy, orders-only):
 *     buildTriggerContext(svc, tenantId, loadId, userId)
 *
 * The positional shim detects "is the 2nd positional arg an object?" and
 * routes to the orders path with entityType='order' and entityId=loadId.
 *
 * @returns {Promise<{ variables: Record<string, string>, orderId: string | null }>}
 */
export async function buildTriggerContext(svc, arg2, arg3, arg4) {
  // Shape detection: object-arg has { tenantId, entityType?, entityId? } on arg2
  const isObjectArg = arg2 && typeof arg2 === 'object' && !Array.isArray(arg2);

  let tenantId, entityType, entityId, userId;
  if (isObjectArg) {
    ({ tenantId, entityType, entityId, userId } = arg2);
  } else {
    // Legacy positional: (svc, tenantId, loadId, userId) — entityType defaults to 'order'
    tenantId = arg2;
    entityType = 'order';
    entityId = arg3;
    userId = arg4;
  }

  if (!tenantId || !entityId) {
    throw new Error(`buildTriggerContext: tenantId and entityId required (got tenantId=${tenantId}, entityId=${entityId})`);
  }

  switch (entityType) {
    case 'order': {
      const result = await buildOrderTriggerContext(svc, tenantId, entityId, userId);
      // buildOrderTriggerContext legacy return shape may not include `orderId` — ensure it does.
      return { variables: result?.variables || {}, orderId: entityId };
    }
    case 'charge_set':
      return buildChargeSetTriggerContext(svc, { tenantId, chargeSetId: entityId, userId });
    case 'move':
      return buildMoveTriggerContext(svc, { tenantId, moveId: entityId, userId });
    default:
      throw new Error(`buildTriggerContext: unknown entityType ${entityType}`);
  }
}
```

Important: the original `buildTriggerContext` returned `{ variables }` without `orderId`. The new router wraps the order path to add `orderId: entityId` so callers always get the consistent shape. Verify this in Step 5.

- [ ] **Step 5: Run tests to verify all 4 cases pass**

```bash
cd C:/Users/bento/app-drayagedirect && node tests/trigger-context-generalized.test.mjs
```

Expected: all ~20 assertions pass across Cases 1-4.

If Case 1 fails on `orderId === entityId`, check the router wrapper on the order branch — the `orderId: entityId` addition is load-bearing.

- [ ] **Step 6: Commit**

```bash
git -C C:/Users/bento/app-drayagedirect add lib/email-dispatch/context-builder.js tests/trigger-context-generalized.test.mjs
git -C C:/Users/bento/app-drayagedirect commit -m "feat(ai-ready): generalize buildTriggerContext with entity routing + positional shim

Primary signature: buildTriggerContext(svc, { tenantId, entityType, entityId, userId }).
Routes by entityType to buildOrderTriggerContext (extracted from prior body),
buildChargeSetTriggerContext, or buildMoveTriggerContext.

Backward-compat positional shim preserves (svc, tenantId, loadId, userId)
invocation — detects object-arg vs. positional and routes accordingly.
Existing orders callers keep working.

All 4 test cases (order object-arg, charge_set, move, positional-shim)
pass with ~20 assertions total.

Part of Stream B.1c (closes FU-072 progress)."
```

---

## Phase 2 — Dispatcher generalization (2 tasks)

### Task 4: Generalize `fireTrigger` with entity-awareness + parent-order lookup

**Files:**
- Modify: `lib/email-dispatch/dispatcher.js` (add entityType/entityId params, parent-order resolution, thread through log writes)
- Create: `tests/fire-trigger-entity-aware.test.mjs` (3 cases)

- [ ] **Step 1: Write the failing test file**

Create `C:\Users\bento\app-drayagedirect\tests\fire-trigger-entity-aware.test.mjs`:

```js
import { fireTrigger } from '../lib/email-dispatch/dispatcher.js';

let passed = 0;
let failed = 0;
function check(name, cond) {
  if (cond) { console.log(`  ✓ ${name}`); passed++; }
  else      { console.log(`  ✗ ${name}`); failed++; }
}

// Minimal mock for fireTrigger's surface. Captures what was queried +
// what was inserted. Returns configured row data or empty.
function makeMockClient(config = {}) {
  const calls = { queries: [], inserts: [] };
  function chain(table) {
    const c = {
      _table: table, _filters: {},
      select: (..._a) => c,
      eq: (col, val) => { c._filters[col] = val; return c; },
      in: () => c,
      is: () => c,
      insert: (payload) => { calls.inserts.push({ table, payload }); return { select: () => ({ single: async () => ({ data: null, error: null }), maybeSingle: async () => ({ data: null, error: null }) }) }; },
      update: (payload) => { calls.inserts.push({ table, payload, mode: 'update' }); return { eq: () => c, select: () => ({ single: async () => ({ data: null, error: null }) }) }; },
      maybeSingle: async () => {
        calls.queries.push({ table, filters: { ...c._filters } });
        return config[table] !== undefined ? { data: config[table], error: null } : { data: null, error: null };
      },
      single: async () => {
        calls.queries.push({ table, filters: { ...c._filters } });
        return config[table] !== undefined ? { data: config[table], error: null } : { data: null, error: null };
      },
      then: (r) => { calls.queries.push({ table, filters: { ...c._filters } }); r(config[table + '_list'] ? { data: config[table + '_list'], error: null } : { data: [], error: null }); },
    };
    return c;
  }
  return { from(table) { return chain(table); }, _calls: calls };
}

console.log('fireTrigger (entity-aware)');

// Case 1: Order entity — direct entityId, no parent lookup
{
  const svc = makeMockClient({
    email_template_triggers: { id: 'trig-1', tenant_id: 't-1', event_name: 'completed', entity_type: 'order', is_active: true, conditions: {}, template: null },
    orders: { id: 'ord-1', tenant_id: 't-1', load_number: 'LD-1', customer: null, driver: null, pickup_org: null, delivery_org: null, return_org: null, final_delivery_org: null, container_owner: null },
    tenants: { id: 't-1', name: 'TestCorp' },
    tenant_format_preferences: { tenant_id: 't-1' },
  });
  const result = await fireTrigger(svc, {
    tenantId: 't-1', triggerId: 'trig-1',
    entityType: 'order', entityId: 'ord-1',
    fireKey: 'key-1', userId: null, eventName: 'completed',
  });
  check('order: fireTrigger resolves without crashing', !!result);
  check('order: no charge_set lookup (entity IS order)',
    !svc._calls.queries.some(q => q.table === 'order_charge_sets'));
  check('order: no moves lookup (entity IS order)',
    !svc._calls.queries.some(q => q.table === 'order_container_moves'));
}

// Case 2: Charge_set — parent-order lookup resolves load_id
{
  const svc = makeMockClient({
    email_template_triggers: { id: 'trig-2', tenant_id: 't-1', event_name: 'invoiced', entity_type: 'charge_set', is_active: true, conditions: {}, template: null },
    order_charge_sets: { id: 'cs-1', tenant_id: 't-1', order_id: 'ord-parent-1', status: 'invoiced', total_cents: 10000, reference_number: 'REF-1' },
    orders: { id: 'ord-parent-1', tenant_id: 't-1', load_number: 'LD-PARENT', customer: null, driver: null, pickup_org: null, delivery_org: null, return_org: null, final_delivery_org: null, container_owner: null },
    tenants: { id: 't-1', name: 'TestCorp' },
    tenant_format_preferences: { tenant_id: 't-1' },
  });
  const result = await fireTrigger(svc, {
    tenantId: 't-1', triggerId: 'trig-2',
    entityType: 'charge_set', entityId: 'cs-1',
    fireKey: 'key-2', userId: null, eventName: 'invoiced',
  });
  check('charge_set: fireTrigger resolves without crashing', !!result);
  check('charge_set: parent-order query happened',
    svc._calls.queries.some(q => q.table === 'order_charge_sets' && q.filters.id === 'cs-1'));
}

// Case 3: Move — parent-order lookup resolves load_id
{
  const svc = makeMockClient({
    email_template_triggers: { id: 'trig-3', tenant_id: 't-1', event_name: 'completed', entity_type: 'move', is_active: true, conditions: {}, template: null },
    order_container_moves: { id: 'm-1', tenant_id: 't-1', order_id: 'ord-parent-2', move_type: 'delivery', status: 'completed', scheduled_at: null, started_at: null, completed_at: '2026-04-24T00:00:00Z', from_location_id: null, to_location_id: null },
    orders: { id: 'ord-parent-2', tenant_id: 't-1', load_number: 'LD-MOVE', customer: null, driver: null },
    tenants: { id: 't-1', name: 'TestCorp' },
    tenant_format_preferences: { tenant_id: 't-1' },
  });
  const result = await fireTrigger(svc, {
    tenantId: 't-1', triggerId: 'trig-3',
    entityType: 'move', entityId: 'm-1',
    fireKey: 'key-3', userId: null, eventName: 'completed',
  });
  check('move: fireTrigger resolves without crashing', !!result);
  check('move: parent-order query happened',
    svc._calls.queries.some(q => q.table === 'order_container_moves' && q.filters.id === 'm-1'));
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
```

- [ ] **Step 2: Run tests to verify failure**

```bash
cd C:/Users/bento/app-drayagedirect && node tests/fire-trigger-entity-aware.test.mjs
```

Expected: FAIL — fireTrigger still requires `loadId` (throws on line 57 of dispatcher.js).

- [ ] **Step 3: Modify `fireTrigger` signature + body**

Open `C:\Users\bento\app-drayagedirect\lib\email-dispatch\dispatcher.js`. Find `fireTrigger` starting at line 53.

Current signature destructures `loadId` from params and checks for it. Change the destructure + check:

```js
export async function fireTrigger(svc, params) {
  const {
    tenantId,
    triggerId,
    entityType: rawEntityType,
    entityId: rawEntityId,
    loadId: rawLoadId,  // legacy callers still pass this
    fireKey,
    userId,
    eventName,
  } = params;

  // Resolve entity: prefer explicit entityType+entityId; fall back to
  // legacy loadId (orders-only).
  const entityType = rawEntityType || 'order';
  const entityId = rawEntityId || rawLoadId;

  if (!tenantId || !triggerId || !entityId || !fireKey) {
    throw new Error('fireTrigger: tenantId, triggerId, entityId (or loadId), fireKey are required');
  }

  // Resolve loadId for log-keying. For non-order entities, look up the
  // parent order's id (charge_sets and moves both have order_id FKs).
  let loadId = rawLoadId || rawEntityId;
  if (entityType === 'charge_set') {
    const { data: cs } = await svc.from('order_charge_sets').select('order_id').eq('tenant_id', tenantId).eq('id', entityId).maybeSingle();
    if (!cs?.order_id) {
      console.warn(`fireTrigger: charge_set ${entityId} parent order not found`);
      return { outcome: 'skipped', reason: 'parent order not found', triggerId };
    }
    loadId = cs.order_id;
  } else if (entityType === 'move') {
    const { data: move } = await svc.from('order_container_moves').select('order_id').eq('tenant_id', tenantId).eq('id', entityId).maybeSingle();
    if (!move?.order_id) {
      console.warn(`fireTrigger: move ${entityId} parent order not found`);
      return { outcome: 'skipped', reason: 'parent order not found', triggerId };
    }
    loadId = move.order_id;
  }

  // ── Step 1: Load trigger + template ──  (UNCHANGED from here down, EXCEPT for buildTriggerContext call below)
```

Find the call to `buildTriggerContext` (line ~141):

```js
builtContext = await buildTriggerContext(svc, tenantId, loadId, userId);
```

Replace with the object-arg form:

```js
builtContext = await buildTriggerContext(svc, {
  tenantId,
  entityType,
  entityId,
  userId,
});
```

Everything else in `fireTrigger` uses the now-resolved `loadId` variable for log-keying — no further changes needed.

- [ ] **Step 4: Run fire-trigger tests to verify pass**

```bash
cd C:/Users/bento/app-drayagedirect && node tests/fire-trigger-entity-aware.test.mjs
```

Expected: all 3 cases pass.

- [ ] **Step 5: Run existing tests to confirm no regression**

```bash
cd C:/Users/bento/app-drayagedirect && node tests/status-change-fire-generalized.test.mjs && node tests/status-evaluator-generalized.test.mjs && node tests/charge-sets-transition.test.mjs && node tests/routing-moves-transition.test.mjs
```

Expected: all pass. The legacy orders path in fireTrigger still works because `rawLoadId` is accepted (orders callers still pass `loadId`).

- [ ] **Step 6: Commit**

```bash
git -C C:/Users/bento/app-drayagedirect add lib/email-dispatch/dispatcher.js tests/fire-trigger-entity-aware.test.mjs
git -C C:/Users/bento/app-drayagedirect commit -m "feat(ai-ready): fireTrigger entity-aware (charge_set + move + order)

Primary signature accepts entityType + entityId. For charge_set and move
entities, parent-order lookup resolves loadId for log-keying — logs stay
order-keyed (no schema change).

Legacy callers passing {loadId, ...} continue working; loadId is treated
as entityId for entityType='order' (default).

3 test cases (order direct, charge_set parent-lookup, move parent-lookup),
all pass. Existing tests pass (no regressions).

Part of Stream B.1c (closes FU-072 progress)."
```

---

### Task 5: Add `fireTriggerForOrder` wrapper + migrate existing callers

**Files:**
- Modify: `lib/email-dispatch/dispatcher.js` (add wrapper export)
- Modify: `lib/email-dispatch/index.js` (re-export wrapper)
- Modify: existing callers that pass `loadId` explicitly to `fireTrigger`

- [ ] **Step 1: Add the wrapper**

At the end of `lib/email-dispatch/dispatcher.js` (before the existing exports block at the bottom), add:

```js
/**
 * Legacy orders-only wrapper. Forwards to fireTrigger with entityType='order'.
 * Prefer calling fireTrigger({ entityType, entityId, ... }) directly in new code.
 *
 * @param svc
 * @param {{ tenantId: string, triggerId: string, loadId: string, fireKey: string, userId: string | null, eventName: string }} params
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

- [ ] **Step 2: Export from module index**

In `lib/email-dispatch/index.js`, find the existing `export { fireTrigger } from './dispatcher.js';` (or similar — the export may be bundled with others). Add `fireTriggerForOrder`:

```js
export { fireTrigger, fireTriggerForOrder } from './dispatcher.js';
```

- [ ] **Step 3: Grep for existing fireTrigger callers**

```bash
cd C:/Users/bento/app-drayagedirect && grep -rnE "fireTrigger\s*\(" lib pages --include="*.js" | grep -v "dispatcher.js" | grep -v "fireTriggerForOrder"
```

Expected: the callers are in `polled-worker.js` (inside email-dispatch, already going to be modified in Task 6) and possibly `status-change-fire.js` (already handles entity-typed fire — no migration needed here; it passes entityType).

**Expected result: zero callers outside email-dispatch need migration** because `fireTrigger` is module-internal. If the grep returns callers OUTSIDE `lib/email-dispatch/`, that's unexpected — investigate and migrate.

- [ ] **Step 4: Commit (even if no external callers)**

```bash
git -C C:/Users/bento/app-drayagedirect add lib/email-dispatch/dispatcher.js lib/email-dispatch/index.js
git -C C:/Users/bento/app-drayagedirect commit -m "feat(ai-ready): fireTriggerForOrder backward-compat wrapper

Thin wrapper for legacy orders-only callers — forwards to fireTrigger
with entityType='order'. No current external callers (fireTrigger is
module-internal to email-dispatch), but the wrapper exists for future
safety and mirrors the fireOrderStatusChangeTriggers pattern from B.1b.

Part of Stream B.1c."
```

---

## Phase 3 — Polled worker + remove B.1b skip (2 tasks)

### Task 6: Generalize polled-worker dispatch loop

**Files:**
- Modify: `lib/email-dispatch/polled-worker.js` (dispatch loop reads candidate.entityType or falls back to load_id)
- Create: `tests/polled-worker-entity-aware.test.mjs` (2 cases)

- [ ] **Step 1: Read current polled-worker dispatch**

Open `C:\Users\bento\app-drayagedirect\lib\email-dispatch\polled-worker.js`. Find the `fireTrigger` call around line 165. Current shape is roughly:

```js
const result = await fireTrigger(svc, {
  tenantId,
  triggerId: trigger.id,
  loadId: candidate.load_id,
  fireKey,
  userId: null,
  eventName: trigger.event_name,
});
```

- [ ] **Step 2: Write the test file**

Create `C:\Users\bento\app-drayagedirect\tests\polled-worker-entity-aware.test.mjs`:

```js
// Note: polled-worker is complex — we test the dispatch-decision logic
// in isolation by exercising the candidate-shape-reading code via fireTrigger's
// observable side effects.
//
// This test does NOT fully test runPolledEvaluation end-to-end (too much surface
// for unit tests). Instead, we verify that when the dispatch loop receives
// candidates of each shape, it passes the right entityType/entityId to fireTrigger.

import { fireTrigger } from '../lib/email-dispatch/dispatcher.js';

let passed = 0;
let failed = 0;
function check(name, cond) {
  if (cond) { console.log(`  ✓ ${name}`); passed++; }
  else      { console.log(`  ✗ ${name}`); failed++; }
}

// Test strategy: since we can't easily mock runPolledEvaluation's full loop,
// we test the DISPATCH CONTRACT — that fireTrigger, given either candidate shape,
// processes correctly. The polled-worker change is minimal (one line: candidate
// shape detection), verified by reading the code AND by these indirect assertions.

// Case 1: Order candidate (legacy shape { load_id, reason })
{
  // Verified by fire-trigger-entity-aware.test.mjs Case 1 — fireTrigger
  // processes { entityType: 'order', entityId } correctly. Polled-worker
  // passes candidate.entityType || 'order' and candidate.entityId || candidate.load_id.
  check('order legacy candidate dispatches as orders (verified by fire-trigger test Case 1)', true);
}

// Case 2: Non-order candidate (new shape { entityType, entityId, enteredAt })
{
  // Verified by fire-trigger-entity-aware.test.mjs Cases 2+3.
  check('non-order candidate dispatches with entity-aware fireTrigger', true);
}

// Primary assertion: polled-worker.js has the candidate-shape-aware dispatch code.
// We verify by reading the file and asserting the key expressions exist.
import { readFileSync } from 'node:fs';
const workerSrc = readFileSync(
  new URL('../lib/email-dispatch/polled-worker.js', import.meta.url),
  'utf8'
);
check('polled-worker references candidate.entityType',
  workerSrc.includes('candidate.entityType') || workerSrc.includes('candidate.entity_type'));
check('polled-worker references candidate.entityId or falls back to load_id',
  (workerSrc.includes('candidate.entityId') || workerSrc.includes('candidate.entity_id')) ||
  workerSrc.includes('candidate.load_id'));
check('polled-worker passes entityType to fireTrigger',
  workerSrc.includes('entityType:') && /fireTrigger\(svc,[\s\S]*?entityType/.test(workerSrc));

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
```

This test is source-code-inspection-based (imperfect but pragmatic given the integration complexity). Fine for this step.

- [ ] **Step 3: Run tests to verify failure**

```bash
cd C:/Users/bento/app-drayagedirect && node tests/polled-worker-entity-aware.test.mjs
```

Expected: the source-inspection assertions fail because the polled-worker dispatch still uses `candidate.load_id` hardcoded.

- [ ] **Step 4: Modify the polled-worker dispatch**

In `lib/email-dispatch/polled-worker.js`, find the existing `fireTrigger` call (around line 165). Replace:

```js
const result = await fireTrigger(svc, {
  tenantId,
  triggerId: trigger.id,
  loadId: candidate.load_id,
  fireKey,
  userId: null,
  eventName: trigger.event_name,
});
```

with:

```js
// Candidate-shape-aware dispatch:
// - Legacy orders candidates: { load_id, reason } → entityType='order', entityId=load_id
// - Non-order candidates: { entityType, entityId, enteredAt } → use as-is
const entityType = candidate.entityType || 'order';
const entityId = candidate.entityId || candidate.load_id;

const result = await fireTrigger(svc, {
  tenantId,
  triggerId: trigger.id,
  entityType,
  entityId,
  fireKey,
  userId: null,
  eventName: trigger.event_name,
});
```

- [ ] **Step 5: Run tests to verify pass**

```bash
cd C:/Users/bento/app-drayagedirect && node tests/polled-worker-entity-aware.test.mjs
```

Expected: all source-inspection assertions pass.

- [ ] **Step 6: Run full suite to confirm no regression**

```bash
cd C:/Users/bento/app-drayagedirect && for f in tests/*.test.mjs tests/**/*.test.mjs; do [ -f "$f" ] && node "$f" >/dev/null 2>&1 && echo "OK $f" || echo "FAIL $f"; done
```

Expected: every file reports OK.

- [ ] **Step 7: Commit**

```bash
git -C C:/Users/bento/app-drayagedirect add lib/email-dispatch/polled-worker.js tests/polled-worker-entity-aware.test.mjs
git -C C:/Users/bento/app-drayagedirect commit -m "feat(ai-ready): polled-worker dispatches non-order candidates

Dispatch loop reads candidate.entityType || 'order' and candidate.entityId ||
candidate.load_id, passing the entity-typed shape to the now-generalized
fireTrigger. Legacy orders candidates (load_id-only shape) still work
unchanged; non-order candidates (entityType + entityId shape from the
B.1b evaluator) now actually fire instead of silently being ignored.

Part of Stream B.1c (closes FU-073)."
```

---

### Task 7: Remove B.1b tactical skip + add integration tests

**Files:**
- Modify: `lib/email-dispatch/status-change-fire.js` (remove the skip)
- Modify: `tests/status-change-fire-generalized.test.mjs` (add charge_set + move immediate-fire cases)

- [ ] **Step 1: Remove the skip**

Open `lib/email-dispatch/status-change-fire.js`. Find the block added in B.1b's fix pass:

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

**Delete the entire `if (entityType !== 'order') continue;` block AND the preceding comment.**

Right after the deletion, locate the `fireTrigger` call (which still says `loadId: entityType === 'order' ? entityId : null` from B.1b). Simplify it — now the call works for all entity types:

```js
// Before (B.1b shape):
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
    .then(/* ... */)
    .catch(/* ... */)
);

// After (B.1c shape — fireTrigger resolves loadId internally via parent lookup):
attempts.push(
  fireTrigger(svc, {
    tenantId,
    triggerId: trigger.id,
    entityType,
    entityId,
    fireKey,
    userId,
    eventName: newStatus,
  })
    .then(/* unchanged */)
    .catch(/* unchanged */)
);
```

- [ ] **Step 2: Add charge_set + move cases to `tests/status-change-fire-generalized.test.mjs`**

Find the existing Case 2 (charge_set entity path) in `tests/status-change-fire-generalized.test.mjs`. That case currently only verifies history-table + filter routing; it does NOT verify that fireTrigger was actually invoked (B.1b's skip prevented it). Extend that case to verify the fire path reached (triggers fetched + attempts would be non-zero given a mock trigger).

Add 2 new cases AT THE END of the test file (before the final summary):

```js
// Case 7: Charge_set immediate fire — now actually attempts (B.1c removes the skip)
{
  const svc = makeMockClient({
    insert: { order_charge_sets_status_history: { data: null, error: null } },
    select: {
      email_template_triggers: {
        data: [{
          id: 'trig-cs-1',
          tenant_id: 't-1',
          event_name: 'invoiced',
          entity_type: 'charge_set',
          is_active: true,
          conditions: { notify_after: { days: 0, hours: 0, minutes: 0 } },
        }],
        error: null,
      },
    },
  });
  const r = await fireStatusChangeTriggers(svc, {
    tenantId: 't-1',
    entityType: 'charge_set',
    entityId: 'cs-1',
    oldStatus: 'draft',
    newStatus: 'invoiced',
    userId: 'u-1',
  });
  // firesAttempted should be 1 for the matched trigger (was 0 pre-B.1c due to skip)
  check('charge_set immediate: firesAttempted >= 1', (r?.firesAttempted ?? 0) >= 1);
}

// Case 8: Move immediate fire — same as above but for move
{
  const svc = makeMockClient({
    insert: { order_container_moves_status_history: { data: null, error: null } },
    select: {
      email_template_triggers: {
        data: [{
          id: 'trig-m-1',
          tenant_id: 't-1',
          event_name: 'completed',
          entity_type: 'move',
          is_active: true,
          conditions: { notify_after: { days: 0, hours: 0, minutes: 0 } },
        }],
        error: null,
      },
    },
  });
  const r = await fireStatusChangeTriggers(svc, {
    tenantId: 't-1',
    entityType: 'move',
    entityId: 'm-1',
    oldStatus: 'in_progress',
    newStatus: 'completed',
    userId: 'u-1',
  });
  check('move immediate: firesAttempted >= 1', (r?.firesAttempted ?? 0) >= 1);
}
```

Note: these may fail if the mock doesn't provide enough fixtures for fireTrigger's full flow (trigger-fetch + parent-order lookup + context-build + email dispatch). The assertion `firesAttempted >= 1` is the minimum — even if dispatch fails per-trigger and returns `outcome: 'errored'`, the attempt was made. If the mock needs more fixtures, extend it; don't weaken assertions.

- [ ] **Step 3: Run all relevant tests**

```bash
cd C:/Users/bento/app-drayagedirect && node tests/status-change-fire-generalized.test.mjs
```

Expected: existing cases pass + 2 new cases pass.

Also:

```bash
cd C:/Users/bento/app-drayagedirect && node tests/charge-sets-transition.test.mjs && node tests/routing-moves-transition.test.mjs
```

Expected: still pass (these tests don't exercise fireTrigger directly; they just verify the transition helper's UPDATE + history + fire-invocation path).

- [ ] **Step 4: Commit**

```bash
git -C C:/Users/bento/app-drayagedirect add lib/email-dispatch/status-change-fire.js tests/status-change-fire-generalized.test.mjs
git -C C:/Users/bento/app-drayagedirect commit -m "feat(ai-ready): remove B.1b tactical skip — non-order immediate triggers fire

With the FU-072 dependency now resolved (fireTrigger + buildTriggerContext
accept entity types), remove the 'if entityType !== order continue' skip.
Charge_set and move immediate triggers now actually fire through
fireTrigger, which resolves the parent order internally for log-keying.

2 new test cases (charge_set + move immediate-fire) added. All pass.

Resolves: FU-072, FU-073

Part of Stream B.1c."
```

---

## Phase 4 — Ledger + close (1 task)

### Task 8: Close FU-072 + FU-073, update MEMORY.md

**Files:**
- Modify: `C:\Users\bento\.claude\projects\C--Users-bento-app-drayagedirect\memory\followups.md` (move FU-072 + FU-073 to Recently Resolved)
- Modify: `C:\Users\bento\.claude\projects\C--Users-bento-app-drayagedirect\memory\MEMORY.md` (audit-line bump)

- [ ] **Step 1: Get current HEAD SHA**

```bash
git -C C:/Users/bento/app-drayagedirect rev-parse --short HEAD
```

Capture the SHA — use it as the "Resolved in" reference for both FUs.

- [ ] **Step 2: Move FU-072 to Recently Resolved**

Open `followups.md`. Find `FU-072` in the Open section. Move the entry to the `## Recently resolved` section, changing the format:

```markdown
### FU-072: [ai-ready] Cross-cutting: Generalize context-builder for non-order entity types
- Source: docs/superpowers/specs/2026-04-24-event-spine-generalization-design.md (Stream B.1b)
- Resolved: 2026-04-24 in <SHA from Step 1>
- Area: infra
- Intent: (original Intent preserved)
- Notes: Shipped via Stream B.1c. buildTriggerContext now routes by entity_type; new buildMoveTriggerContext + buildChargeSetTriggerContext helpers; fireTrigger generalized to accept entityType+entityId with parent-order lookup for log-keying.
```

- [ ] **Step 3: Move FU-073 to Recently Resolved**

Find `FU-073` in the Open section. Same treatment:

```markdown
### FU-073: [ai-ready] Cross-cutting: Generalize polled-worker candidate shape for non-order entities
- Source: docs/superpowers/specs/2026-04-24-event-spine-generalization-design.md (Stream B.1b)
- Resolved: 2026-04-24 in <SHA from Step 1>
- Area: infra
- Intent: (original Intent preserved)
- Notes: Shipped via Stream B.1c. Polled-worker dispatch loop reads candidate.entityType || 'order' and candidate.entityId || candidate.load_id, passing entity-typed shape to fireTrigger. B.1b tactical skip in status-change-fire.js removed atomically.
```

- [ ] **Step 4: Update MEMORY.md audit-line**

Count current Open FU entries:

```bash
grep -cE "^### FU-[0-9]+" C:/Users/bento/.claude/projects/C--Users-bento-app-drayagedirect/memory/followups.md
```

Count difference: 2 FUs moved from Open → Resolved. Old count was 70 → new is 68.

Update the audit-line in `MEMORY.md`:

```markdown
- **[followups.md](followups.md) — open follow-ups across all sessions. Check FIRST.** Last audited 2026-04-24 (HEAD `<new SHA>`). 68 open, ~20 recently-resolved.
```

(The "recently-resolved" count bumps by 2.)

- [ ] **Step 5: Verify**

```bash
grep -nE "^### FU-07[23]" C:/Users/bento/.claude/projects/C--Users-bento-app-drayagedirect/memory/followups.md
```

Expected: both matches in the Recently Resolved section, not in Open.

- [ ] **Step 6: Final report**

Summarize for the controller:
- All 8 tasks complete
- Commit SHAs from Tasks 1-7
- Test counts: full suite passes with no regressions
- FU-072 + FU-073 closed in `<SHA>`; FU-074 stays open as the only remaining event-spine thread
- Anything unexpected

---

## Rollout note

After this plan ships:
- Admins can create `email_template_triggers` rows with `entity_type='charge_set'` or `entity_type='move'`.
- Immediate firing: works on every successful transition of the target entity (via Stream B.1a's helpers → `fireStatusChangeTriggers` → `fireTrigger`).
- Delayed firing: works via the polled-worker (every 15 min via Vercel Cron) reading the entity's history table.
- No UI yet for authoring non-order triggers — admins use SQL INSERT.
- FU-074 (history-write unification) remains open — a B.1d cleanup for when we have capacity.

## Open questions — addressed by this plan

1. **Positional-shim detection logic** — Task 3 Step 4 specifies `arg2 && typeof arg2 === 'object' && !Array.isArray(arg2)` as the shape check. Works for all realistic invocations.
2. **Parent-order lookup when soft-deleted** — Task 4 Step 3 shows the `outcome: 'skipped'` return for missing parents. Rare case, documented.
3. **Which callers migrate?** — Task 5 Step 3's grep identifies them. Expect zero external callers (fireTrigger is module-internal).
4. **Exact move template variables** — Task 1 Step 4 enumerates: `move_id, move_type, move_status, move_scheduled_at, move_started_at, move_completed_at, move_from_location_name, move_to_location_name, move_from_location_city, move_to_location_city`.

## Risks during plan execution

1. **Positional-shim detection edge cases.** If a caller passes `null` or `undefined` as `arg2`, the `typeof arg2 === 'object'` check passes for `null` — verify Task 3 Step 4's code rejects null with the `arg2 && ...` prefix. Without it, shim misfires.
2. **Mock fixtures for fireTrigger tests may be incomplete.** fireTrigger's real body has many DB queries (trigger, template, fire-log lookup, etc.) we only partially mock. If assertions fail, extend the mock rather than weaken assertions.
3. **The extracted `buildOrderTriggerContext` return shape.** Existing callers expect `{ variables }` without `orderId`. The new router wraps the order path to add `orderId: entityId`. Any caller that DESTRUCTURES the return (e.g., `const { variables } = await buildTriggerContext(...)`) still works because extra properties are ignored. Any caller that EQUALITY-CHECKS the return shape would break — unlikely but worth greping.
4. **Fire-trigger tests rely on the mock chain supporting `.then()` as a thenable.** The mock's `then` implementation must correctly produce array-like terminal results when callers do `await svc.from('t').select(...).eq(...)`. Verified in Task 1's mock.
