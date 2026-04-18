# AR UI Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship three AR UX improvements — Bill To dropdown on load Billing tab, pipeline card count+sum, and bulk checkbox + Approve/Unapprove/Export CSV actions on /ar Billing Pipeline — so dispatchers see and act on AR workflow data in-context.

**Architecture:** Pure UI-layer changes plus one API response-shape extension. No new DB migrations, no new endpoints, no new dependencies. Bill To uses the existing `OrgPicker` component and existing PUT endpoint. Card sums extend the existing `/api/tenant/ar` GET response. Bulk actions iterate client-side over the existing per-charge-set PUT endpoint with smart-skip handling.

**Tech Stack:** Next.js Pages Router, React 19, Tailwind v4, Supabase via service role. Existing components: `OrgPicker`, `Alert`, `Button`, `lucide-react` icons.

**Spec:** `docs/superpowers/specs/2026-04-18-ar-ui-polish-design.md`

**Branch:** `main`. Before each commit: `git branch --show-current` must return `main` (parallel Cowork session has intermittently swapped workspace branches — recovery pattern in `session_2026_04_17_handoff.md`).

**No automated tests in this plan.** Codebase uses manual Cowork QA + targeted DB verification. Each task has a local sanity-check step before commit.

**Do NOT run `npm run build`** — it wipes `.next/` which breaks any running dev server. Rely on grep + dev-server hot-reload for syntax verification.

---

## Task 1: Bill To dropdown on load Billing tab

**Files:**
- Modify: `components/loads/tabs/BillingTab.js` (inside `ChargeSetCard` component)

**Context for the implementer:**
- `ChargeSetCard` is defined at `components/loads/tabs/BillingTab.js:268` (internal component, not exported).
- The card currently has a read-only `{chargeSet.bill_to && <div>Bill to: {chargeSet.bill_to.name}</div>}` display at lines 467-469 — this must be removed.
- `OrgPicker` is already imported at line 8: `import OrgPicker from '../../ui/OrgPicker';`
- The list query populates `chargeSet.bill_to_customer_id` (uuid) and a nested `chargeSet.bill_to` object (joined customer).
- The PUT endpoint at `pages/api/tenant/loads/[id]/charge-sets/[csId]` already accepts `bill_to_customer_id` on the request body (line 54-55). No API change needed.
- New charge sets POST already defaults `bill_to_customer_id = load.customer_id` at `BillingTab.js:98`.

- [ ] **Step 1: Verify branch is `main`**

```bash
git branch --show-current
```

Expected: `main`. If anything else, STOP and report BLOCKED — recovery pattern in session_2026_04_17_handoff.md.

- [ ] **Step 2: Add the `saveBillTo` helper function inside `ChargeSetCard`**

Locate the existing `updateStatus` function inside `ChargeSetCard` (starts at line 286). Immediately BEFORE `updateStatus`, add the new helper:

```js
  async function saveBillTo(newCustomerId) {
    try {
      const res = await fetch(
        `/api/tenant/loads/${loadId}/charge-sets/${chargeSet.id}`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ bill_to_customer_id: newCustomerId }),
        }
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || 'Failed to update Bill To');
      }
      // Refetch so the nested `bill_to` object refreshes alongside the id
      await onChanged();
    } catch (e) {
      onError(e.message);
    }
  }
```

Rationale: no optimistic update — refetch path is simpler and the PUT is fast. Error surfaces via existing `onError` prop (which feeds the shared Alert banner at the top of BillingTab).

- [ ] **Step 3: Remove the existing read-only Bill To display**

In `ChargeSetCard`'s render, find lines 467-469:

```jsx
          {chargeSet.bill_to && (
            <div className="text-helper text-muted mt-0.5">Bill to: {chargeSet.bill_to.name}</div>
          )}
```

Delete this block entirely. The Bill To will now live in a new row above the header (added in the next step).

- [ ] **Step 4: Add a Bill To row above the header**

In the same `ChargeSetCard` render (starting at line 436), find the opening of the card:

```jsx
  return (
    <div className="rounded-xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-900 overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-100 dark:border-slate-800 bg-gray-50 dark:bg-slate-900">
```

Insert a new row BEFORE `{/* Header */}` and its div. The new row must be the first child inside the outer `rounded-xl` wrapper:

```jsx
  return (
    <div className="rounded-xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-900 overflow-hidden">
      {/* Bill To row — dispatcher can pick which customer this charge set is billed to */}
      <div className="px-4 py-2.5 border-b border-gray-100 dark:border-slate-800 bg-white dark:bg-slate-900">
        <OrgPicker
          label="Bill To"
          type="customer"
          value={chargeSet.bill_to_customer_id}
          valueLabel={chargeSet.bill_to?.name}
          onChange={(org) => saveBillTo(org?.id || null)}
          placeholder="Select customer..."
        />
      </div>
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-100 dark:border-slate-800 bg-gray-50 dark:bg-slate-900">
```

**OrgPicker contract reminders for the implementer** (these prop names differ from early drafts of the plan):
- Prop is `type`, not `customerType`
- `onChange` receives the full org object or `null` — extract `.id` for the UUID
- `valueLabel` is required to render the existing Bill To on first paint
- Use the built-in `label` prop instead of a sibling `<label>` — matches 30+ other OrgPicker callers

- [ ] **Step 5: Sanity-check the edit via grep**

```bash
grep -n "saveBillTo\|type=\"customer\"\|Bill To row" components/loads/tabs/BillingTab.js
```

