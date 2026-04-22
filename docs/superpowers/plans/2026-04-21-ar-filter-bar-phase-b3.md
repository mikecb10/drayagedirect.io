# AR Filter Bar Phase B3 — Wire Payments / Credit Memos / Aging Sub-Tabs

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire the Payments, Credit Memos, and Aging AR sub-tabs to consume applicable filters from the global ArFiltersBar, so a saved custom tab narrows their data just like Billing + Invoices do today.

**Architecture:** Each sub-tab's endpoint gains array-filter param support (customer_ids with exclude, date ranges, reference_number where applicable). Each tab component accepts a `filters` prop and forwards the applicable subset in its fetch. `lib/ar-filter-schema.js` populates `SECTION_KEYS` entries so the FilterSidebar shows only the filters each section can actually apply. ApplyPaymentsTab remains unwired (`SECTION_KEYS.apply_payments = []`) because it has its own OrgPicker-based per-customer flow.

**Tech Stack:** Next.js pages/api, Supabase service-role, React hooks. No migration, no UI component changes beyond accepting a prop + forwarding params.

---

## File Structure

**Backend:**
- Modify: `pages/api/tenant/ar/payments/index.js` (GET: accept `customer_ids`, `customer_ids_exclude`, `reference_number`)
- Modify: `pages/api/tenant/ar/credit-memos/index.js` (GET: accept `customer_ids`, `customer_ids_exclude`, `from`, `to`)
- Modify: `pages/api/tenant/ar/aging.js` (accept `customer_ids`, `customer_ids_exclude`, `invoiced_from`, `invoiced_to`)

**Frontend:**
- Modify: `lib/ar-filter-schema.js` (populate 3 section entries)
- Modify: `components/ar/PaymentsTab.js` (accept `filters` prop, forward params, add to useEffect deps)
- Modify: `components/ar/CreditMemosTab.js` (same)
- Modify: `components/ar/AgingTab.js` (same)
- Modify: `pages/ar/index.js` (pass `filters={filters}` to the 3 wired tabs)

---

## Conventions

1. **Backward compat:** Each endpoint already accepts a single-value `customer_id`. Keep that working. If BOTH `customer_id` and `customer_ids` arrive, union them.
2. **Filter application:** Use `parseCsvParam` from `lib/ar-filter-params` for all array params (same pattern as Billing + Invoices endpoints).
3. **No unit tests** added in B3 — the sanitizer + URL-forwarding shape is unchanged from Phase B2. These endpoints are exercised via live gates only.
4. **ApplyPaymentsTab stays UNWIRED** — it has its own OrgPicker-driven customer-scoping UX; global filter-bar customer narrowing would conflict.

---

## Applicable SECTION_KEYS per tab

| Section | Keys |
|---|---|
| `payments` | `customer_ids`, `customer_ids_exclude`, `from`, `to`, `reference_number` |
| `credit_memos` | `customer_ids`, `customer_ids_exclude`, `from`, `to` |
| `aging` | `customer_ids`, `customer_ids_exclude`, `invoiced_from`, `invoiced_to` |
| `apply_payments` | `[]` (unchanged) |
| `billing` + `invoices` | all 24 Phase B2 keys (unchanged) |

---

## Task 1: Extend `/api/tenant/ar/payments` GET

**Files:**
- Modify: `pages/api/tenant/ar/payments/index.js`

Add `customer_ids` (CSV array) + `customer_ids_exclude` (CSV array) + `reference_number` (substring match). Preserve existing `customer_id` singular and union into array.

- [ ] **Step 1: Add the import**

At the top of the file (after existing `import { PERMISSIONS } from '../../../../../lib/permissions';`), add:

```javascript
import { parseCsvParam } from '../../../../../lib/ar-filter-params';
```

- [ ] **Step 2: Extend the GET-branch param parse**

Find the line:
```javascript
    const { customer_id, from, to, payment_method } = req.query;
```

Replace with:
```javascript
    const { customer_id, from, to, payment_method, reference_number } = req.query;
    const customerIdsRaw = parseCsvParam(req.query.customer_ids);
    const customerIdsExclude = parseCsvParam(req.query.customer_ids_exclude);
    // Backward-compat: fold single `customer_id` into the include array.
    const customerIds = customer_id
      ? Array.from(new Set([...customerIdsRaw, customer_id]))
      : customerIdsRaw;
```

