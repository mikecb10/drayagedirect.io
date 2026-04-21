# AR Filter Bar Phase B2 — Exclude Toggles + Invoiced Dates + Location Filters

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add "Exclude" toggles on every multi-select filter (customer, branch, load type, container type/size, flags, SSL, driver), plus an Invoiced date range, plus Pickup / Delivery / Return location multi-selects, all applied on Billing + Invoices.

**Architecture:** Exclude toggles use a paired `<dim>_ids` + `<dim>_ids_exclude` shape — include list and exclude list are separate arrays, so users can theoretically mix both on one dimension though the UI shows a single toggle at a time per section. Endpoints apply `customer_id IN include_list` then `customer_id NOT IN exclude_list` sequentially. Flags use AND-of-true for include, NONE-of-true (every flag `!== true`) for exclude. Locations reuse the `CustomerCombobox` component from Phase A with an `/api/tenant/organizations` fetch (no type filter so terminals / warehouses also populate).

**Tech Stack:** Next.js pages/api, Supabase service-role, React hooks, Tailwind v4 with mandatory `dark:` variants, `lucide-react`. No migration.

---

## File Structure

**Backend:**
- Modify: `lib/ar-filter-params.js` — expand `ARRAY_KEYS` + `STRING_KEYS`
- Modify: `lib/ar-filter-schema.js` — expand `ALL_B2_KEYS` (rename from `ALL_B1_KEYS`) with 14 new keys
- Modify: `pages/api/tenant/ar/index.js` — parse + apply 8 excludes + 2 invoiced dates + 3 locations
- Modify: `pages/api/tenant/ar/invoices/index.js` — same

**Frontend:**
- Modify: `components/ar/FilterSidebar.js` — add `ExcludeToggle` inline helper, wrap all 8 multi-selects with it, render Invoiced date + 3 Location sections
- Modify: `components/ar/ArFiltersBar.js` — extend `filtersMatch` + `filtersAreEmpty`
- Modify: `components/ar/BillingPipelineTab.js` + `components/ar/InvoicesTab.js` — forward the 14 new params

**Tests:**
- Modify: `tests/ar-filter-params.test.mjs` — new assertions for `_exclude` arrays + location arrays + invoiced dates

---

## Conventions

1. **Filter state shape extension**: each multi-select dimension gains a paired `_exclude` array. Example: customer section stores BOTH `customer_ids` (include) and `customer_ids_exclude` (exclude) — the UI toggle determines which list future checkbox clicks land in.
2. **Exclude semantics per dimension**:
   - Array filters (customer/branch/load_type/container_type/container_size/SSL/driver/locations): endpoint applies `.filter(row => !excludeList.includes(row.col))`
   - Flag filter: include uses `every(k => row[is_<k>] === true)`; exclude uses `every(k => row[is_<k>] !== true)` (NONE semantics)
