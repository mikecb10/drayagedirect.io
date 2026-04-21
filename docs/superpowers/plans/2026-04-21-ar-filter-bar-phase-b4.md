# AR Filter Bar Phase B4 — Factor Company + Bill-to Primary/Additional

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add three new filter dimensions on Billing + Invoices — **Bill-to Primary** customer multi-select, **Bill-to Additional** customer multi-select (both with Exclude toggles), and **Factor Company Y/N** single-value toggle.

**Architecture:** "Primary" vs "Additional" charge set is determined by `charge_set_number` pattern — primary charge sets have no trailing `_<N>` suffix (`CS_ORD_O000007`); additional/secondary ones do (`CS_ORD_M000006_1`, `CS_ORD_M000003_2`). Each filter matches against `order_charge_sets.bill_to_customer_id`. Factor Company Y/N is a three-state filter (unset / yes / no) that joins `customers.pay_type === 'factoring'` check on the bill-to customer. No migration — every column exists.

**Tech Stack:** Next.js pages/api, Supabase, React, Tailwind with mandatory `dark:` variants. Reuses CustomerCombobox + ExcludeToggle pattern from Phase B2.

---

## File Structure

**Backend:**
- Modify: `lib/ar-filter-schema.js` (add 5 new keys to `ALL_B2_KEYS`; extend billing/invoices SECTION_KEYS)
- Modify: `lib/ar-filter-params.js` (extend `ARRAY_KEYS` + `STRING_KEYS`)
- Modify: `pages/api/tenant/ar/index.js` (parse + apply new filters client-side)
- Modify: `pages/api/tenant/ar/invoices/index.js` (same, via `orderMatches` / charge_set-level helpers)

**Frontend:**
- Modify: `components/ar/FilterSidebar.js` (2 new combobox sections with exclude toggles + 1 Y/N toggle section)
- Modify: `components/ar/ArFiltersBar.js` (extend `filtersMatch` + `filtersAreEmpty`)
- Modify: `components/ar/BillingPipelineTab.js` + `components/ar/InvoicesTab.js` (forward new params)

**Tests:**
- Modify: `tests/ar-filter-params.test.mjs` (5 new assertions)

---

## Conventions

1. **Primary vs additional** detection uses regex: `/_\d+$/.test(charge_set_number)` matches additional/secondary. Everything else is primary.
2. **Factor company** is a 3-state single-value key — store as a string: `'yes'` (only factoring customers), `'no'` (only direct-pay customers), or omitted (no filter). UI is a 3-state pill toggle or select.
3. **Exclude toggles** reuse the Phase B2 `ExcludeToggle` component + `modes` state pattern.
4. **New keys** mirror Phase B2 naming:
   - `bill_to_primary_customer_ids` + `bill_to_primary_customer_ids_exclude` (arrays)
   - `bill_to_additional_customer_ids` + `bill_to_additional_customer_ids_exclude` (arrays)
   - `factor_company` (string — `'yes'` or `'no'`)

---

## Task 1: Schema + sanitizer + tests

**Files:**
- Modify: `lib/ar-filter-schema.js`
- Modify: `lib/ar-filter-params.js`
- Modify: `tests/ar-filter-params.test.mjs`

- [ ] **Step 1: Extend `ALL_B2_KEYS` in `lib/ar-filter-schema.js`**

Open the file and find the `const ALL_B2_KEYS = [ ... ];` array. Currently 24 keys. APPEND these 5 new keys at the end (before the closing `];`):

```javascript
  // Phase B4: bill-to primary / additional + factor company
  'bill_to_primary_customer_ids',
  'bill_to_primary_customer_ids_exclude',
  'bill_to_additional_customer_ids',
  'bill_to_additional_customer_ids_exclude',
  'factor_company',
```

