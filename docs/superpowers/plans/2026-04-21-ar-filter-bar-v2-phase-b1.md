# AR Filter Bar v2 Phase B1 — Foundation + Six Simple Filter Dimensions

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add per-section filter-visibility schema + six new filter dimensions to the AR FilterSidebar — reference number, load type, container type, container size, load flags, SSL, driver — each applied to both Billing Pipeline and Invoices endpoints.

**Architecture:** Extends Phase A (cross-section tabs). A new `lib/ar-filter-schema.js` declares which filter keys apply to which AR sub-tabs (trivial in B1 — Billing + Invoices get all keys; becomes meaningful in B2 when Payments / Credits / etc. wire up). `sanitizeFilterSet` + `KNOWN_KEYS` expand to accept the new keys. Existing AR endpoints accept new CSV-array / text query params and apply them in the SAME client-side-filter pattern Phase A used. FilterSidebar grows five new sections that render only for the current section's schema entry. No new database migrations — all dimensions map to existing `orders.*` columns.

**Tech Stack:** Next.js pages/api, Supabase service-role client, React (props + local state), Tailwind v4 with mandatory `dark:` variants, `lucide-react` icons. Existing helpers reused: `parseCsvParam`, `sanitizeFilterSet`, `CustomerCombobox` pattern.

---

## File Structure

**Backend:**
- Create: `lib/ar-filter-schema.js` — declarative per-section filter-key list
- Modify: `lib/ar-filter-params.js` — expand `KNOWN_KEYS` + `sanitizeFilterSet`
- Modify: `pages/api/tenant/ar/index.js` — parse + apply new filter params
- Modify: `pages/api/tenant/ar/invoices/index.js` — parse + apply new filter params
- Modify: `pages/api/tenant/drivers/index.js` — broaden GET permission to include `ACCOUNTS_RECEIVABLE`
- Create: `pages/api/tenant/ar/ssl-codes.js` — returns distinct `orders.steamship_line_scac` values for the current tenant

**Frontend:**
- Modify: `components/ar/FilterSidebar.js` — five new sidebar sections
- Modify: `components/ar/ArFiltersBar.js` — extend `filtersMatch` for new keys

**Tests:**
- Modify: `tests/ar-filter-params.test.mjs` — new assertions for new `KNOWN_KEYS`

---

## Conventions (read before starting)

1. **Dark-mode variants are mandatory** on every gray / white / border class. Missing `dark:` variants blocked Phase A final review.
2. **Filter keys are flat** — `filters.reference_number` (string), `filters.load_types` (array), `filters.flags` (array of flag keys), etc. No nested objects.
3. **Backend filtering stays client-side** inside the endpoint (consistent with Phase A) — it already iterates `charge_sets` / `invoices` arrays post-fetch.
4. **AR endpoints already have** Bill-to customer filter (`customer_ids`) and Branch (`branch_ids`) + date range (`from`, `to`). Reuse the exact same URL-param / `parseCsvParam` idiom.
5. **New driver permission fix mirrors the Phase A polish** on `/api/tenant/organizations` (commit `55ac728`) — broaden GET to include `ACCOUNTS_RECEIVABLE`.
6. **Migration number**: no new migration in B1.
7. **Flag column names** on `orders` (13 confirmed via Explore agent): `is_hazmat, is_overweight, is_overheight, is_liquor, is_hot, is_genset, is_scale, is_ev, is_street_turn, is_oog, is_bonded, is_double, is_tanker`. The dispatcher FilterSidebar uses camel-case keys without `is_` (e.g. `hazmat`) — mirror that key shape so users see consistent labels across dispatcher + AR.
8. **Container type / size** come from `/api/tenant/container-types` + `/api/tenant/container-sizes` (reference-data-handler pattern, GET already accessible to tenant users — no permission change needed). Response shape is `{ items: [...] }` with `{ id, code, label, is_enabled }` rows.

---

## Task 1: Per-section filter schema

**Files:**
- Create: `lib/ar-filter-schema.js`

Declarative list of which filter keys each AR sub-tab supports. Trivial today (Billing + Invoices accept everything); meaningful in Phase B2 when Payments / Credits / Aging wire up with a narrower subset.

- [ ] **Step 1: Write the schema module**

Write `lib/ar-filter-schema.js`:

```javascript
/**
 * Declarative per-section filter visibility for the AR FilterSidebar + endpoints.
 *
 * Phase B1 wires Billing + Invoices only; both consume every filter key. Phase B2
 * adds Apply Payments / Payments / Credits / Aging with narrower subsets (e.g.
 * Payments probably only sees customer / branch / invoiced date range, not load
 * flags or container size).
 *
 * The FilterSidebar reads `filterKeysForSection(section)` and only renders
 * sections whose key is in the returned array. Endpoints never look at this —
 * they just parse everything they receive (unknown keys get stripped by
 * sanitizeFilterSet anyway).
 */

const ALL_B1_KEYS = [
  'customer_ids',
  'branch_ids',
  'from',
  'to',
  'reference_number',
  'load_types',
  'container_types',
  'container_sizes',
  'flags',
  'ssl_codes',
  'driver_ids',
];

const SECTION_KEYS = {
  billing:        ALL_B1_KEYS,
  invoices:       ALL_B1_KEYS,
  // Phase B2 will override these with narrower lists:
  apply_payments: ALL_B1_KEYS,
  payments:       ALL_B1_KEYS,
  credit_memos:   ALL_B1_KEYS,
  aging:          ALL_B1_KEYS,
};

/**
 * Return the filter-keys visible for the given AR sub-tab id. Unknown sections
 * fall back to the full list (safer than hiding filters unexpectedly).
 */
export function filterKeysForSection(section) {
  return SECTION_KEYS[section] ?? ALL_B1_KEYS;
}
```

- [ ] **Step 2: Commit**

```bash
git add lib/ar-filter-schema.js
git commit -m "feat(ar): add per-section filter-key schema (Phase B1 foundation)"
```

---

## Task 2: Extend `sanitizeFilterSet` + tests

**Files:**
- Modify: `lib/ar-filter-params.js`
- Modify: `tests/ar-filter-params.test.mjs`

Add the seven new keys to `KNOWN_KEYS` + the type-aware coercion in `sanitizeFilterSet`.

- [ ] **Step 1: Write the failing tests** (append to `tests/ar-filter-params.test.mjs`)

Insert AFTER the existing `console.log('\nsanitizeFilterSet')` block but BEFORE the final `console.log` summary line. New checks:

```javascript
console.log('\nsanitizeFilterSet (Phase B1 keys)');
check('keeps reference_number string',
  JSON.stringify(sanitizeFilterSet({ reference_number: 'PO-123' })) === '{"reference_number":"PO-123"}');
check('drops empty reference_number',
  JSON.stringify(sanitizeFilterSet({ reference_number: '' })) === '{}');
check('keeps load_types array',
  JSON.stringify(sanitizeFilterSet({ load_types: ['import','export'] })) === '{"load_types":["import","export"]}');
check('keeps container_types array',
  JSON.stringify(sanitizeFilterSet({ container_types: ['dry_van'] })) === '{"container_types":["dry_van"]}');
check('keeps container_sizes array',
  JSON.stringify(sanitizeFilterSet({ container_sizes: ['20','40HC'] })) === '{"container_sizes":["20","40HC"]}');
check('keeps flags array',
  JSON.stringify(sanitizeFilterSet({ flags: ['hazmat','overweight'] })) === '{"flags":["hazmat","overweight"]}');
check('keeps ssl_codes array',
  JSON.stringify(sanitizeFilterSet({ ssl_codes: ['MSCU','MAEU'] })) === '{"ssl_codes":["MSCU","MAEU"]}');
check('keeps driver_ids array',
  JSON.stringify(sanitizeFilterSet({ driver_ids: ['u1','u2'] })) === '{"driver_ids":["u1","u2"]}');
check('drops empty arrays (new keys)',
  JSON.stringify(sanitizeFilterSet({ load_types: [], flags: [] })) === '{}');
check('drops non-string entries (flags)',
  JSON.stringify(sanitizeFilterSet({ flags: ['hazmat', 42, null, 'overweight'] })) === '{"flags":["hazmat","overweight"]}');
```

- [ ] **Step 2: Run tests (expect new ones to fail)**

```bash
node tests/ar-filter-params.test.mjs
```