Expected: at least 4 matches — the function definition, the call inside `onChange`, the `type="customer"` prop on OrgPicker, and the comment tag.

Also verify the old read-only block was removed:

```bash
grep -n "Bill to: {chargeSet.bill_to" components/loads/tabs/BillingTab.js
```

Expected: **zero matches**. If any match remains, the old block was not removed — re-check Step 3.

- [ ] **Step 6: Local sanity check in browser**

Dev server should already be running on localhost:3000 (from yesterday's session). If not, `npm run dev` in a separate terminal.

1. Navigate to any load with an existing charge set (e.g., ORD-M000005 or ORD-M000008).
2. Open the Billing tab.
3. Above the charge set card's header row, a new row should appear with a "BILL TO" label and the `OrgPicker` dropdown.
4. If the charge set has `bill_to_customer_id` set, the picker shows the current customer.
5. Pick a different customer from the dropdown. Loading state should be brief; card rerenders with new customer.
6. Refresh the page (F5). The picked customer persists.

If any step fails, STOP and report the specific failure.

- [ ] **Step 7: Verify branch before committing**

```bash
git branch --show-current
```

Expected: `main`.

- [ ] **Step 8: Commit**

```bash
git add components/loads/tabs/BillingTab.js
git commit -m "$(cat <<'EOF'
feat(load-billing): add Bill To dropdown to charge set cards

The charge set card previously showed Bill To as a read-only label
only when set; now dispatchers can view and change it inline via an
OrgPicker above the card header. Uses the existing PUT endpoint
which already accepts bill_to_customer_id — no API or schema change.
New charge sets still default bill_to_customer_id to load.customer_id
on create (unchanged).

Spec: docs/superpowers/specs/2026-04-18-ar-ui-polish-design.md

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

Expected: commit succeeds on branch `main`.

---

## Task 2: Pipeline card count + sum

**Files:**
- Modify: `pages/api/tenant/ar/index.js` (extend `counts` response shape to `{ count, total_cents }` per bucket)
- Modify: `components/ar/BillingPipelineTab.js` (update `PipelineCard` to render the sum line; update call sites)

**Context for the implementer:**
- The AR list endpoint is 106 lines (`pages/api/tenant/ar/index.js`). The current `counts` computation is a single `for` loop over `sets` (lines 60-79) that increments counters.
- The endpoint response currently is `{ charge_sets, counts }` where `counts` is a shallow map like `{ draft: 5, approved: 2, ... }`. We change that to `{ draft: { count: 5, total_cents: 270000 }, approved: { ... }, ... }` plus keep the top-level `total` (count) and `total_cents` (grand sum) for backwards compat.
- `BillingPipelineTab.js` has a local `formatCents` function (line 21) — reuse, no new import needed.

- [ ] **Step 1: Verify branch is `main`**

```bash
git branch --show-current
```

Expected: `main`.

- [ ] **Step 2: Update the backend `counts` shape in `pages/api/tenant/ar/index.js`**

Find the `counts` initialization block (lines 44-58):

```js
  // Compute pipeline counts
  const counts = {
    // Pre-Invoice Pipeline
    uncompleted_loads: 0,
    completed_loads: 0,
    rate_con_sent: 0,
    unapproved: 0,
    approved: 0,
    // Invoice Pipeline
    invoiced: 0,
    rebilling: 0,
    // Other
    void: 0,
    total: sets.length,
    total_cents: 0,
  };
```

Replace with:

```js
  // Compute pipeline counts + sums per bucket.
  // Shape: { <bucket>: { count, total_cents } } with `total`/`total_cents`
  // at the top level preserving grand totals for backwards-compat display.
  const emptyBucket = () => ({ count: 0, total_cents: 0 });
  const counts = {
    // Pre-Invoice Pipeline
    uncompleted_loads: emptyBucket(),
    completed_loads: emptyBucket(),
    rate_con_sent: emptyBucket(),
    unapproved: emptyBucket(),
    approved: emptyBucket(),
    // Invoice Pipeline
    invoiced: emptyBucket(),
    rebilling: emptyBucket(),
    // Other
    void: emptyBucket(),
    total: sets.length,
    total_cents: 0,
  };
```

- [ ] **Step 3: Update the aggregation loop to also accumulate per-bucket sums**

Find the aggregation loop (lines 60-79):

```js
  for (const cs of sets) {
    const loadStatus = cs.order?.status;
    const csStatus = cs.status;

    counts.total_cents += cs.total_cents || 0;

    if (csStatus === 'void') { counts.void++; continue; }
    if (csStatus === 'invoiced' || csStatus === 'billed') { counts.invoiced++; continue; }
    if (csStatus === 'rebilling') { counts.rebilling++; continue; }
    if (csStatus === 'rate_con_sent') { counts.rate_con_sent++; continue; }
    if (csStatus === 'unapproved') { counts.unapproved++; continue; }
    if (csStatus === 'approved') { counts.approved++; continue; }

    // Draft — split by load completion status
    if (loadStatus === 'completed' || loadStatus === 'delivered') {
      counts.completed_loads++;
    } else {
      counts.uncompleted_loads++;
    }
  }
```

Replace with:

```js
  for (const cs of sets) {
    const loadStatus = cs.order?.status;
    const csStatus = cs.status;
    const cents = cs.total_cents || 0;

    counts.total_cents += cents;

    const addTo = (bucket) => {
      counts[bucket].count += 1;
      counts[bucket].total_cents += cents;
    };

    if (csStatus === 'void') { addTo('void'); continue; }
    if (csStatus === 'invoiced' || csStatus === 'billed') { addTo('invoiced'); continue; }
    if (csStatus === 'rebilling') { addTo('rebilling'); continue; }
    if (csStatus === 'rate_con_sent') { addTo('rate_con_sent'); continue; }
    if (csStatus === 'unapproved') { addTo('unapproved'); continue; }
    if (csStatus === 'approved') { addTo('approved'); continue; }

    // Draft — split by load completion status
    if (loadStatus === 'completed' || loadStatus === 'delivered') {
      addTo('completed_loads');
    } else {
      addTo('uncompleted_loads');
    }
  }
```

- [ ] **Step 4: Update `PipelineCard` in `BillingPipelineTab.js` to accept and render `total_cents`**

Find the `PipelineCard` function (line 57). The current signature is:

```js
  function PipelineCard({ label, count, icon: Icon, color, filterKey, active }) {
```

Change it to also accept `total_cents`:

```js
  function PipelineCard({ label, count, total_cents, icon: Icon, color, filterKey, active }) {
```

Then inside the returned JSX, after the existing label `<div>`, add a third line showing the sum. The existing structure is:

```jsx
      <button type="button" onClick={() => setActiveFilter(active ? null : filterKey)}
        className={`rounded-xl border p-3 text-left transition-all flex-1 min-w-[120px] ${active ? c.activeBg + ' ' + c.border : c.bg + ' ' + c.border + ' hover:shadow-sm'}`}>
        <div className="flex items-center gap-2 mb-1">
          <div className={`w-6 h-6 rounded-lg flex items-center justify-center ${c.iconBg}`}>
            <Icon className="w-3.5 h-3.5" />
          </div>
          <span className={`text-lg font-bold ${c.text}`}>{count}</span>
        </div>
        <div className="text-[10px] font-semibold text-gray-500 dark:text-slate-400 uppercase tracking-wide">{label}</div>
      </button>
```

Add the sum line after the label div, before the closing `</button>`:

```jsx
      <button type="button" onClick={() => setActiveFilter(active ? null : filterKey)}
        className={`rounded-xl border p-3 text-left transition-all flex-1 min-w-[120px] ${active ? c.activeBg + ' ' + c.border : c.bg + ' ' + c.border + ' hover:shadow-sm'}`}>
        <div className="flex items-center gap-2 mb-1">
          <div className={`w-6 h-6 rounded-lg flex items-center justify-center ${c.iconBg}`}>
            <Icon className="w-3.5 h-3.5" />
          </div>
          <span className={`text-lg font-bold ${c.text}`}>{count}</span>
        </div>
        <div className="text-[10px] font-semibold text-gray-500 dark:text-slate-400 uppercase tracking-wide">{label}</div>
        <div className="text-xs font-medium text-gray-600 dark:text-slate-300 mt-1">
          {formatCents(total_cents || 0)}
        </div>
      </button>
```

- [ ] **Step 5: Update all `PipelineCard` call sites in `BillingPipelineTab.js` to pass `total_cents`**

Find the pipeline card calls (lines 89-93 for Pre-Invoice, lines 101-102 for Invoice Pipeline):

```jsx
          <PipelineCard label="Uncompleted Loads" count={counts.uncompleted_loads || 0} icon={Truck} color="gray" filterKey="uncompleted_loads" active={activeFilter === 'uncompleted_loads'} />
          <PipelineCard label="Completed Loads" count={counts.completed_loads || 0} icon={CheckCircle2} color="gray" filterKey="completed_loads" active={activeFilter === 'completed_loads'} />
          <PipelineCard label="Rate Con Sent" count={counts.rate_con_sent || 0} icon={FileText} color="cyan" filterKey="rate_con_sent" active={activeFilter === 'rate_con_sent'} />
          <PipelineCard label="Unapproved" count={counts.unapproved || 0} icon={AlertCircle} color="amber" filterKey="unapproved" active={activeFilter === 'unapproved'} />
          <PipelineCard label="Approved" count={counts.approved || 0} icon={Check} color="blue" filterKey="approved" active={activeFilter === 'approved'} />
```

and

```jsx
          <PipelineCard label="Invoiced" count={counts.invoiced || 0} icon={DollarSign} color="emerald" filterKey="invoiced" active={activeFilter === 'invoiced'} />
          <PipelineCard label="Rebilling" count={counts.rebilling || 0} icon={RefreshCw} color="purple" filterKey="rebilling" active={activeFilter === 'rebilling'} />
```

Change each `count={counts.<key> || 0}` to `count={counts.<key>?.count || 0}` and add `total_cents={counts.<key>?.total_cents || 0}`. Result (Pre-Invoice Pipeline):

```jsx
          <PipelineCard label="Uncompleted Loads" count={counts.uncompleted_loads?.count || 0} total_cents={counts.uncompleted_loads?.total_cents || 0} icon={Truck} color="gray" filterKey="uncompleted_loads" active={activeFilter === 'uncompleted_loads'} />
          <PipelineCard label="Completed Loads" count={counts.completed_loads?.count || 0} total_cents={counts.completed_loads?.total_cents || 0} icon={CheckCircle2} color="gray" filterKey="completed_loads" active={activeFilter === 'completed_loads'} />
          <PipelineCard label="Rate Con Sent" count={counts.rate_con_sent?.count || 0} total_cents={counts.rate_con_sent?.total_cents || 0} icon={FileText} color="cyan" filterKey="rate_con_sent" active={activeFilter === 'rate_con_sent'} />
          <PipelineCard label="Unapproved" count={counts.unapproved?.count || 0} total_cents={counts.unapproved?.total_cents || 0} icon={AlertCircle} color="amber" filterKey="unapproved" active={activeFilter === 'unapproved'} />
          <PipelineCard label="Approved" count={counts.approved?.count || 0} total_cents={counts.approved?.total_cents || 0} icon={Check} color="blue" filterKey="approved" active={activeFilter === 'approved'} />
```

And (Invoice Pipeline):

```jsx
          <PipelineCard label="Invoiced" count={counts.invoiced?.count || 0} total_cents={counts.invoiced?.total_cents || 0} icon={DollarSign} color="emerald" filterKey="invoiced" active={activeFilter === 'invoiced'} />
          <PipelineCard label="Rebilling" count={counts.rebilling?.count || 0} total_cents={counts.rebilling?.total_cents || 0} icon={RefreshCw} color="purple" filterKey="rebilling" active={activeFilter === 'rebilling'} />
```

- [ ] **Step 6: Also verify the grand total at line 122 still works**

The line `Total: {formatCents(counts.total_cents || 0)}` at approximately line 122 uses the top-level `counts.total_cents` which we preserved. This should continue to work unchanged.

- [ ] **Step 7: Sanity-check via grep**

```bash
grep -n "emptyBucket\|addTo\|total_cents=" pages/api/tenant/ar/index.js components/ar/BillingPipelineTab.js
```

Expected: At least 2 matches in the API file (`emptyBucket` helper definition + `addTo` helper definition) and 7 matches in `BillingPipelineTab.js` (the 7 `total_cents={...}` props on PipelineCard calls).

- [ ] **Step 8: Local sanity check**

1. Dev server hot-reloads on edit. Visit `http://localhost:3000/ar`.
2. Each pipeline card now shows three lines: icon+count, label, and a dollar amount below.
3. Empty buckets show `$0.00`.
4. Grand total in the table area (below the cards) still renders.
5. Open DB via a diagnostic query to verify sums match:

```bash
node -e "
const fs = require('fs');
for (const line of fs.readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
  const [k, ...v] = line.split('='); if (k && v.length) process.env[k.trim()] = v.join('=').trim().replace(/^[\"']|[\"']\$/g, '');
}
const { createClient } = require('@supabase/supabase-js');
const svc = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
(async () => {
  const { data } = await svc.from('order_charge_sets').select('status, total_cents').eq('tenant_id', 'c7c483bf-f602-4702-92f2-9bee8366cd50');
  const agg = {};
  for (const cs of data) {
    agg[cs.status] = agg[cs.status] || { count: 0, cents: 0 };
    agg[cs.status].count++;
    agg[cs.status].cents += cs.total_cents || 0;
  }
  for (const [k, v] of Object.entries(agg)) console.log(k.padEnd(16), v.count, ' \$', (v.cents/100).toFixed(2));
})();
"
```

Compare DB output to card display. For `draft` status specifically, the DB result's sum splits between the `uncompleted_loads` and `completed_loads` UI cards (driven by load status, not charge set status) — so the UI cards' sums for those two should sum to the DB `draft` sum.

- [ ] **Step 9: Verify branch before committing**

```bash
git branch --show-current
```

- [ ] **Step 10: Commit**

```bash
git add pages/api/tenant/ar/index.js components/ar/BillingPipelineTab.js
git commit -m "$(cat <<'EOF'
feat(ar-pipeline): show count + sum on pipeline cards

Extend /api/tenant/ar response counts from a shallow count map to
per-bucket { count, total_cents } objects, and render the sum as a
third line below the label on each pipeline card. Uncompleted/
Completed Loads buckets aggregate across their matching charge sets.

The top-level counts.total / counts.total_cents keys are preserved
for backwards compat with the existing grand-total display.

Spec: docs/superpowers/specs/2026-04-18-ar-ui-polish-design.md

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3a: Checkbox selection infrastructure

**Files:**
- Modify: `components/ar/BillingPipelineTab.js` (new state, master checkbox header cell, row checkbox cells, selection-clearing effect)

**Context for the implementer:**
- The table is rendered inside the existing component's JSX — likely around lines 140-200 (header row + `chargeSets.map((cs) => (...))` body). Read the current structure before editing.
- Row click currently opens the load overlay via `openOverlay('load', { loadId: cs.order_id, tab: 'billing', onClose: () => fetchAR({ silent: true }) })` (we added the onClose yesterday). Row click behavior must be preserved — checkbox clicks need `stopPropagation` so they don't bubble.

- [ ] **Step 1: Verify branch is `main`**

```bash
git branch --show-current
```

- [ ] **Step 2: Add selection state to `BillingPipelineTab` component**

Find the existing state declarations near the top of `BillingPipelineTab()` (around line 27-33):

```js
  const { openOverlay } = useOverlay();
  const [chargeSets, setChargeSets] = useState([]);
  const [counts, setCounts] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState('');
  const [activeFilter, setActiveFilter] = useState(null);
```

Add two new state declarations immediately after `activeFilter`:

```js
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [lastClickedId, setLastClickedId] = useState(null);
```

- [ ] **Step 3: Add a useEffect to clear selection when filter/search changes**

After the existing `useEffect(() => { fetchAR(); }, [activeFilter]);` (line 55), add:

```js
  // Selection is meaningful only within the currently displayed list.
  // When the filter or search changes, the list changes, so clear selection.
  useEffect(() => {
    setSelectedIds(new Set());
    setLastClickedId(null);
  }, [activeFilter, search]);
```

- [ ] **Step 4: Add selection helper functions inside the component**

After the `useEffect` just added, insert these helpers:

```js
  const visibleIds = chargeSets.map((cs) => cs.id);
  const allSelected = visibleIds.length > 0 && visibleIds.every((id) => selectedIds.has(id));
  const someSelected = visibleIds.some((id) => selectedIds.has(id)) && !allSelected;

  function toggleAll() {
    if (allSelected || someSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(visibleIds));
    }
  }

  function toggleRow(csId, event) {
    event.stopPropagation();
    if (event.shiftKey && lastClickedId) {
      const startIdx = visibleIds.indexOf(lastClickedId);
      const endIdx = visibleIds.indexOf(csId);
      if (startIdx >= 0 && endIdx >= 0) {
        const [a, b] = [Math.min(startIdx, endIdx), Math.max(startIdx, endIdx)];
        const rangeIds = visibleIds.slice(a, b + 1);
        setSelectedIds((prev) => {
          const next = new Set(prev);
          for (const id of rangeIds) next.add(id);
          return next;
        });
      }
    } else {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        if (next.has(csId)) next.delete(csId);
        else next.add(csId);
        return next;
      });
    }
    setLastClickedId(csId);
  }