(Both `billing` and `invoices` already map to `ALL_B2_KEYS`, so they'll automatically pick up these new entries. Other sections stay as-is.)

- [ ] **Step 2: Write the failing tests**

In `tests/ar-filter-params.test.mjs`, find the FINAL summary block and INSERT these 6 new checks BEFORE it:

```javascript
console.log('\nsanitizeFilterSet (Phase B4 keys)');
check('keeps bill_to_primary_customer_ids',
  JSON.stringify(sanitizeFilterSet({ bill_to_primary_customer_ids: ['c1'] })) === '{"bill_to_primary_customer_ids":["c1"]}');
check('keeps bill_to_primary_customer_ids_exclude',
  JSON.stringify(sanitizeFilterSet({ bill_to_primary_customer_ids_exclude: ['c1'] })) === '{"bill_to_primary_customer_ids_exclude":["c1"]}');
check('keeps bill_to_additional_customer_ids',
  JSON.stringify(sanitizeFilterSet({ bill_to_additional_customer_ids: ['c2'] })) === '{"bill_to_additional_customer_ids":["c2"]}');
check('keeps bill_to_additional_customer_ids_exclude',
  JSON.stringify(sanitizeFilterSet({ bill_to_additional_customer_ids_exclude: ['c2'] })) === '{"bill_to_additional_customer_ids_exclude":["c2"]}');
check('keeps factor_company string',
  JSON.stringify(sanitizeFilterSet({ factor_company: 'yes' })) === '{"factor_company":"yes"}');
check('drops empty factor_company',
  JSON.stringify(sanitizeFilterSet({ factor_company: '' })) === '{}');
```

- [ ] **Step 3: Run tests — new ones fail**

```bash
node tests/ar-filter-params.test.mjs
```

Expected: existing 36 pass, new 6 fail.

- [ ] **Step 4: Extend `ARRAY_KEYS` + `STRING_KEYS` in `lib/ar-filter-params.js`**

Find the two constants. REPLACE `ARRAY_KEYS` + `STRING_KEYS` with:

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
  // Bill-to primary + additional (Phase B4)
  'bill_to_primary_customer_ids',
  'bill_to_primary_customer_ids_exclude',
  'bill_to_additional_customer_ids',
  'bill_to_additional_customer_ids_exclude',
];

const STRING_KEYS = [
  'from',
  'to',
  'reference_number',
  'invoiced_from',
  'invoiced_to',
  // Factor company Y/N (Phase B4) — string 'yes' | 'no'
  'factor_company',
];
```

(The `KNOWN_KEYS = [...ARRAY_KEYS, ...STRING_KEYS]` derivation + `sanitizeFilterSet` body are unchanged.)

- [ ] **Step 5: Run tests — all pass**

```bash
node tests/ar-filter-params.test.mjs
```

Expected summary: `42 passed, 0 failed`.

- [ ] **Step 6: Commit**

```bash
git add lib/ar-filter-schema.js lib/ar-filter-params.js tests/ar-filter-params.test.mjs
git commit -m "feat(ar): extend schema + sanitizer for Phase B4 keys"
```

---

## Task 2: AR pipeline endpoint — apply new filters

**Files:**
- Modify: `pages/api/tenant/ar/index.js`

Primary vs additional split + factor company filter.

- [ ] **Step 1: Parse new params**

After the existing `const returnLocationIds = parseCsvParam(...)` line (Phase B2), add:

```javascript
  // Phase B4: bill-to primary / additional + factor company
  const billToPrimaryCustomerIds        = parseCsvParam(req.query.bill_to_primary_customer_ids);
  const billToPrimaryCustomerIdsExclude = parseCsvParam(req.query.bill_to_primary_customer_ids_exclude);
  const billToAdditionalCustomerIds     = parseCsvParam(req.query.bill_to_additional_customer_ids);
  const billToAdditionalCustomerIdsExclude = parseCsvParam(req.query.bill_to_additional_customer_ids_exclude);
  const { factor_company } = req.query;
```

- [ ] **Step 2: Extend the `bill_to:customers!...` nested select to include `pay_type`**

Find the line (in the Supabase select):
```javascript
      bill_to:customers!order_charge_sets_bill_to_customer_id_fkey(id, name),
```

Replace with:
```javascript
      bill_to:customers!order_charge_sets_bill_to_customer_id_fkey(id, name, pay_type),