- [ ] **Step 3: Replace the customer_id `.eq()` line with array-aware filtering**

Find the line:
```javascript
    if (customer_id) query = query.eq('customer_id', customer_id);
```

Replace with:
```javascript
    if (customerIds.length === 1) query = query.eq('customer_id', customerIds[0]);
    else if (customerIds.length > 1) query = query.in('customer_id', customerIds);
    if (customerIdsExclude.length === 1) query = query.neq('customer_id', customerIdsExclude[0]);
    else if (customerIdsExclude.length > 1) query = query.not('customer_id', 'in', '(' + customerIdsExclude.join(',') + ')');
```

- [ ] **Step 4: Add reference_number filter**

Just before `const { data, error } = await query;`, add:

```javascript
    if (reference_number && typeof reference_number === 'string' && reference_number.trim().length > 0) {
      query = query.ilike('reference_number', `%${reference_number.trim()}%`);
    }
```

- [ ] **Step 5: Commit**

```bash
git add pages/api/tenant/ar/payments/index.js
git commit -m "feat(ar): payments endpoint accepts customer_ids + reference_number"
```

---

## Task 2: Extend `/api/tenant/ar/credit-memos` GET

**Files:**
- Modify: `pages/api/tenant/ar/credit-memos/index.js`

Add `customer_ids` + `customer_ids_exclude` + `from` + `to` (on `credit_memos.created_at`). Preserve existing `customer_id` singular + `status`.

- [ ] **Step 1: Add the import**

At the top (after PERMISSIONS import), add:

```javascript
import { parseCsvParam } from '../../../../../lib/ar-filter-params';
```

- [ ] **Step 2: Extend param parse**

Find:
```javascript
    const { customer_id, status } = req.query;
```

Replace with:
```javascript
    const { customer_id, status, from, to } = req.query;
    const customerIdsRaw = parseCsvParam(req.query.customer_ids);
    const customerIdsExclude = parseCsvParam(req.query.customer_ids_exclude);
    const customerIds = customer_id
      ? Array.from(new Set([...customerIdsRaw, customer_id]))
      : customerIdsRaw;
```

- [ ] **Step 3: Replace the customer_id `.eq()` line + add date + exclude**

Find:
```javascript
    if (customer_id) query = query.eq('customer_id', customer_id);
    if (status) query = query.eq('status', status);
```

Replace with:
```javascript
    if (customerIds.length === 1) query = query.eq('customer_id', customerIds[0]);
    else if (customerIds.length > 1) query = query.in('customer_id', customerIds);
    if (customerIdsExclude.length === 1) query = query.neq('customer_id', customerIdsExclude[0]);
    else if (customerIdsExclude.length > 1) query = query.not('customer_id', 'in', '(' + customerIdsExclude.join(',') + ')');
    if (status) query = query.eq('status', status);
    if (from) query = query.gte('created_at', from);
    if (to)   query = query.lte('created_at', to);
```

- [ ] **Step 4: Commit**

```bash
git add pages/api/tenant/ar/credit-memos/index.js
git commit -m "feat(ar): credit-memos endpoint accepts customer_ids + date range"
```

---

## Task 3: Extend `/api/tenant/ar/aging` GET

**Files:**
- Modify: `pages/api/tenant/ar/aging.js`

Aging currently has zero query params. Add: customer filter (include + exclude) + invoiced date range (applies to `invoices.created_at`).

- [ ] **Step 1: Add imports**

At the top of the file (after `import { PERMISSIONS } from '../../../../lib/permissions';`), add:

```javascript
import { parseCsvParam } from '../../../../lib/ar-filter-params';
```

- [ ] **Step 2: Parse params**

At the top of the handler, AFTER `const svc = getServiceClient();`, add:

```javascript
  const customerIds        = parseCsvParam(req.query.customer_ids);
  const customerIdsExclude = parseCsvParam(req.query.customer_ids_exclude);
  const { invoiced_from, invoiced_to } = req.query;
```