```

- [ ] **Step 5: Add a master checkbox `<th>` to the table header**

Find the table `<thead>` / `<tr>` header row. Immediately before the first existing `<th>`, insert a new leftmost cell:

```jsx
                <th className="px-3 py-2 w-10">
                  <input
                    type="checkbox"
                    checked={allSelected}
                    ref={(el) => { if (el) el.indeterminate = someSelected; }}
                    onChange={toggleAll}
                    aria-label="Select all visible charge sets"
                    className="rounded border-gray-300 dark:border-slate-600 text-blue-600 focus:ring-blue-500 cursor-pointer"
                  />
                </th>
```

- [ ] **Step 6: Add a checkbox `<td>` to each row**

Inside the `chargeSets.map((cs) => ...)` body of the table, find the row opening `<tr>`. Currently looks like:

```jsx
                  <tr key={cs.id} className="hover:bg-gray-50 dark:hover:bg-slate-800/40 cursor-pointer"
                    onClick={() =>
                      openOverlay('load', {
                        loadId: cs.order_id,
                        tab: 'billing',
                        onClose: () => fetchAR({ silent: true }),
                      })
                    }>
```

Change the `className` to include a conditional selected highlight, and insert a checkbox cell as the first `<td>`:

```jsx
                  <tr key={cs.id}
                    className={`cursor-pointer ${
                      selectedIds.has(cs.id)
                        ? 'bg-blue-50 dark:bg-blue-950/40'
                        : 'hover:bg-gray-50 dark:hover:bg-slate-800/40'
                    }`}
                    onClick={() =>
                      openOverlay('load', {
                        loadId: cs.order_id,
                        tab: 'billing',
                        onClose: () => fetchAR({ silent: true }),
                      })
                    }>
                    <td className="px-3 py-2.5 w-10" onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        checked={selectedIds.has(cs.id)}
                        onChange={(e) => toggleRow(cs.id, e)}
                        onClick={(e) => e.stopPropagation()}
                        aria-label={`Select charge set ${cs.charge_set_number || ''}`}
                        className="rounded border-gray-300 dark:border-slate-600 text-blue-600 focus:ring-blue-500 cursor-pointer"
                      />
                    </td>