```

- [ ] **Step 3: Add filter passes AFTER existing Phase B2 filters, BEFORE counts computation**

```javascript
  // ── Phase B4: bill-to primary / additional ─────────────────────────
  // Primary = charge_set_number does NOT match /_\d+$/ (no _N suffix).
  // Secondary/additional = matches /_\d+$/.
  const SECONDARY_PATTERN = /_\d+$/;
  const isPrimaryCs = (cs) => !SECONDARY_PATTERN.test(cs.charge_set_number || '');

  if (billToPrimaryCustomerIds.length > 0) {
    const ids = new Set(billToPrimaryCustomerIds);
    scopedSets = scopedSets.filter((cs) =>
      isPrimaryCs(cs) && cs.bill_to_customer_id && ids.has(cs.bill_to_customer_id)
    );
  }
  if (billToPrimaryCustomerIdsExclude.length > 0) {
    const ids = new Set(billToPrimaryCustomerIdsExclude);
    scopedSets = scopedSets.filter((cs) =>
      !(isPrimaryCs(cs) && cs.bill_to_customer_id && ids.has(cs.bill_to_customer_id))
    );
  }
  if (billToAdditionalCustomerIds.length > 0) {
    const ids = new Set(billToAdditionalCustomerIds);
    scopedSets = scopedSets.filter((cs) =>
      !isPrimaryCs(cs) && cs.bill_to_customer_id && ids.has(cs.bill_to_customer_id)
    );
  }
  if (billToAdditionalCustomerIdsExclude.length > 0) {
    const ids = new Set(billToAdditionalCustomerIdsExclude);
    scopedSets = scopedSets.filter((cs) =>
      !(!isPrimaryCs(cs) && cs.bill_to_customer_id && ids.has(cs.bill_to_customer_id))
    );
  }

  // ── Phase B4: factor company Y/N ───────────────────────────────────
  // 'yes' = bill-to customer has pay_type === 'factoring'; 'no' = not.
  if (factor_company === 'yes') {
    scopedSets = scopedSets.filter((cs) => cs.bill_to?.pay_type === 'factoring');
  } else if (factor_company === 'no') {
    scopedSets = scopedSets.filter((cs) => cs.bill_to?.pay_type && cs.bill_to.pay_type !== 'factoring');
  }
```

- [ ] **Step 4: Commit**

```bash
git add pages/api/tenant/ar/index.js
git commit -m "feat(ar): AR pipeline endpoint applies Phase B4 filters"
```

---

## Task 3: AR invoices endpoint — apply new filters

**Files:**
- Modify: `pages/api/tenant/ar/invoices/index.js`

For Invoices, an invoice passes if ANY of its charge_sets satisfies the bill-to and factor tests. Extend the existing `orderMatches` helper pattern.

- [ ] **Step 1: Parse new params**

Inside the GET branch, after the existing Phase B2 parses (ending with `const returnLocationIds = ...`), add:

```javascript
    // Phase B4
    const billToPrimaryCustomerIds        = parseCsvParam(req.query.bill_to_primary_customer_ids);
    const billToPrimaryCustomerIdsExclude = parseCsvParam(req.query.bill_to_primary_customer_ids_exclude);
    const billToAdditionalCustomerIds     = parseCsvParam(req.query.bill_to_additional_customer_ids);
    const billToAdditionalCustomerIdsExclude = parseCsvParam(req.query.bill_to_additional_customer_ids_exclude);
    const { factor_company } = req.query;
```

- [ ] **Step 2: Extend the nested charge_set select**

Find the deep `charge_set:order_charge_sets(id, charge_set_number, order_id, total_cents, ...)` — add `bill_to_customer_id` and a nested `bill_to:customers!order_charge_sets_bill_to_customer_id_fkey(id, pay_type)`:

Replace the block that looks like:
```javascript
        charge_sets:invoice_charge_sets(
          charge_set:order_charge_sets(id, charge_set_number, order_id, total_cents,
            order:orders(...)
          )
        )
```

With:
```javascript
        charge_sets:invoice_charge_sets(
          charge_set:order_charge_sets(id, charge_set_number, order_id, total_cents, bill_to_customer_id,
            bill_to:customers!order_charge_sets_bill_to_customer_id_fkey(id, name, pay_type),
            order:orders(...)
          )
        )