- [ ] **Step 3: Apply the filters to the invoices query**

Find the current invoices query block:
```javascript
  const { data: invoices, error } = await svc
    .from('invoices')
    .select('id, invoice_number, customer_id, due_date, balance_due_cents, total_amount_cents, status, created_at')
    .eq('tenant_id', ctx.tenantId)
    .in('status', ['sent', 'overdue'])
    .is('deleted_at', null)
    .gt('balance_due_cents', 0)
    .order('due_date', { ascending: true });
```

Replace with:
```javascript
  let invoicesQuery = svc
    .from('invoices')
    .select('id, invoice_number, customer_id, due_date, balance_due_cents, total_amount_cents, status, created_at')
    .eq('tenant_id', ctx.tenantId)
    .in('status', ['sent', 'overdue'])
    .is('deleted_at', null)
    .gt('balance_due_cents', 0)
    .order('due_date', { ascending: true });

  if (customerIds.length === 1) invoicesQuery = invoicesQuery.eq('customer_id', customerIds[0]);
  else if (customerIds.length > 1) invoicesQuery = invoicesQuery.in('customer_id', customerIds);
  if (customerIdsExclude.length === 1) invoicesQuery = invoicesQuery.neq('customer_id', customerIdsExclude[0]);
  else if (customerIdsExclude.length > 1) invoicesQuery = invoicesQuery.not('customer_id', 'in', '(' + customerIdsExclude.join(',') + ')');
  if (invoiced_from && typeof invoiced_from === 'string') invoicesQuery = invoicesQuery.gte('created_at', invoiced_from);
  if (invoiced_to   && typeof invoiced_to   === 'string') invoicesQuery = invoicesQuery.lte('created_at', invoiced_to);

  const { data: invoices, error } = await invoicesQuery;
```

- [ ] **Step 4: Commit**

```bash
git add pages/api/tenant/ar/aging.js
git commit -m "feat(ar): aging endpoint accepts customer_ids + invoiced date range"
```

---

## Task 4: Populate SECTION_KEYS for 3 sub-tabs

**Files:**
- Modify: `lib/ar-filter-schema.js`

- [ ] **Step 1: Replace the SECTION_KEYS constant**

Find the current constant (after Phase B2 it still has `apply_payments / payments / credit_memos / aging` all mapped to `[]`). Replace the whole constant with:

```javascript
const SECTION_KEYS = {
  billing:  ALL_B2_KEYS,
  invoices: ALL_B2_KEYS,
  // Phase B3: applicable subsets per section. ApplyPaymentsTab has its own
  // OrgPicker customer flow — leaving its filter list empty avoids a
  // conflict between the sidebar's customer filter and the tab's picker.
  apply_payments: [],
  payments:       ['customer_ids', 'customer_ids_exclude', 'from', 'to', 'reference_number'],
  credit_memos:   ['customer_ids', 'customer_ids_exclude', 'from', 'to'],
  aging:          ['customer_ids', 'customer_ids_exclude', 'invoiced_from', 'invoiced_to'],
};
```

- [ ] **Step 2: Commit**

```bash
git add lib/ar-filter-schema.js
git commit -m "feat(ar): populate SECTION_KEYS for Payments/Credits/Aging"
```

---

## Task 5: Wire `PaymentsTab` as filter-consumer

**Files:**
- Modify: `components/ar/PaymentsTab.js`

- [ ] **Step 1: Update the function signature**

Change:
```javascript
export default function PaymentsTab() {
```

To:
```javascript
export default function PaymentsTab({ filters = {} }) {
```

- [ ] **Step 2: Update `load()` to forward filter params**

Replace the existing `async function load() { ... }` body with:

```javascript
  async function load() {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (filters.customer_ids?.length)         params.set('customer_ids', filters.customer_ids.join(','));
      if (filters.customer_ids_exclude?.length) params.set('customer_ids_exclude', filters.customer_ids_exclude.join(','));
      if (filters.from) params.set('from', filters.from);
      if (filters.to)   params.set('to',   filters.to);
      if (filters.reference_number) params.set('reference_number', filters.reference_number);

      const qs = params.toString();
      const res = await fetch(`/api/tenant/ar/payments${qs ? `?${qs}` : ''}`);
      if (!res.ok) throw new Error('Failed to load');
      const data = await res.json();
      setPayments(data.payments || []);
      setStats(data.stats || {});
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }
```