```

The outer `<td onClick={(e) => e.stopPropagation()}>` AND the inner `<input onClick={(e) => e.stopPropagation()}>` together prevent any checkbox-cell click from bubbling to the row overlay-open handler.

- [ ] **Step 7: Sanity-check via grep**

```bash
grep -n "selectedIds\|toggleRow\|toggleAll\|lastClickedId" components/ar/BillingPipelineTab.js
```

Expected: at least 10 matches covering the two state declarations, the useEffect, `visibleIds`, `allSelected`, `someSelected`, both toggle functions, and the JSX uses.

- [ ] **Step 8: Local sanity check**

1. Visit `/ar`.
2. Table should have a new leftmost column with a checkbox in the header and in each row.
3. Click a row's checkbox — row highlights blue; no overlay opens.
4. Click a different cell in the row (e.g., Order #) — overlay DOES open (selection unchanged).
5. Click the header checkbox — all visible rows select.
6. Click the header checkbox again — all deselect.
7. Select one row, then shift-click a row 4 below — all 5 rows between selected.
8. Type in search box — selection clears.
9. Click a pipeline card (changes filter) — selection clears.

- [ ] **Step 9: Verify branch before committing**

```bash
git branch --show-current
```

- [ ] **Step 10: Commit**

```bash
git add components/ar/BillingPipelineTab.js
git commit -m "$(cat <<'EOF'
feat(ar-pipeline): add checkbox selection infrastructure

