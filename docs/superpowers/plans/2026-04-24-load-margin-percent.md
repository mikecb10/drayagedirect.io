# Load Margin % Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship per-load margin % (revenue − driver pay) rendered as red/yellow/green/neutral pills across five load surfaces, with tenant-configurable thresholds in a new Settings → Accounting section, and close out the AR filter bar's Phase-C deferred `margin_from` / `margin_to` dimension.

**Architecture:** Pure compute helper (`lib/load-margin.js`) + batched two-query input fetcher. No persisted margin columns — computed live on read. Thresholds + dry-run toggle stored as three new columns on `tenants` (migration 092). Shared `<MarginBadge />` component ensures one source of truth for color + dark-mode. AR filter applier uses the secondary-query pattern established in Phase C.

**Tech Stack:** Next.js API routes · Supabase (service role bypass with explicit tenant_id scoping) · React · Tailwind (dark-mode variants mandatory per `dev_dark_mode_convention.md`) · hand-rolled `.test.mjs` tests run via `node tests/<file>.test.mjs`.

**Spec:** `docs/superpowers/specs/2026-04-24-load-margin-percent-design.md`

**Migration number:** 092 (089 = leg-distance, 090+091 = driver-planner parallel work on feat/driver-planner; 092 is next available on main-derived branch).

---

## Phase 1 — Database + Pure Engine (4 tasks)

### Task 1: Migration 092 — tenants margin-threshold columns

**Files:**
- Create: `supabase/migrations/092_load_margin_thresholds.sql`

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/092_load_margin_thresholds.sql`:

```sql
-- ============================================================
-- Migration 092: Load margin thresholds (tenant-configurable)
-- ============================================================
-- Adds three columns to `tenants` that configure the Load Margin %
-- color layer:
--   - margin_red_threshold    — at-or-below this pct = red bucket
--   - margin_yellow_threshold — above red, at-or-below this = yellow;
--                                above yellow = green
--   - margin_include_dry_runs — when FALSE, dry-run line items are
--                                excluded from both revenue and cost
--
-- Defaults: 15 / 30 / TRUE. A CHECK constraint enforces that
-- yellow > red so the bucket logic always has a non-empty yellow band.
-- ============================================================

BEGIN;

ALTER TABLE tenants
  ADD COLUMN margin_red_threshold    NUMERIC(5,2) NOT NULL DEFAULT 15.00,
  ADD COLUMN margin_yellow_threshold NUMERIC(5,2) NOT NULL DEFAULT 30.00,
  ADD COLUMN margin_include_dry_runs BOOLEAN      NOT NULL DEFAULT TRUE;

ALTER TABLE tenants
  ADD CONSTRAINT chk_margin_threshold_order
  CHECK (margin_yellow_threshold > margin_red_threshold);

NOTIFY pgrst, 'reload schema';

COMMIT;
```

- [ ] **Step 2: Apply via Supabase SQL editor or CLI**

User applies manually (project convention — migrations are hand-applied to the live DB, not run via CLI). After apply, verify:

```sql
SELECT
  margin_red_threshold,
  margin_yellow_threshold,
  margin_include_dry_runs
FROM tenants
LIMIT 3;
```

Expected: three rows (or however many tenants exist) with `15.00`, `30.00`, `TRUE`.

- [ ] **Step 3: Verify CHECK constraint rejects invalid ordering**

```sql
UPDATE tenants SET margin_yellow_threshold = 10.00 WHERE id = '<some-tenant-id>';
-- Expected: ERROR: new row for relation "tenants" violates check constraint "chk_margin_threshold_order"
```

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/092_load_margin_thresholds.sql
git commit -m "feat(load-margin): migration 092 — tenant margin threshold columns"
```

---

### Task 2: Engine unit tests (failing)

**Files:**
- Create: `tests/load-margin-engine.test.mjs`

- [ ] **Step 1: Write failing tests covering all 15 cases**

Create `tests/load-margin-engine.test.mjs`:

```js
// Hand-rolled test runner matching existing project convention
// (see tests/dry-run-engine.test.mjs, tests/routing-event-distance.test.mjs)
import { computeLoadMargin } from '../lib/load-margin.js';

let passed = 0;
let failed = 0;
function check(name, cond, detail) {
  if (cond) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failed++;
    console.log(`  ✗ ${name}${detail ? `\n    ${detail}` : ''}`);
  }
}

console.log('computeLoadMargin');

// T1: Green — 50% margin
{
  const r = computeLoadMargin({ revenueCents: 10000, costCents: 5000, redThreshold: 15, yellowThreshold: 30 });
  check('T1  50% → green', r.bucket === 'green' && r.marginPct === 50);
}

// T2: Red at lower boundary — margin = 15 should be red (≤ red threshold)
{
  const r = computeLoadMargin({ revenueCents: 10000, costCents: 8500, redThreshold: 15, yellowThreshold: 30 });
  check('T2  15% (boundary) → red', r.bucket === 'red' && r.marginPct === 15);
}

// T3: Yellow — 20%, between red and yellow
{
  const r = computeLoadMargin({ revenueCents: 10000, costCents: 8000, redThreshold: 15, yellowThreshold: 30 });
  check('T3  20% → yellow', r.bucket === 'yellow' && r.marginPct === 20);
}

// T4: Yellow at upper boundary — margin = 30 should be yellow (≤ yellow threshold)
{
  const r = computeLoadMargin({ revenueCents: 10000, costCents: 7000, redThreshold: 15, yellowThreshold: 30 });
  check('T4  30% (boundary) → yellow', r.bucket === 'yellow' && r.marginPct === 30);
}

// T5: Green — 31% is above yellow threshold
{
  const r = computeLoadMargin({ revenueCents: 10000, costCents: 6900, redThreshold: 15, yellowThreshold: 30 });
  check('T5  31% → green', r.bucket === 'green' && r.marginPct === 31);
}

// T6: Neutral — no revenue, no cost
{
  const r = computeLoadMargin({ revenueCents: 0, costCents: 0, redThreshold: 15, yellowThreshold: 30 });
  check('T6  0/0 → neutral', r.bucket === 'neutral' && r.marginPct === null);
}

// T7: Neutral — revenue but no cost
{
  const r = computeLoadMargin({ revenueCents: 10000, costCents: 0, redThreshold: 15, yellowThreshold: 30 });
  check('T7  revenue-only → neutral', r.bucket === 'neutral' && r.marginPct === null);
}

// T8: Neutral — cost but no revenue
{
  const r = computeLoadMargin({ revenueCents: 0, costCents: 5000, redThreshold: 15, yellowThreshold: 30 });
  check('T8  cost-only → neutral', r.bucket === 'neutral' && r.marginPct === null);
}

// T9: Underwater (cost > revenue) — margin is negative, should be red
{
  const r = computeLoadMargin({ revenueCents: 10000, costCents: 11000, redThreshold: 15, yellowThreshold: 30 });
  check('T9  underwater -10% → red', r.bucket === 'red' && r.marginPct === -10);
}

// T10: Defensive — NaN inputs
{
  const r = computeLoadMargin({ revenueCents: NaN, costCents: undefined, redThreshold: 15, yellowThreshold: 30 });
  check('T10 NaN/undefined → neutral', r.bucket === 'neutral' && r.marginPct === null);
}

// T11: Custom thresholds — tight margin tenant (5 / 10)
{
  const r = computeLoadMargin({ revenueCents: 10000, costCents: 9300, redThreshold: 5, yellowThreshold: 10 });
  check('T11 tight thresholds 7% → yellow', r.bucket === 'yellow' && Math.round(r.marginPct) === 7);
}

// T12: Custom thresholds — 11% with (5 / 10) → green
{
  const r = computeLoadMargin({ revenueCents: 10000, costCents: 8900, redThreshold: 5, yellowThreshold: 10 });
  check('T12 tight thresholds 11% → green', r.bucket === 'green' && Math.round(r.marginPct) === 11);
}

// T13: Rounding — 15.50001% with red threshold 15 → yellow (strictly > 15)
{
  const r = computeLoadMargin({ revenueCents: 100000, costCents: 84500, redThreshold: 15, yellowThreshold: 30 });
  // 100000 - 84500 = 15500. 15500/100000 = 15.5. Yellow (> 15, ≤ 30).
  check('T13 15.5% → yellow', r.bucket === 'yellow');
}

// T14: No overflow with very large values — use (5,10) thresholds so 30% lands firmly in green
// (with default (15,30) thresholds, 30% would be yellow by the ≤ rule, colliding with T4's boundary case)
{
  const r = computeLoadMargin({ revenueCents: 1_000_000_000, costCents: 700_000_000, redThreshold: 5, yellowThreshold: 10 });
  check('T14 $10M revenue 30% with (5,10) → green', r.bucket === 'green' && r.marginPct === 30);
}

// T15: Bucket is always one of four strings
{
  const buckets = new Set();
  for (const [rev, cost] of [[0,0],[100,50],[100,85],[100,75],[100,90],[100,110]]) {
    const r = computeLoadMargin({ revenueCents: rev, costCents: cost, redThreshold: 15, yellowThreshold: 30 });
    buckets.add(r.bucket);
  }
  check('T15 all buckets are valid strings', [...buckets].every(b => ['red','yellow','green','neutral'].includes(b)));
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
```