```

(Keep the existing `order:orders(...)` nested select intact — Phase B1/B2 already expanded that one.)

- [ ] **Step 3: Add a charge-set-level helper + apply post-fetch**

AFTER the `orderMatches` helper definition, add:

```javascript
    const SECONDARY_PATTERN = /_\d+$/;
    const isPrimaryCs = (cs) => cs && !SECONDARY_PATTERN.test(cs.charge_set_number || '');

    const chargeSetBillToMatches = (cs) => {
      if (!cs) return false;
      const isPrimary = isPrimaryCs(cs);
      // Primary include
      if (billToPrimaryCustomerIds.length > 0) {
        if (!(isPrimary && cs.bill_to_customer_id && billToPrimaryCustomerIds.includes(cs.bill_to_customer_id))) return false;
      }
      // Primary exclude
      if (billToPrimaryCustomerIdsExclude.length > 0) {
        if (isPrimary && cs.bill_to_customer_id && billToPrimaryCustomerIdsExclude.includes(cs.bill_to_customer_id)) return false;
      }
      // Additional include
      if (billToAdditionalCustomerIds.length > 0) {
        if (!(!isPrimary && cs.bill_to_customer_id && billToAdditionalCustomerIds.includes(cs.bill_to_customer_id))) return false;
      }
      // Additional exclude
      if (billToAdditionalCustomerIdsExclude.length > 0) {
        if (!isPrimary && cs.bill_to_customer_id && billToAdditionalCustomerIdsExclude.includes(cs.bill_to_customer_id)) return false;
      }
      // Factor company
      if (factor_company === 'yes') {
        if (cs.bill_to?.pay_type !== 'factoring') return false;
      } else if (factor_company === 'no') {
        if (!cs.bill_to?.pay_type || cs.bill_to.pay_type === 'factoring') return false;
      }
      return true;
    };

    const hasChargeSetFilters =
      billToPrimaryCustomerIds.length > 0 ||
      billToPrimaryCustomerIdsExclude.length > 0 ||
      billToAdditionalCustomerIds.length > 0 ||
      billToAdditionalCustomerIdsExclude.length > 0 ||
      factor_company === 'yes' || factor_company === 'no';

    if (hasChargeSetFilters) {
      filtered = filtered.filter((inv) => {
        const sets = inv.charge_sets || [];
        return sets.some((cs) => chargeSetBillToMatches(cs?.charge_set));
      });
    }
```

Insert this block AFTER the existing `if (hasOrderFilters) { filtered = filtered.filter(...); }` block and BEFORE the invoiced-date filter that follows.

- [ ] **Step 4: Commit**

```bash
git add pages/api/tenant/ar/invoices/index.js
git commit -m "feat(ar): invoices endpoint applies Phase B4 filters"
```

---

## Task 4: ArFiltersBar extensions

**Files:**
- Modify: `components/ar/ArFiltersBar.js`

Extend `filtersMatch` and `filtersAreEmpty` to cover the 5 new keys.

- [ ] **Step 1: Update `filtersMatch`**

Locate the function at the bottom. Replace with:

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
    arrEq(a.customer_ids_exclude,    b.customer_ids_exclude) &&
    arrEq(a.branch_ids_exclude,      b.branch_ids_exclude) &&
    arrEq(a.load_types_exclude,      b.load_types_exclude) &&
    arrEq(a.container_types_exclude, b.container_types_exclude) &&
    arrEq(a.container_sizes_exclude, b.container_sizes_exclude) &&
    arrEq(a.flags_exclude,           b.flags_exclude) &&
    arrEq(a.ssl_codes_exclude,       b.ssl_codes_exclude) &&
    arrEq(a.driver_ids_exclude,      b.driver_ids_exclude) &&
    arrEq(a.pickup_location_ids,   b.pickup_location_ids) &&
    arrEq(a.delivery_location_ids, b.delivery_location_ids) &&
    arrEq(a.return_location_ids,   b.return_location_ids) &&
    arrEq(a.bill_to_primary_customer_ids,         b.bill_to_primary_customer_ids) &&
    arrEq(a.bill_to_primary_customer_ids_exclude, b.bill_to_primary_customer_ids_exclude) &&
    arrEq(a.bill_to_additional_customer_ids,         b.bill_to_additional_customer_ids) &&
    arrEq(a.bill_to_additional_customer_ids_exclude, b.bill_to_additional_customer_ids_exclude) &&
    (a.from ?? '') === (b.from ?? '') &&
    (a.to   ?? '') === (b.to   ?? '') &&
    (a.invoiced_from ?? '') === (b.invoiced_from ?? '') &&
    (a.invoiced_to   ?? '') === (b.invoiced_to   ?? '') &&
    strEq(a.reference_number, b.reference_number) &&
    (a.factor_company ?? '') === (b.factor_company ?? '')
  );
}
```