Adds per-row and master checkboxes to the AR Billing Pipeline table.
Shift-click selects a range. Row click still opens the load overlay
(checkbox cell stops propagation). Selection clears when filter or
search changes since the list identity changes.

No behavior yet wired to selection — bulk action bar + handlers land
in the next commit.

Spec: docs/superpowers/specs/2026-04-18-ar-ui-polish-design.md

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3b: Bulk action bar + handlers

**Files:**
- Modify: `components/ar/BillingPipelineTab.js` (new imports for icons; new state for `bulkAction` + `toast`; action bar JSX; three handler functions + shared helper; toast dismissal effect)

**Context for the implementer:**
- Builds on Task 3a's `selectedIds` state.
- Reuses the existing `Alert` component for the toast.
- `Button` component is used throughout the codebase and is located at `components/ui/Button`. If not imported by this file already, add the import.
- The PUT endpoint for status transitions is `/api/tenant/loads/[id]/charge-sets/[csId]`; it validates status against `VALID_STATUSES` and returns 400 for invalid. The charge-set row has `cs.order_id` to construct the URL.
- After any bulk transition, refetch the list via `fetchAR({ silent: true })` so cards update live without flashing.

- [ ] **Step 1: Verify branch is `main`**

```bash
git branch --show-current
```

- [ ] **Step 2: Extend the imports**