- [ ] **Step 2: Run to confirm failure (no engine yet)**

```bash
node tests/load-margin-engine.test.mjs
```

Expected: import error — `ERR_MODULE_NOT_FOUND: Cannot find module '.../lib/load-margin.js'` (or similar). This is the expected failure — lib/load-margin.js doesn't exist yet.

- [ ] **Step 3: Commit tests**

```bash
git add tests/load-margin-engine.test.mjs
git commit -m "test(load-margin): 15 engine tests (failing — no impl yet)"
```

---

### Task 3: `computeLoadMargin` implementation

**Files:**
- Create: `lib/load-margin.js`

- [ ] **Step 1: Implement computeLoadMargin**

Create `lib/load-margin.js`:

```js
/**
 * Pure functions for load-level margin %.
 *
 * See docs/superpowers/specs/2026-04-24-load-margin-percent-design.md
 * for design rationale.
 */

/**
 * Compute load-level margin from pre-fetched revenue + cost sums.
 *
 * @param {object}  args
 * @param {number}  args.revenueCents    SUM of order_charge_sets.total_cents (or line items when excluding dry runs)
 * @param {number}  args.costCents       SUM of order_driver_pay_lines.amount_cents
 * @param {number}  args.redThreshold    tenant.margin_red_threshold as a whole-number percent (e.g. 15)
 * @param {number}  args.yellowThreshold tenant.margin_yellow_threshold as a whole-number percent (e.g. 30)
 * @returns {{
 *   revenueCents: number,
 *   costCents: number,
 *   marginCents: number,
 *   marginPct: number|null,
 *   bucket: 'red'|'yellow'|'green'|'neutral',
 * }}
 */
export function computeLoadMargin({ revenueCents, costCents, redThreshold, yellowThreshold }) {
  const r = Number.isFinite(revenueCents) && revenueCents > 0 ? revenueCents : 0;
  const c = Number.isFinite(costCents)    && costCents    > 0 ? costCents    : 0;
  const marginCents = r - c;

  // Neutral: insufficient data on either side of the equation.
  if (r === 0 || c === 0) {
    return { revenueCents: r, costCents: c, marginCents, marginPct: null, bucket: 'neutral' };
  }

  const marginPct = (marginCents / r) * 100;

  let bucket;
  if (marginPct <= redThreshold)         bucket = 'red';
  else if (marginPct <= yellowThreshold) bucket = 'yellow';
  else                                    bucket = 'green';

  return { revenueCents: r, costCents: c, marginCents, marginPct, bucket };
}
```

- [ ] **Step 2: Run tests**

```bash
node tests/load-margin-engine.test.mjs
```

Expected: `15 passed, 0 failed`.

- [ ] **Step 3: Commit**

```bash
git add lib/load-margin.js
git commit -m "feat(load-margin): computeLoadMargin pure function (15 tests green)"
```

---

### Task 4: `fetchLoadMarginInputs` batch-fetch helper

**Files:**
- Modify: `lib/load-margin.js` — add fetchLoadMarginInputs + selectMarginRevenueSource helper

- [ ] **Step 1: Append the batch-fetch helper**

Add to `lib/load-margin.js`:

```js
/**
 * Batch-load revenue and cost sums for a set of orders.
 *
 * Runs two queries (one per side — revenue via order_charge_set_line_items,
 * cost via order_driver_pay_lines). Returns a Map keyed by order_id.
 *
 * When includeDryRuns is false, both queries add a
 *   .is('dry_run_attempt_id', null)
 * filter. Revenue is always computed from line_items (not
 * order_charge_sets.total_cents) so the dry-run filter applies uniformly.
 *
 * @param {object}  svc                 Supabase service-role client
 * @param {object}  args
 * @param {string}  args.tenantId
 * @param {string[]} args.orderIds     Scoped set of order UUIDs
 * @param {boolean} args.includeDryRuns
 * @returns {Promise<Map<string, { revenueCents: number, costCents: number }>>}
 */
export async function fetchLoadMarginInputs(svc, { tenantId, orderIds, includeDryRuns }) {
  const out = new Map();
  if (!orderIds || orderIds.length === 0) return out;
  for (const id of orderIds) out.set(id, { revenueCents: 0, costCents: 0 });

  // ── Revenue: line items → charge_set → order_id
  // First, get the charge_set → order_id mapping.
  const { data: chargeSets, error: csErr } = await svc
    .from('order_charge_sets')
    .select('id, order_id')
    .eq('tenant_id', tenantId)
    .in('order_id', orderIds);
  if (csErr) throw csErr;

  const csToOrder = new Map();
  for (const cs of chargeSets ?? []) csToOrder.set(cs.id, cs.order_id);
  const csIds = [...csToOrder.keys()];

  // Now sum line items, filtered by dry-run inclusion.
  if (csIds.length > 0) {
    let liQ = svc
      .from('order_charge_set_line_items')
      .select('charge_set_id, total_cents, dry_run_attempt_id')
      .eq('tenant_id', tenantId)
      .in('charge_set_id', csIds);
    if (!includeDryRuns) liQ = liQ.is('dry_run_attempt_id', null);
    const { data: lineItems, error: liErr } = await liQ;
    if (liErr) throw liErr;
    for (const li of lineItems ?? []) {
      const orderId = csToOrder.get(li.charge_set_id);
      if (!orderId) continue;
      const row = out.get(orderId);
      if (row) row.revenueCents += li.total_cents ?? 0;
    }
  }

  // ── Cost: driver pay lines, grouped by order_id directly
  let plQ = svc
    .from('order_driver_pay_lines')
    .select('order_id, amount_cents, dry_run_attempt_id')
    .eq('tenant_id', tenantId)
    .in('order_id', orderIds);
  if (!includeDryRuns) plQ = plQ.is('dry_run_attempt_id', null);
  const { data: payLines, error: plErr } = await plQ;
  if (plErr) throw plErr;
  for (const pl of payLines ?? []) {
    const row = out.get(pl.order_id);
    if (row) row.costCents += pl.amount_cents ?? 0;
  }

  return out;
}
```

- [ ] **Step 2: Add a second test file for the batch helper**

Create `tests/load-margin-fetch.test.mjs`:

```js
import { fetchLoadMarginInputs } from '../lib/load-margin.js';

let passed = 0;
let failed = 0;
function check(name, cond, detail) {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else      { failed++; console.log(`  ✗ ${name}${detail ? `\n    ${detail}` : ''}`); }
}

// Minimal mock of the Supabase query chain used by fetchLoadMarginInputs.
function mockSvc({ chargeSets = [], lineItems = [], payLines = [] }) {
  return {
    from(table) {
      const state = { table, filters: { in: {}, eq: {}, is: {} } };
      const chain = {
        select: () => chain,
        eq: (col, val) => { state.filters.eq[col] = val; return chain; },
        in: (col, vals) => { state.filters.in[col] = vals; return chain; },
        is: (col, val) => { state.filters.is[col] = val; return chain; },
        then: (resolve) => {
          let data;
          if (table === 'order_charge_sets') {
            data = chargeSets.filter(cs =>
              state.filters.eq.tenant_id === cs.tenant_id &&
              state.filters.in.order_id?.includes(cs.order_id));
          } else if (table === 'order_charge_set_line_items') {
            data = lineItems.filter(li =>
              state.filters.eq.tenant_id === li.tenant_id &&
              state.filters.in.charge_set_id?.includes(li.charge_set_id) &&
              (!('dry_run_attempt_id' in state.filters.is) || li.dry_run_attempt_id === null));
          } else if (table === 'order_driver_pay_lines') {
            data = payLines.filter(pl =>
              state.filters.eq.tenant_id === pl.tenant_id &&
              state.filters.in.order_id?.includes(pl.order_id) &&
              (!('dry_run_attempt_id' in state.filters.is) || pl.dry_run_attempt_id === null));
          } else {
            data = [];
          }
          return Promise.resolve({ data, error: null }).then(resolve);
        },
      };
      return chain;
    },
  };
}

console.log('fetchLoadMarginInputs');

// Fixture shared across scenarios
const T = 'tenant-1';
const O1 = 'order-1';
const O2 = 'order-2';
const CS1 = 'cs-1';
const CS2 = 'cs-2';
const DR1 = 'dry-run-1';

const fixture = {
  chargeSets: [
    { tenant_id: T, id: CS1, order_id: O1 },
    { tenant_id: T, id: CS2, order_id: O2 },
  ],
  lineItems: [
    { tenant_id: T, charge_set_id: CS1, total_cents: 10000, dry_run_attempt_id: null },
    { tenant_id: T, charge_set_id: CS1, total_cents:  2500, dry_run_attempt_id: DR1 }, // dry-run revenue
    { tenant_id: T, charge_set_id: CS2, total_cents:  8000, dry_run_attempt_id: null },
  ],
  payLines: [
    { tenant_id: T, order_id: O1, amount_cents: 5000, dry_run_attempt_id: null },
    { tenant_id: T, order_id: O1, amount_cents: 1500, dry_run_attempt_id: DR1 }, // dry-run cost
    { tenant_id: T, order_id: O2, amount_cents: 4000, dry_run_attempt_id: null },
  ],
};

// F1: includeDryRuns=true picks up dry-run line items and pay lines
{
  const svc = mockSvc(fixture);
  const result = await fetchLoadMarginInputs(svc, { tenantId: T, orderIds: [O1, O2], includeDryRuns: true });
  const o1 = result.get(O1);
  const o2 = result.get(O2);
  check('F1  includeDryRuns=true  O1 revenue = 12500', o1.revenueCents === 12500);
  check('F1  includeDryRuns=true  O1 cost    = 6500',  o1.costCents    === 6500);
  check('F1  includeDryRuns=true  O2 revenue = 8000',  o2.revenueCents === 8000);
  check('F1  includeDryRuns=true  O2 cost    = 4000',  o2.costCents    === 4000);
}

// F2: includeDryRuns=false excludes dry-run line items and pay lines
{
  const svc = mockSvc(fixture);
  const result = await fetchLoadMarginInputs(svc, { tenantId: T, orderIds: [O1, O2], includeDryRuns: false });
  const o1 = result.get(O1);
  check('F2  includeDryRuns=false O1 revenue = 10000 (dry-run LI excluded)', o1.revenueCents === 10000);
  check('F2  includeDryRuns=false O1 cost    = 5000 (dry-run PL excluded)',  o1.costCents    === 5000);
}

// F3: empty orderIds returns empty Map
{
  const svc = mockSvc(fixture);
  const result = await fetchLoadMarginInputs(svc, { tenantId: T, orderIds: [], includeDryRuns: true });
  check('F3  empty orderIds → empty map', result.size === 0);
}

// F4: unknown order (no charge sets, no pay lines) returns zero sums
{
  const svc = mockSvc(fixture);
  const result = await fetchLoadMarginInputs(svc, { tenantId: T, orderIds: ['order-missing'], includeDryRuns: true });
  const row = result.get('order-missing');
  check('F4  unknown order → { revenueCents:0, costCents:0 }', row && row.revenueCents === 0 && row.costCents === 0);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
```

- [ ] **Step 3: Run both test files**

```bash
node tests/load-margin-engine.test.mjs && node tests/load-margin-fetch.test.mjs
```

Expected: `15 passed, 0 failed` (engine) and `8 passed, 0 failed` (fetch).

- [ ] **Step 4: Commit**

```bash
git add lib/load-margin.js tests/load-margin-fetch.test.mjs
git commit -m "feat(load-margin): fetchLoadMarginInputs batch helper (8 tests green)"
```

---

## Phase 2 — Tenant Settings API + UI (3 tasks)

### Task 5: Margin thresholds API endpoint (GET + PUT)

**Files:**
- Create: `pages/api/tenant/me/margin-thresholds.js`

- [ ] **Step 1: Implement the endpoint**

Check an existing simple `/api/tenant/me/*` endpoint to copy the auth pattern. Start by reading `pages/api/tenant/dispatcher-preferences.js` to see the tenant-scoped auth + service-role pattern used elsewhere. Mirror it.

Create `pages/api/tenant/me/margin-thresholds.js`:

```js
import { requireTenantAuth } from '../../../../lib/auth-helpers';
import { supabaseAdmin } from '../../../../lib/supabase-admin';

export default async function handler(req, res) {
  const ctx = await requireTenantAuth(req, res);
  if (!ctx) return; // requireTenantAuth already wrote the 401

  if (req.method === 'GET') return handleGet(req, res, ctx);
  if (req.method === 'PUT') return handlePut(req, res, ctx);
  res.setHeader('Allow', 'GET, PUT');
  return res.status(405).json({ error: 'Method not allowed' });
}

async function handleGet(req, res, ctx) {
  const { data, error } = await supabaseAdmin
    .from('tenants')
    .select('margin_red_threshold, margin_yellow_threshold, margin_include_dry_runs')
    .eq('id', ctx.tenantId)
    .single();
  if (error) {
    console.error('margin-thresholds GET failed', error);
    return res.status(500).json({ error: 'Failed to load thresholds' });
  }
  return res.status(200).json({
    red_threshold:    Number(data.margin_red_threshold),
    yellow_threshold: Number(data.margin_yellow_threshold),
    include_dry_runs: !!data.margin_include_dry_runs,
  });
}

async function handlePut(req, res, ctx) {
  // Permission check: only SETTINGS or ALL can write
  if (!ctx.permissions.includes('SETTINGS') && !ctx.permissions.includes('ALL')) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  const { red_threshold, yellow_threshold, include_dry_runs } = req.body ?? {};

  // Validate inputs
  const red    = Number(red_threshold);
  const yellow = Number(yellow_threshold);
  if (!Number.isFinite(red) || red < 0 || red > 100) {
    return res.status(400).json({ error: 'red_threshold must be between 0 and 100' });
  }
  if (!Number.isFinite(yellow) || yellow < 0 || yellow > 100) {
    return res.status(400).json({ error: 'yellow_threshold must be between 0 and 100' });
  }
  if (yellow <= red) {
    return res.status(400).json({ error: 'yellow_threshold must exceed red_threshold' });
  }
  if (typeof include_dry_runs !== 'boolean') {
    return res.status(400).json({ error: 'include_dry_runs must be a boolean' });
  }

  const { error } = await supabaseAdmin
    .from('tenants')
    .update({
      margin_red_threshold:    red,
      margin_yellow_threshold: yellow,
      margin_include_dry_runs: include_dry_runs,
    })
    .eq('id', ctx.tenantId);

  if (error) {
    // Surface CHECK-constraint violation as 400 (defense in depth —
    // we already validated above, but DB is source of truth).
    if (error.message?.includes('chk_margin_threshold_order')) {
      return res.status(400).json({ error: 'yellow_threshold must exceed red_threshold' });
    }
    console.error('margin-thresholds PUT failed', error);
    return res.status(500).json({ error: 'Failed to save thresholds' });
  }

  return res.status(200).json({ ok: true });
}
```

> **IMPORTANT — verify during recon:** the exact names `requireTenantAuth` and `supabaseAdmin` must match the codebase. If a different helper name is used (e.g. `supabaseService`, `getTenantContext`), update the imports + call sites before committing. Read `pages/api/tenant/dispatcher-preferences.js` as the canonical reference.