3. **URL param shape**: `customer_ids_exclude=c1,c2` (CSV, same as include). When empty, omit.
4. **Location data source**: `/api/tenant/organizations` (NO `type=customer` filter, since pickup/delivery/return can be terminals / warehouses / customers).
5. **Invoiced date source**:
   - Billing: `order_charge_sets.invoiced_at` (JSONB column exists per migration 042)
   - Invoices: `invoices.created_at` (simplest proxy; invoices don't have a dedicated `invoiced_at` — creation time = invoicing time)
6. **Dark-mode mandatory**.
7. **Migration**: none.
8. **Backward compatibility**: Phase A/B1 saved tabs only have `customer_ids` / `branch_ids` / etc. — no `_exclude` keys. Endpoint must gracefully treat missing `_exclude` keys as empty arrays.

---

## Task 1: Schema + sanitizer expansion + tests

**Files:**
- Modify: `lib/ar-filter-schema.js`
- Modify: `lib/ar-filter-params.js`
- Modify: `tests/ar-filter-params.test.mjs`

- [ ] **Step 1: Update the schema constant**

In `lib/ar-filter-schema.js`, REPLACE the `const ALL_B1_KEYS = [...]` array with:

```javascript
const ALL_B2_KEYS = [
  // Phase A + B1
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
  // Phase B2: exclude variants (same keys with _exclude suffix)
  'customer_ids_exclude',
  'branch_ids_exclude',
  'load_types_exclude',
  'container_types_exclude',
  'container_sizes_exclude',
  'flags_exclude',
  'ssl_codes_exclude',
  'driver_ids_exclude',
  // Phase B2: new dimensions
  'invoiced_from',
  'invoiced_to',
  'pickup_location_ids',
  'delivery_location_ids',
  'return_location_ids',
];
```

Then update every reference of `ALL_B1_KEYS` in the file to `ALL_B2_KEYS`. The `SECTION_KEYS` constant currently has `billing / invoices → ALL_B1_KEYS` and the 4 unwired tabs → `[]` — update the billing/invoices mappings to `ALL_B2_KEYS`. The fallback return in `filterKeysForSection` also points at `ALL_B2_KEYS`.

- [ ] **Step 2: Write the failing tests first**

Open `tests/ar-filter-params.test.mjs`. Find the FINAL summary `console.log` line. IMMEDIATELY BEFORE it, INSERT:

```javascript
console.log('\nsanitizeFilterSet (Phase B2 keys)');
check('keeps customer_ids_exclude',
  JSON.stringify(sanitizeFilterSet({ customer_ids_exclude: ['c1'] })) === '{"customer_ids_exclude":["c1"]}');
check('keeps branch_ids_exclude',
  JSON.stringify(sanitizeFilterSet({ branch_ids_exclude: ['b1'] })) === '{"branch_ids_exclude":["b1"]}');
check('keeps load_types_exclude',
  JSON.stringify(sanitizeFilterSet({ load_types_exclude: ['import'] })) === '{"load_types_exclude":["import"]}');
check('keeps container_types_exclude',
  JSON.stringify(sanitizeFilterSet({ container_types_exclude: ['dry_van'] })) === '{"container_types_exclude":["dry_van"]}');
check('keeps container_sizes_exclude',
  JSON.stringify(sanitizeFilterSet({ container_sizes_exclude: ['40HC'] })) === '{"container_sizes_exclude":["40HC"]}');
check('keeps flags_exclude',
  JSON.stringify(sanitizeFilterSet({ flags_exclude: ['hazmat'] })) === '{"flags_exclude":["hazmat"]}');
check('keeps ssl_codes_exclude',
  JSON.stringify(sanitizeFilterSet({ ssl_codes_exclude: ['MSCU'] })) === '{"ssl_codes_exclude":["MSCU"]}');
check('keeps driver_ids_exclude',
  JSON.stringify(sanitizeFilterSet({ driver_ids_exclude: ['u1'] })) === '{"driver_ids_exclude":["u1"]}');
check('keeps invoiced_from',
  JSON.stringify(sanitizeFilterSet({ invoiced_from: '2026-01-01' })) === '{"invoiced_from":"2026-01-01"}');
check('keeps invoiced_to',
  JSON.stringify(sanitizeFilterSet({ invoiced_to: '2026-02-01' })) === '{"invoiced_to":"2026-02-01"}');
check('keeps pickup_location_ids',
  JSON.stringify(sanitizeFilterSet({ pickup_location_ids: ['loc1'] })) === '{"pickup_location_ids":["loc1"]}');
check('keeps delivery_location_ids',
  JSON.stringify(sanitizeFilterSet({ delivery_location_ids: ['loc2'] })) === '{"delivery_location_ids":["loc2"]}');
check('keeps return_location_ids',
  JSON.stringify(sanitizeFilterSet({ return_location_ids: ['loc3'] })) === '{"return_location_ids":["loc3"]}');
check('drops empty exclude arrays',
  JSON.stringify(sanitizeFilterSet({ customer_ids_exclude: [], flags_exclude: [] })) === '{}');
```

- [ ] **Step 3: Run tests — new ones fail**

```bash
node tests/ar-filter-params.test.mjs
```

Expected: existing 22 pass, new 14 fail.

- [ ] **Step 4: Expand `ARRAY_KEYS` + `STRING_KEYS` in `lib/ar-filter-params.js`**

Replace the existing `ARRAY_KEYS` and `STRING_KEYS` constants with:

```javascript
const ARRAY_KEYS = [
  // Include variants (Phase A + B1)
  'customer_ids',
  'branch_ids',
  'load_types',
  'container_types',
  'container_sizes',
  'flags',
  'ssl_codes',
  'driver_ids',
  // Exclude variants (Phase B2)
  'customer_ids_exclude',
  'branch_ids_exclude',
  'load_types_exclude',
  'container_types_exclude',
  'container_sizes_exclude',
  'flags_exclude',
  'ssl_codes_exclude',
  'driver_ids_exclude',
  // Location multi-selects (Phase B2)
  'pickup_location_ids',
  'delivery_location_ids',
  'return_location_ids',
];

const STRING_KEYS = [
  'from',
  'to',
  'reference_number',
  // Invoiced date range (Phase B2)
  'invoiced_from',
  'invoiced_to',
];
```

The `KNOWN_KEYS = [...ARRAY_KEYS, ...STRING_KEYS]` derivation + `sanitizeFilterSet` function body stay unchanged — they loop over `KNOWN_KEYS` and coerce based on `ARRAY_KEYS.includes(key)`, so the expanded constants automatically cover the new keys.

`parseCsvParam` — untouched.

- [ ] **Step 5: Run tests — all pass**

```bash
node tests/ar-filter-params.test.mjs
```

Expected summary: `36 passed, 0 failed` (22 + 14).

- [ ] **Step 6: Commit**

```bash
git add lib/ar-filter-schema.js lib/ar-filter-params.js tests/ar-filter-params.test.mjs
git commit -m "feat(ar): expand schema + sanitizer for Phase B2 keys"
```

---

## Task 2: AR pipeline endpoint — new filters

**Files:**
- Modify: `pages/api/tenant/ar/index.js`

Apply: 8 exclude variants + `invoiced_from` / `invoiced_to` + 3 location arrays. Uses same client-side-filter pattern as Phase B1.

- [ ] **Step 1: Parse new params**

After the existing `const driverIds = parseCsvParam(req.query.driver_ids);`, add:

```javascript
  // Exclude variants
  const customerIdsExclude    = parseCsvParam(req.query.customer_ids_exclude);
  const branchIdsExclude      = parseCsvParam(req.query.branch_ids_exclude);
  const loadTypesExclude      = parseCsvParam(req.query.load_types_exclude);
  const containerTypesExclude = parseCsvParam(req.query.container_types_exclude);
  const containerSizesExclude = parseCsvParam(req.query.container_sizes_exclude);
  const flagKeysExclude       = parseCsvParam(req.query.flags_exclude);
  const sslCodesExclude       = parseCsvParam(req.query.ssl_codes_exclude);
  const driverIdsExclude      = parseCsvParam(req.query.driver_ids_exclude);
  // New dimensions
  const { invoiced_from, invoiced_to } = req.query;
  const pickupLocationIds   = parseCsvParam(req.query.pickup_location_ids);
  const deliveryLocationIds = parseCsvParam(req.query.delivery_location_ids);
  const returnLocationIds   = parseCsvParam(req.query.return_location_ids);
```

- [ ] **Step 2: Extend the `order:orders(...)` nested select**

The existing select currently ends right before `created_at, deleted_at`. Add 3 new columns: `pickup_location_id, delivery_location_id, return_location_id, invoiced_at` (the last one is actually on `order_charge_sets`, not `orders` — include it at the TOP LEVEL of the select chain):

Find the existing select. It looks like `svc.from('order_charge_sets').select(`\n...chain...`). Add `invoiced_at` to the TOP-LEVEL fields (alongside `*` or replacing `*` with explicit column list if needed). If the select uses `*`, then `invoiced_at` is already included — no change needed at the top level.

For the `orders(...)` nested select, add `pickup_location_id, delivery_location_id, return_location_id`:

```javascript
      order:orders(id, order_number, status, load_type, customer_id, customer_reference, branch_id, driver_id, container_type, container_size, steamship_line_scac, is_hazmat, is_overweight, is_overheight, is_liquor, is_hot, is_genset, is_scale, is_ev, is_street_turn, is_oog, is_bonded, is_double, is_tanker, pickup_location_id, delivery_location_id, return_location_id, created_at, deleted_at,
```

- [ ] **Step 3: Add the 11 new client-side filter passes AFTER the existing Phase B1 filters, BEFORE the counts computation**

Insert this block:

```javascript
  // ── Phase B2: exclude variants ─────────────────────────────────────
  if (customerIdsExclude.length > 0) {
    const ids = new Set(customerIdsExclude);
    scopedSets = scopedSets.filter((cs) =>
      !(cs.order?.customer_id && ids.has(cs.order.customer_id)) &&
      !(cs.bill_to_customer_id && ids.has(cs.bill_to_customer_id))
    );
  }
  if (branchIdsExclude.length > 0) {
    const ids = new Set(branchIdsExclude);
    scopedSets = scopedSets.filter((cs) => !(cs.order?.branch_id && ids.has(cs.order.branch_id)));
  }
  if (loadTypesExclude.length > 0) {
    const types = new Set(loadTypesExclude);
    scopedSets = scopedSets.filter((cs) => !(cs.order?.load_type && types.has(cs.order.load_type)));
  }
  if (containerTypesExclude.length > 0) {
    const types = new Set(containerTypesExclude);
    scopedSets = scopedSets.filter((cs) => !(cs.order?.container_type && types.has(cs.order.container_type)));
  }
  if (containerSizesExclude.length > 0) {
    const sizes = new Set(containerSizesExclude);
    scopedSets = scopedSets.filter((cs) => !(cs.order?.container_size && sizes.has(cs.order.container_size)));
  }
  // Flags exclude: row must have NONE of the selected flags set true (every flag is_<key> !== true).
  if (flagKeysExclude.length > 0) {
    scopedSets = scopedSets.filter((cs) =>
      flagKeysExclude.every((key) => cs.order?.[`is_${key}`] !== true)
    );
  }
  if (sslCodesExclude.length > 0) {
    const codes = new Set(sslCodesExclude.map((c) => c.toUpperCase()));
    scopedSets = scopedSets.filter((cs) =>
      !(cs.order?.steamship_line_scac && codes.has(cs.order.steamship_line_scac.toUpperCase()))
    );
  }
  if (driverIdsExclude.length > 0) {
    const ids = new Set(driverIdsExclude);
    scopedSets = scopedSets.filter((cs) => !(cs.order?.driver_id && ids.has(cs.order.driver_id)));
  }

  // ── Phase B2: invoiced date range ──────────────────────────────────
  // Billing pipeline operates on order_charge_sets.invoiced_at directly.
  if (invoiced_from && typeof invoiced_from === 'string') {
    scopedSets = scopedSets.filter((cs) => cs.invoiced_at && cs.invoiced_at >= invoiced_from);
  }
  if (invoiced_to && typeof invoiced_to === 'string') {
    scopedSets = scopedSets.filter((cs) => cs.invoiced_at && cs.invoiced_at <= invoiced_to);
  }

  // ── Phase B2: location filters (include only — exclude variants
  // deferred until UI surfaces that need; plan.md requests locations
  // without exclude toggles in B2) ───────────────────────────────────
  if (pickupLocationIds.length > 0) {
    const ids = new Set(pickupLocationIds);
    scopedSets = scopedSets.filter((cs) => cs.order?.pickup_location_id && ids.has(cs.order.pickup_location_id));
  }
  if (deliveryLocationIds.length > 0) {
    const ids = new Set(deliveryLocationIds);
    scopedSets = scopedSets.filter((cs) => cs.order?.delivery_location_id && ids.has(cs.order.delivery_location_id));
  }
  if (returnLocationIds.length > 0) {
    const ids = new Set(returnLocationIds);
    scopedSets = scopedSets.filter((cs) => cs.order?.return_location_id && ids.has(cs.order.return_location_id));
  }
```

- [ ] **Step 4: Commit**

```bash
git add pages/api/tenant/ar/index.js
git commit -m "feat(ar): AR pipeline endpoint applies Phase B2 filters"
```

---

## Task 3: AR invoices endpoint — new filters

**Files:**
- Modify: `pages/api/tenant/ar/invoices/index.js`

Mirror Task 2 inside the GET-branch. Touch ONLY the GET branch — POST stays byte-identical.

- [ ] **Step 1: Parse new params**

Inside the GET branch, after `const driverIds = parseCsvParam(req.query.driver_ids);`, add the same 11 new parses as Task 2 (copy verbatim).

- [ ] **Step 2: Extend the deepest `order:orders(...)` nested select**

Add `pickup_location_id, delivery_location_id, return_location_id` to the nested orders select. The deepest select is inside `invoice_charge_sets → charge_set:order_charge_sets → order:orders(...)`.

- [ ] **Step 3: Extend the `orderMatches` helper**

Inside the GET branch, find `const orderMatches = (order) => { ... }`. Add these checks at the END of the function, right before `return true;`:

```javascript
      // Phase B2 exclude variants
      if (customerIdsExclude.length > 0 && order.customer_id && customerIdsExclude.includes(order.customer_id)) return false;
      if (branchIdsExclude.length > 0 && order.branch_id && branchIdsExclude.includes(order.branch_id)) return false;
      if (loadTypesExclude.length > 0 && order.load_type && loadTypesExclude.includes(order.load_type)) return false;
      if (containerTypesExclude.length > 0 && order.container_type && containerTypesExclude.includes(order.container_type)) return false;
      if (containerSizesExclude.length > 0 && order.container_size && containerSizesExclude.includes(order.container_size)) return false;
      if (flagKeysExclude.length > 0 && !flagKeysExclude.every((key) => order[`is_${key}`] !== true)) return false;
      if (sslCodesExclude.length > 0) {
        const codes = new Set(sslCodesExclude.map((c) => c.toUpperCase()));
        if (order.steamship_line_scac && codes.has(order.steamship_line_scac.toUpperCase())) return false;
      }
      if (driverIdsExclude.length > 0 && order.driver_id && driverIdsExclude.includes(order.driver_id)) return false;
      // Phase B2 locations
      if (pickupLocationIds.length > 0 && !(order.pickup_location_id && pickupLocationIds.includes(order.pickup_location_id))) return false;
      if (deliveryLocationIds.length > 0 && !(order.delivery_location_id && deliveryLocationIds.includes(order.delivery_location_id))) return false;
      if (returnLocationIds.length > 0 && !(order.return_location_id && returnLocationIds.includes(order.return_location_id))) return false;
```

- [ ] **Step 4: Extend `hasOrderFilters`**

Find the `const hasOrderFilters = ...` assignment. Expand the OR chain to include every new array and the locations:

```javascript
    const hasOrderFilters =
      (reference_number && typeof reference_number === 'string' && reference_number.trim().length > 0) ||
      loadTypes.length > 0 || containerTypes.length > 0 || containerSizes.length > 0 ||
      flagKeys.length > 0 || sslCodes.length > 0 || driverIds.length > 0 ||
      customerIdsExclude.length > 0 || branchIdsExclude.length > 0 ||
      loadTypesExclude.length > 0 || containerTypesExclude.length > 0 || containerSizesExclude.length > 0 ||
      flagKeysExclude.length > 0 || sslCodesExclude.length > 0 || driverIdsExclude.length > 0 ||
      pickupLocationIds.length > 0 || deliveryLocationIds.length > 0 || returnLocationIds.length > 0;
```

- [ ] **Step 5: Apply invoiced date range at the invoices level**

AFTER the `hasOrderFilters` block, add invoice-level date filtering:

```javascript
    // Phase B2: invoiced date range — filter invoices whose created_at
    // falls in the range. Invoices don't have a dedicated invoiced_at
    // column; created_at is when the invoice row was generated, which
    // equals the invoicing moment in this app.
    if (invoiced_from && typeof invoiced_from === 'string') {
      filtered = filtered.filter((inv) => inv.created_at && inv.created_at >= invoiced_from);
    }
    if (invoiced_to && typeof invoiced_to === 'string') {
      filtered = filtered.filter((inv) => inv.created_at && inv.created_at <= invoiced_to);
    }
```

- [ ] **Step 6: Commit**

```bash
git add pages/api/tenant/ar/invoices/index.js
git commit -m "feat(ar): invoices endpoint applies Phase B2 filters"
```

---

## Task 4: ArFiltersBar — extend match/empty/activeCount

**Files:**
- Modify: `components/ar/ArFiltersBar.js`

Expand the three helpers to recognize every new key.

- [ ] **Step 1: Update `filtersMatch` at the bottom of the file**

Replace the function body with:

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
    // Include arrays (Phase A + B1)
    arrEq(a.customer_ids,    b.customer_ids) &&
    arrEq(a.branch_ids,      b.branch_ids) &&
    arrEq(a.load_types,      b.load_types) &&
    arrEq(a.container_types, b.container_types) &&
    arrEq(a.container_sizes, b.container_sizes) &&
    arrEq(a.flags,           b.flags) &&
    arrEq(a.ssl_codes,       b.ssl_codes) &&
    arrEq(a.driver_ids,      b.driver_ids) &&
    // Exclude arrays (Phase B2)
    arrEq(a.customer_ids_exclude,    b.customer_ids_exclude) &&
    arrEq(a.branch_ids_exclude,      b.branch_ids_exclude) &&
    arrEq(a.load_types_exclude,      b.load_types_exclude) &&
    arrEq(a.container_types_exclude, b.container_types_exclude) &&
    arrEq(a.container_sizes_exclude, b.container_sizes_exclude) &&
    arrEq(a.flags_exclude,           b.flags_exclude) &&
    arrEq(a.ssl_codes_exclude,       b.ssl_codes_exclude) &&
    arrEq(a.driver_ids_exclude,      b.driver_ids_exclude) &&
    // Location arrays (Phase B2)
    arrEq(a.pickup_location_ids,   b.pickup_location_ids) &&
    arrEq(a.delivery_location_ids, b.delivery_location_ids) &&
    arrEq(a.return_location_ids,   b.return_location_ids) &&
    // Dates
    (a.from ?? '') === (b.from ?? '') &&
    (a.to   ?? '') === (b.to   ?? '') &&
    (a.invoiced_from ?? '') === (b.invoiced_from ?? '') &&
    (a.invoiced_to   ?? '') === (b.invoiced_to   ?? '') &&
    // Strings
    strEq(a.reference_number, b.reference_number)
  );
}
```

- [ ] **Step 2: Update `filtersAreEmpty`**

Replace with:

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
      (currentFilters.customer_ids_exclude?.length    ?? 0) === 0 &&
      (currentFilters.branch_ids_exclude?.length      ?? 0) === 0 &&
      (currentFilters.load_types_exclude?.length      ?? 0) === 0 &&
      (currentFilters.container_types_exclude?.length ?? 0) === 0 &&
      (currentFilters.container_sizes_exclude?.length ?? 0) === 0 &&
      (currentFilters.flags_exclude?.length           ?? 0) === 0 &&
      (currentFilters.ssl_codes_exclude?.length       ?? 0) === 0 &&
      (currentFilters.driver_ids_exclude?.length      ?? 0) === 0 &&
      (currentFilters.pickup_location_ids?.length   ?? 0) === 0 &&
      (currentFilters.delivery_location_ids?.length ?? 0) === 0 &&
      (currentFilters.return_location_ids?.length   ?? 0) === 0 &&
      !currentFilters.from &&
      !currentFilters.to &&
      !currentFilters.invoiced_from &&
      !currentFilters.invoiced_to &&
      !(currentFilters.reference_number && currentFilters.reference_number.trim().length > 0)
    );
```

- [ ] **Step 3: Commit**

```bash
git add components/ar/ArFiltersBar.js
git commit -m "feat(ar): ArFiltersBar covers Phase B2 keys in match + empty"
```

---

## Task 5: FilterSidebar — Exclude toggle pattern

**Files:**
- Modify: `components/ar/FilterSidebar.js`

Add an inline `ExcludeToggle` helper and wire it into every multi-select section. Each section gains a pair of arrays (include + exclude) and a shared mode flag.

- [ ] **Step 1: Add the `ExcludeToggle` helper function** at the bottom of the file, just above `CustomerCombobox`:

```javascript
// ──────────────────────────────────────────────────────────────
// Small pill toggle for Include / Exclude mode on a multi-select
// section. Keeps include + exclude lists in the draft simultaneously;
// the UI only shows one mode's list at a time.
// ──────────────────────────────────────────────────────────────
function ExcludeToggle({ mode, onChange }) {
  return (
    <button
      type="button"
      onClick={() => onChange(mode === 'exclude' ? 'include' : 'exclude')}
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wide border ${
        mode === 'exclude'
          ? 'bg-red-100 text-red-700 border-red-200 dark:bg-red-950/40 dark:text-red-300 dark:border-red-900'
          : 'bg-gray-100 text-gray-600 border-gray-200 dark:bg-slate-800 dark:text-slate-400 dark:border-slate-700'
      }`}
      aria-pressed={mode === 'exclude'}
    >
      {mode === 'exclude' ? 'Excluding' : 'Include'}
    </button>
  );
}
```

- [ ] **Step 2: Add per-dimension mode state at the top of `FilterSidebar`'s body**

Near the existing `useState` calls (after `customerQuery`, `branchQuery`, `driverQuery`), add:

```javascript
  const [modes, setModes] = useState({
    customer:       'include',
    branch:         'include',
    load_type:      'include',
    container_type: 'include',
    container_size: 'include',
    flag:           'include',
    ssl:            'include',
    driver:         'include',
  });
  const setMode = (key, mode) => setModes((m) => ({ ...m, [key]: mode }));
```

- [ ] **Step 3: Update `EMPTY` to include all exclude arrays + locations + invoiced dates**

Replace:

```javascript
const EMPTY = {
  customer_ids: [], branch_ids: [], from: '', to: '',
  reference_number: '',
  load_types: [], container_types: [], container_sizes: [], flags: [], ssl_codes: [], driver_ids: [],
  customer_ids_exclude: [], branch_ids_exclude: [], load_types_exclude: [],
  container_types_exclude: [], container_sizes_exclude: [],
  flags_exclude: [], ssl_codes_exclude: [], driver_ids_exclude: [],
  invoiced_from: '', invoiced_to: '',
  pickup_location_ids: [], delivery_location_ids: [], return_location_ids: [],
};
```

- [ ] **Step 4: Wire `ExcludeToggle` into each multi-select section**

For EACH of the 8 multi-selects (customer, branch, load_type, container_type, container_size, flags, ssl, driver), do the following three changes inside the `<section>`:

**(a)** In the section header, next to the "X selected" count span, add the toggle:

```jsx
              <div className="flex items-center gap-2">
                {(draft.<incKey>?.length ?? 0) + (draft.<excKey>?.length ?? 0) > 0 && (
                  <span className="text-[10px] text-gray-500 dark:text-slate-400">{draft.<incKey>?.length || draft.<excKey>?.length} selected</span>
                )}
                <ExcludeToggle mode={modes.<mode>} onChange={(m) => setMode('<mode>', m)} />
              </div>
```

(`<incKey>` = `customer_ids`, `<excKey>` = `customer_ids_exclude`, `<mode>` = `customer`; substitute analogously for each dimension.)

**(b)** Change the checked binding to resolve from the active mode:

```jsx
const activeList = modes.<mode> === 'exclude' ? (draft.<excKey> ?? []) : (draft.<incKey> ?? []);
const selected = activeList.includes(<item>);
```

**(c)** Change the onChange toggle so it adds/removes from the currently-active mode's list:

```jsx
onChange={() => setDraft((d) => {
  const targetKey = modes.<mode> === 'exclude' ? '<excKey>' : '<incKey>';
  const set = new Set(d[targetKey] ?? []);
  if (set.has(<item>)) set.delete(<item>); else set.add(<item>);
  return { ...d, [targetKey]: Array.from(set) };
})}
```

Do this for all 8 multi-selects. The pattern is identical; only the key names differ.

Driver (combobox) is a special case — Customer (combobox) too. For those, pass `selectedIds={modes.driver === 'exclude' ? draft.driver_ids_exclude : draft.driver_ids}` and route `onChange` to the matching key.

- [ ] **Step 5: Update Apply handler**

Inside the Apply button's onClick, extend the `cleaned` build to forward every new key when non-empty:

```javascript
                if (draft.customer_ids_exclude?.length)    cleaned.customer_ids_exclude    = draft.customer_ids_exclude;
                if (draft.branch_ids_exclude?.length)      cleaned.branch_ids_exclude      = draft.branch_ids_exclude;
                if (draft.load_types_exclude?.length)      cleaned.load_types_exclude      = draft.load_types_exclude;
                if (draft.container_types_exclude?.length) cleaned.container_types_exclude = draft.container_types_exclude;
                if (draft.container_sizes_exclude?.length) cleaned.container_sizes_exclude = draft.container_sizes_exclude;
                if (draft.flags_exclude?.length)           cleaned.flags_exclude           = draft.flags_exclude;
                if (draft.ssl_codes_exclude?.length)       cleaned.ssl_codes_exclude       = draft.ssl_codes_exclude;
                if (draft.driver_ids_exclude?.length)      cleaned.driver_ids_exclude      = draft.driver_ids_exclude;
```

- [ ] **Step 6: Extend activeCount to include the new arrays**

Find `const activeCount = ...` and add the 8 exclude counts + 3 location counts + 2 invoiced-date booleans. Match the pattern from Phase B1.

- [ ] **Step 7: Forward new params in both tabs**

In `components/ar/BillingPipelineTab.js` AND `components/ar/InvoicesTab.js`, after the existing forwarders, add:

```javascript
if (filters.customer_ids_exclude?.length)    params.set('customer_ids_exclude',    filters.customer_ids_exclude.join(','));
if (filters.branch_ids_exclude?.length)      params.set('branch_ids_exclude',      filters.branch_ids_exclude.join(','));
if (filters.load_types_exclude?.length)      params.set('load_types_exclude',      filters.load_types_exclude.join(','));
if (filters.container_types_exclude?.length) params.set('container_types_exclude', filters.container_types_exclude.join(','));
if (filters.container_sizes_exclude?.length) params.set('container_sizes_exclude', filters.container_sizes_exclude.join(','));
if (filters.flags_exclude?.length)           params.set('flags_exclude',           filters.flags_exclude.join(','));
if (filters.ssl_codes_exclude?.length)       params.set('ssl_codes_exclude',       filters.ssl_codes_exclude.join(','));
if (filters.driver_ids_exclude?.length)      params.set('driver_ids_exclude',      filters.driver_ids_exclude.join(','));
```

- [ ] **Step 8: Commit**

```bash
git add components/ar/FilterSidebar.js components/ar/BillingPipelineTab.js components/ar/InvoicesTab.js
git commit -m "feat(ar): FilterSidebar — Exclude toggles on all multi-selects"
```

---

## Task 6: FilterSidebar — Invoiced date range

**Files:**
- Modify: `components/ar/FilterSidebar.js`
- Modify: `components/ar/BillingPipelineTab.js`
- Modify: `components/ar/InvoicesTab.js`

- [ ] **Step 1: Render the section**

In the sidebar content area, RIGHT AFTER the existing "Created between" date range section, add:

```jsx
          {/* Invoiced between — on order_charge_sets.invoiced_at (Billing) and invoices.created_at (Invoices) */}
          {(showKey('invoiced_from') || showKey('invoiced_to')) && (
            <section>
              <label className="block text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-slate-400 mb-2">Invoiced between</label>
              <div className="grid grid-cols-2 gap-2">
                <input
                  type="date"
                  value={draft.invoiced_from ?? ''}
                  onChange={(e) => setDraft((d) => ({ ...d, invoiced_from: e.target.value }))}
                  className="px-2 py-1.5 text-xs border border-gray-200 dark:border-slate-700 rounded-md bg-white dark:bg-slate-800 text-gray-900 dark:text-slate-100"
                />
                <input
                  type="date"
                  value={draft.invoiced_to ?? ''}
                  onChange={(e) => setDraft((d) => ({ ...d, invoiced_to: e.target.value }))}
                  className="px-2 py-1.5 text-xs border border-gray-200 dark:border-slate-700 rounded-md bg-white dark:bg-slate-800 text-gray-900 dark:text-slate-100"
                />
              </div>
            </section>
          )}
```

- [ ] **Step 2: Extend the Apply handler**

After existing date forwards, add:

```javascript
                if (draft.invoiced_from) cleaned.invoiced_from = draft.invoiced_from;
                if (draft.invoiced_to)   cleaned.invoiced_to   = draft.invoiced_to;
```

- [ ] **Step 3: Forward in both tab fetches**

In both tabs' param builders, after the `to` forward, add:

```javascript
if (filters.invoiced_from) params.set('invoiced_from', filters.invoiced_from);
if (filters.invoiced_to)   params.set('invoiced_to',   filters.invoiced_to);
```

- [ ] **Step 4: Commit**

```bash
git add components/ar/FilterSidebar.js components/ar/BillingPipelineTab.js components/ar/InvoicesTab.js
git commit -m "feat(ar): FilterSidebar — Invoiced date range"
```

---

## Task 7: FilterSidebar — Pickup / Delivery / Return location comboboxes

**Files:**
- Modify: `components/ar/FilterSidebar.js`
- Modify: `components/ar/BillingPipelineTab.js`
- Modify: `components/ar/InvoicesTab.js`

Three combobox sections. Reuse `CustomerCombobox` with the full organizations list (no type filter — pickups / deliveries / returns can be terminals or warehouses).

- [ ] **Step 1: Add state**

Near existing combobox state (`customerQuery`, `driverQuery`):

```javascript
  const [orgs, setOrgs] = useState([]); // all org types — for pickup/delivery/return
  const [pickupQuery, setPickupQuery]     = useState('');
  const [deliveryQuery, setDeliveryQuery] = useState('');
  const [returnQuery, setReturnQuery]     = useState('');
```

- [ ] **Step 2: Fetch orgs on open**

Extend the Promise.all in the on-open useEffect:

```javascript
          fetch('/api/tenant/organizations').then((r) => (r.ok ? r.json() : { organizations: [] })),
```

Add destructure + setter:

```javascript
        const [custRes, brRes, ctRes, csRes, sslRes, drvRes, orgsRes] = await Promise.all([ /* ... */ ]);
        // ... existing setters ...
        setOrgs(orgsRes.organizations ?? []);
```

- [ ] **Step 3: Render the 3 sections**

After the Driver section, AFTER `{showKey('driver_ids') && (...)}` closes, add:

```jsx
          {/* Pickup location */}
          {showKey('pickup_location_ids') && (
            <section>
              <div className="flex items-center justify-between mb-2">
                <label className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-slate-400">Pickup location</label>
                {(draft.pickup_location_ids?.length ?? 0) > 0 && (
                  <span className="text-[10px] text-gray-500 dark:text-slate-400">{draft.pickup_location_ids.length} selected</span>
                )}
              </div>
              <CustomerCombobox
                options={orgs.map((o) => ({ id: o.id, name: o.name }))}
                selectedIds={draft.pickup_location_ids ?? []}
                onChange={(ids) => setDraft((d) => ({ ...d, pickup_location_ids: ids }))}
                query={pickupQuery}
                onQueryChange={setPickupQuery}
              />
            </section>
          )}

          {/* Delivery location */}
          {showKey('delivery_location_ids') && (
            <section>
              <div className="flex items-center justify-between mb-2">
                <label className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-slate-400">Delivery location</label>
                {(draft.delivery_location_ids?.length ?? 0) > 0 && (
                  <span className="text-[10px] text-gray-500 dark:text-slate-400">{draft.delivery_location_ids.length} selected</span>
                )}
              </div>
              <CustomerCombobox
                options={orgs.map((o) => ({ id: o.id, name: o.name }))}
                selectedIds={draft.delivery_location_ids ?? []}
                onChange={(ids) => setDraft((d) => ({ ...d, delivery_location_ids: ids }))}
                query={deliveryQuery}
                onQueryChange={setDeliveryQuery}
              />
            </section>
          )}

          {/* Return location */}
          {showKey('return_location_ids') && (
            <section>
              <div className="flex items-center justify-between mb-2">
                <label className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-slate-400">Return location</label>
                {(draft.return_location_ids?.length ?? 0) > 0 && (
                  <span className="text-[10px] text-gray-500 dark:text-slate-400">{draft.return_location_ids.length} selected</span>
                )}
              </div>
              <CustomerCombobox
                options={orgs.map((o) => ({ id: o.id, name: o.name }))}
                selectedIds={draft.return_location_ids ?? []}
                onChange={(ids) => setDraft((d) => ({ ...d, return_location_ids: ids }))}
                query={returnQuery}
                onQueryChange={setReturnQuery}
              />
            </section>
          )}
```

- [ ] **Step 4: Extend Apply handler**

```javascript
                if (draft.pickup_location_ids?.length)   cleaned.pickup_location_ids   = draft.pickup_location_ids;
                if (draft.delivery_location_ids?.length) cleaned.delivery_location_ids = draft.delivery_location_ids;
                if (draft.return_location_ids?.length)   cleaned.return_location_ids   = draft.return_location_ids;
```

- [ ] **Step 5: Forward in both tabs**

```javascript
if (filters.pickup_location_ids?.length)   params.set('pickup_location_ids',   filters.pickup_location_ids.join(','));
if (filters.delivery_location_ids?.length) params.set('delivery_location_ids', filters.delivery_location_ids.join(','));
if (filters.return_location_ids?.length)   params.set('return_location_ids',   filters.return_location_ids.join(','));
```

- [ ] **Step 6: Commit**

```bash
git add components/ar/FilterSidebar.js components/ar/BillingPipelineTab.js components/ar/InvoicesTab.js
git commit -m "feat(ar): FilterSidebar — Pickup / Delivery / Return location filters"
```

---

## Task 8: End-to-end verification

**Files:** none — smoke test only.

- [ ] **Step 1: Run unit tests**

```bash
node tests/ar-filter-params.test.mjs
```

Expected: `36 passed, 0 failed`.

- [ ] **Step 2: HMR rebuild**

Your dev server is running; HMR should have picked up all edits. If anything looks stale, restart it manually.

- [ ] **Step 3: Manual browser check**

- Open AR → Billing, click Filters
- Verify every multi-select section has an "Include / Excluding" pill toggle in its header
- Verify Invoiced between section renders (below Created between)
- Verify Pickup / Delivery / Return location sections render (below Driver)

No commit here — if bugs surface, fix in a targeted commit.

---

## Live Gates

- **Gate 1** — `node tests/ar-filter-params.test.mjs` outputs `36 passed, 0 failed`
- **Gate 2** — Every multi-select section in the sidebar has an Exclude toggle pill. Toggling to "Excluding" shows red styling.
- **Gate 3** — Select "Big B Beer" in Customer, toggle Customer to Excluding, Apply → Billing fetch includes `customer_ids_exclude=<uuid>` — rows NOT in Big B remain
- **Gate 4** — Invoiced between: pick a 1-week window → Apply → `invoiced_from=...&invoiced_to=...` appears in the fetch query
- **Gate 5** — Pickup location: type a few letters → dropdown → select → chip → Apply → `pickup_location_ids=<uuid>` in the fetch
- **Gate 6** — Same for Delivery + Return locations
- **Gate 7** — Exclude on Flags: toggle Flag section to Excluding, check "hazmat", Apply → `flags_exclude=hazmat` → rows with `is_hazmat=true` are hidden
- **Gate 8** — Save a tab with 3 filter dimensions (one include, one exclude, one location). Reload. Tab re-applies correctly.
- **Gate 9** — Switch to Invoices sub-tab. Saved tab visible. Click → Invoices fetch forwards every filter param.
- **Gate 10** — Dark mode audit — all new elements render correctly.

---

## Self-Review

**Spec coverage**
- Exclude toggles on 8 multi-selects: ✅ Task 5
- Invoiced date range: ✅ Task 6
- Pickup + Delivery + Return locations: ✅ Task 7
- Endpoints apply everything: ✅ Tasks 2, 3
- `sanitizeFilterSet` + tests: ✅ Task 1
- `filtersMatch` + `filtersAreEmpty` + `activeCount`: ✅ Task 4

**Placeholder scan** — each step has concrete code or bash commands.

**Type consistency**
- Every new key consistent across `lib/ar-filter-params.js`, `lib/ar-filter-schema.js`, both endpoints, `ArFiltersBar`, `FilterSidebar`, both tabs.
- Locations store `id` (UUIDs matching `orders.pickup_location_id` etc.)
- Exclude arrays mirror include array names exactly, just with `_exclude` suffix.
- `invoiced_from` / `invoiced_to` use ISO date strings (same format as existing `from`/`to`).