Find the imports at the top of `BillingPipelineTab.js`:

```js
import { useEffect, useState } from 'react';
import {
  Search, FileText, Check, DollarSign, Clock, AlertCircle,
  RefreshCw, ExternalLink, Truck, CheckCircle2,
} from 'lucide-react';
import Alert from '../ui/Alert';
import { useOverlay } from '../../contexts/OverlayContext';
import { formatInvoiceNumber } from '../../lib/invoice-utils';
```

Replace the lucide-react import block to add `CheckSquare`, `X`, and `Download`:

```js
import { useEffect, useState } from 'react';
import {
  Search, FileText, Check, DollarSign, Clock, AlertCircle,
  RefreshCw, ExternalLink, Truck, CheckCircle2,
  CheckSquare, X, Download,
} from 'lucide-react';
import Alert from '../ui/Alert';
import Button from '../ui/Button';
import { useOverlay } from '../../contexts/OverlayContext';
import { formatInvoiceNumber } from '../../lib/invoice-utils';
```

Note the added `import Button from '../ui/Button';` — verify with `grep -n "^import" components/ar/BillingPipelineTab.js` that it's not already imported.

- [ ] **Step 3: Add `bulkAction` and `toast` state**

Inside the component, after the `lastClickedId` state added in Task 3a Step 2:

```js
  const [bulkAction, setBulkAction] = useState(null); // 'approve' | 'unapprove' | null
  const [toast, setToast] = useState(null); // { type, message } | null
```

- [ ] **Step 4: Add a toast auto-dismiss effect**

Near the selection-clearing effect from Task 3a, add:

```js
  // Toast auto-dismisses after 4 seconds
  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(id);
  }, [toast]);
```

- [ ] **Step 5: Add the bulk-transition helper function**

After `toggleRow` from Task 3a Step 4, add:

```js
  async function bulkStatusTransition(nextStatus, validFromStatuses) {
    const actionLabel = nextStatus === 'approved' ? 'approve' : 'unapprove';
    setBulkAction(actionLabel);

    const selected = chargeSets.filter((cs) => selectedIds.has(cs.id));
    const eligible = selected.filter((cs) => validFromStatuses.includes(cs.status));
    const skipped = selected.length - eligible.length;
    let succeeded = 0;
    let failed = 0;

    for (const cs of eligible) {
      try {
        const res = await fetch(
          `/api/tenant/loads/${cs.order_id}/charge-sets/${cs.id}`,
          {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status: nextStatus }),
          }
        );
        if (!res.ok) throw new Error(await res.text());
        succeeded++;
      } catch (e) {
        failed++;
      }
    }

    setBulkAction(null);
    setSelectedIds(new Set());
    setLastClickedId(null);
    await fetchAR({ silent: true });

    const verb = nextStatus === 'approved' ? 'Approved' : 'Unapproved';
    const parts = [];
    if (succeeded > 0) parts.push(`${verb} ${succeeded}`);
    if (skipped > 0) parts.push(`skipped ${skipped} (ineligible status)`);
    if (failed > 0) parts.push(`${failed} failed`);

    const kind = failed > 0 && succeeded === 0 ? 'error' : 'success';
    setToast({ type: kind, message: parts.join(' · ') || 'Nothing to do' });
  }

  async function handleBulkApprove() {
    await bulkStatusTransition('approved', ['draft', 'rate_con_sent', 'unapproved']);
  }

  async function handleBulkUnapprove() {
    await bulkStatusTransition('unapproved', ['draft', 'rate_con_sent', 'approved']);
  }
```

- [ ] **Step 6: Add the CSV export handler**

After `handleBulkUnapprove`:

```js
  function handleExportCsv() {
    const selected = chargeSets.filter((cs) => selectedIds.has(cs.id));
    if (selected.length === 0) return;

    const rows = [
      ['Order #', 'Customer', 'Charge Set #', 'Status', 'Bill To', 'Total'],
      ...selected.map((cs) => [
        cs.order?.order_number || '',
        cs.order?.customer?.name || '',
        cs.charge_set_number || '',
        cs.status || '',
        cs.bill_to?.name || '',
        `$${((cs.total_cents || 0) / 100).toFixed(2)}`,
      ]),
    ];

    const escape = (v) => {
      const s = String(v ?? '');
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const csv = rows.map((row) => row.map(escape).join(',')).join('\n');

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ar-billing-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    setToast({ type: 'success', message: `Exported ${selected.length} charge set${selected.length !== 1 ? 's' : ''} to CSV` });
  }
```