- [ ] **Step 2: Quick smoke test**

Dev server running locally:

```bash
# GET as a logged-in user (browser session cookie). Use the Chrome MCP or curl with cookie.
curl -b "<cookie>" http://localhost:3000/api/tenant/me/margin-thresholds
# Expected: {"red_threshold":15,"yellow_threshold":30,"include_dry_runs":true}

# PUT with invalid ordering — expect 400
curl -b "<cookie>" -X PUT -H 'Content-Type: application/json' \
  -d '{"red_threshold":20,"yellow_threshold":10,"include_dry_runs":true}' \
  http://localhost:3000/api/tenant/me/margin-thresholds
# Expected: {"error":"yellow_threshold must exceed red_threshold"}

# PUT with valid values — expect 200 {"ok":true}
curl -b "<cookie>" -X PUT -H 'Content-Type: application/json' \
  -d '{"red_threshold":10,"yellow_threshold":25,"include_dry_runs":false}' \
  http://localhost:3000/api/tenant/me/margin-thresholds
```

- [ ] **Step 3: Commit**

```bash
git add pages/api/tenant/me/margin-thresholds.js
git commit -m "feat(load-margin): GET/PUT /api/tenant/me/margin-thresholds"
```

---

### Task 6: Settings nav — add "Accounting" group

**Files:**
- Modify: `lib/settings-nav.js`

- [ ] **Step 1: Add Percent icon import + Accounting group**

