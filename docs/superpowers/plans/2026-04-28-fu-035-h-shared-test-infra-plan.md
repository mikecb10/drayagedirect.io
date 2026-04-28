# FU-035-H-shared-test-infra Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `@swc-node/register` to enable JSX-aware test runs under `node --test`, then prove it works end-to-end by adding byte-magic PDF smoke tests across all 6 AR-family PDF renderers (Invoice / Rate Con / Combined Invoice / POD / Statement / Credit Memo).

**Architecture:** Single new devDependency (`@swc-node/register@^1.x`) wired in via `--import` flag in a new `npm test` script. A shared `tests/helpers/mock-supabase.mjs` module exports `makeMockSvc(responses)` — extracted from the existing inline helper in `tests/credit-memo-fetcher-integration.test.mjs` and extended to support the `.or()` chain method that `resolveTemplateConfig` uses. Each of 6 renderer integration test files imports the helper, mocks the per-renderer query plan + `document_templates` (for cascade resolution), calls `renderXPdf(svc, id, tenantId)`, and asserts the result is a Buffer starting with `%PDF-` magic bytes and longer than 1000 bytes.

**Tech Stack:** Node ≥ 20.6 native test runner (`node --test`), `@swc-node/register@^1.x` for JSX transform on import, existing `@react-pdf/renderer@^4.5.1` for PDF rendering, `node:assert/strict` for assertions.

---

## File Structure

### New files

| Path | Responsibility |
|---|---|
| `tests/helpers/mock-supabase.mjs` | Export `makeMockSvc(responses)` — Supabase chain-API mock supporting `.from().select().eq().is().not().gt().lte().order().in().or().maybeSingle()` plus thenable for chains without terminal |
| `tests/invoice-fetcher-integration.test.mjs` | Byte-magic smoke for `renderInvoicePdf` |
| `tests/rate-con-fetcher-integration.test.mjs` | Byte-magic smoke for `renderRateConPdf` |
| `tests/combined-invoice-fetcher-integration.test.mjs` | Byte-magic smoke for `renderCombinedInvoicePdf` |
| `tests/pod-fetcher-integration.test.mjs` | Byte-magic smoke for `renderPodPdf` |
| `tests/statement-fetcher-integration.test.mjs` | Byte-magic smoke for `renderStatementPdf` |

### Modified files

| Path | Change |
|---|---|
| `package.json` | Add `@swc-node/register` to `devDependencies`; add `"test"` script |
| `tests/credit-memo-fetcher-integration.test.mjs` | Replace inline `makeMockSvc` (lines 19-55) with `import { makeMockSvc } from './helpers/mock-supabase.mjs'`; add new test `'renderCreditMemoPdf produces a valid PDF buffer'` |

**Total:** 6 new + 2 modified = 8 files.

---

## Task 1: Add @swc-node/register + npm test script

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Read current package.json**

Run: `cat package.json` (or use Read tool). Verify `devDependencies` block does not yet contain `@swc-node/register`. Verify `scripts` block does not yet contain `test`.

- [ ] **Step 2: Add devDependency + test script via npm**

Run:
```bash
npm install --save-dev @swc-node/register@^1.10.0
```

Expected: `package.json` and `package-lock.json` updated; `node_modules/@swc-node/register` exists.

- [ ] **Step 3: Add test script to package.json**

Edit `package.json` `scripts` block to add the new entry (preserve existing entries):

```json
"scripts": {
  "dev": "next dev",
  "build": "next build",
  "start": "next start",
  "lint": "next lint",
  "test": "node --import @swc-node/register/esm-register --test \"tests/*.test.mjs\""
}
```

Note: `@swc-node/register/esm-register` is the ESM-mode entry point that supports `--import`. The plain `@swc-node/register` may fail with newer Node ESM loader rules; if it does, that's the fallback path.

- [ ] **Step 4: Run all existing tests to verify no regression**

Run:
```bash
npm test 2>&1 | tail -20
```