- [ ] **Step 3: Add `filters` to the useEffect dep array**

Find:
```javascript
  useEffect(() => { load(); }, []);
```

Replace with:
```javascript
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [filters]);
```

(The `load` function is stable-ish and captures current state setters; keeping it out of deps matches the existing pattern.)

- [ ] **Step 4: Commit**

```bash
git add components/ar/PaymentsTab.js
git commit -m "feat(ar): PaymentsTab reads filters from props + forwards in fetch"
```

---

## Task 6: Wire `CreditMemosTab` as filter-consumer

**Files:**
- Modify: `components/ar/CreditMemosTab.js`

Same pattern as Task 5, narrowed keys.

- [ ] **Step 1: Update signature**

```javascript
export default function CreditMemosTab({ filters = {} }) {
```

- [ ] **Step 2: Update `load()`**

Replace:
```javascript
  async function load() {
    setLoading(true);
    try {
      const res = await fetch('/api/tenant/ar/credit-memos');
      if (!res.ok) throw new Error('Failed to load');
      const data = await res.json();
      setMemos(data.credit_memos || []);
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }
```

With:
```javascript
  async function load() {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (filters.customer_ids?.length)         params.set('customer_ids', filters.customer_ids.join(','));
      if (filters.customer_ids_exclude?.length) params.set('customer_ids_exclude', filters.customer_ids_exclude.join(','));
      if (filters.from) params.set('from', filters.from);
      if (filters.to)   params.set('to',   filters.to);

      const qs = params.toString();
      const res = await fetch(`/api/tenant/ar/credit-memos${qs ? `?${qs}` : ''}`);
      if (!res.ok) throw new Error('Failed to load');
      const data = await res.json();
      setMemos(data.credit_memos || []);
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }
```

- [ ] **Step 3: Dep array**

Replace:
```javascript
  useEffect(() => { load(); }, []);
```

With:
```javascript
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [filters]);
```

- [ ] **Step 4: Commit**

```bash
git add components/ar/CreditMemosTab.js
git commit -m "feat(ar): CreditMemosTab reads filters from props + forwards in fetch"
```

---

## Task 7: Wire `AgingTab` as filter-consumer

**Files:**
- Modify: `components/ar/AgingTab.js`

- [ ] **Step 1: Update signature**

```javascript
export default function AgingTab({ filters = {} }) {
```

- [ ] **Step 2: Update `load()`**

Replace:
```javascript
  async function load() {
    setLoading(true);
    try {
      const res = await fetch('/api/tenant/ar/aging');
      if (!res.ok) throw new Error('Failed to load aging data');
      const d = await res.json();
      setData(d);
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }
```

With:
```javascript
  async function load() {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (filters.customer_ids?.length)         params.set('customer_ids', filters.customer_ids.join(','));
      if (filters.customer_ids_exclude?.length) params.set('customer_ids_exclude', filters.customer_ids_exclude.join(','));
      if (filters.invoiced_from) params.set('invoiced_from', filters.invoiced_from);
      if (filters.invoiced_to)   params.set('invoiced_to',   filters.invoiced_to);

      const qs = params.toString();
      const res = await fetch(`/api/tenant/ar/aging${qs ? `?${qs}` : ''}`);
      if (!res.ok) throw new Error('Failed to load aging data');
      const d = await res.json();
      setData(d);
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }
```

- [ ] **Step 3: Dep array**

Replace:
```javascript
  useEffect(() => { load(); }, []);
```

With:
```javascript
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [filters]);
```

- [ ] **Step 4: Commit**

```bash
git add components/ar/AgingTab.js
git commit -m "feat(ar): AgingTab reads filters from props + forwards in fetch"
```

---

## Task 8: Pass `filters` to the 3 wired tabs from AR parent

**Files:**
- Modify: `pages/ar/index.js`

- [ ] **Step 1: Pass `filters` to the 3 wired sub-tab renders**