- [ ] **Step 2: Update `filtersAreEmpty`**

Extend with the 5 new keys — add to the existing chain:

Current `filtersAreEmpty` checks 19 arrays + 4 dates + 1 ref_number. Add after the `return_location_ids?.length` check:

```javascript
      (currentFilters.bill_to_primary_customer_ids?.length            ?? 0) === 0 &&
      (currentFilters.bill_to_primary_customer_ids_exclude?.length    ?? 0) === 0 &&
      (currentFilters.bill_to_additional_customer_ids?.length         ?? 0) === 0 &&
      (currentFilters.bill_to_additional_customer_ids_exclude?.length ?? 0) === 0 &&
```

And before the closing `)` (next to `!currentFilters.from`), add:

```javascript
      !(currentFilters.factor_company === 'yes' || currentFilters.factor_company === 'no')
```

- [ ] **Step 3: Commit**

```bash
git add components/ar/ArFiltersBar.js
git commit -m "feat(ar): ArFiltersBar covers Phase B4 keys"
```

---

## Task 5: FilterSidebar — Bill-to Primary + Additional sections

**Files:**
- Modify: `components/ar/FilterSidebar.js`

Two new sections, each a CustomerCombobox with an ExcludeToggle (Phase B2 pattern). Place them AFTER the existing Customers section, BEFORE Branches.

- [ ] **Step 1: Add state for queries + extend `modes`**

Near existing useState declarations, add:

```javascript
  const [primaryBillToQuery, setPrimaryBillToQuery]       = useState('');
  const [additionalBillToQuery, setAdditionalBillToQuery] = useState('');
```

Extend the `modes` state default object — add two entries to the useState initializer:

```javascript
  const [modes, setModes] = useState({
    customer:            'include',
    branch:              'include',
    load_type:           'include',
    container_type:      'include',
    container_size:      'include',
    flag:                'include',
    ssl:                 'include',
    driver:              'include',
    bill_to_primary:     'include',
    bill_to_additional:  'include',
  });
```

- [ ] **Step 2: Extend `EMPTY`**

Add the 4 new arrays + factor_company to the `EMPTY` constant:

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
  bill_to_primary_customer_ids: [],    bill_to_primary_customer_ids_exclude: [],
  bill_to_additional_customer_ids: [], bill_to_additional_customer_ids_exclude: [],
  factor_company: '',
};
```

Also update the Reset button's `setModes(...)` call to include the two new entries (`bill_to_primary: 'include'`, `bill_to_additional: 'include'`).

- [ ] **Step 3: Render the two Bill-to sections AFTER Customers section**

Find the Customers section. IMMEDIATELY AFTER its closing `)}`, add:

```jsx
          {/* Bill To — Primary (primary charge set's bill_to_customer_id) */}
          {showKey('bill_to_primary_customer_ids') && (
            <section>
              <div className="flex items-center justify-between mb-2">
                <label className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-slate-400">Bill To — Primary</label>
                <div className="flex items-center gap-2">
                  {((draft.bill_to_primary_customer_ids?.length ?? 0) + (draft.bill_to_primary_customer_ids_exclude?.length ?? 0)) > 0 && (
                    <span className="text-[10px] text-gray-500 dark:text-slate-400">
                      {modes.bill_to_primary === 'exclude' ? (draft.bill_to_primary_customer_ids_exclude?.length ?? 0) : (draft.bill_to_primary_customer_ids?.length ?? 0)} selected
                    </span>
                  )}
                  <ExcludeToggle mode={modes.bill_to_primary} onChange={(m) => setMode('bill_to_primary', m)} />
                </div>
              </div>
              <CustomerCombobox
                options={customers}
                selectedIds={modes.bill_to_primary === 'exclude' ? (draft.bill_to_primary_customer_ids_exclude ?? []) : (draft.bill_to_primary_customer_ids ?? [])}
                onChange={(ids) => setDraft((d) => ({
                  ...d,
                  [modes.bill_to_primary === 'exclude' ? 'bill_to_primary_customer_ids_exclude' : 'bill_to_primary_customer_ids']: ids,
                }))}
                query={primaryBillToQuery}
                onQueryChange={setPrimaryBillToQuery}
              />
            </section>
          )}

          {/* Bill To — Additional (secondary charge sets' bill_to_customer_id) */}
          {showKey('bill_to_additional_customer_ids') && (
            <section>
              <div className="flex items-center justify-between mb-2">
                <label className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-slate-400">Bill To — Additional</label>
                <div className="flex items-center gap-2">
                  {((draft.bill_to_additional_customer_ids?.length ?? 0) + (draft.bill_to_additional_customer_ids_exclude?.length ?? 0)) > 0 && (
                    <span className="text-[10px] text-gray-500 dark:text-slate-400">
                      {modes.bill_to_additional === 'exclude' ? (draft.bill_to_additional_customer_ids_exclude?.length ?? 0) : (draft.bill_to_additional_customer_ids?.length ?? 0)} selected
                    </span>
                  )}
                  <ExcludeToggle mode={modes.bill_to_additional} onChange={(m) => setMode('bill_to_additional', m)} />
                </div>
              </div>
              <CustomerCombobox
                options={customers}
                selectedIds={modes.bill_to_additional === 'exclude' ? (draft.bill_to_additional_customer_ids_exclude ?? []) : (draft.bill_to_additional_customer_ids ?? [])}
                onChange={(ids) => setDraft((d) => ({
                  ...d,
                  [modes.bill_to_additional === 'exclude' ? 'bill_to_additional_customer_ids_exclude' : 'bill_to_additional_customer_ids']: ids,
                }))}
                query={additionalBillToQuery}
                onQueryChange={setAdditionalBillToQuery}
              />
            </section>
          )}