Expected: All ~83 existing test files pass. Look for the summary line `# pass <N>` and confirm no `# fail` count > 0 (note: there is one pre-existing fire-trigger failure documented in the H6 handoff — `tests/fire-trigger-entity-aware.test.mjs`. If exactly that one fails, it's expected and acceptable).

If any *other* test fails, investigate before proceeding — it likely means the SWC transformer is changing module-load behavior in a way that exposes a real bug.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json
git commit -m "$(cat <<'EOF'
chore(deps): add @swc-node/register + npm test script (FU-035-H-shared-test-infra task 1)

Adds @swc-node/register@^1.10.0 as a devDependency to enable JSX-aware
test runs under bare node --test. Adds an "npm test" script that wires
the transformer in via --import. No behavior change for existing tests
(SWC is a no-op for non-JSX modules).

Unblocks byte-magic PDF smoke tests for all 6 AR-family renderers.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Extract makeMockSvc into shared helper + refactor credit-memo test

**Files:**
- Create: `tests/helpers/mock-supabase.mjs`
- Modify: `tests/credit-memo-fetcher-integration.test.mjs`

- [ ] **Step 1: Create the shared helper**

Create `tests/helpers/mock-supabase.mjs`:

```js
// Shared Supabase-client mock for fetcher integration tests.
//
// The PDF renderer modules build their data with a fixed set of chained
// Supabase query methods. This helper provides a minimal stand-in that
// returns canned responses keyed by table name, supporting the chain
// methods all 6 AR-family renderers (Invoice, Rate Con, Combined Invoice,
// POD, Statement, Credit Memo) plus resolveTemplateConfig collectively use.
//
// Convention: tests in tests/*-fetcher-integration.test.mjs import this
// helper. New chain methods can be added to `obj` below without breaking
// existing callers — methods are no-op pass-throughs that return self.

/**
 * Build a Supabase-shaped client mock for unit tests.
 *
 * @param {Record<string, { data: any, error: any }>} responses
 *   Map from table name to the response object returned by terminal
 *   methods (.maybeSingle()) and when the chain is awaited directly
 *   (no terminal). Tables not in the map return { data: null, error: null }.
 *
 * @returns {object} A mock client supporting:
 *     client.from(table).select(...).eq(...).is(...).maybeSingle()
 *     client.from(table).select(...).in(...).eq(...).is(...)   // awaited directly
 *     client.from(table).select(...).or(...)                   // resolveTemplateConfig path
 *
 * Chain methods returned by the builder: select, eq, in, is, not,
 * gt, lte, order, or. All are no-op pass-throughs returning self.
 */
export function makeMockSvc(responses) {
  function builder(table) {
    const response = responses[table] || { data: null, error: null };
    const obj = {
      // Terminal: resolves to a single row response.
      maybeSingle: () => Promise.resolve(response),
      // Chain methods (no-ops returning self).
      select: () => obj,
      eq:     () => obj,
      in:     () => obj,
      is:     () => obj,
      not:    () => obj,
      gt:     () => obj,
      lte:    () => obj,
      order:  () => obj,
      or:     () => obj,
      // Awaiting the chain directly (no terminal) returns the response.
      then:   (resolve, reject) => Promise.resolve(response).then(resolve, reject),
    };
    return obj;
  }
  return { from: (table) => builder(table) };
}
```

- [ ] **Step 2: Refactor credit-memo test to import the helper**

Modify `tests/credit-memo-fetcher-integration.test.mjs`:

Find this block (lines 19-55):

```js
// ── Mock builder ────────────────────────────────────────────────────

/**
 * Build a Supabase-shaped client that responds to the chained query API:
 *   client.from(table).select(...).eq(...).is(...).maybeSingle()
 *   client.from(table).select(...).in(...).eq(...).is(...)
 *
 * Each table's response is supplied via the `responses` map. The same
 * builder shape is returned for every chained method except the terminal
 * (`maybeSingle()` resolves to single row; the absence of a terminal
 * returns the array directly when awaited).
 */
function makeMockSvc(responses) {
  function builder(table) {
    let response = responses[table];
    if (!response) {
      response = { data: null, error: null };
    }
    const obj = {
      // Terminal that resolves to a single row.
      maybeSingle: () => Promise.resolve(response),
      // Chain methods (no-ops returning self).
      select: () => obj,
      eq:     () => obj,
      in:     () => obj,
      is:     () => obj,
      not:    () => obj,
      gt:     () => obj,
      lte:    () => obj,
      order:  () => obj,
      // Awaiting the chain directly (no terminal) returns the response.
      then:   (resolve, reject) => Promise.resolve(response).then(resolve, reject),
    };
    return obj;
  }
  return { from: (table) => builder(table) };
}
```

Replace with a single import line at the top of the imports block:

```js
import { makeMockSvc } from './helpers/mock-supabase.mjs';
```

Delete the entire `// ── Mock builder ────...` block including its docblock comment and the `function makeMockSvc(...)` definition.

- [ ] **Step 3: Run credit-memo tests to verify no regression**

Run:
```bash
npm test -- --test-name-pattern="fetchCreditMemoData" 2>&1 | tail -30
```

Expected: All 7 existing credit-memo tests pass. If any fail, the helper's chain shape diverged from the inline original — re-check the diff.

(If `--test-name-pattern` isn't supported by the installed Node version, just run full `npm test` and grep the output for `credit-memo` results.)

- [ ] **Step 4: Commit**

```bash
git add tests/helpers/mock-supabase.mjs tests/credit-memo-fetcher-integration.test.mjs
git commit -m "$(cat <<'EOF'
test(pdf): extract makeMockSvc into shared helper (FU-035-H-shared-test-infra task 2)

Lifts makeMockSvc from the inline definition in credit-memo-fetcher-integration.test.mjs
into a new shared module at tests/helpers/mock-supabase.mjs. Adds .or()
to the chain shape (used by resolveTemplateConfig).

Establishes the tests/helpers/ convention. Future fetcher integration
tests across all 6 AR-family renderers will import from this location.

No behavior change in the 7 existing credit-memo tests.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Add credit-memo byte-magic test

**Files:**
- Modify: `tests/credit-memo-fetcher-integration.test.mjs`

- [ ] **Step 1: Add the byte-magic test at the bottom of the file**

Append to `tests/credit-memo-fetcher-integration.test.mjs` (after the last existing test, before EOF):

```js
test('renderCreditMemoPdf produces a valid PDF buffer (end-to-end smoke)', async () => {
  const { renderCreditMemoPdf } = await import('../lib/pdf/render-credit-memo.js');
  const svc = makeMockSvc({
    credit_memos:    { data: memoRow, error: null },
    invoices:        { data: [issuedFromInvoice, appliedToInvoice], error: null },
    tenants:         { data: tenantRow, error: null },
    tenant_settings: { data: settingsRow, error: null },
    document_templates: { data: [], error: null },  // no custom template; fall back to system default
  });

  const buf = await renderCreditMemoPdf(svc, memoRow.id, 'tenant-uuid');

  assert.ok(Buffer.isBuffer(buf), 'expected a Buffer');
  assert.ok(buf.length > 1000, `PDF buffer too small (${buf.length} bytes)`);
  assert.equal(buf.slice(0, 5).toString('ascii'), '%PDF-');
});
```

- [ ] **Step 2: Run the new test to verify it passes**

Run:
```bash
npm test 2>&1 | tail -40
```

Expected: All credit-memo tests including the new byte-magic test pass. If the new test fails:
- "expected a Buffer" → renderCreditMemoPdf is returning the wrong type; investigate render-credit-memo.js
- "PDF buffer too small" → the React-PDF render produced an unexpectedly tiny output; likely a template crash silently rendered an empty Page
- `'%PDF-'` mismatch → the output isn't a PDF; check whether an error response is being returned instead

If the test fails because of a missing fixture field (e.g., `Cannot read property 'X' of null`), expand the relevant fixture row at the top of the file to include the missing field, then re-run.

- [ ] **Step 3: Commit**

```bash
git add tests/credit-memo-fetcher-integration.test.mjs
git commit -m "$(cat <<'EOF'
test(pdf): credit-memo byte-magic PDF smoke (FU-035-H-shared-test-infra task 3)

Adds the first end-to-end byte-magic smoke test for renderCreditMemoPdf —
asserts the output is a Buffer >1000 bytes starting with %PDF- magic.

This is the first proof that the @swc-node/register transformer wires
JSX-importing modules through node --test correctly. Closes the remaining
~10% gap of FU-035-H6-followup-A.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Invoice byte-magic test

**Files:**
- Create: `tests/invoice-fetcher-integration.test.mjs`

**Background — Invoice query plan (from `lib/pdf/render-invoice.js`):**

`renderInvoicePdf` first peeks `invoices.is_consolidated`. If true, delegates to combined-invoice. If false (our fixture path), `fetchInvoiceData` runs:
1. `invoices` (with joined `customer:customers!customer_id`) — `.maybeSingle()`
2. `invoice_charge_sets` (with joined `charge_set:order_charge_sets` → `order:orders`) — awaited
3. `order_container_moves` (with joined `driver:drivers`) — awaited (only if first order found)
4. `order_routing_events` (with joined `location:customers`) — awaited (only if moves found)
5. `invoice_line_items` — awaited
6. `tenants` — `.maybeSingle()`
7. `tenant_settings` — `.maybeSingle()`
8. `resolveTemplateConfig` queries `document_templates` — uses `.or()` if customer_id is set

- [ ] **Step 1: Write the test file with skeleton fixture + assertion**

Create `tests/invoice-fetcher-integration.test.mjs`:

```js
// Byte-magic smoke for renderInvoicePdf.
// Validates that the fetcher → composer → React-PDF render pipeline
// produces a valid PDF Buffer for a representative invoice fixture.

import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { renderInvoicePdf } from '../lib/pdf/render-invoice.js';
import { makeMockSvc } from './helpers/mock-supabase.mjs';

const tenantId  = 'tenant-uuid';
const invoiceId = 'invoice-uuid';
const customerId = 'customer-uuid';
const orderId    = 'order-uuid';
const moveId     = 'move-uuid';

const customerRow = {
  id: customerId,
  name: 'Jolly Greens brews',
  address_line1: '14155 Dallas Pkwy',
  address_line2: null,
  city: 'Dallas',
  state: 'TX',
  zip: '75254-4430',
  billing_email: 'bill@jollygreens.example',
  phone: '555-555-1234',
};

const invoiceRow = {
  id: invoiceId,
  invoice_number: 'INV-2026-001',
  invoice_date: '2026-04-01',
  sent_at: null,
  created_at: '2026-04-01T12:00:00.000Z',
  due_date: '2026-05-01',
  payment_terms_days: 30,
  is_consolidated: false,                  // critical: prevents delegation to combined renderer
  subtotal_cents: 250000,
  total_amount_cents: 275000,
  notes: 'Thank you for your business.',
  customer_id: customerId,
  customer: customerRow,
};

const orderRow = {
  id: orderId,
  order_number: 'L-ABC-0001',
  customer_reference: 'PO-12345',
  container_number: 'TCNU1234567',
  chassis_number: 'CHAS001',
  container_size: '40',
  container_type: 'HC',
  chassis_size: '40',
  chassis_type: 'HC',
  chassis_owner: 'OWNED',
  steamship_line: 'MAERSK',
  seal_number: 'SEAL001',
  mbol: 'MBOL001',
  hbol: 'HBOL001',
  booking_number: 'BK001',
  pickup_number: 'PU001',
  is_hazmat: false,
  last_free_day: '2026-04-10',
  per_diem_free_day: '2026-04-12',
  pull_container_date: '2026-04-02',
  return_container_date: '2026-04-05',
  notes: null,
  internal_notes: null,
};

const chargeSetLinkRow = {
  charge_set: {
    id: 'cs-uuid',
    charge_set_number: 'CS-001',
    order_id: orderId,
    order: orderRow,
  },
};

const moveRow = {
  id: moveId,
  sequence: 1,
  move_type: 'pickup_delivery',
  status: 'completed',
  driver: { id: 'driver-uuid', first_name: 'John', last_name: 'Driver', phone: '555-DRIVER' },
};

const eventRows = [
  {
    id: 'event-pickup-uuid',
    move_id: moveId,
    sequence: 1,
    event_type: 'pickup',
    scheduled_at: '2026-04-02T08:00:00.000Z',
    arrived_at: '2026-04-02T08:15:00.000Z',
    departed_at: '2026-04-02T09:00:00.000Z',
    location_id: 'loc1-uuid',
    location_name: 'Port Terminal A',
    city: 'Long Beach', state: 'CA',
    location: { id: 'loc1-uuid', name: 'Port Terminal A', city: 'Long Beach', state: 'CA' },
  },
  {
    id: 'event-deliver-uuid',
    move_id: moveId,
    sequence: 2,
    event_type: 'deliver',
    scheduled_at: '2026-04-02T14:00:00.000Z',
    arrived_at: '2026-04-02T14:30:00.000Z',
    departed_at: '2026-04-02T15:30:00.000Z',
    location_id: 'loc2-uuid',
    location_name: 'Acme Warehouse',
    city: 'Dallas', state: 'TX',
    location: { id: 'loc2-uuid', name: 'Acme Warehouse', city: 'Dallas', state: 'TX' },
  },
];

const lineItemRows = [
  {
    id: 'li1', description: 'Linehaul', quantity: 1,
    unit_amount_cents: 200000, total_amount_cents: 200000, sort_order: 1,
  },
  {
    id: 'li2', description: 'Fuel surcharge', quantity: 1,
    unit_amount_cents: 50000, total_amount_cents: 50000, sort_order: 2,
  },
  {
    id: 'li3', description: 'Chassis split', quantity: 1,
    unit_amount_cents: 25000, total_amount_cents: 25000, sort_order: 3,
  },
];

const tenantRow   = { name: 'Acme Drayage' };
const settingsRow = {
  company_display_name: 'Acme Drayage Inc.',
  logo_small_url: null, logo_large_url: null,
  address_line1: '123 Main Street', address_line2: null,
  city: 'Newark', state: 'NJ', zip: '07102',
  phone: '555-555-1212', website: 'www.acme.example',
};

test('renderInvoicePdf produces a valid PDF buffer (end-to-end smoke)', async () => {
  const svc = makeMockSvc({
    invoices:                 { data: invoiceRow, error: null },
    invoice_charge_sets:      { data: [chargeSetLinkRow], error: null },
    order_container_moves:    { data: [moveRow], error: null },
    order_routing_events:     { data: eventRows, error: null },
    invoice_line_items:       { data: lineItemRows, error: null },
    tenants:                  { data: tenantRow, error: null },
    tenant_settings:          { data: settingsRow, error: null },
    document_templates:       { data: [], error: null },
  });

  const buf = await renderInvoicePdf(svc, invoiceId, tenantId);

  assert.ok(Buffer.isBuffer(buf), 'expected a Buffer');
  assert.ok(buf.length > 1000, `PDF buffer too small (${buf.length} bytes)`);
  assert.equal(buf.slice(0, 5).toString('ascii'), '%PDF-');
});
```

- [ ] **Step 2: Run the test (RED first if fixture incomplete, then GREEN)**

Run:
```bash
npm test 2>&1 | grep -A 2 "invoice-fetcher" | tail -15
```

Expected first run outcomes:
- **Pass** → done; move to Step 3.
- **`Cannot read property 'X' of null/undefined`** → InvoiceTemplate references a field not in the fixture. Read `components/pdf/InvoiceTemplate.js` (or check the section composer in `lib/pdf/build-invoice-section-data.js`) to identify the missing field. Add it to `invoiceRow`, `orderRow`, `customerRow`, or `settingsRow` as appropriate. Re-run.
- **PDF buffer too small (< 1000 bytes)** → React-PDF rendered an empty Page. Likely the section composer returned all-falsy values for every section. Inspect `lib/pdf/build-invoice-section-data.js` to see what data shapes drive section visibility. Add missing data (e.g., `invoice_meta.invoice_number` is the most common required field).

Iterate fixture until the test passes.

- [ ] **Step 3: Commit**

```bash
git add tests/invoice-fetcher-integration.test.mjs
git commit -m "$(cat <<'EOF'
test(pdf): invoice byte-magic PDF smoke (FU-035-H-shared-test-infra task 4)

Adds end-to-end PDF render smoke for renderInvoicePdf. Mocks the 7-query
plan (invoices, invoice_charge_sets, order_container_moves, order_routing_events,
invoice_line_items, tenants, tenant_settings) plus document_templates for
cascade. Asserts buf.startsWith('%PDF-') + length > 1000.

is_consolidated=false in fixture forces single-load path (combined-invoice
delegation tested separately in task 6).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Rate Con byte-magic test

**Files:**
- Create: `tests/rate-con-fetcher-integration.test.mjs`

**Background — Rate Con query plan (from `lib/pdf/render-rate-con.js`):**

`fetchRateConData(svc, chargeSetId, tenantId)`:
1. `order_charge_sets` (with joined `order:orders` + `pickup_org` + `delivery_org` + `line_items:order_charge_set_line_items`) — `.maybeSingle()`
2. `order_container_moves` (with joined `driver`) — awaited (skip if no order)
3. `order_routing_events` (with joined `location`) — awaited (skip if no moves)
4. `tenants` — `.maybeSingle()`
5. `tenant_settings` — `.maybeSingle()`
6. `document_templates` (via resolveTemplateConfig)

- [ ] **Step 1: Write the test file**

Create `tests/rate-con-fetcher-integration.test.mjs`:

```js
// Byte-magic smoke for renderRateConPdf.

import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { renderRateConPdf } from '../lib/pdf/render-rate-con.js';
import { makeMockSvc } from './helpers/mock-supabase.mjs';

const tenantId    = 'tenant-uuid';
const chargeSetId = 'cs-uuid';
const orderId     = 'order-uuid';
const customerId  = 'customer-uuid';
const moveId      = 'move-uuid';

const pickupOrg = {
  id: 'pickup-org-uuid', name: 'Port Terminal A',
  address_line1: '500 Port Way',
  city: 'Long Beach', state: 'CA', zip: '90802',
};
const deliveryOrg = {
  id: 'delivery-org-uuid', name: 'Acme Warehouse',
  address_line1: '14155 Dallas Pkwy',
  city: 'Dallas', state: 'TX', zip: '75254',
};

const orderRow = {
  id: orderId,
  order_number: 'L-ABC-0001',
  customer_reference: 'PO-12345',
  customer_id: customerId,
  container_number: 'TCNU1234567',
  chassis_number: 'CHAS001',
  container_size: '40', container_type: 'HC',
  chassis_size: '40', chassis_type: 'HC',
  chassis_owner: 'OWNED', steamship_line: 'MAERSK',
  seal_number: 'SEAL001',
  mbol: 'MBOL001', hbol: 'HBOL001',
  booking_number: 'BK001', pickup_number: 'PU001',
  is_hazmat: false,
  last_free_day: '2026-04-10', per_diem_free_day: '2026-04-12',
  pull_container_date: '2026-04-02', return_container_date: '2026-04-05',
  notes: null, internal_notes: null,
  pickup_apt_from: '2026-04-02T08:00:00.000Z',
  delivery_apt_from: '2026-04-02T14:00:00.000Z',
  pickup_org: pickupOrg,
  delivery_org: deliveryOrg,
};

const chargeSetRow = {
  id: chargeSetId,
  charge_set_number: 'CS-001',
  created_at: '2026-04-01T12:00:00.000Z',
  total_cents: 275000,
  order: orderRow,
  line_items: [
    { id: 'li1', name: 'Linehaul',  description: 'Linehaul Long Beach → Dallas',
      unit_count: 1, per_unit_price_cents: 200000, total_cents: 200000 },
    { id: 'li2', name: 'Fuel',      description: 'Fuel surcharge',
      unit_count: 1, per_unit_price_cents: 50000,  total_cents: 50000 },
    { id: 'li3', name: 'Chassis',   description: 'Chassis split',
      unit_count: 1, per_unit_price_cents: 25000,  total_cents: 25000 },
  ],
};

const moveRow = {
  id: moveId, sequence: 1, move_type: 'pickup_delivery', status: 'planned',
  driver: { id: 'driver-uuid', first_name: 'John', last_name: 'Driver', phone: '555-DRIVER' },
};

const eventRows = [
  {
    id: 'ev1', move_id: moveId, sequence: 1, event_type: 'pickup',
    scheduled_at: '2026-04-02T08:00:00.000Z',
    arrived_at: null, departed_at: null,
    location_id: 'loc1', location_name: 'Port Terminal A',
    city: 'Long Beach', state: 'CA',
    location: { id: 'loc1', name: 'Port Terminal A', city: 'Long Beach', state: 'CA' },
  },
  {
    id: 'ev2', move_id: moveId, sequence: 2, event_type: 'deliver',
    scheduled_at: '2026-04-02T14:00:00.000Z',
    arrived_at: null, departed_at: null,
    location_id: 'loc2', location_name: 'Acme Warehouse',
    city: 'Dallas', state: 'TX',
    location: { id: 'loc2', name: 'Acme Warehouse', city: 'Dallas', state: 'TX' },
  },
];

const tenantRow   = { name: 'Acme Drayage' };
const settingsRow = {
  company_display_name: 'Acme Drayage Inc.',
  logo_small_url: null, logo_large_url: null,
  address_line1: '123 Main Street', address_line2: null,
  city: 'Newark', state: 'NJ', zip: '07102',
  phone: '555-555-1212', website: 'www.acme.example',
};

test('renderRateConPdf produces a valid PDF buffer (end-to-end smoke)', async () => {
  const svc = makeMockSvc({
    order_charge_sets:        { data: chargeSetRow, error: null },
    order_container_moves:    { data: [moveRow], error: null },
    order_routing_events:     { data: eventRows, error: null },
    tenants:                  { data: tenantRow, error: null },
    tenant_settings:          { data: settingsRow, error: null },
    document_templates:       { data: [], error: null },
  });

  const buf = await renderRateConPdf(svc, chargeSetId, tenantId);

  assert.ok(Buffer.isBuffer(buf), 'expected a Buffer');
  assert.ok(buf.length > 1000, `PDF buffer too small (${buf.length} bytes)`);
  assert.equal(buf.slice(0, 5).toString('ascii'), '%PDF-');
});
```

- [ ] **Step 2: Run the test, iterate fixture until GREEN**

Run:
```bash
npm test 2>&1 | grep -A 2 "rate-con-fetcher" | tail -15
```

Same iteration loop as Task 4: if a field is missing, read `components/pdf/RateConTemplate.js` or `lib/pdf/build-rate-con-section-data.js` and expand the fixture.

- [ ] **Step 3: Commit**

```bash
git add tests/rate-con-fetcher-integration.test.mjs
git commit -m "$(cat <<'EOF'
test(pdf): rate-con byte-magic PDF smoke (FU-035-H-shared-test-infra task 5)

Adds end-to-end PDF render smoke for renderRateConPdf. Mocks the 5-query
plan (order_charge_sets w/ joined order+pickup_org+delivery_org+line_items,
order_container_moves, order_routing_events, tenants, tenant_settings)
plus document_templates for cascade.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Combined Invoice byte-magic test

**Files:**
- Create: `tests/combined-invoice-fetcher-integration.test.mjs`

**Background — Combined Invoice query plan (from `lib/pdf/render-combined-invoice.js`):**

`fetchCombinedInvoiceData(svc, invoiceId, tenantId)`:
1. `invoices` (with joined customer) — `.maybeSingle()`
2. `invoice_charge_sets` (with joined `charge_set:order_charge_sets` → `order:orders` → `pickup_org` + `delivery_org`) — awaited
3. `invoice_line_items` (note: includes `order_id`) — awaited
4. `tenants` — `.maybeSingle()`
5. `tenant_settings` — `.maybeSingle()`
6. `document_templates`

Key difference from Invoice: ≥2 charge sets (consolidated). Mock returns 2 link rows, 2 orders, line items grouped by `order_id`.

- [ ] **Step 1: Write the test file**

Create `tests/combined-invoice-fetcher-integration.test.mjs`:

```js
// Byte-magic smoke for renderCombinedInvoicePdf (consolidated invoice path).

import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { renderCombinedInvoicePdf } from '../lib/pdf/render-combined-invoice.js';
import { makeMockSvc } from './helpers/mock-supabase.mjs';

const tenantId   = 'tenant-uuid';
const invoiceId  = 'invoice-uuid';
const customerId = 'customer-uuid';
const orderId1   = 'order-1-uuid';
const orderId2   = 'order-2-uuid';

const customerRow = {
  id: customerId,
  name: 'Jolly Greens brews',
  address_line1: '14155 Dallas Pkwy',
  address_line2: null,
  city: 'Dallas', state: 'TX', zip: '75254',
  billing_email: 'bill@jolly.example',
  phone: '555-555-1234',
};

const invoiceRow = {
  id: invoiceId,
  invoice_number: 'INV-2026-002',
  invoice_date: '2026-04-15',
  sent_at: null,
  created_at: '2026-04-15T12:00:00.000Z',
  due_date: '2026-05-15',
  payment_terms_days: 30,
  is_consolidated: true,                    // critical: this IS the combined path
  subtotal_cents: 500000,
  total_amount_cents: 550000,
  notes: 'Consolidated invoice for April loads.',
  customer_id: customerId,
  customer: customerRow,
};

const pickupOrg1 = { id: 'p1', name: 'Long Beach Port', city: 'Long Beach', state: 'CA' };
const pickupOrg2 = { id: 'p2', name: 'Oakland Port',    city: 'Oakland',    state: 'CA' };
const deliveryOrg1 = { id: 'd1', name: 'Acme Dallas',  city: 'Dallas',  state: 'TX' };
const deliveryOrg2 = { id: 'd2', name: 'Acme Houston', city: 'Houston', state: 'TX' };

const linkRows = [
  {
    charge_set: {
      id: 'cs-1', charge_set_number: 'CS-001', order_id: orderId1,
      order: {
        id: orderId1,
        order_number: 'L-ABC-0001',
        customer_reference: 'PO-12345',
        container_number: 'TCNU1111111',
        chassis_number: 'CH001',
        pickup_apt_from: '2026-04-02T08:00:00.000Z',
        delivery_apt_from: '2026-04-02T14:00:00.000Z',
        pickup_org: pickupOrg1,
        delivery_org: deliveryOrg1,
      },
    },
  },
  {
    charge_set: {
      id: 'cs-2', charge_set_number: 'CS-002', order_id: orderId2,
      order: {
        id: orderId2,
        order_number: 'L-ABC-0002',
        customer_reference: 'PO-12346',
        container_number: 'TCNU2222222',
        chassis_number: 'CH002',
        pickup_apt_from: '2026-04-05T08:00:00.000Z',
        delivery_apt_from: '2026-04-05T14:00:00.000Z',
        pickup_org: pickupOrg2,
        delivery_org: deliveryOrg2,
      },
    },
  },
];

const lineItemRows = [
  { id: 'li1', order_id: orderId1, description: 'Linehaul order 1',     quantity: 1, unit_amount_cents: 200000, total_amount_cents: 200000, sort_order: 1 },
  { id: 'li2', order_id: orderId1, description: 'Fuel surcharge order 1', quantity: 1, unit_amount_cents: 50000,  total_amount_cents: 50000,  sort_order: 2 },
  { id: 'li3', order_id: orderId2, description: 'Linehaul order 2',     quantity: 1, unit_amount_cents: 225000, total_amount_cents: 225000, sort_order: 3 },
  { id: 'li4', order_id: orderId2, description: 'Fuel surcharge order 2', quantity: 1, unit_amount_cents: 25000,  total_amount_cents: 25000,  sort_order: 4 },
];

const tenantRow   = { name: 'Acme Drayage' };
const settingsRow = {
  company_display_name: 'Acme Drayage Inc.',
  logo_small_url: null, logo_large_url: null,
  address_line1: '123 Main Street', address_line2: null,
  city: 'Newark', state: 'NJ', zip: '07102',
  phone: '555-555-1212', website: 'www.acme.example',
};

test('renderCombinedInvoicePdf produces a valid PDF buffer (end-to-end smoke)', async () => {
  const svc = makeMockSvc({
    invoices:                 { data: invoiceRow, error: null },
    invoice_charge_sets:      { data: linkRows, error: null },
    invoice_line_items:       { data: lineItemRows, error: null },
    tenants:                  { data: tenantRow, error: null },
    tenant_settings:          { data: settingsRow, error: null },
    document_templates:       { data: [], error: null },
  });

  const buf = await renderCombinedInvoicePdf(svc, invoiceId, tenantId);

  assert.ok(Buffer.isBuffer(buf), 'expected a Buffer');
  assert.ok(buf.length > 1000, `PDF buffer too small (${buf.length} bytes)`);
  assert.equal(buf.slice(0, 5).toString('ascii'), '%PDF-');
});
```

- [ ] **Step 2: Run the test, iterate fixture until GREEN**

Run:
```bash
npm test 2>&1 | grep -A 2 "combined-invoice-fetcher" | tail -15
```

If a field is missing, read `components/pdf/CombinedInvoiceTemplate.js` or `lib/pdf/build-combined-invoice-section-data.js`.

- [ ] **Step 3: Commit**

```bash
git add tests/combined-invoice-fetcher-integration.test.mjs
git commit -m "$(cat <<'EOF'
test(pdf): combined-invoice byte-magic PDF smoke (FU-035-H-shared-test-infra task 6)

Adds end-to-end PDF render smoke for renderCombinedInvoicePdf. Mocks the
consolidated path with 2 charge sets, 2 orders, and 4 line items grouped
by order_id. Validates the loads_summary + charge_groups composer logic
runs without crashing on representative data.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: POD byte-magic test

**Files:**
- Create: `tests/pod-fetcher-integration.test.mjs`

**Background — POD query plan (from `lib/pdf/render-pod.js`):**

`fetchPodData(svc, orderId, tenantId)`:
1. `orders` (with joined customer) — `.maybeSingle()`
2. `order_container_moves` (with joined driver) — awaited
3. `order_routing_events` (with joined location) — awaited (only if moves)
4. `order_documents` filtered to `document_type = 'POD'` — awaited
5. `tenants` — `.maybeSingle()`
6. `tenant_settings` — `.maybeSingle()`
7. `document_templates`

Key: at least one move must have a `deliver` event so `resolveDriverName` returns non-null and `findLastDeliverEvent` returns a row (drives `delivery_date` / `delivery_time` formatting).

- [ ] **Step 1: Write the test file**

Create `tests/pod-fetcher-integration.test.mjs`:

```js
// Byte-magic smoke for renderPodPdf.

import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { renderPodPdf } from '../lib/pdf/render-pod.js';
import { makeMockSvc } from './helpers/mock-supabase.mjs';

const tenantId   = 'tenant-uuid';
const orderId    = 'order-uuid';
const customerId = 'customer-uuid';
const moveId     = 'move-uuid';

const customerRow = {
  id: customerId, name: 'Jolly Greens brews',
  address_line1: '14155 Dallas Pkwy', address_line2: null,
  city: 'Dallas', state: 'TX', zip: '75254',
  billing_email: 'bill@jolly.example', phone: '555-555-1234',
};

const orderRow = {
  id: orderId,
  order_number: 'L-ABC-0001',
  customer_reference: 'PO-12345',
  container_number: 'TCNU1234567',
  chassis_number: 'CHAS001',
  container_size: '40', container_type: 'HC',
  chassis_size: '40', chassis_type: 'HC',
  chassis_owner: 'OWNED', steamship_line: 'MAERSK',
  seal_number: 'SEAL001',
  mbol: 'MBOL001', hbol: 'HBOL001',
  booking_number: 'BK001', pickup_number: 'PU001',
  is_hazmat: false,
  last_free_day: '2026-04-10', per_diem_free_day: '2026-04-12',
  pull_container_date: '2026-04-02', return_container_date: '2026-04-05',
  notes: null, internal_notes: null,
  customer_id: customerId,
  customer: customerRow,
};

const moveRow = {
  id: moveId, sequence: 1, move_type: 'pickup_delivery', status: 'completed',
  driver: { id: 'driver-uuid', first_name: 'John', last_name: 'Driver', phone: '555-DRIVER' },
};

const eventRows = [
  {
    id: 'ev1', move_id: moveId, sequence: 1, event_type: 'pickup',
    scheduled_at: '2026-04-02T08:00:00.000Z',
    arrived_at:   '2026-04-02T08:15:00.000Z',
    departed_at:  '2026-04-02T09:00:00.000Z',
    location_id: 'loc1', location_name: 'Port Terminal A',
    city: 'Long Beach', state: 'CA',
    location: { id: 'loc1', name: 'Port Terminal A', city: 'Long Beach', state: 'CA' },
  },
  {
    id: 'ev2', move_id: moveId, sequence: 2, event_type: 'deliver',
    scheduled_at: '2026-04-02T14:00:00.000Z',
    arrived_at:   '2026-04-02T14:30:00.000Z',
    departed_at:  '2026-04-02T15:30:00.000Z',
    location_id: 'loc2', location_name: 'Acme Warehouse',
    city: 'Dallas', state: 'TX',
    location: { id: 'loc2', name: 'Acme Warehouse', city: 'Dallas', state: 'TX' },
  },
];

const orderDocRows = [
  { id: 'doc1', file_name: 'POD_signed.jpg', document_type: 'POD',
    uploaded_at: '2026-04-02T15:45:00.000Z' },
];

const tenantRow   = { name: 'Acme Drayage' };
const settingsRow = {
  company_display_name: 'Acme Drayage Inc.',
  logo_small_url: null, logo_large_url: null,
  address_line1: '123 Main Street', address_line2: null,
  city: 'Newark', state: 'NJ', zip: '07102',
  phone: '555-555-1212', website: 'www.acme.example',
};

test('renderPodPdf produces a valid PDF buffer (end-to-end smoke)', async () => {
  const svc = makeMockSvc({
    orders:                   { data: orderRow, error: null },
    order_container_moves:    { data: [moveRow], error: null },
    order_routing_events:     { data: eventRows, error: null },
    order_documents:          { data: orderDocRows, error: null },
    tenants:                  { data: tenantRow, error: null },
    tenant_settings:          { data: settingsRow, error: null },
    document_templates:       { data: [], error: null },
  });

  const buf = await renderPodPdf(svc, orderId, tenantId);

  assert.ok(Buffer.isBuffer(buf), 'expected a Buffer');
  assert.ok(buf.length > 1000, `PDF buffer too small (${buf.length} bytes)`);
  assert.equal(buf.slice(0, 5).toString('ascii'), '%PDF-');
});
```

- [ ] **Step 2: Run the test, iterate fixture until GREEN**

Run:
```bash
npm test 2>&1 | grep -A 2 "pod-fetcher" | tail -15
```

If missing field, read `components/pdf/PodTemplate.js` or `lib/pdf/build-pod-section-data.js`.

- [ ] **Step 3: Commit**

```bash
git add tests/pod-fetcher-integration.test.mjs
git commit -m "$(cat <<'EOF'
test(pdf): POD byte-magic PDF smoke (FU-035-H-shared-test-infra task 7)

Adds end-to-end PDF render smoke for renderPodPdf. Mocks orders +
moves + routing_events (with deliver event so driver_name resolution
+ delivery_date computation succeed) + order_documents (1 POD) +
tenant + tenant_settings + document_templates.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: Statement byte-magic test

**Files:**
- Create: `tests/statement-fetcher-integration.test.mjs`

**Background — Statement query plan (from `lib/pdf/render-statement.js`):**

`fetchStatementData(svc, customerId, tenantId, asOfDate)`:
1. `customers` — `.maybeSingle()`
2. `invoices` (open, > 0 balance, not void/draft) — awaited (uses `.not()`, `.gt()`, `.lte()`)
3. `invoice_charge_sets` (joined order for customer_reference) — awaited (only if invoices found)
4. `tenants` — `.maybeSingle()`
5. `tenant_settings` — `.maybeSingle()`
6. `document_templates`

Note: Statement also calls `computeAging` which is pure JS — no extra mock needed.

- [ ] **Step 1: Write the test file**

Create `tests/statement-fetcher-integration.test.mjs`:

```js
// Byte-magic smoke for renderStatementPdf.

import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { renderStatementPdf } from '../lib/pdf/render-statement.js';
import { makeMockSvc } from './helpers/mock-supabase.mjs';

const tenantId   = 'tenant-uuid';
const customerId = 'customer-uuid';
const asOfDate   = '2026-04-28';

const customerRow = {
  id: customerId,
  name: 'Jolly Greens brews',
  short_name: 'JOLLY',
  address_line1: '14155 Dallas Pkwy', address_line2: null,
  city: 'Dallas', state: 'TX', zip: '75254',
  billing_email: 'bill@jolly.example', phone: '555-555-1234',
};

// Three open invoices spanning aging buckets:
//  - inv1: due 2026-04-25 (3 days past due → days_1_30)
//  - inv2: due 2026-03-25 (34 days past due → days_31_60)
//  - inv3: due 2026-04-30 (current, 2 days in future → current/0 days)
const invoiceRows = [
  {
    id: 'inv1', invoice_number: 'INV-001',
    invoice_date: '2026-03-25', due_date: '2026-04-25',
    payment_terms_days: 30,
    total_amount_cents: 100000, balance_due_cents: 100000,
    status: 'sent', is_consolidated: false,
  },
  {
    id: 'inv2', invoice_number: 'INV-002',
    invoice_date: '2026-02-23', due_date: '2026-03-25',
    payment_terms_days: 30,
    total_amount_cents: 75000, balance_due_cents: 75000,
    status: 'sent', is_consolidated: false,
  },
  {
    id: 'inv3', invoice_number: 'INV-003',
    invoice_date: '2026-03-31', due_date: '2026-04-30',
    payment_terms_days: 30,
    total_amount_cents: 50000, balance_due_cents: 50000,
    status: 'sent', is_consolidated: false,
  },
];

const linkRows = [
  { invoice_id: 'inv1', charge_set: { order: { customer_reference: 'PO-001' } } },
  { invoice_id: 'inv2', charge_set: { order: { customer_reference: 'PO-002' } } },
  { invoice_id: 'inv3', charge_set: { order: { customer_reference: 'PO-003' } } },
];

const tenantRow   = { name: 'Acme Drayage' };
const settingsRow = {
  company_display_name: 'Acme Drayage Inc.',
  logo_small_url: null, logo_large_url: null,
  address_line1: '123 Main Street', address_line2: null,
  city: 'Newark', state: 'NJ', zip: '07102',
  phone: '555-555-1212', website: 'www.acme.example',
};

test('renderStatementPdf produces a valid PDF buffer (end-to-end smoke)', async () => {
  const svc = makeMockSvc({
    customers:                { data: customerRow, error: null },
    invoices:                 { data: invoiceRows, error: null },
    invoice_charge_sets:      { data: linkRows, error: null },
    tenants:                  { data: tenantRow, error: null },
    tenant_settings:          { data: settingsRow, error: null },
    document_templates:       { data: [], error: null },
  });

  const buf = await renderStatementPdf(svc, customerId, tenantId, asOfDate);

  assert.ok(Buffer.isBuffer(buf), 'expected a Buffer');
  assert.ok(buf.length > 1000, `PDF buffer too small (${buf.length} bytes)`);
  assert.equal(buf.slice(0, 5).toString('ascii'), '%PDF-');
});
```

- [ ] **Step 2: Run the test, iterate fixture until GREEN**

Run:
```bash
npm test 2>&1 | grep -A 2 "statement-fetcher" | tail -15
```

If missing field, read `components/pdf/StatementTemplate.js` or `lib/pdf/build-statement-section-data.js`.

- [ ] **Step 3: Commit**

```bash
git add tests/statement-fetcher-integration.test.mjs
git commit -m "$(cat <<'EOF'
test(pdf): statement byte-magic PDF smoke (FU-035-H-shared-test-infra task 8)

Adds end-to-end PDF render smoke for renderStatementPdf. Mocks 1 customer
+ 3 open invoices spanning multiple aging buckets (current / 1-30 / 31-60)
+ invoice_charge_sets for customer_reference passthrough + tenant +
tenant_settings + document_templates. Exercises computeAging() against
representative data.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: Final verification + ledger update + push

**Files:**
- Modify: `memory/followups.md`

- [ ] **Step 1: Run the full test suite**

Run:
```bash
npm test 2>&1 | tail -20
```

Expected: All test files pass except the pre-existing `fire-trigger-entity-aware.test.mjs` failure documented in the H6 handoff. Confirm:
- Total pass count is **at least 6 higher** than before this FU (1 credit-memo extension + 5 new files, each with ≥1 test).
- No new failures beyond the documented pre-existing one.

- [ ] **Step 2: Update memory/followups.md ledger**

Open `memory/followups.md`. Find the `### FU-035-H-shared-test-infra:` section (currently at line ~702). Replace the existing section with a Resolved entry:

```markdown
### FU-035-H-shared-test-infra: JSX-transform test utility for end-to-end renderer integration smoke
- ✅ Resolved 2026-04-28 in `<commit-hash>` — Added `@swc-node/register@^1.10.0` as devDependency + `npm test` script wired with `--import @swc-node/register/esm-register`. Extracted `makeMockSvc` from inline definition into shared `tests/helpers/mock-supabase.mjs` (added `.or()` chain method support for resolveTemplateConfig). All 6 AR-family renderers now have a byte-magic PDF smoke test: Credit Memo (extension to existing file) + new files for Invoice / Rate Con / Combined Invoice / POD / Statement. Each asserts `Buffer.isBuffer(buf)` + `buf.length > 1000` + `buf.slice(0,5).toString('ascii') === '%PDF-'`. 6 new tests total. **Closes the remaining ~10% gap of FU-035-H6-followup-A (which was scoped-resolved at `11a43f0`). The full FU-035-H6-followup-A is now fully resolved.**
```

(Insert the actual commit hash from the final commit after Step 4 below.)

Find `### FU-035-H6-followup-A:` (line ~665). Update its trailing line — change "Remaining ~10%" to "Resolved":

Find:
```markdown
- **Remaining ~10%:** the `renderToBuffer(<CreditMemoTemplate ... />)` byte-level smoke needs a shared JSX-transform test utility (esbuild-register / @swc-node/register) — back-applies across all 6 renderers. Filed as **FU-035-H-shared-test-infra** below.
```

Replace with:
```markdown
- **Remaining ~10% — Resolved 2026-04-28** via FU-035-H-shared-test-infra: byte-magic smoke for `renderCreditMemoPdf` added; transformer infra back-applied to 5 other AR renderers.
```

- [ ] **Step 3: Commit ledger + final verification**

```bash
git add memory/followups.md
git commit -m "$(cat <<'EOF'
chore: FU-035-H-shared-test-infra resolved + H6-followup-A fully closed

- @swc-node/register installed; npm test script wired
- 6 AR-family renderers all have byte-magic PDF smoke tests
- tests/helpers/mock-supabase.mjs convention established
- followups.md ledger updated

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 4: Push to remote**

Run:
```bash
git log --oneline origin/main..HEAD
```

Expected: ~9 commits ahead (1 spec, 1 each per task = 8 implementation commits, 1 ledger).

Then:
```bash
git push origin main
```

Expected: push succeeds, all commits on remote.

---

## Self-Review Checklist (planner — run before handoff)

- [x] **Spec coverage:** Every spec section maps to a task:
  - Spec §3.1 transformer choice → Task 1
  - Spec §3.2 test invocation → Task 1
  - Spec §3.3 shared helper → Task 2
  - Spec §3.4 byte-magic pattern → Tasks 3-8
  - Spec §3.5 per-renderer fixtures → Tasks 4-8
  - Spec §5.1 verification plan → distributed across all tasks; final pass in Task 9
  - Spec §7 success criteria → Task 9 ledger entry
- [x] **Placeholder scan:** No "TBD" / "TODO" / "implement later" in any task. Each step has executable content.
- [x] **Type consistency:** `makeMockSvc(responses)` signature is the same across all 6 test files. Fixture names (`tenantId`, `tenantRow`, `settingsRow`, `customerRow`) follow the same convention. Chain method list (`select, eq, in, is, not, gt, lte, order, or`) is identical between the helper definition (Task 2) and the comment (Task 2).
- [x] **DRY check:** `tenantRow` and `settingsRow` shapes are intentionally repeated per test file (no shared fixtures helper) — see spec §3.3 last paragraph for rationale (premature factoring).
- [x] **Risk coverage:** The "iterate fixture until GREEN" steps in Tasks 4-8 explicitly handle the spec's identified risk #1 (hidden non-Supabase I/O) and #2 (templates that crash on minimal data).