Expected: old tests pass, new ones fail (`KNOWN_KEYS` doesn't include the new keys yet).

- [ ] **Step 3: Extend `sanitizeFilterSet` + `KNOWN_KEYS`**

In `lib/ar-filter-params.js`, REPLACE the entire `sanitizeFilterSet` block (the current `KNOWN_KEYS` array + the function body) with:

```javascript
/**
 * Narrow a filter object to only the canonical keys and drop empty
 * values (empty arrays, null / undefined / '' dates and strings). Used
 * when persisting custom-tab filter payloads so the JSONB row stays
 * compact, and when merging client-supplied filter patches into a
 * URLSearchParams-shaped fetch payload.
 *
 * Keys are grouped by coercion:
 *   - ARRAY_KEYS:  arrays of non-empty strings (ids, codes, flag names)
 *   - STRING_KEYS: non-empty strings (text search, ISO dates)
 */
const ARRAY_KEYS = [
  'customer_ids',
  'branch_ids',
  'load_types',
  'container_types',
  'container_sizes',
  'flags',
  'ssl_codes',
  'driver_ids',
];

const STRING_KEYS = [
  'from',
  'to',
  'reference_number',
];

const KNOWN_KEYS = [...ARRAY_KEYS, ...STRING_KEYS];

export function sanitizeFilterSet(input) {
  if (!input || typeof input !== 'object') return {};
  const out = {};
  for (const key of KNOWN_KEYS) {
    const v = input[key];
    if (ARRAY_KEYS.includes(key)) {
      if (Array.isArray(v) && v.length > 0) {
        const cleaned = v.filter((s) => typeof s === 'string' && s.length > 0);
        if (cleaned.length > 0) out[key] = cleaned;
      }
    } else {
      if (typeof v === 'string' && v.length > 0) out[key] = v;
    }
  }
  return out;
}
```

The existing `parseCsvParam` export at the top of the file is unchanged — leave it.

- [ ] **Step 4: Run tests — all should pass**

```bash
node tests/ar-filter-params.test.mjs
```

Expected output includes `22 passed, 0 failed` (the original 12 + 10 new).

- [ ] **Step 5: Commit**

```bash
git add lib/ar-filter-params.js tests/ar-filter-params.test.mjs
git commit -m "feat(ar): extend sanitizeFilterSet with Phase B1 filter keys"
```

---

## Task 3: AR pipeline endpoint — apply new filters

**Files:**
- Modify: `pages/api/tenant/ar/index.js`

Parse the seven new params and apply them client-side (same pattern as Phase A's `customer_ids` filter). All new filters check fields on the joined `orders` row.

- [ ] **Step 1: Read the current file** to locate the scope block

```bash
cat pages/api/tenant/ar/index.js
```

You'll find a block around lines 27-30 that parses current filter params:

```javascript
  const { status, load_status, search, from, to } = req.query;
  const customerIds = parseCsvParam(req.query.customer_ids);
  const branchIds   = parseCsvParam(req.query.branch_ids);
```

and a client-side filter block (~lines 54-70) that narrows `scopedSets` by customer/branch.

- [ ] **Step 2: Parse the new params**

After the existing `const branchIds = parseCsvParam(...)` line, add:

```javascript
  const { reference_number } = req.query;
  const loadTypes       = parseCsvParam(req.query.load_types);
  const containerTypes  = parseCsvParam(req.query.container_types);
  const containerSizes  = parseCsvParam(req.query.container_sizes);
  const flagKeys        = parseCsvParam(req.query.flags);
  const sslCodes        = parseCsvParam(req.query.ssl_codes);
  const driverIds       = parseCsvParam(req.query.driver_ids);
```

- [ ] **Step 3: Extend the orders-join select**

The existing select includes fields like `customer_id, branch_id`. Add to the `order:orders(...)` part of the `.select()` chain (around line 35) the additional fields we now filter on. Find the existing line that looks like:

```javascript
      order:orders(id, order_number, status, load_type, customer_id, customer_reference, branch_id, created_at, deleted_at,
```

Replace it with:

```javascript
      order:orders(id, order_number, status, load_type, customer_id, customer_reference, branch_id, driver_id, container_type, container_size, steamship_line_scac, is_hazmat, is_overweight, is_overheight, is_liquor, is_hot, is_genset, is_scale, is_ev, is_street_turn, is_oog, is_bonded, is_double, is_tanker, created_at, deleted_at,
```

(The rest of the select — customer nested join, etc. — stays intact.)

- [ ] **Step 4: Add the new client-side filter passes**

Locate the existing client-side filter block that starts with `// Customer filter — match on order.customer_id OR bill_to_customer_id.` and ends after the branch filter (around `if (branchIds.length > 0) { … scopedSets = scopedSets.filter(...) }`).

Immediately AFTER that `branchIds` filter block but BEFORE the `// Compute counts over the SCOPED set` comment, INSERT:

```javascript
  // Reference number — substring match on orders.customer_reference (case-insensitive).
  if (reference_number && typeof reference_number === 'string' && reference_number.trim().length > 0) {
    const q = reference_number.trim().toLowerCase();
    scopedSets = scopedSets.filter((cs) =>
      cs.order?.customer_reference?.toLowerCase().includes(q)
    );
  }

  // Load type — multi-select on orders.load_type.
  if (loadTypes.length > 0) {
    const types = new Set(loadTypes);
    scopedSets = scopedSets.filter((cs) => cs.order?.load_type && types.has(cs.order.load_type));
  }

  // Container type + size — multi-select on orders.container_type / .container_size.
  if (containerTypes.length > 0) {
    const types = new Set(containerTypes);
    scopedSets = scopedSets.filter((cs) => cs.order?.container_type && types.has(cs.order.container_type));
  }
  if (containerSizes.length > 0) {
    const sizes = new Set(containerSizes);
    scopedSets = scopedSets.filter((cs) => cs.order?.container_size && sizes.has(cs.order.container_size));
  }

  // Load flags — AND semantics (row must have EVERY selected flag set true).
  // flag keys are bare labels (e.g. "hazmat"); the DB columns are is_<key>.
  if (flagKeys.length > 0) {
    scopedSets = scopedSets.filter((cs) =>
      flagKeys.every((key) => cs.order?.[`is_${key}`] === true)
    );
  }

  // SSL multi-select on orders.steamship_line_scac (uppercased SCAC code).
  if (sslCodes.length > 0) {
    const codes = new Set(sslCodes.map((c) => c.toUpperCase()));
    scopedSets = scopedSets.filter((cs) =>
      cs.order?.steamship_line_scac && codes.has(cs.order.steamship_line_scac.toUpperCase())
    );
  }

  // Driver multi-select on orders.driver_id.
  if (driverIds.length > 0) {
    const ids = new Set(driverIds);
    scopedSets = scopedSets.filter((cs) => cs.order?.driver_id && ids.has(cs.order.driver_id));
  }
```

The subsequent `counts` computation + `load_status` filter logic already consumes `scopedSets`, so the new narrowing flows through automatically.

- [ ] **Step 5: Smoke-check syntax**

Read the full file and eyeball the braces + commas. The block of 7 new filter passes should sit between the branch filter and the count-computation loop.

- [ ] **Step 6: Commit**

```bash
git add pages/api/tenant/ar/index.js
git commit -m "feat(ar): AR pipeline endpoint applies 7 new filter dimensions"
```

---

## Task 4: AR invoices endpoint — apply new filters

**Files:**
- Modify: `pages/api/tenant/ar/invoices/index.js`

Same approach as Task 3. The invoices endpoint joins `invoice_charge_sets → order_charge_sets → order`, so the new filters check fields on the order at the bottom of that chain.

- [ ] **Step 1: Read current file** to understand the join + existing filter block

```bash
cat pages/api/tenant/ar/invoices/index.js
```

Currently the endpoint's GET handler:
1. Destructures `customer_ids`, `branch_ids`, `from`, `to`, `search` from `req.query` via `parseCsvParam`
2. Fetches `invoices` with a nested `invoice_charge_sets → order_charge_sets → order` select
3. Applies customer/branch/date filters (some SQL-side, some client-side) and returns

- [ ] **Step 2: Parse the new params**

Near the top of the GET handler, AFTER the existing `const branchIds = parseCsvParam(...)`, add:

```javascript
  const { reference_number } = req.query;
  const loadTypes       = parseCsvParam(req.query.load_types);
  const containerTypes  = parseCsvParam(req.query.container_types);
  const containerSizes  = parseCsvParam(req.query.container_sizes);
  const flagKeys        = parseCsvParam(req.query.flags);
  const sslCodes        = parseCsvParam(req.query.ssl_codes);
  const driverIds       = parseCsvParam(req.query.driver_ids);
```

- [ ] **Step 3: Extend the nested orders select**

Find the existing select chain — specifically the deepest `order:orders(...)` nested join. Currently it reads something like `order:orders(id, order_number)`. Update it to include the filterable fields:

```javascript
            order:orders(id, order_number, load_type, customer_reference, branch_id, driver_id, container_type, container_size, steamship_line_scac, is_hazmat, is_overweight, is_overheight, is_liquor, is_hot, is_genset, is_scale, is_ev, is_street_turn, is_oog, is_bonded, is_double, is_tanker)
```

Don't touch the other select fields (customer join, charge_sets array, etc.).

- [ ] **Step 4: Add the client-side filter passes**

The endpoint currently applies filters and returns `{ invoices: filtered, stats }`. Find the point AFTER the initial `data = data.filter(...)` (deleted_at / customer-match / branch-match filters) but BEFORE the stats computation. Wrap in a helper to check "does any charge_set on this invoice's order match these order-level criteria?" — an invoice passes if ANY of its underlying orders passes all active filters.

Insert this block at that point. Keep the variable name `filtered` if it already exists; otherwise introduce it from `data`:

```javascript
  // The following filters are order-level — an invoice passes if ANY of its
  // constituent charge-sets' orders satisfies every active filter.
  const orderMatches = (order) => {
    if (!order) return false;
    if (reference_number && typeof reference_number === 'string' && reference_number.trim().length > 0) {
      const q = reference_number.trim().toLowerCase();
      if (!order.customer_reference?.toLowerCase().includes(q)) return false;
    }
    if (loadTypes.length > 0 && !loadTypes.includes(order.load_type)) return false;
    if (containerTypes.length > 0 && !containerTypes.includes(order.container_type)) return false;
    if (containerSizes.length > 0 && !containerSizes.includes(order.container_size)) return false;
    if (flagKeys.length > 0 && !flagKeys.every((key) => order[`is_${key}`] === true)) return false;
    if (sslCodes.length > 0) {
      const codes = new Set(sslCodes.map((c) => c.toUpperCase()));
      if (!order.steamship_line_scac || !codes.has(order.steamship_line_scac.toUpperCase())) return false;
    }
    if (driverIds.length > 0 && !driverIds.includes(order.driver_id)) return false;
    return true;
  };

  const hasOrderFilters =
    (reference_number && typeof reference_number === 'string' && reference_number.trim().length > 0) ||
    loadTypes.length > 0 ||
    containerTypes.length > 0 ||
    containerSizes.length > 0 ||
    flagKeys.length > 0 ||
    sslCodes.length > 0 ||
    driverIds.length > 0;

  if (hasOrderFilters) {
    filtered = filtered.filter((inv) => {
      const sets = inv.charge_sets || [];
      return sets.some((cs) => orderMatches(cs?.charge_set?.order));
    });
  }
```

If the current endpoint doesn't already bind `filtered = data.filter(...)`, introduce it: `let filtered = (data || []).filter(...)` before this block, and then change the final response from `{ invoices: data, stats }` to `{ invoices: filtered, stats }`. Stats should compute from `filtered`, not `data`.

- [ ] **Step 5: Commit**

```bash
git add pages/api/tenant/ar/invoices/index.js
git commit -m "feat(ar): invoices endpoint applies 7 new filter dimensions"
```

---

## Task 5: Broaden drivers endpoint perm + create SSL-codes endpoint

**Files:**
- Modify: `pages/api/tenant/drivers/index.js`
- Create: `pages/api/tenant/ar/ssl-codes.js`

The FilterSidebar's Driver combobox fetches `/api/tenant/drivers`; the SSL multi-select fetches `/api/tenant/ar/ssl-codes`. Both must be reachable by AR users.

- [ ] **Step 1: Broaden `/api/tenant/drivers` GET permission**

In `pages/api/tenant/drivers/index.js` around line 17, find the line:

```javascript
    if (!requirePermission(ctx, [PERMISSIONS.DISPATCHING, PERMISSIONS.ALL], res)) return;
```

Replace with:

```javascript
    if (!requirePermission(ctx, [PERMISSIONS.DISPATCHING, PERMISSIONS.ACCOUNTS_RECEIVABLE, PERMISSIONS.ALL], res)) return;
```

Only the GET-branch permission changes. Leave the POST-branch permission gate untouched (creating drivers stays dispatching-only).

- [ ] **Step 2: Create `/api/tenant/ar/ssl-codes.js`**

Write this file:

```javascript
import {
  requireTenantUser,
  requirePermission,
  getServiceClient,
} from '../../../../lib/tenant-api';
import { PERMISSIONS } from '../../../../lib/permissions';

/**
 * GET /api/tenant/ar/ssl-codes
 *
 * Returns the distinct `orders.steamship_line_scac` values present in the
 * current tenant's non-deleted orders, uppercased and sorted alphabetically.
 * Used to populate the AR FilterSidebar's SSL multi-select without hitting
 * a reference table (SCAC codes are free-text on orders).
 *
 * Response shape: { codes: ["MAEU", "MSCU", "ONEY", ...] }
 */
const AR_PERMS = [
  PERMISSIONS.ACCOUNTS_RECEIVABLE,
  PERMISSIONS.ORDER_ENTRY,
  PERMISSIONS.DISPATCHING,
  PERMISSIONS.ALL,
];

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const ctx = await requireTenantUser(req, res);
  if (!ctx) return;
  if (!requirePermission(ctx, AR_PERMS, res)) return;

  const svc = getServiceClient();

  const { data, error } = await svc
    .from('orders')
    .select('steamship_line_scac')
    .eq('tenant_id', ctx.tenantId)
    .is('deleted_at', null)
    .not('steamship_line_scac', 'is', null);

  if (error) {
    console.error('[ar/ssl-codes] query failed:', error.message);
    return res.status(500).json({ error: 'query_failed' });
  }

  const codes = Array.from(
    new Set((data || [])
      .map((r) => (typeof r.steamship_line_scac === 'string' ? r.steamship_line_scac.trim().toUpperCase() : ''))
      .filter(Boolean))
  ).sort();

  res.setHeader('Cache-Control', 'no-store');
  return res.status(200).json({ codes });
}
```

- [ ] **Step 3: Commit**

```bash
git add pages/api/tenant/drivers/index.js pages/api/tenant/ar/ssl-codes.js
git commit -m "feat(ar): grant AR read access to drivers + add ssl-codes endpoint"
```

---

## Task 6: Extend `ArFiltersBar.filtersMatch`

**Files:**
- Modify: `components/ar/ArFiltersBar.js`

Currently `filtersMatch()` compares `customer_ids`, `branch_ids`, `from`, `to`. Without extending it, saving a tab with e.g. a reference-number filter always shows "+ Save as tab" (because Phase A's comparator ignores the new keys and always reports equality with a tab whose customer/branch match). We need the comparator to consider every B1 key.

- [ ] **Step 1: Replace the existing `filtersMatch` function**

Find the current `filtersMatch` function at the bottom of `components/ar/ArFiltersBar.js`. Replace its entire body with:

```javascript
function filtersMatch(a, b) {
  a = a || {};
  b = b || {};
  const arrEq = (x, y) => {
    const xs = [...(x ?? [])].sort();
    const ys = [...(y ?? [])].sort();
    return xs.length === ys.length && xs.every((v, i) => v === ys[i]);
  };
  const strEq = (x, y) => (x ?? '').trim().toLowerCase() === (y ?? '').trim().toLowerCase();

  return (
    arrEq(a.customer_ids,    b.customer_ids) &&
    arrEq(a.branch_ids,      b.branch_ids) &&
    arrEq(a.load_types,      b.load_types) &&
    arrEq(a.container_types, b.container_types) &&
    arrEq(a.container_sizes, b.container_sizes) &&
    arrEq(a.flags,           b.flags) &&
    arrEq(a.ssl_codes,       b.ssl_codes) &&
    arrEq(a.driver_ids,      b.driver_ids) &&
    (a.from ?? '') === (b.from ?? '') &&
    (a.to   ?? '') === (b.to   ?? '') &&
    strEq(a.reference_number, b.reference_number)
  );
}
```

- [ ] **Step 2: Update `filtersAreEmpty` in the same file**

Near the top of the `ArFiltersBar` function body, the existing `filtersAreEmpty` check only tests customer/branch/from/to. Replace its declaration with:

```javascript
  const filtersAreEmpty =
    !currentFilters ||
    (
      (currentFilters.customer_ids?.length    ?? 0) === 0 &&
      (currentFilters.branch_ids?.length      ?? 0) === 0 &&
      (currentFilters.load_types?.length      ?? 0) === 0 &&
      (currentFilters.container_types?.length ?? 0) === 0 &&
      (currentFilters.container_sizes?.length ?? 0) === 0 &&
      (currentFilters.flags?.length           ?? 0) === 0 &&
      (currentFilters.ssl_codes?.length       ?? 0) === 0 &&
      (currentFilters.driver_ids?.length      ?? 0) === 0 &&
      !currentFilters.from &&
      !currentFilters.to &&
      !(currentFilters.reference_number && currentFilters.reference_number.trim().length > 0)
    );
```

- [ ] **Step 3: Commit**

```bash
git add components/ar/ArFiltersBar.js
git commit -m "feat(ar): ArFiltersBar recognizes Phase B1 filter keys in match + empty check"
```

---

## Task 7: FilterSidebar — Reference Number input

**Files:**
- Modify: `components/ar/FilterSidebar.js`

- [ ] **Step 1: Add a schema import and section prop**

At the top of the file, add:

```javascript
import { filterKeysForSection } from '../../lib/ar-filter-schema';
```

Update the `export default function FilterSidebar(...)` signature to accept an optional `section` prop. Change:

```javascript
export default function FilterSidebar({ isOpen, onClose, filters, onApply }) {
```

to:

```javascript
export default function FilterSidebar({ isOpen, onClose, filters, onApply, section = 'billing' }) {
  const visibleKeys = filterKeysForSection(section);
  const showKey = (key) => visibleKeys.includes(key);
```

(The `section` prop lets Phase B2 narrow the sidebar per sub-tab; in B1 it's a no-op because every section gets every key.)

- [ ] **Step 2: Update `pages/ar/index.js` to pass the active section**

Find the existing `<FilterSidebar ... />` render and add a `section={activeTab}` prop:

```jsx
        <FilterSidebar
          isOpen={filterSidebarOpen}
          onClose={() => setFilterSidebarOpen(false)}
          filters={filters}
          section={activeTab}
          onApply={(next) => {
            setFilters(next);
            setActiveTabId(null);
          }}
        />
```

- [ ] **Step 3: Add the Reference Number section to the sidebar**

Inside the sidebar's content area (the scrollable column below the header, between existing sections), find the current Customers section. IMMEDIATELY BEFORE it, add:

```jsx
          {/* Reference number — text search on orders.customer_reference */}
          {showKey('reference_number') && (
            <section>
              <label className="block text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-slate-400 mb-2">
                Reference number
              </label>
              <input
                type="text"
                value={draft.reference_number ?? ''}
                onChange={(e) => setDraft((d) => ({ ...d, reference_number: e.target.value }))}
                placeholder="e.g. PO-12345"
                className="w-full px-2 py-1.5 text-xs border border-gray-200 dark:border-slate-700 rounded-md bg-white dark:bg-slate-800 text-gray-900 dark:text-slate-100 placeholder-gray-400 dark:placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </section>
          )}
```

- [ ] **Step 4: Update the Apply handler to forward `reference_number`**

Find the `Apply` button's `onClick` (inside the footer). The current handler builds a `cleaned` object of non-empty filter values before calling `onApply(cleaned)`. Add the reference-number forward:

```javascript
              onClick={() => {
                const cleaned = {};
                if (draft.customer_ids?.length) cleaned.customer_ids = draft.customer_ids;
                if (draft.branch_ids?.length)   cleaned.branch_ids   = draft.branch_ids;
                if (draft.from)                 cleaned.from         = draft.from;
                if (draft.to)                   cleaned.to           = draft.to;
                if (draft.reference_number && draft.reference_number.trim().length > 0) {
                  cleaned.reference_number = draft.reference_number.trim();
                }
                onApply(cleaned);
                onClose();
              }}
```

- [ ] **Step 5: Teach BillingPipelineTab + InvoicesTab fetch to forward the new param**

In `components/ar/BillingPipelineTab.js`, find the block that builds `params` in the existing fetch. After the existing `if (filters.from)` / `if (filters.to)` additions, insert:

```javascript
if (filters.reference_number) params.set('reference_number', filters.reference_number);
```

In `components/ar/InvoicesTab.js`, do the same in its fetch's param-build block.

- [ ] **Step 6: Commit**

```bash
git add components/ar/FilterSidebar.js pages/ar/index.js components/ar/BillingPipelineTab.js components/ar/InvoicesTab.js
git commit -m "feat(ar): FilterSidebar — Reference Number input + fetch forwarding"
```

---

## Task 8: FilterSidebar — Load Type multi-select

**Files:**
- Modify: `components/ar/FilterSidebar.js`
- Modify: `components/ar/BillingPipelineTab.js`, `components/ar/InvoicesTab.js`

Hardcoded enum — Billing and Invoices consume the same options. Match the dispatcher's ordering + labels exactly.

- [ ] **Step 1: Add the options constant near the top of FilterSidebar.js**

Near the existing `const EMPTY = { ... }` constant at the top of the file, add:

```javascript
const LOAD_TYPE_OPTIONS = [
  { value: 'import',    label: 'Import' },
  { value: 'inbound',   label: 'Inbound' },
  { value: 'export',    label: 'Export' },
  { value: 'outbound',  label: 'Outbound' },
  { value: 'road',      label: 'Road' },
  { value: 'bill_only', label: 'Bill Only' },
];
```

Also update `EMPTY` to include the new array key so resets zero it out:

```javascript
const EMPTY = { customer_ids: [], branch_ids: [], from: '', to: '', reference_number: '', load_types: [], container_types: [], container_sizes: [], flags: [], ssl_codes: [], driver_ids: [] };
```

- [ ] **Step 2: Render the Load Type section**

In the sidebar content, AFTER the Reference Number section from Task 7, add:

```jsx
          {/* Load type — multi-select on orders.load_type */}
          {showKey('load_types') && (
            <section>
              <div className="flex items-center justify-between mb-2">
                <label className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-slate-400">Load type</label>
                {(draft.load_types?.length ?? 0) > 0 && (
                  <span className="text-[10px] text-gray-500 dark:text-slate-400">{draft.load_types.length} selected</span>
                )}
              </div>
              <div className="grid grid-cols-2 gap-1 border border-gray-100 dark:border-slate-800 rounded-md p-1">
                {LOAD_TYPE_OPTIONS.map((opt) => {
                  const selected = draft.load_types?.includes(opt.value) ?? false;
                  return (
                    <label key={opt.value} className="flex items-center gap-2 px-2 py-1 text-xs hover:bg-gray-50 dark:hover:bg-slate-800 cursor-pointer rounded">
                      <input
                        type="checkbox"
                        checked={selected}
                        onChange={() => setDraft((d) => {
                          const set = new Set(d.load_types ?? []);
                          if (set.has(opt.value)) set.delete(opt.value); else set.add(opt.value);
                          return { ...d, load_types: Array.from(set) };
                        })}
                        className="rounded"
                      />
                      <span className="text-gray-700 dark:text-slate-300">{opt.label}</span>
                    </label>
                  );
                })}
              </div>
            </section>
          )}
```

- [ ] **Step 3: Update the Apply handler**

Extend the `cleaned` builder in the Apply `onClick` to forward `load_types`:

```javascript
                if (draft.load_types?.length) cleaned.load_types = draft.load_types;
```

- [ ] **Step 4: Forward `load_types` in both tab fetches**

In BOTH `components/ar/BillingPipelineTab.js` and `components/ar/InvoicesTab.js`, add to the params-build block:

```javascript
if (filters.load_types?.length) params.set('load_types', filters.load_types.join(','));
```

- [ ] **Step 5: Commit**

```bash
git add components/ar/FilterSidebar.js components/ar/BillingPipelineTab.js components/ar/InvoicesTab.js
git commit -m "feat(ar): FilterSidebar — Load Type multi-select"
```

---

## Task 9: FilterSidebar — Container Type + Container Size

**Files:**
- Modify: `components/ar/FilterSidebar.js`
- Modify: `components/ar/BillingPipelineTab.js`, `components/ar/InvoicesTab.js`

These fetch their options from `/api/tenant/container-types` and `/api/tenant/container-sizes` (reference-data-handler shape — `{ items: [...] }` with `{ id, code, label, is_enabled }`). Filter stores selected `code` strings (e.g. `'dry_van'`, `'40HC'`) because that's what `orders.container_type` and `orders.container_size` hold.

- [ ] **Step 1: Fetch the option lists on open**

Find the existing `useEffect` that fetches customers + branches when the sidebar opens. Extend that effect so it also fetches container types + sizes. Replace the effect body with:

```javascript
  useEffect(() => {
    if (!isOpen) return;
    (async () => {
      try {
        const [custRes, brRes, ctRes, csRes] = await Promise.all([
          fetch('/api/tenant/organizations?type=customer').then((r) => (r.ok ? r.json() : { organizations: [] })),
          fetch('/api/tenant/branches').then((r) => (r.ok ? r.json() : { branches: [] })),
          fetch('/api/tenant/container-types?enabled=true').then((r) => (r.ok ? r.json() : { items: [] })),
          fetch('/api/tenant/container-sizes?enabled=true').then((r) => (r.ok ? r.json() : { items: [] })),
        ]);
        setCustomers(custRes.organizations ?? custRes.customers ?? custRes ?? []);
        setBranches(brRes.branches ?? brRes ?? []);
        setContainerTypes(ctRes.items ?? []);
        setContainerSizes(csRes.items ?? []);
      } catch (_) { /* swallow — user sees empty list, can still apply other filters */ }
    })();
  }, [isOpen]);
```

Add the two new `useState` declarations near the existing `customers` / `branches` states:

```javascript
  const [containerTypes, setContainerTypes] = useState([]);
  const [containerSizes, setContainerSizes] = useState([]);
```

- [ ] **Step 2: Render the two sections**

AFTER the Load Type section from Task 8, add:

```jsx
          {/* Container type */}
          {showKey('container_types') && (
            <section>
              <div className="flex items-center justify-between mb-2">
                <label className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-slate-400">Container type</label>
                {(draft.container_types?.length ?? 0) > 0 && (
                  <span className="text-[10px] text-gray-500 dark:text-slate-400">{draft.container_types.length} selected</span>
                )}
              </div>
              <div className="max-h-40 overflow-y-auto border border-gray-100 dark:border-slate-800 rounded-md">
                {containerTypes.length === 0 ? (
                  <div className="px-3 py-2 text-xs text-gray-400 dark:text-slate-500">No types available</div>
                ) : (
                  containerTypes.map((t) => {
                    const selected = draft.container_types?.includes(t.code) ?? false;
                    return (
                      <label key={t.id} className="flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-gray-50 dark:hover:bg-slate-800 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={selected}
                          onChange={() => setDraft((d) => {
                            const set = new Set(d.container_types ?? []);
                            if (set.has(t.code)) set.delete(t.code); else set.add(t.code);
                            return { ...d, container_types: Array.from(set) };
                          })}
                          className="rounded"
                        />
                        <span className="text-gray-700 dark:text-slate-300 truncate">{t.label || t.code}</span>
                      </label>
                    );
                  })
                )}
              </div>
            </section>
          )}

          {/* Container size */}
          {showKey('container_sizes') && (
            <section>
              <div className="flex items-center justify-between mb-2">
                <label className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-slate-400">Container size</label>
                {(draft.container_sizes?.length ?? 0) > 0 && (
                  <span className="text-[10px] text-gray-500 dark:text-slate-400">{draft.container_sizes.length} selected</span>
                )}
              </div>
              <div className="grid grid-cols-3 gap-1 border border-gray-100 dark:border-slate-800 rounded-md p-1">
                {containerSizes.length === 0 ? (
                  <div className="col-span-3 px-3 py-2 text-xs text-gray-400 dark:text-slate-500">No sizes available</div>
                ) : (
                  containerSizes.map((s) => {
                    const selected = draft.container_sizes?.includes(s.code) ?? false;
                    return (
                      <label key={s.id} className="flex items-center gap-2 px-2 py-1 text-xs hover:bg-gray-50 dark:hover:bg-slate-800 cursor-pointer rounded">
                        <input
                          type="checkbox"
                          checked={selected}
                          onChange={() => setDraft((d) => {
                            const set = new Set(d.container_sizes ?? []);
                            if (set.has(s.code)) set.delete(s.code); else set.add(s.code);
                            return { ...d, container_sizes: Array.from(set) };
                          })}
                          className="rounded"
                        />
                        <span className="text-gray-700 dark:text-slate-300">{s.label || s.code}</span>
                      </label>
                    );
                  })
                )}
              </div>
            </section>
          )}
```

- [ ] **Step 3: Extend the Apply handler**

```javascript
                if (draft.container_types?.length) cleaned.container_types = draft.container_types;
                if (draft.container_sizes?.length) cleaned.container_sizes = draft.container_sizes;
```

- [ ] **Step 4: Forward the two new params in both tab fetches**

In BillingPipelineTab and InvoicesTab:

```javascript
if (filters.container_types?.length) params.set('container_types', filters.container_types.join(','));
if (filters.container_sizes?.length) params.set('container_sizes', filters.container_sizes.join(','));
```

- [ ] **Step 5: Commit**

```bash
git add components/ar/FilterSidebar.js components/ar/BillingPipelineTab.js components/ar/InvoicesTab.js
git commit -m "feat(ar): FilterSidebar — Container Type + Container Size"
```

---

## Task 10: FilterSidebar — Load Flags multi-select

**Files:**
- Modify: `components/ar/FilterSidebar.js`
- Modify: `components/ar/BillingPipelineTab.js`, `components/ar/InvoicesTab.js`

- [ ] **Step 1: Add the flag constant near the other constants**

At the top of FilterSidebar.js:

```javascript
const FLAG_OPTIONS = [
  { key: 'hazmat',      label: 'Hazmat' },
  { key: 'overweight',  label: 'Overweight' },
  { key: 'overheight',  label: 'Overheight' },
  { key: 'hot',         label: 'Hot' },
  { key: 'genset',      label: 'Genset' },
  { key: 'scale',       label: 'Scale' },
  { key: 'ev',          label: 'EV' },
  { key: 'street_turn', label: 'Street Turn' },
  { key: 'oog',         label: 'OOG' },
  { key: 'bonded',      label: 'Bonded' },
  { key: 'double',      label: 'Double' },
  { key: 'tanker',      label: 'Tanker' },
  { key: 'liquor',      label: 'Liquor' },
];
```

(13 flags — the schema survey confirmed these are the live `is_<key>` columns. If `orders.is_reefer` exists in the live DB, add `{ key: 'reefer', label: 'Reefer' }` after 'overheight' before committing; dispatcher FilterSidebar includes it. Verify with `git grep -n "is_reefer" supabase/migrations/` before writing the array.)

- [ ] **Step 2: Render the Flags section**

AFTER Container Size section, add:

```jsx
          {/* Load flags — AND semantics; row must have every selected flag set true */}
          {showKey('flags') && (
            <section>
              <div className="flex items-center justify-between mb-2">
                <label className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-slate-400">Flags</label>
                {(draft.flags?.length ?? 0) > 0 && (
                  <span className="text-[10px] text-gray-500 dark:text-slate-400">{draft.flags.length} selected</span>
                )}
              </div>
              <div className="grid grid-cols-2 gap-1 border border-gray-100 dark:border-slate-800 rounded-md p-1">
                {FLAG_OPTIONS.map((opt) => {
                  const selected = draft.flags?.includes(opt.key) ?? false;
                  return (
                    <label key={opt.key} className="flex items-center gap-2 px-2 py-1 text-xs hover:bg-gray-50 dark:hover:bg-slate-800 cursor-pointer rounded">
                      <input
                        type="checkbox"
                        checked={selected}
                        onChange={() => setDraft((d) => {
                          const set = new Set(d.flags ?? []);
                          if (set.has(opt.key)) set.delete(opt.key); else set.add(opt.key);
                          return { ...d, flags: Array.from(set) };
                        })}
                        className="rounded"
                      />
                      <span className="text-gray-700 dark:text-slate-300">{opt.label}</span>
                    </label>
                  );
                })}
              </div>
            </section>
          )}
```

- [ ] **Step 3: Extend the Apply handler**

```javascript
                if (draft.flags?.length) cleaned.flags = draft.flags;
```

- [ ] **Step 4: Forward `flags` in both tab fetches**

```javascript
if (filters.flags?.length) params.set('flags', filters.flags.join(','));
```

- [ ] **Step 5: Commit**

```bash
git add components/ar/FilterSidebar.js components/ar/BillingPipelineTab.js components/ar/InvoicesTab.js
git commit -m "feat(ar): FilterSidebar — Load Flags multi-select (AND semantics)"
```

---

## Task 11: FilterSidebar — SSL multi-select

**Files:**
- Modify: `components/ar/FilterSidebar.js`
- Modify: `components/ar/BillingPipelineTab.js`, `components/ar/InvoicesTab.js`

- [ ] **Step 1: Add `sslCodes` state + fetch**

Add a `useState([])` for `sslCodes` alongside containerTypes / containerSizes. Extend the on-open fetch Promise.all to include the new endpoint:

```javascript
  const [sslCodes, setSslCodes] = useState([]);
```

```javascript
        const [custRes, brRes, ctRes, csRes, sslRes] = await Promise.all([
          fetch('/api/tenant/organizations?type=customer').then((r) => (r.ok ? r.json() : { organizations: [] })),
          fetch('/api/tenant/branches').then((r) => (r.ok ? r.json() : { branches: [] })),
          fetch('/api/tenant/container-types?enabled=true').then((r) => (r.ok ? r.json() : { items: [] })),
          fetch('/api/tenant/container-sizes?enabled=true').then((r) => (r.ok ? r.json() : { items: [] })),
          fetch('/api/tenant/ar/ssl-codes').then((r) => (r.ok ? r.json() : { codes: [] })),
        ]);
        // ... existing setters ...
        setSslCodes(sslRes.codes ?? []);
```

- [ ] **Step 2: Render the SSL section**

AFTER the Flags section, add:

```jsx
          {/* SSL — steamship line SCAC multi-select */}
          {showKey('ssl_codes') && (
            <section>
              <div className="flex items-center justify-between mb-2">
                <label className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-slate-400">SSL</label>
                {(draft.ssl_codes?.length ?? 0) > 0 && (
                  <span className="text-[10px] text-gray-500 dark:text-slate-400">{draft.ssl_codes.length} selected</span>
                )}
              </div>
              <div className="max-h-40 overflow-y-auto border border-gray-100 dark:border-slate-800 rounded-md">
                {sslCodes.length === 0 ? (
                  <div className="px-3 py-2 text-xs text-gray-400 dark:text-slate-500">No SSL codes in orders</div>
                ) : (
                  sslCodes.map((code) => {
                    const selected = draft.ssl_codes?.includes(code) ?? false;
                    return (
                      <label key={code} className="flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-gray-50 dark:hover:bg-slate-800 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={selected}
                          onChange={() => setDraft((d) => {
                            const set = new Set(d.ssl_codes ?? []);
                            if (set.has(code)) set.delete(code); else set.add(code);
                            return { ...d, ssl_codes: Array.from(set) };
                          })}
                          className="rounded"
                        />
                        <span className="text-gray-700 dark:text-slate-300 font-mono">{code}</span>
                      </label>
                    );
                  })
                )}
              </div>
            </section>
          )}
```

- [ ] **Step 3: Extend the Apply handler**

```javascript
                if (draft.ssl_codes?.length) cleaned.ssl_codes = draft.ssl_codes;
```

- [ ] **Step 4: Forward `ssl_codes` in both tab fetches**

```javascript
if (filters.ssl_codes?.length) params.set('ssl_codes', filters.ssl_codes.join(','));
```

- [ ] **Step 5: Commit**

```bash
git add components/ar/FilterSidebar.js components/ar/BillingPipelineTab.js components/ar/InvoicesTab.js
git commit -m "feat(ar): FilterSidebar — SSL multi-select"
```

---

## Task 12: FilterSidebar — Driver combobox

**Files:**
- Modify: `components/ar/FilterSidebar.js`
- Modify: `components/ar/BillingPipelineTab.js`, `components/ar/InvoicesTab.js`

Reuse the Phase A `CustomerCombobox` component (already defined at the bottom of FilterSidebar.js) — it's entity-agnostic; we just feed it the drivers list.

- [ ] **Step 1: Add drivers state + fetch**

Add:

```javascript
  const [drivers, setDrivers] = useState([]);
  const [driverQuery, setDriverQuery] = useState('');
```

Extend the on-open Promise.all:

```javascript
          fetch('/api/tenant/drivers').then((r) => (r.ok ? r.json() : { drivers: [] })),
```

and the setter:

```javascript
        setDrivers(drvRes.drivers ?? []);
```

(Destructure `drvRes` alongside the others from the Promise.all result array.)

- [ ] **Step 2: Render the Driver combobox section**

AFTER the SSL section, add:

```jsx
          {/* Driver — typeahead combobox with chips (mirrors Customers) */}
          {showKey('driver_ids') && (
            <section>
              <div className="flex items-center justify-between mb-2">
                <label className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-slate-400">Driver</label>
                {(draft.driver_ids?.length ?? 0) > 0 && (
                  <span className="text-[10px] text-gray-500 dark:text-slate-400">{draft.driver_ids.length} selected</span>
                )}
              </div>
              <CustomerCombobox
                options={drivers.map((d) => ({ id: d.id, name: d.name || `${d.first_name || ''} ${d.last_name || ''}`.trim() || 'Unnamed Driver' }))}
                selectedIds={draft.driver_ids ?? []}
                onChange={(ids) => setDraft((d) => ({ ...d, driver_ids: ids }))}
                query={driverQuery}
                onQueryChange={setDriverQuery}
              />
            </section>
          )}
```

(The `CustomerCombobox` only cares about an `options` array of `{ id, name }`, so the driver shape transform is inline here.)

- [ ] **Step 3: Extend the Apply handler**

```javascript
                if (draft.driver_ids?.length) cleaned.driver_ids = draft.driver_ids;
```

- [ ] **Step 4: Forward `driver_ids` in both tab fetches**

```javascript
if (filters.driver_ids?.length) params.set('driver_ids', filters.driver_ids.join(','));
```

- [ ] **Step 5: Commit**

```bash
git add components/ar/FilterSidebar.js components/ar/BillingPipelineTab.js components/ar/InvoicesTab.js
git commit -m "feat(ar): FilterSidebar — Driver combobox (reuses CustomerCombobox)"
```

---

## Live Gates

After all tasks land + the user restarts the dev server:

- **Gate 1** `/api/tenant/ar/ssl-codes` returns `{ codes: [...] }` (status 200, no auth errors)
- **Gate 2** AR FilterSidebar on Billing opens and shows ALL new sections: Reference Number input, Load Type checkboxes, Container Type + Size, Flags (13 checkboxes), SSL, Driver combobox
- **Gate 3** Type a reference number → Apply → Billing rows narrow to matching `orders.customer_reference`
- **Gate 4** Select 2 load types → Apply → rows narrow to those types
- **Gate 5** Select `hazmat` + `overweight` flags → Apply → rows narrow to orders with both flags true (AND semantics)
- **Gate 6** Select SSL code(s) → Apply → rows narrow to orders with that SCAC
- **Gate 7** Type in the Driver combobox → chip appears on select → Apply → rows narrow to that driver's orders
- **Gate 8** Save a tab with all seven filter dimensions set → refresh → tab still visible + re-applies every dimension
- **Gate 9** Switch from Billing → Invoices tab → same sidebar sections render; Invoices endpoint returns filtered invoices
- **Gate 10** Dark-mode audit: every new section renders correctly with no white-on-white or unreadable labels

---

## Self-Review

**Spec coverage**
- Per-section filter schema: ✅ Task 1 (`lib/ar-filter-schema.js`) + Task 7 (FilterSidebar reads schema via `showKey`)
- Reference number: ✅ Task 7
- Load type: ✅ Task 8
- Container type + size: ✅ Task 9
- Load flags: ✅ Task 10
- SSL: ✅ Task 11 (+ Task 5 endpoint)
- Driver: ✅ Task 12 (+ Task 5 perm broaden)
- Endpoints apply every new filter: ✅ Task 3 (pipeline) + Task 4 (invoices)
- `sanitizeFilterSet` + tests updated: ✅ Task 2
- `filtersMatch` + `filtersAreEmpty` updated: ✅ Task 6

**Placeholder scan** — each task has concrete code + bash commands. No "TBD", "add appropriate X", or "similar to Task N" sloppy references.

**Type consistency**
- Filter keys are consistent across schema (Task 1), sanitizer + tests (Task 2), both endpoints (Tasks 3-4), `filtersMatch` (Task 6), and every sidebar section (Tasks 7-12).
- Shape of `container_types` / `container_sizes` filters stores `code` strings matching `orders.container_type` / `orders.container_size` columns — not `id` UUIDs.
- `flags` key stores the bare label (`'hazmat'`), mapped to DB column `is_hazmat` in both endpoints' filter passes.
- `driver_ids` stores user IDs matching `orders.driver_id`.
- `ssl_codes` stores uppercased SCAC strings matching `orders.steamship_line_scac` after uppercasing (both sides uppercase for case-insensitive match).