```

- [ ] **Step 4: Extend Apply handler**

Add to the Apply `cleaned` builder (after the existing customer/exclude forwards):

```javascript
                if (draft.bill_to_primary_customer_ids?.length)    cleaned.bill_to_primary_customer_ids    = draft.bill_to_primary_customer_ids;
                if (draft.bill_to_primary_customer_ids_exclude?.length) cleaned.bill_to_primary_customer_ids_exclude = draft.bill_to_primary_customer_ids_exclude;
                if (draft.bill_to_additional_customer_ids?.length) cleaned.bill_to_additional_customer_ids = draft.bill_to_additional_customer_ids;
                if (draft.bill_to_additional_customer_ids_exclude?.length) cleaned.bill_to_additional_customer_ids_exclude = draft.bill_to_additional_customer_ids_exclude;
```

- [ ] **Step 5: Extend activeCount**

Add 4 new length tallies to the activeCount sum.

- [ ] **Step 6: Commit**

```bash
git add components/ar/FilterSidebar.js
git commit -m "feat(ar): FilterSidebar — Bill-to Primary + Additional sections"
```

---

## Task 6: FilterSidebar — Factor Company Y/N toggle + forward everything in tabs

**Files:**
- Modify: `components/ar/FilterSidebar.js`
- Modify: `components/ar/BillingPipelineTab.js`
- Modify: `components/ar/InvoicesTab.js`

A single-value three-state filter (unset / 'yes' / 'no'). UI: three pills (All / Factor only / Direct-pay only).

- [ ] **Step 1: Render the Factor Company section**

In the sidebar, after Bill-to Additional section (just added in Task 5), add:

```jsx
          {/* Factor Company — customers.pay_type Y/N */}
          {showKey('factor_company') && (
            <section>
              <label className="block text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-slate-400 mb-2">Factor company</label>
              <div className="inline-flex rounded-md border border-gray-200 dark:border-slate-700 overflow-hidden">
                {[
                  { value: '',    label: 'All' },
                  { value: 'yes', label: 'Factor' },
                  { value: 'no',  label: 'Direct-pay' },
                ].map((opt, i) => {
                  const active = (draft.factor_company ?? '') === opt.value;
                  return (
                    <button
                      key={opt.value || 'all'}
                      type="button"
                      onClick={() => setDraft((d) => ({ ...d, factor_company: opt.value }))}
                      className={`px-3 py-1 text-xs font-semibold ${i > 0 ? 'border-l border-gray-200 dark:border-slate-700' : ''} ${
                        active
                          ? 'bg-blue-600 text-white'
                          : 'bg-white text-gray-600 dark:bg-slate-800 dark:text-slate-400 hover:bg-gray-100 dark:hover:bg-slate-700'
                      }`}
                    >
                      {opt.label}
                    </button>
                  );
                })}
              </div>
            </section>
          )}