Note the `cs.bill_to?.name` reference — if the AR list query doesn't join `bill_to`, this falls back to empty string cleanly. The CSV is still valid.

- [ ] **Step 7: Render the bulk action bar + toast**

Find the `return (` of the component (around line 81). Immediately inside the outer div, after the existing `{error && <Alert ... />}` line, add the toast block and the bulk action bar. Locate:

```jsx
  return (
    <div className="space-y-5">
      {error && <Alert type="error" message={error} onClose={() => setError(null)} />}
```

Replace with:

```jsx
  return (
    <div className="space-y-5">
      {error && <Alert type="error" message={error} onClose={() => setError(null)} />}
      {toast && (
        <Alert
          type={toast.type}
          message={toast.message}
          onClose={() => setToast(null)}
        />
      )}
      {selectedIds.size > 0 && (
        <div className="sticky top-0 z-10 flex items-center gap-3 bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-900 rounded-lg px-4 py-2">
          <div className="flex items-center gap-2 text-sm font-medium text-blue-700 dark:text-blue-300">
            <CheckSquare className="w-4 h-4" />
            {selectedIds.size} selected
          </div>
          <div className="h-4 w-px bg-blue-300 dark:bg-blue-800" />
          <Button
            size="sm"
            variant="secondary"
            onClick={handleBulkApprove}
            loading={bulkAction === 'approve'}
            disabled={bulkAction != null}
          >
            <Check className="w-3.5 h-3.5 inline -mt-0.5 mr-1" /> Approve
          </Button>
          <Button
            size="sm"
            variant="secondary"
            onClick={handleBulkUnapprove}
            loading={bulkAction === 'unapprove'}
            disabled={bulkAction != null}
          >
            <AlertCircle className="w-3.5 h-3.5 inline -mt-0.5 mr-1" /> Unapprove
          </Button>
          <Button
            size="sm"
            variant="secondary"
            onClick={handleExportCsv}
            disabled={bulkAction != null}
          >
            <Download className="w-3.5 h-3.5 inline -mt-0.5 mr-1" /> Export CSV
          </Button>
          <div className="flex-1" />
          <button
            onClick={() => {
              setSelectedIds(new Set());
              setLastClickedId(null);
            }}
            className="text-sm text-blue-600 dark:text-blue-400 hover:text-blue-700 flex items-center gap-1"
          >
            <X className="w-3.5 h-3.5" /> Clear
          </button>
        </div>
      )}
```

- [ ] **Step 8: Sanity-check via grep**

```bash
grep -n "bulkAction\|handleBulkApprove\|handleBulkUnapprove\|handleExportCsv\|bulkStatusTransition\|setToast" components/ar/BillingPipelineTab.js
```

Expected: at least 15 matches covering state declarations, effect, helper functions, and the JSX action bar.

Verify Button is imported:

```bash
grep -n "^import Button" components/ar/BillingPipelineTab.js
```

Expected: 1 match (unless already present — then 1 match still, no duplicate).

- [ ] **Step 9: Local sanity check — full workflow**

Test scenarios on `http://localhost:3000/ar`:

1. **Draft approval**: Select 2-3 draft charge sets → bulk action bar appears with "3 selected" → click Approve → spinner briefly on the Approve button → toast "Approved 3" shows for 4 seconds then dismisses → cards refresh → selected rows now show Approved badge.
2. **Mixed statuses**: Select 1 draft + 1 invoiced → click Approve → toast shows "Approved 1 · skipped 1 (ineligible status)".
3. **Unapprove on approved**: Select an approved charge set (from step 1) → click Unapprove → toast shows "Unapproved 1".
4. **All invalid**: Select only invoiced charge sets → click Approve → toast shows "skipped N (ineligible status)" with no "Approved" segment.
5. **Export CSV**: Select any 3 rows → click Export CSV → browser downloads `ar-billing-2026-04-18.csv` → open in Excel/Numbers → 6 columns (Order #, Customer, Charge Set #, Status, Bill To, Total), 3 rows + header → values correct.
6. **Clear button**: Select rows → click × Clear in the action bar → selection clears; action bar disappears.
7. **Action in-flight disables others**: While Approve is running, Unapprove and Export should be disabled (`disabled={bulkAction != null}`).
8. **Regression (yesterday's feature)**: Open a load overlay by clicking a row (not the checkbox), make a change, close overlay → cards refresh silently (the existing onClose-refetch still fires).

- [ ] **Step 10: Verify branch before committing**

```bash
git branch --show-current
```

- [ ] **Step 11: Commit**

```bash
git add components/ar/BillingPipelineTab.js
git commit -m "$(cat <<'EOF'
feat(ar-pipeline): bulk Approve/Unapprove/Export CSV actions

Adds a sticky action bar above the AR Billing Pipeline table that
appears when one or more charge sets are selected. Provides three
bulk actions:

- Approve — transitions draft/rate_con_sent/unapproved to approved
- Unapprove — transitions draft/rate_con_sent/approved to unapproved
- Export CSV — client-side download with 6 columns, proper escaping

Smart-skip on mixed selections: rows with ineligible statuses are
skipped and reported in the summary toast. Status transitions iterate
the existing per-row PUT endpoint sequentially — no new API surface.

Buttons disable while a bulk action is in flight. After completion
the selection clears and fetchAR({ silent: true }) refreshes cards
with updated counts and sums without flashing.

Does NOT include bulk Approve & Invoice or bulk Send Rate Con —
those require an email popup modal + PDF templates, designed as
sub-project 2a (see docs/superpowers/scratch/2a-*).

Spec: docs/superpowers/specs/2026-04-18-ar-ui-polish-design.md

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Push + regression smoke

**Files:** (none)

**Context for the implementer:** All four task commits are now on local `main`. Push to origin, run a final regression smoke across yesterday's shipped features to make sure nothing we touched regressed.

- [ ] **Step 1: Verify the last 4 commits are on main**

```bash
git log --oneline -5
```

Expected: top 4 commits (most recent first) are the four AR UI polish commits:
- `feat(ar-pipeline): bulk Approve/Unapprove/Export CSV actions`
- `feat(ar-pipeline): add checkbox selection infrastructure`
- `feat(ar-pipeline): show count + sum on pipeline cards`
- `feat(load-billing): add Bill To dropdown to charge set cards`

- [ ] **Step 2: Push to origin**

```bash
git push origin main
```

Expected: 4 commits pushed, no rejections. If a remote conflict surfaces from a parallel Cowork session pushing something else, rebase on origin/main and retry — none of these files should conflict with unrelated feature work.

- [ ] **Step 3: Regression smoke — yesterday's Tier 1 live refresh**

Visit `/ar`, open any charge set via row click (not checkbox), make a status change inside the overlay, close. Pipeline cards should update live without a full-page reload.

Also: visit `/dispatcher`, open a load, make a status change, close. Board should refresh live.

Expected: both still work. (Touching `BillingPipelineTab.js` extensively — verify we didn't accidentally disable the `fetchAR({ silent: true })` call path.)

- [ ] **Step 4: Regression smoke — yesterday's AR hardening**

Create a new charge set on a load → Approve it → Approve & Invoice. Expected: `invoices` row created (not ghost). Verify with the audit script:

```bash
node scripts/ar-flow-audit.js
```

Expected: invoice count increased by 1. Status says "AR pipeline appears exercised end-to-end."

- [ ] **Step 5: Mark the feature complete**

If all regression checks pass, the AR UI polish batch is shipped.

If anything regressed, reopen the relevant task, fix, re-commit, re-push, re-verify.

---

## Self-review (plan author)

### Spec coverage

| Spec section | Implementing task |
|---|---|
| §Goal | Tasks 1-3 combined |
| §Non-goals (11 items deferred) | Documented in Task 3b commit message + Task 4 final check |
| §Context — BillingTab.js current state | Task 1 context block |
| §Context — BillingPipelineTab.js current state | Task 2 context block |
| §Context — OrgPicker availability | Task 1 Step 4 (direct usage) |
| §Approach — Task 1 Bill To | Task 1 (8 steps) |
| §Approach — Task 2 Card sums | Task 2 (10 steps) |
| §Approach — Task 3a Checkbox infra | Task 3a (10 steps) |
| §Approach — Task 3b Bulk action bar | Task 3b (11 steps) |
| §File-level changes — saveBillTo | Task 1 Step 2 (exact code) |
| §File-level changes — counts shape | Task 2 Steps 2-3 (exact code) |
| §File-level changes — PipelineCard update | Task 2 Steps 4-5 (exact code) |
| §File-level changes — selection state | Task 3a Steps 2-4 (exact code) |
| §File-level changes — action bar + handlers | Task 3b Steps 5-7 (exact code) |
| §Permission mapping (no change) | Noted in Task 3b Step 5 |
| §Edge cases (15 total) | Covered by smart-skip logic in Task 3b Step 5 + selection-clear effect in Task 3a Step 3 |
| §Verification gates | Task 1 Step 6, Task 2 Step 8, Task 3a Step 8, Task 3b Step 9, Task 4 Steps 3-4 |
| §Branch discipline | Every task starts with `git branch --show-current` check |
| §Risks | Low-risk, all addressed by optimistic-free patterns + refetch-based consistency |

No spec gaps detected.

### Placeholder scan

Scanned plan text — no "TBD", "TODO", "similar to Task N", "implement later", "add appropriate error handling". Every code step has concrete before/after blocks. Every verification step has exact commands + expected output.

One intentional ambiguity: Task 1 Step 4 says "Insert a new row BEFORE `{/* Header */}` and its div" — the implementer locates the exact line by reading the file. The code block is complete; only the insert position requires reading the file for anchor.

### Type consistency

- `selectedIds: Set<string>` used uniformly across Task 3a and Task 3b.
- `bulkAction: 'approve' | 'unapprove' | null` used in Task 3b Step 3 and referenced in Task 3b Step 7 button JSX.
- `toast: { type: string, message: string } | null` matches Alert component's prop shape.
- `counts.<bucket>.count` / `counts.<bucket>.total_cents` consistent between backend (Task 2 Steps 2-3) and UI (Task 2 Step 5).
- Helper name `bulkStatusTransition` used in Task 3b Step 5 definition and Steps 5-6 callers.
- Function signatures line up — `toggleRow(csId, event)` defined in Task 3a Step 4, called from row `<input onChange={(e) => toggleRow(cs.id, e)}>` in Step 6 with correct argument order.

No type/naming inconsistencies detected.