Read current `lib/settings-nav.js`. Add `Percent` to the lucide imports (alphabetical within the existing import list; if alphabetical order isn't enforced, append). Then insert a new group `'Accounting'` between `'AR'` and `'Pricing'`:

```js
// After the existing `'AR'` group, before `'Pricing'`:
{
  group: 'Accounting',
  items: [
    {
      key: 'margin_thresholds',
      label: 'Margin Thresholds',
      href: '/settings/accounting/margin',
      icon: Percent,
      requiredPermission: [PERMISSIONS.SETTINGS, PERMISSIONS.ALL],
    },
  ],
},
```

The `Percent` icon import line sits in the destructured lucide-react import block at the top of the file.

- [ ] **Step 2: Visual check**

Hit `/settings` in the browser. Sidebar should now show `Accounting → Margin Thresholds` between the AR and Pricing groups. Click the link — route resolves to `/settings/accounting/margin` (page coming in Task 7, so a 404 for now is expected).

- [ ] **Step 3: Commit**

```bash
git add lib/settings-nav.js
git commit -m "feat(load-margin): settings-nav Accounting group + Margin Thresholds entry"
```

---

### Task 7: Settings page — `/settings/accounting/margin`

**Files:**
- Create: `pages/settings/accounting/margin.js`

- [ ] **Step 1: Implement the page with form + live preview**

Read `pages/settings/dispatcher-colors.js` (or another existing SettingsLayout page) to see the file conventions — SettingsLayout wrapper, Head title, form pattern, toast/save UX.

Create `pages/settings/accounting/margin.js`:

```jsx
import { useEffect, useState } from 'react';
import Head from 'next/head';
import SettingsLayout from '../../../components/settings/SettingsLayout';
import Button from '../../../components/ui/Button';
import Input from '../../../components/ui/Input';
import MarginBadge from '../../../components/ui/MarginBadge';
import { computeLoadMargin } from '../../../lib/load-margin';

export default function MarginThresholdsPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [saved, setSaved] = useState(false);
  const [red, setRed] = useState('15');
  const [yellow, setYellow] = useState('30');
  const [includeDryRuns, setIncludeDryRuns] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const r = await fetch('/api/tenant/me/margin-thresholds');
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const data = await r.json();
        setRed(String(data.red_threshold));
        setYellow(String(data.yellow_threshold));
        setIncludeDryRuns(data.include_dry_runs);
      } catch (e) {
        setError(e.message);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const redNum    = Number(red);
  const yellowNum = Number(yellow);
  const orderingValid = Number.isFinite(redNum) && Number.isFinite(yellowNum) && yellowNum > redNum;

  async function save() {
    setError(null);
    setSaving(true);
    setSaved(false);
    try {
      const r = await fetch('/api/tenant/me/margin-thresholds', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          red_threshold: redNum,
          yellow_threshold: yellowNum,
          include_dry_runs: includeDryRuns,
        }),
      });
      if (!r.ok) {
        const body = await r.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${r.status}`);
      }
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  // Live preview sample rows — 10% / 20% / 35% margin under current thresholds.
  const previewScenarios = [
    { revenue: 10000, cost: 9000,  label: '10% margin' },
    { revenue: 10000, cost: 8000,  label: '20% margin' },
    { revenue: 10000, cost: 6500,  label: '35% margin' },
  ];

  if (loading) {
    return (
      <SettingsLayout title="Margin Thresholds">
        <div className="max-w-xl animate-pulse">
          <div className="h-8 w-64 bg-gray-200 dark:bg-slate-800 rounded mb-4" />
          <div className="h-32 bg-gray-100 dark:bg-slate-900 rounded" />
        </div>
      </SettingsLayout>
    );
  }

  return (
    <SettingsLayout title="Margin Thresholds">
      <Head><title>Margin Thresholds · DrayageDirect</title></Head>
      <div className="max-w-xl">
        <h1 className="text-xl font-semibold text-gray-900 dark:text-slate-100 mb-1">Margin Thresholds</h1>
        <p className="text-sm text-gray-500 dark:text-slate-400 mb-6">
          Loads show a colored margin pill across the dispatcher board, AR pipeline, and load detail.
          Set your thresholds here. Margin = (Revenue − Driver Pay) ÷ Revenue × 100.
        </p>

        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1">
                Red threshold (≤)
              </label>
              <div className="flex items-center gap-2">
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  max="100"
                  value={red}
                  onChange={(e) => setRed(e.target.value)}
                />
                <span className="text-sm text-gray-500 dark:text-slate-400">%</span>
              </div>
              <p className="mt-1 text-xs text-gray-500 dark:text-slate-400">
                Margins at or below this percent paint red.
              </p>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1">
                Yellow upper threshold (≤)
              </label>
              <div className="flex items-center gap-2">
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  max="100"
                  value={yellow}
                  onChange={(e) => setYellow(e.target.value)}
                />
                <span className="text-sm text-gray-500 dark:text-slate-400">%</span>
              </div>
              <p className="mt-1 text-xs text-gray-500 dark:text-slate-400">
                Above red, at-or-below this percent paints yellow. Above this paints green.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <input
              id="include_dry_runs"
              type="checkbox"
              checked={includeDryRuns}
              onChange={(e) => setIncludeDryRuns(e.target.checked)}
              className="rounded border-gray-300 dark:border-slate-600"
            />
            <label htmlFor="include_dry_runs" className="text-sm text-gray-700 dark:text-slate-300">
              Include dry runs in margin calc
            </label>
          </div>

          {!orderingValid && (
            <div className="rounded border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950 px-3 py-2 text-sm text-amber-700 dark:text-amber-300">
              Yellow threshold must be greater than red threshold.
            </div>
          )}

          {error && (
            <div className="rounded border border-red-300 dark:border-red-700 bg-red-50 dark:bg-red-950 px-3 py-2 text-sm text-red-700 dark:text-red-300">
              {error}
            </div>
          )}

          <div className="flex items-center gap-3">
            <Button onClick={save} disabled={saving || !orderingValid}>
              {saving ? 'Saving…' : 'Save'}
            </Button>
            {saved && <span className="text-sm text-emerald-600 dark:text-emerald-400">Saved.</span>}
          </div>

          <div className="mt-6 border-t border-gray-200 dark:border-slate-800 pt-4">
            <h2 className="text-sm font-medium text-gray-700 dark:text-slate-300 mb-2">
              Preview with current thresholds
            </h2>
            <div className="flex flex-wrap gap-3">
              {previewScenarios.map((s) => {
                const m = computeLoadMargin({
                  revenueCents: s.revenue,
                  costCents: s.cost,
                  redThreshold:    orderingValid ? redNum    : 15,
                  yellowThreshold: orderingValid ? yellowNum : 30,
                });
                return (
                  <div key={s.label} className="text-sm text-gray-600 dark:text-slate-400">
                    <span className="mr-2">{s.label}:</span>
                    <MarginBadge marginPct={m.marginPct} bucket={m.bucket} size="sm" />
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </SettingsLayout>
  );
}
```

This depends on `<MarginBadge />` (Task 8). If executing tasks strictly in order, Task 8 must come before Task 7, OR stub `<MarginBadge />` as `({ marginPct, bucket }) => <span>{marginPct ?? '—'}% ({bucket})</span>` temporarily. **Recommendation: swap execution order so Task 8 (MarginBadge) runs before Task 7 (page).**

- [ ] **Step 2: Visual check**

Hit `/settings/accounting/margin`. Should see form with two number inputs, toggle, preview row with three sample pills updating live as you change thresholds.

- [ ] **Step 3: Commit**

```bash
git add pages/settings/accounting/margin.js
git commit -m "feat(load-margin): Settings → Accounting → Margin Thresholds page"
```

---

## Phase 3 — Shared UI (1 task)

### Task 8: `<MarginBadge />` shared component

**Files:**
- Create: `components/ui/MarginBadge.js`

> **EXECUTE BEFORE TASK 7** if working in strict order — Task 7 imports MarginBadge.

- [ ] **Step 1: Implement the component**

Create `components/ui/MarginBadge.js`:

```jsx
/**
 * Shared margin pill rendered across dispatcher board, AR pipeline rows,
 * load detail header, and the load detail Billing tab summary.
 *
 * See docs/superpowers/specs/2026-04-24-load-margin-percent-design.md
 */

const BUCKET_CLASS = {
  red:     'bg-red-100 text-red-700 border-red-200 dark:bg-red-950 dark:text-red-300 dark:border-red-900',
  yellow:  'bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-950 dark:text-amber-300 dark:border-amber-900',
  green:   'bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-950 dark:text-emerald-300 dark:border-emerald-900',
  neutral: 'bg-gray-100 text-gray-500 border-gray-200 dark:bg-slate-800 dark:text-slate-400 dark:border-slate-700',
};

const SIZE_CLASS = {
  sm: 'text-xs px-1.5 py-0.5 rounded',
  md: 'text-sm px-2 py-1 rounded-md',
};

export default function MarginBadge({ marginPct, bucket, size = 'sm', tooltip }) {
  const label = bucket === 'neutral' || marginPct == null
    ? '—'
    : `${marginPct.toFixed(1)}%`;

  return (
    <span
      className={`inline-flex items-center border font-medium ${BUCKET_CLASS[bucket] ?? BUCKET_CLASS.neutral} ${SIZE_CLASS[size] ?? SIZE_CLASS.sm}`}
      title={tooltip}
      aria-label={tooltip ? `Margin ${label} — ${tooltip}` : `Margin ${label}`}
    >
      {label}
    </span>
  );
}
```

- [ ] **Step 2: Manual visual check**

In a temp file (or via the Settings page once Task 7 is done), render all four buckets at both sizes to eyeball dark-mode contrast.

- [ ] **Step 3: Commit**

```bash
git add components/ui/MarginBadge.js
git commit -m "feat(load-margin): shared MarginBadge component (red/yellow/green/neutral, sm/md)"
```

---

## Phase 4 — Load Detail Surfaces (3 tasks)

### Task 9: Load detail GET attaches `margin`

**Files:**
- Modify: `pages/api/tenant/loads/[id]/index.js`

- [ ] **Step 1: Read current file + identify the GET response shape**

Before editing, read the file. Find the GET handler's final `res.status(200).json({ ... })`. Note how the `load` object is shaped.

- [ ] **Step 2: Attach margin to the load object**

After the existing load fetch (but before the final response), insert:

```js
// ── Margin attach (gated by ACCOUNTS_RECEIVABLE or REPORTING) ──
if (ctx.permissions.includes('ACCOUNTS_RECEIVABLE') || ctx.permissions.includes('REPORTING') || ctx.permissions.includes('ALL')) {
  const { data: tenant, error: tErr } = await supabaseAdmin
    .from('tenants')
    .select('margin_red_threshold, margin_yellow_threshold, margin_include_dry_runs')
    .eq('id', ctx.tenantId)
    .single();
  if (!tErr && tenant) {
    const { fetchLoadMarginInputs, computeLoadMargin } = await import('../../../../../lib/load-margin.js');
    const inputs = await fetchLoadMarginInputs(supabaseAdmin, {
      tenantId: ctx.tenantId,
      orderIds: [load.id],
      includeDryRuns: tenant.margin_include_dry_runs,
    });
    const { revenueCents, costCents } = inputs.get(load.id) ?? { revenueCents: 0, costCents: 0 };
    load.margin = computeLoadMargin({
      revenueCents,
      costCents,
      redThreshold:    Number(tenant.margin_red_threshold),
      yellowThreshold: Number(tenant.margin_yellow_threshold),
    });
  }
}
// If user lacks permission, load.margin stays undefined — surfaces
// must render nothing when load.margin is missing.
```

The exact relative import path (`../../../../../lib/load-margin.js`) may differ — verify against the actual file depth. Use static imports at the top if the project convention favors them.

> **Recon note during implementation:** the exact name of the load variable (`load` vs `order`) and the auth context variable (`ctx` vs `user`) must match what's already in the file.

- [ ] **Step 3: Commit**

```bash
git add pages/api/tenant/loads/[id]/index.js
git commit -m "feat(load-margin): load detail GET attaches margin object (gated by AR/REPORTING)"
```

---

### Task 10: Load detail header — persistent badge

**Files:**
- Modify: `components/loads/LoadDetailLayout.js`

- [ ] **Step 1: Read the layout file + locate the header metadata strip**

Find the line that renders the load's status chip (search for status usage). The badge goes immediately after.

- [ ] **Step 2: Insert the badge**

Import at top:

```jsx
import MarginBadge from '../ui/MarginBadge';
```

In the header strip, after the status chip:

```jsx
{load?.margin && (
  <MarginBadge
    marginPct={load.margin.marginPct}
    bucket={load.margin.bucket}
    size="md"
    tooltip={
      load.margin.bucket === 'neutral'
        ? 'Not enough data to compute margin'
        : `Revenue $${(load.margin.revenueCents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} − Cost $${(load.margin.costCents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} = Margin $${(load.margin.marginCents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    }
  />
)}
```

Wrap in a `className="ml-2"` span if spacing looks off.

- [ ] **Step 3: Commit**

```bash
git add components/loads/LoadDetailLayout.js
git commit -m "feat(load-margin): load detail header — persistent margin badge"
```

---

### Task 11: Load detail Billing tab — summary row

**Files:**
- Modify: `components/loads/tabs/BillingTab.js`

- [ ] **Step 1: Insert summary row at top of tab content**

Read the file to find where the tab's main content starts (after loading/error states, right before the charge-set cards render). Import `MarginBadge` at the top.

Insert at the top of the main render block:

```jsx
import MarginBadge from '../../ui/MarginBadge';

// ... (inside the component's return, above the charge-set cards render):
{load?.margin && (
  <div className="mb-4 flex items-center gap-3 rounded-lg border border-gray-200 dark:border-slate-800 bg-gray-50 dark:bg-slate-900/50 px-3 py-2 text-sm">
    <span className="text-gray-600 dark:text-slate-400">Revenue</span>
    <span className="font-medium text-gray-900 dark:text-slate-100">
      {load.margin.revenueCents > 0 ? formatCents(load.margin.revenueCents) : '—'}
    </span>
    <span className="text-gray-400 dark:text-slate-600">·</span>
    <span className="text-gray-600 dark:text-slate-400">Cost</span>
    <span className="font-medium text-gray-900 dark:text-slate-100">
      {load.margin.costCents > 0 ? formatCents(load.margin.costCents) : '—'}
    </span>
    <span className="text-gray-400 dark:text-slate-600">·</span>
    <span className="text-gray-600 dark:text-slate-400">Margin</span>
    <span className="font-medium text-gray-900 dark:text-slate-100">
      {load.margin.bucket !== 'neutral' ? formatCents(load.margin.marginCents) : '—'}
    </span>
    <MarginBadge
      marginPct={load.margin.marginPct}
      bucket={load.margin.bucket}
      size="sm"
    />
  </div>
)}
```

`formatCents` already exists in this file (line 27) — reuse it.

- [ ] **Step 2: Commit**

```bash
git add components/loads/tabs/BillingTab.js
git commit -m "feat(load-margin): Billing tab summary row (Revenue · Cost · Margin pill)"
```

---

## Phase 5 — Dispatcher Board (2 tasks)

### Task 12: Loads list GET attaches `margin` per row

**Files:**
- Modify: `pages/api/tenant/loads/index.js`

- [ ] **Step 1: Read the file + identify the rows array**

Before editing, read `pages/api/tenant/loads/index.js`. Note:
- Where rows are fetched into a variable (likely `orders` or `loads`).
- The permission check helper (same pattern as the single-load endpoint).
- Where the final `res.status(200).json({ ... })` happens.

- [ ] **Step 2: Attach margin per row via single batched fetch**

After rows are loaded, before the response:

```js
import { fetchLoadMarginInputs, computeLoadMargin } from '../../../../lib/load-margin.js';

// ... (in handler, after rows are fetched and permission-checked):
if (rows.length > 0 && (ctx.permissions.includes('ACCOUNTS_RECEIVABLE') || ctx.permissions.includes('REPORTING') || ctx.permissions.includes('ALL'))) {
  const { data: tenant } = await supabaseAdmin
    .from('tenants')
    .select('margin_red_threshold, margin_yellow_threshold, margin_include_dry_runs')
    .eq('id', ctx.tenantId)
    .single();
  if (tenant) {
    const inputs = await fetchLoadMarginInputs(supabaseAdmin, {
      tenantId: ctx.tenantId,
      orderIds: rows.map(r => r.id),
      includeDryRuns: tenant.margin_include_dry_runs,
    });
    for (const row of rows) {
      const { revenueCents, costCents } = inputs.get(row.id) ?? { revenueCents: 0, costCents: 0 };
      row.margin = computeLoadMargin({
        revenueCents,
        costCents,
        redThreshold:    Number(tenant.margin_red_threshold),
        yellowThreshold: Number(tenant.margin_yellow_threshold),
      });
    }
  }
}
```

Variable name (`rows` vs `orders` vs `loads`) must match the actual file.

- [ ] **Step 3: Commit**

```bash
git add pages/api/tenant/loads/index.js
git commit -m "feat(load-margin): loads list GET attaches margin per row (dispatcher board data)"
```

---

### Task 13: Dispatcher board — margin column

**Files:**
- Modify: dispatcher board column config + row renderer

- [ ] **Step 1: Recon: find the dispatcher board's column definition**

Before editing, grep for existing dispatcher columns (e.g. `'load_number'`, `'container_number'`) to locate the column config. Likely in `components/dispatcher/columns.js` or similar. Identify:
- The column array / registry.
- The row renderer pattern (how does an existing column render?).
- How column visibility/order is persisted (per `feature_dispatcher_board.md`: `user_dispatcher_preferences.column_order`).

- [ ] **Step 2: Add `margin_pct` column entry**

```js
// Example shape — adapt to the project's column config:
{
  key: 'margin_pct',
  label: 'Margin %',
  width: 90,
  defaultVisible: false,   // opt-in; respects user prefs if they toggle on
  render: (row) =>
    row.margin
      ? <MarginBadge marginPct={row.margin.marginPct} bucket={row.margin.bucket} size="sm" />
      : null,
},
```

Add `MarginBadge` import at the top of the column file.

- [ ] **Step 3: Visual check**

Load the dispatcher board. Open column visibility panel. Toggle "Margin %" on — column appears with pills on each row. Toggle off — column disappears.

- [ ] **Step 4: Commit**

```bash
git add <files touched>
git commit -m "feat(load-margin): dispatcher board Margin % column (opt-in)"
```

---

## Phase 6 — AR Pipeline Rows (2 tasks)

### Task 14: AR Billing + Invoices endpoints attach `margin` per row

**Files:**
- Modify: `pages/api/tenant/ar/index.js`
- Modify: `pages/api/tenant/ar/invoices/index.js`

- [ ] **Step 1: AR Billing endpoint**

In `pages/api/tenant/ar/index.js`, find where charge-set rows are built for the response. After the rows array is finalized (after all filters applied, before response), attach margin by distinct order_id:

```js
import { fetchLoadMarginInputs, computeLoadMargin } from '../../../../lib/load-margin.js';

// ... (after existing filter + row-building logic):
if (rows.length > 0 && (ctx.permissions.includes('ACCOUNTS_RECEIVABLE') || ctx.permissions.includes('REPORTING') || ctx.permissions.includes('ALL'))) {
  const { data: tenant } = await supabaseAdmin
    .from('tenants')
    .select('margin_red_threshold, margin_yellow_threshold, margin_include_dry_runs')
    .eq('id', ctx.tenantId)
    .single();
  if (tenant) {
    const distinctOrderIds = [...new Set(rows.map(r => r.order_id).filter(Boolean))];
    const inputs = await fetchLoadMarginInputs(supabaseAdmin, {
      tenantId: ctx.tenantId,
      orderIds: distinctOrderIds,
      includeDryRuns: tenant.margin_include_dry_runs,
    });
    const marginByOrder = new Map();
    for (const id of distinctOrderIds) {
      const { revenueCents, costCents } = inputs.get(id) ?? { revenueCents: 0, costCents: 0 };
      marginByOrder.set(id, computeLoadMargin({
        revenueCents,
        costCents,
        redThreshold:    Number(tenant.margin_red_threshold),
        yellowThreshold: Number(tenant.margin_yellow_threshold),
      }));
    }
    for (const row of rows) row.margin = marginByOrder.get(row.order_id) ?? null;
  }
}
```

- [ ] **Step 2: AR Invoices endpoint — mirror the same pattern**

Apply the identical block to `pages/api/tenant/ar/invoices/index.js`.

- [ ] **Step 3: Commit**

```bash
git add pages/api/tenant/ar/index.js pages/api/tenant/ar/invoices/index.js
git commit -m "feat(load-margin): AR Billing + Invoices endpoints attach margin per row"
```

---

### Task 15: AR tabs — render margin column

**Files:**
- Modify: `components/ar/BillingPipelineTab.js`
- Modify: `components/ar/InvoicesTab.js`

- [ ] **Step 1: Add Margin column to Billing tab**

Read `components/ar/BillingPipelineTab.js`. Find the `<thead>` columns + the `<tbody>` row renderer. Add a `<th>Margin</th>` (position: after Bill To or Amount, whichever feels natural) and corresponding `<td>`:

```jsx
// In thead:
<th className="px-3 py-2 text-left text-xs font-medium text-gray-500 dark:text-slate-400 uppercase tracking-wider">
  Margin
</th>

// In tbody row:
<td className="px-3 py-2">
  {row.margin
    ? <MarginBadge marginPct={row.margin.marginPct} bucket={row.margin.bucket} size="sm" />
    : null}
</td>
```

Import `MarginBadge` at the top of the component.

- [ ] **Step 2: Same for InvoicesTab**

Apply the identical change to `components/ar/InvoicesTab.js`.

- [ ] **Step 3: Visual check**

Load `/ar/billing` and `/ar/invoices`. Each row shows the margin pill. All CS rows for the same load show the same pill (load-level margin).

- [ ] **Step 4: Commit**

```bash
git add components/ar/BillingPipelineTab.js components/ar/InvoicesTab.js
git commit -m "feat(load-margin): AR Billing + Invoices rows render margin pill column"
```

---

## Phase 7 — AR Filter Bar Closeout (3 tasks)

### Task 16: AR filter schema + params extension

**Files:**
- Modify: `lib/ar-filter-schema.js`
- Modify: `lib/ar-filter-params.js`
- Modify: `tests/ar-filter-schema.test.mjs`

- [ ] **Step 1: Read the schema + params files**

Know the current shape of `ALL_B2_KEYS`, `SECTION_KEYS.billing`, `SECTION_KEYS.invoices`, `STRING_KEYS`, and the `sanitizeFilterSet` function before making changes.

- [ ] **Step 2: Schema — add two keys**

In `lib/ar-filter-schema.js`, add `'margin_from'` and `'margin_to'` to `ALL_B2_KEYS`, `SECTION_KEYS.billing`, and `SECTION_KEYS.invoices`. Match alphabetical / logical placement used by existing keys.

- [ ] **Step 3: Params — STRING_KEYS extension**

In `lib/ar-filter-params.js`, append `'margin_from'` and `'margin_to'` to `STRING_KEYS`. The existing sanitizer accepts any non-empty string; no new validation logic needed (downstream treats non-numeric as no-op).

- [ ] **Step 4: Unit tests**

Extend `tests/ar-filter-schema.test.mjs`:

```js
// Existing file already has check/cover pattern. Append these cases:

check('margin_from in ALL_B2_KEYS', ALL_B2_KEYS.includes('margin_from'));
check('margin_to   in ALL_B2_KEYS', ALL_B2_KEYS.includes('margin_to'));
check('margin_from in SECTION_KEYS.billing',  SECTION_KEYS.billing.includes('margin_from'));
check('margin_to   in SECTION_KEYS.billing',  SECTION_KEYS.billing.includes('margin_to'));
check('margin_from in SECTION_KEYS.invoices', SECTION_KEYS.invoices.includes('margin_from'));
check('margin_to   in SECTION_KEYS.invoices', SECTION_KEYS.invoices.includes('margin_to'));

// Sanitizer: accepts numeric strings
{
  const s = sanitizeFilterSet({ margin_from: '15', margin_to: '30' });
  check('sanitizer keeps margin_from "15"', s.margin_from === '15');
  check('sanitizer keeps margin_to   "30"', s.margin_to   === '30');
}

// filtersMatch: both keys considered
{
  const a = { margin_from: '15' };
  const b = { margin_from: '20' };
  check('filtersMatch differs when margin_from differs', !filtersMatch(a, b));
}

// filtersAreEmpty: excludes unset margin_* keys
{
  check('empty filter set with only margin_from unset is empty',
    filtersAreEmpty({ margin_from: '', margin_to: '' }));
}
```

- [ ] **Step 5: Run tests**

```bash
node tests/ar-filter-schema.test.mjs
```

Expected: previous 46 tests + 9 new = 55 passing.

- [ ] **Step 6: Commit**

```bash
git add lib/ar-filter-schema.js lib/ar-filter-params.js tests/ar-filter-schema.test.mjs
git commit -m "feat(load-margin): AR filter schema + params support margin_from/margin_to"
```

---

### Task 17: AR endpoints apply margin filter

**Files:**
- Modify: `pages/api/tenant/ar/index.js`
- Modify: `pages/api/tenant/ar/invoices/index.js`

- [ ] **Step 1: Apply margin filter — AR Billing endpoint**

In `pages/api/tenant/ar/index.js`, after existing Phase C filters run (e.g. `rate_con_sent_y` applier), add:

```js
// ── Margin range filter ──
// Applies AFTER existing filters have narrowed the row set; reuses
// fetchLoadMarginInputs on the narrowed order ID set to compute once
// per load, then filters rows whose margin falls outside the range.
if (filters.margin_from != null || filters.margin_to != null) {
  // Tenant thresholds (already fetched above for the margin attach; reuse if so —
  // otherwise fetch once here).
  const distinctOrderIds = [...new Set(rows.map(r => r.order_id).filter(Boolean))];
  if (distinctOrderIds.length > 0 && tenant) {
    const inputs = await fetchLoadMarginInputs(supabaseAdmin, {
      tenantId: ctx.tenantId,
      orderIds: distinctOrderIds,
      includeDryRuns: tenant.margin_include_dry_runs,
    });

    const passing = new Set();
    const from = filters.margin_from !== '' && filters.margin_from != null ? Number(filters.margin_from) : null;
    const to   = filters.margin_to   !== '' && filters.margin_to   != null ? Number(filters.margin_to)   : null;

    for (const id of distinctOrderIds) {
      const { revenueCents, costCents } = inputs.get(id) ?? { revenueCents: 0, costCents: 0 };
      const m = computeLoadMargin({
        revenueCents,
        costCents,
        redThreshold:    Number(tenant.margin_red_threshold),
        yellowThreshold: Number(tenant.margin_yellow_threshold),
      });
      // Neutral buckets are excluded from numeric-range filters (no margin to compare)
      if (m.bucket === 'neutral') continue;
      if (Number.isFinite(from) && m.marginPct < from) continue;
      if (Number.isFinite(to)   && m.marginPct > to)   continue;
      passing.add(id);
    }
    rows = rows.filter(r => passing.has(r.order_id));
  }
}
```

**Optimization note:** if the margin-attach block from Task 14 has already computed `marginByOrder`, reuse that Map here — skip the redundant fetch. Otherwise the filter runs its own fetch.

- [ ] **Step 2: Mirror to Invoices endpoint**

Same block in `pages/api/tenant/ar/invoices/index.js`.

- [ ] **Step 3: Commit**

```bash
git add pages/api/tenant/ar/index.js pages/api/tenant/ar/invoices/index.js
git commit -m "feat(load-margin): AR endpoints apply margin_from/margin_to range filter"
```

---

### Task 18: FilterSidebar — Load Margin % section with quick-pick pills

**Files:**
- Modify: `components/ar/FilterSidebar.js`

- [ ] **Step 1: Fetch tenant thresholds on mount**

In FilterSidebar, add a hook to fetch thresholds once (reused for quick-pick pill values). Read current file to see how other dynamic data is loaded — likely a useEffect+fetch pattern.

```jsx
const [thresholds, setThresholds] = useState({ red: 15, yellow: 30 });
useEffect(() => {
  (async () => {
    try {
      const r = await fetch('/api/tenant/me/margin-thresholds');
      if (r.ok) {
        const d = await r.json();
        setThresholds({ red: d.red_threshold, yellow: d.yellow_threshold });
      }
    } catch {}
  })();
}, []);
```

- [ ] **Step 2: Add Load Margin % section**

After the existing "Factor Company Y/N" section (or wherever fits the sidebar's logical flow), add:

```jsx
<section className="border-b border-gray-200 dark:border-slate-800 py-3">
  <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-slate-400 mb-2">
    Load Margin %
  </h3>
  <div className="grid grid-cols-2 gap-2 mb-2">
    <input
      type="number"
      step="0.01"
      placeholder="Min %"
      className="w-full rounded border border-gray-300 dark:border-slate-600 px-2 py-1 text-sm bg-white dark:bg-slate-900 text-gray-900 dark:text-slate-100"
      value={filters.margin_from ?? ''}
      onChange={(e) => setFilter('margin_from', e.target.value)}
    />
    <input
      type="number"
      step="0.01"
      placeholder="Max %"
      className="w-full rounded border border-gray-300 dark:border-slate-600 px-2 py-1 text-sm bg-white dark:bg-slate-900 text-gray-900 dark:text-slate-100"
      value={filters.margin_to ?? ''}
      onChange={(e) => setFilter('margin_to', e.target.value)}
    />
  </div>
  <div className="flex flex-wrap gap-1">
    <button
      type="button"
      onClick={() => { setFilter('margin_from', ''); setFilter('margin_to', String(thresholds.red)); }}
      className="text-xs px-2 py-0.5 rounded border border-red-300 text-red-700 dark:border-red-800 dark:text-red-300"
    >
      Red only
    </button>
    <button
      type="button"
      onClick={() => { setFilter('margin_from', String(thresholds.red + 0.01)); setFilter('margin_to', ''); }}
      className="text-xs px-2 py-0.5 rounded border border-amber-300 text-amber-700 dark:border-amber-800 dark:text-amber-300"
    >
      Yellow+
    </button>
    <button
      type="button"
      onClick={() => { setFilter('margin_from', String(thresholds.yellow + 0.01)); setFilter('margin_to', ''); }}
      className="text-xs px-2 py-0.5 rounded border border-emerald-300 text-emerald-700 dark:border-emerald-800 dark:text-emerald-300"
    >
      Green+
    </button>
    <button
      type="button"
      onClick={() => { setFilter('margin_from', ''); setFilter('margin_to', ''); }}
      className="text-xs px-2 py-0.5 rounded border border-gray-300 text-gray-600 dark:border-slate-700 dark:text-slate-400"
    >
      Clear
    </button>
  </div>
</section>
```

The `setFilter` / `filters` accessor names must match what the FilterSidebar already uses.

- [ ] **Step 3: Commit**

```bash
git add components/ar/FilterSidebar.js
git commit -m "feat(load-margin): FilterSidebar Load Margin % section + quick-pick pills"
```

---

## Phase 8 — Live Verification + Ship (2 tasks)

### Task 19: Batched Chrome live-gate walks (4 batches)

Uses `claude-in-chrome` MCP. Load chrome MCP tools first via ToolSearch:

```
ToolSearch({ query: "claude-in-chrome", max_results: 30 })
```

ZERO screenshots directive. Use `javascript_tool` for soft nav + synthetic `fetch()` where possible. Avoid billing-tab DOM loads when feasible (has crashed Chrome extension twice previously — see session kickoff).

- [ ] **Batch 1 — Settings page (3 gates)**

  1. Navigate to `/settings/accounting/margin`. Verify page renders, three preview pills visible, current thresholds loaded into form.
  2. Save valid update (red=10, yellow=25, dry-runs=off) → 200, toast `Saved.`, reload persists values.
  3. Attempt save with yellow=5 (below red=10) → inline error `Yellow threshold must be greater than red threshold.`, Save button disabled.

- [ ] **Batch 2 — Dispatcher board (3 gates)**

  1. Open dispatcher board. Open column visibility panel. Toggle "Margin %" on — column appears. Rows with charge sets + pay lines show red/yellow/green pills; rows without show neutral `—`.
  2. Toggle off — column disappears from board.
  3. Log in as a user without `ACCOUNTS_RECEIVABLE` or `REPORTING` permission. Column is absent from the toggle panel entirely (or toggling it has no effect because `row.margin` is undefined for that user's session).

- [ ] **Batch 3 — AR pipeline (4 gates)**

  1. `/ar/billing`: rows show margin pill in the Margin column.
  2. FilterSidebar → Load Margin %: enter `Min=15, Max=30`. Fetch query includes `margin_from=15&margin_to=30`. Rows below 15% and above 30% are filtered out.
  3. Click "Red only" pill — inputs update to `Min=, Max=<tenant.red>`. Fetch query reflects.
  4. `/ar/invoices` — same behaviour as Billing.

- [ ] **Batch 4 — Load detail + dry-run toggle (3 gates)**

  1. Open a load detail overlay. Header shows margin badge (size md). Tooltip shows `Revenue $X − Cost $Y = Margin $Z`. Switch to Billing tab — header badge persists; summary row above CS cards shows `Revenue · Cost · Margin [pill]`.
  2. Back to Settings → Accounting → Margin Thresholds. Toggle "Include dry runs" OFF, save. Reopen the load detail — margin recomputed. For a load with dry-run CS + PL, both sides dropped, margin bucket may shift (e.g. yellow → green).
  3. Re-enable "Include dry runs", save, reopen — margin returns to original value.

- [ ] **Commit (memory note)**

After all four batches pass:

```bash
git commit --allow-empty -m "verify(load-margin): all 13 live gates PASS (Chrome subagent)"
```

---

### Task 20: Memory + PR prep

**Files:**
- Create: `memory/feature_load_margin.md` (optional — user maintains memory index, but we can draft)

- [ ] **Step 1: Draft feature memory file**

```md
---
name: Load Margin %
description: Per-load margin % (revenue − driver pay) with tenant-configurable red/yellow/green thresholds
type: feature
originSessionId: <fill-in>
---

# Load Margin % — SHIPPED 2026-04-24

**What shipped (N commits, migration 092):**
- lib/load-margin.js — pure computeLoadMargin + fetchLoadMarginInputs
- Settings → Accounting → Margin Thresholds page (3 inputs, live preview)
- GET/PUT /api/tenant/me/margin-thresholds endpoints
- Shared <MarginBadge /> component (red/yellow/green/neutral, sm/md, full dark-mode)
- 5 surface integrations: dispatcher board column, AR Billing + Invoices rows, load detail header badge, load detail Billing tab summary row
- AR filter bar Phase C closeout: margin_from / margin_to + Red/Yellow+/Green+/Clear quick-pick pills

**Tests:** 23 new (15 engine + 4 fetch + 4 AR schema) on top of existing 45/46 → 68 total.

**Gates:** 13 live gates green (Chrome subagent, 4 batches).

**Deferred:**
- Per-charge-set margin allocation (spec Non-Goal #2)
- Configurable cost/revenue buckets (spec Non-Goal #1)
- Historic margin reports / dashboards
- Sidebar + driver mobile + customer portal
- Colorblind-friendly palette toggle
- Payments-received / collected margin

**Gotchas to remember:**
- order_charge_sets.total_cents is maintained by application code (charge-sets/[csId]/line-items.js), NOT by a DB trigger
- fetchLoadMarginInputs uses line items (not charge_sets.total_cents) for revenue so the dry-run filter applies uniformly
- Load detail uses LoadDetailLayout which wraps all tabs; header badge is persistent
- order_driver_pay_lines uses order_id (not load_id) — same gotcha that bit leg-distance ship
- CHECK constraint chk_margin_threshold_order enforces yellow > red at DB level
```

- [ ] **Step 2: Open PR**

```bash
git push -u origin feat/load-margin
gh pr create \
  --title "feat: Load Margin % — tenant-configurable color layer + AR filter dim" \
  --body "$(cat <<'EOF'
## Summary
- Per-load margin % rendered across 5 surfaces (dispatcher board, AR Billing pipeline, AR Invoices pipeline, load detail header, load detail Billing tab summary row)
- Tenant-configurable thresholds in new Settings → Accounting → Margin Thresholds (red/yellow defaults 15/30, dry-run inclusion toggle)
- Closes out AR filter bar Phase C — margin_from / margin_to range filter + Red/Yellow+/Green+/Clear quick-pick pills
- Migration 092 on tenants: margin_red_threshold, margin_yellow_threshold, margin_include_dry_runs + CHECK constraint

## Test plan
- [x] 15 engine tests (computeLoadMargin) green
- [x] 8 fetch-helper tests (fetchLoadMarginInputs) green
- [x] AR filter schema tests extended (+9 cases)
- [x] Batch 1 — Settings page (save, constraint violation)
- [x] Batch 2 — Dispatcher board (column toggle, permission gate)
- [x] Batch 3 — AR Billing + Invoices + filter range + quick-picks
- [x] Batch 4 — Load detail header/Billing tab + dry-run toggle

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 3: Return PR URL**

---

## Summary

**Task count:** 20

**Test count added:** 27 (15 engine + 8 fetch + ~9 AR schema)

**Files created:** 6
- `supabase/migrations/092_load_margin_thresholds.sql`
- `lib/load-margin.js`
- `tests/load-margin-engine.test.mjs`
- `tests/load-margin-fetch.test.mjs`
- `pages/api/tenant/me/margin-thresholds.js`
- `pages/settings/accounting/margin.js`
- `components/ui/MarginBadge.js`

**Files modified:** 10+
- `.gitignore` (already done pre-plan)
- `lib/settings-nav.js`
- `lib/ar-filter-schema.js`
- `lib/ar-filter-params.js`
- `pages/api/tenant/loads/index.js`
- `pages/api/tenant/loads/[id]/index.js`
- `pages/api/tenant/ar/index.js`
- `pages/api/tenant/ar/invoices/index.js`
- `components/loads/LoadDetailLayout.js`
- `components/loads/tabs/BillingTab.js`
- `components/ar/BillingPipelineTab.js`
- `components/ar/InvoicesTab.js`
- `components/ar/FilterSidebar.js`
- Dispatcher board column registry (path TBD during recon)
- `tests/ar-filter-schema.test.mjs`

**Execution order note:** Task 8 (MarginBadge) must run before Task 7 (Settings page) because the page imports the component.

**Cross-task dependencies:**
- Task 4 (fetchLoadMarginInputs) must finish before Tasks 9, 12, 14, 17 (anything that attaches margin on endpoints)
- Task 8 (MarginBadge) must finish before Tasks 7, 10, 11, 13, 15 (anything that renders margin)
- Task 16 (AR filter schema) must finish before Task 17 (AR filter applier) and Task 18 (FilterSidebar UI)