Find the conditional rendering block that looks like:
```jsx
        {activeTab === 'billing'        && <BillingPipelineTab filters={filters} />}
        {activeTab === 'invoices'       && <InvoicesTab filters={filters} />}
        {activeTab === 'apply_payments' && <ApplyPaymentsTab />}
        {activeTab === 'payments'       && <PaymentsTab />}
        {activeTab === 'credit_memos'   && <CreditMemosTab />}
        {activeTab === 'aging'          && <AgingTab />}
```

Replace with:
```jsx
        {activeTab === 'billing'        && <BillingPipelineTab filters={filters} />}
        {activeTab === 'invoices'       && <InvoicesTab filters={filters} />}
        {activeTab === 'apply_payments' && <ApplyPaymentsTab />}
        {activeTab === 'payments'       && <PaymentsTab filters={filters} />}
        {activeTab === 'credit_memos'   && <CreditMemosTab filters={filters} />}
        {activeTab === 'aging'          && <AgingTab filters={filters} />}
```

(ApplyPaymentsTab intentionally does NOT receive filters — its SECTION_KEYS is `[]`.)

- [ ] **Step 2: Commit**

```bash
git add pages/ar/index.js
git commit -m "feat(ar): pass filters prop to Payments/Credits/Aging tabs"
```

---

## Task 9: E2E verification + live gates

**Files:** none — smoke test only.

- [ ] **Step 1: HMR** — your dev server is running; changes should have rebuilt.

- [ ] **Step 2: Manual gates (record in live-gates walk)**

1. On AR → Billing, open Filters, pick a customer, Save as tab "QA B3", Apply.
2. Switch to **Payments** — tab "QA B3" visible, fetch sends `customer_ids=<uuid>`, list narrows.
3. Switch to **Credit Memos** — same behavior.
4. Switch to **Aging** — same behavior.
5. Switch to **Apply Payments** — opening Filters sidebar should still show "No filters available for this section yet." (unwired).
6. Clean up: delete "QA B3" tab.

- [ ] **Step 3: No commit** — verification only. Fix forward if anything breaks.

---

## Live Gates

- **Gate 1** — `node tests/ar-filter-params.test.mjs` → `36 passed, 0 failed` (no change from B2, confirms we didn't break anything)
- **Gate 2** — Open Filters on **Payments** sub-tab → sidebar renders only Customers (with Exclude) + Created between + Reference number
- **Gate 3** — Apply a customer filter on Payments → fetch sends `customer_ids=<uuid>`, list narrows
- **Gate 4** — Open Filters on **Credit Memos** → sidebar renders Customers + Created between only (no reference, no invoiced)
- **Gate 5** — Apply a date range on Credit Memos → fetch sends `from=...&to=...`, list narrows
- **Gate 6** — Open Filters on **Aging** → sidebar renders Customers + Invoiced between only
- **Gate 7** — Apply customer_ids_exclude on Aging → invoices for that customer hidden from aging buckets
- **Gate 8** — Cross-section: save "QA B3" tab on Billing, switch to Payments/Credits/Aging — tab visible, filters narrow each section's data
- **Gate 9** — **Apply Payments** sub-tab still shows "No filters available for this section yet." and no filter sections render
- **Gate 10** — Dark-mode audit on all three newly-wired tabs (should just work — no new UI)

---

## Self-Review

**Spec coverage**
- Payments endpoint + tab: ✅ Tasks 1, 5
- Credit Memos endpoint + tab: ✅ Tasks 2, 6
- Aging endpoint + tab: ✅ Tasks 3, 7
- Schema update: ✅ Task 4
- Parent passes filters: ✅ Task 8
- Verification: ✅ Task 9

**Placeholder scan** — each step has concrete code + bash commands.

**Type consistency**
- Filter keys consistent across endpoints / SECTION_KEYS / tab fetch forwards.
- All endpoints use `parseCsvParam` from `lib/ar-filter-params` (same import already used by Billing + Invoices endpoints).
- Supabase query builder methods: `.eq`, `.in`, `.neq`, `.not('col', 'in', '(...)')`, `.gte`, `.lte`, `.ilike` — all existing patterns in the codebase.