```

- [ ] **Step 2: Extend Apply handler**

Add:

```javascript
                if (draft.factor_company === 'yes' || draft.factor_company === 'no') {
                  cleaned.factor_company = draft.factor_company;
                }
```

- [ ] **Step 3: Forward 5 new params in both tabs**

In both `components/ar/BillingPipelineTab.js` and `components/ar/InvoicesTab.js`, after the existing Phase B2 forwards, add:

```javascript
if (filters.bill_to_primary_customer_ids?.length)    params.set('bill_to_primary_customer_ids',    filters.bill_to_primary_customer_ids.join(','));
if (filters.bill_to_primary_customer_ids_exclude?.length) params.set('bill_to_primary_customer_ids_exclude', filters.bill_to_primary_customer_ids_exclude.join(','));
if (filters.bill_to_additional_customer_ids?.length) params.set('bill_to_additional_customer_ids', filters.bill_to_additional_customer_ids.join(','));
if (filters.bill_to_additional_customer_ids_exclude?.length) params.set('bill_to_additional_customer_ids_exclude', filters.bill_to_additional_customer_ids_exclude.join(','));
if (filters.factor_company === 'yes' || filters.factor_company === 'no') params.set('factor_company', filters.factor_company);
```

- [ ] **Step 4: Commit**

```bash
git add components/ar/FilterSidebar.js components/ar/BillingPipelineTab.js components/ar/InvoicesTab.js
git commit -m "feat(ar): FilterSidebar — Factor Company Y/N + forward B4 params"
```

---

## Task 7: E2E verification

**Files:** none — smoke test only.

- [ ] **Step 1: Run unit tests**

```bash
node tests/ar-filter-params.test.mjs
```

Expected: `42 passed, 0 failed`.

- [ ] **Step 2: Manual browser smoke**

Open Filters sidebar on Billing:
- New sections present after Customers: Bill To — Primary, Bill To — Additional, Factor Company
- Primary/Additional each have Exclude toggle
- Factor Company has 3 pill options (All / Factor / Direct-pay)

Apply a Bill-to Primary filter → Billing fetch query includes `bill_to_primary_customer_ids=<uuid>` → rows narrow to charge sets that are primary AND bill-to matches.

- [ ] **Step 3: No commit** — verification only.

---

## Live Gates

- **Gate 1** — `node tests/ar-filter-params.test.mjs` → `42 passed, 0 failed`
- **Gate 2** — Sidebar shows 3 new sections after Customers: Bill To — Primary, Bill To — Additional, Factor Company
- **Gate 3** — Bill-to Primary include filter narrows Billing → fetch sends `bill_to_primary_customer_ids=<uuid>`, only primary charge sets remain
- **Gate 4** — Bill-to Primary exclude narrows → `bill_to_primary_customer_ids_exclude=<uuid>` in fetch
- **Gate 5** — Bill-to Additional filter → rows narrow to secondary charge sets with matching bill_to
- **Gate 6** — Factor Company = "Factor" → only charge sets with `bill_to.pay_type === 'factoring'` remain, query includes `factor_company=yes`
- **Gate 7** — Factor Company = "Direct-pay" → only non-factoring charge sets remain, query includes `factor_company=no`
- **Gate 8** — Save a tab with all 3 dimensions set → reload → re-applies each
- **Gate 9** — Cross-section: same tab applied on Invoices returns narrowed invoices
- **Gate 10** — Dark-mode audit on new sections

---

## Self-Review

**Spec coverage**
- Bill-to Primary multi-select + exclude: ✅ Tasks 1, 2, 3, 4, 5
- Bill-to Additional multi-select + exclude: ✅ Tasks 1, 2, 3, 4, 5
- Factor Company Y/N: ✅ Tasks 1, 2, 3, 4, 6
- Endpoints: ✅ Tasks 2, 3
- ArFiltersBar: ✅ Task 4
- UI + forwarding: ✅ Tasks 5, 6
- Tests: ✅ Task 1

**Placeholder scan** — every step has concrete code + bash.

**Type consistency**
- Primary/additional detection: `/_\d+$/` regex consistent across both endpoints.
- `factor_company` is a plain string key in STRING_KEYS.
- 5 new keys consistent across sanitizer, schema, both endpoints, ArFiltersBar, FilterSidebar, both tabs.
