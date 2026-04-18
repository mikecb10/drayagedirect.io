# AR UI Polish — Design Spec

**Date:** 2026-04-18
**Status:** Approved — ready for implementation plan
**Scope:** Three targeted AR UX improvements (Bill To visibility/edit, pipeline card sums, bulk actions on pipeline rows)

## Goal

Ship three focused polish items on the AR module that surface information dispatchers need in-context and reduce click cost for common bulk workflows. Covers the first of four planned AR sub-projects; email-sending behavior and filter/saved-tab features are intentionally deferred.

## Non-goals

- **No email-sending behavior** — "Approve & Invoice" and "Send Rate Con" keep their current behavior unchanged this pass. The email popup + delivery tracking is sub-project 2a (design notes stashed at `docs/superpowers/scratch/2a-bulk-invoice-email-design-notes.md`).
- **No filter sidebar** — sub-project 2b.
- **No saved filter tabs** — sub-project 3.
- **No dispatcher adoption of the filter/tabs pattern** — sub-project 4.
- **No consolidated invoicing** (multiple charge sets → one invoice). Bulk "Approve & Invoice" is intentionally excluded from this pass's bulk action set.
- **No backdated invoice button with date picker** — also deferred to 2a.
- **No new migrations.** All schema columns required already exist.
- **No change to `bill_to_customer_id` defaulting.** New charge sets still default to `load.customer_id` on creation (`BillingTab.js:98`, unchanged).

## Context (current state)

### Load Billing tab (`components/loads/tabs/BillingTab.js`)

Charge set cards today render: `CS_ORD_XXXXX · [STATUS badge] · Total $X.XX · [trash]`. The card has no UI to view or change `bill_to_customer_id`. New charge sets get `bill_to_customer_id = load.customer_id` on POST, but there is no way to alter it post-create. Legacy charge sets may have `bill_to_customer_id = NULL` and fall back to `order.customer_id` via the invoice-creation endpoint (`pages/api/tenant/ar/invoices/index.js:103`).

### AR Billing Pipeline tab (`components/ar/BillingPipelineTab.js`)

Pipeline cards render `[icon] [count] / [LABEL]` with no dollar aggregation. Data comes from `/api/tenant/ar` GET, whose `counts` response is a map of `{ status: count }`. Rows in the table below the cards are click-to-open-overlay with no selection affordance and no bulk actions.

### OrgPicker availability

`OrgPicker` is an existing component used by `NewLoadModal` for customer selection. It supports a `customer-type` filter, placeholder text, and an `excludeIds` prop. Reusable without modification.

## Approach

Three tasks, each shippable on its own, one spec, one plan. Bulk actions split into two sub-tasks (selection infra + action bar) for easier review per Approach 3.

```
Task 1: Load Billing tab — Bill To dropdown
Task 2: /ar pipeline cards — count + sum
Task 3a: /ar pipeline table — checkbox selection infra
Task 3b: /ar pipeline bulk action bar + handlers
```

## File-level changes

### `components/loads/tabs/BillingTab.js` (Task 1)

Adds a Bill To row above each charge set card's header. Inside the existing charge set loop, immediately before the status + total header row:

```jsx
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
```

**OrgPicker contract notes (verified against `components/ui/OrgPicker.js` + existing callers):**
- Prop is `type`, not `customerType`
- `onChange` receives the full org object (or `null` on clear) — consumer must extract `.id`
- `valueLabel` is required to render the current selection on first paint (component's internal `selectedLabel` initializes from `valueLabel || ''`)
- Built-in `label` prop (rendered inside the picker) matches the pattern used by `LoadInfoTab`, `PaymentsTab`, `ApplyPaymentsTab`, `CreditMemosTab`, and ~30 other callers; preferred over a sibling `<label>` element

New helper function `saveBillTo(csId, newId)` in the component:

```js
async function saveBillTo(csId, newId) {
  // Optimistic: update local state immediately
  setChargeSets((prev) =>
    prev.map((cs) => (cs.id === csId ? { ...cs, bill_to_customer_id: newId } : cs))
  );
  try {
    const res = await fetch(
      `/api/tenant/loads/${loadId}/charge-sets/${csId}`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bill_to_customer_id: newId }),
      }
    );
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || 'Failed to update Bill To');
    }
  } catch (e) {
    // Revert on error
    await fetchChargeSets();
    onError(e.message);
  }
}
```

No API change needed — `pages/api/tenant/loads/[id]/charge-sets/[csId].js:54-55` already accepts `bill_to_customer_id` in the PUT body.

### `pages/api/tenant/ar/index.js` (Task 2 — backend)

Current implementation returns `counts` as a shallow count map. Change the query to also aggregate `SUM(total_cents)` per bucket, and change the response shape to `{ count, total_cents }` per bucket.

Response shape (before):
```json
{
  "charge_sets": [...],
  "counts": { "draft": 5, "approved": 2, ... }
}
```

Response shape (after):
```json
{
  "charge_sets": [...],
  "counts": {
    "draft": { "count": 5, "total_cents": 270000 },
    "approved": { "count": 2, "total_cents": 145000 },
    "uncompleted_loads": { "count": 8, "total_cents": 421500 },
    ...
  }
}
```

Query change:

```sql
-- Per-status aggregation
SELECT status, COUNT(*) AS count, COALESCE(SUM(total_cents), 0) AS total_cents
FROM order_charge_sets
WHERE tenant_id = $1 AND deleted_at IS NULL
GROUP BY status;
```

For `uncompleted_loads` and `completed_loads` (which filter by load status, not charge set status), aggregate across charge sets belonging to matching loads:

```sql
SELECT
  CASE WHEN o.status IN ('completed') THEN 'completed_loads' ELSE 'uncompleted_loads' END AS bucket,
  COUNT(*) AS count,
  COALESCE(SUM(cs.total_cents), 0) AS total_cents
FROM order_charge_sets cs
JOIN orders o ON o.id = cs.order_id
WHERE cs.tenant_id = $1 AND cs.deleted_at IS NULL
GROUP BY bucket;
```

Implementer to pick the exact pattern (single combined CTE or two separate queries); either is fine.

### `components/ar/BillingPipelineTab.js` (Task 2 — UI + Task 3)

**Task 2 changes:**
- Update `PipelineCard` signature to take `count` and `total_cents` separately.
- Update call sites to pass `counts[key].count` and `counts[key].total_cents`.
- Add a third line to the card showing `formatCents(total_cents || 0)` in `text-xs font-medium text-gray-600 dark:text-slate-300 mt-1`.

Card component shape (after):

```jsx
function PipelineCard({ label, count, total_cents, icon: Icon, color, filterKey, active }) {
  const c = colorMap[color] || colorMap.gray;
  return (
    <button type="button" onClick={() => setActiveFilter(active ? null : filterKey)}
      className={`rounded-xl border p-3 text-left transition-all flex-1 min-w-[120px] ${active ? c.activeBg + ' ' + c.border : c.bg + ' ' + c.border + ' hover:shadow-sm'}`}>
      <div className="flex items-center gap-2 mb-1">
        <div className={`w-6 h-6 rounded-lg flex items-center justify-center ${c.iconBg}`}>
          <Icon className="w-3.5 h-3.5" />
        </div>
        <span className={`text-lg font-bold ${c.text}`}>{count}</span>
      </div>
      <div className="text-[10px] font-semibold text-gray-500 dark:text-slate-400 uppercase tracking-wide">
        {label}
      </div>
      <div className="text-xs font-medium text-gray-600 dark:text-slate-300 mt-1">
        {formatCents(total_cents || 0)}
      </div>
    </button>
  );
}
```

Empty bucket shows `$0.00` (from the `total_cents || 0` fallback → `formatCents` returns `$0.00`).

**Task 3a changes (selection infra):**

Add state to the component:

```js
const [selectedIds, setSelectedIds] = useState(() => new Set());
const [lastClickedId, setLastClickedId] = useState(null);
```

Clear the selection when filter/search/data changes:

```js
useEffect(() => {
  setSelectedIds(new Set());
  setLastClickedId(null);
}, [activeFilter, search]);
```

**Table structure changes** (inside `<tbody>`):
- Add a new leftmost `<th>` in the header for the master checkbox.
- Add a new leftmost `<td>` in each row for the row checkbox.
- Each row checkbox `onClick` uses `stopPropagation()` so clicking the checkbox doesn't bubble to the row click handler.

Master checkbox logic:

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
```

Row checkbox logic (shift-click aware):

```js
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

Selected rows get a subtle blue background: `bg-blue-50 dark:bg-blue-950/40`.

**Task 3b changes (bulk action bar):**

Above the table and below the search row, render when `selectedIds.size > 0`:

```jsx
{selectedIds.size > 0 && (
  <div className="sticky top-0 z-10 flex items-center gap-3 bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-900 rounded-lg px-4 py-2 mb-3">
    <div className="flex items-center gap-2 text-sm font-medium text-blue-700 dark:text-blue-300">
      <CheckSquare className="w-4 h-4" />
      {selectedIds.size} selected
    </div>
    <div className="h-4 w-px bg-blue-300 dark:bg-blue-800" />
    <Button size="sm" variant="secondary" onClick={handleBulkApprove} loading={bulkAction === 'approve'} disabled={bulkAction != null}>
      <Check className="w-3.5 h-3.5 inline -mt-0.5 mr-1" /> Approve
    </Button>
    <Button size="sm" variant="secondary" onClick={handleBulkUnapprove} loading={bulkAction === 'unapprove'} disabled={bulkAction != null}>
      <AlertCircle className="w-3.5 h-3.5 inline -mt-0.5 mr-1" /> Unapprove
    </Button>
    <Button size="sm" variant="secondary" onClick={handleExportCsv} disabled={bulkAction != null}>
      <Download className="w-3.5 h-3.5 inline -mt-0.5 mr-1" /> Export CSV
    </Button>
    <div className="flex-1" />
    <button onClick={() => setSelectedIds(new Set())}
      className="text-sm text-blue-600 dark:text-blue-400 hover:text-blue-700 flex items-center gap-1">
      <X className="w-3.5 h-3.5" /> Clear
    </button>
  </div>
)}
```

Handler signature:

```js
async function handleBulkApprove() {
  await bulkStatusTransition('approved', ['draft', 'rate_con_sent', 'unapproved']);
}

async function handleBulkUnapprove() {
  await bulkStatusTransition('unapproved', ['draft', 'rate_con_sent', 'approved']);
}

async function bulkStatusTransition(nextStatus, validFromStatuses) {
  setBulkAction(nextStatus === 'approved' ? 'approve' : 'unapprove');
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
  await fetchAR({ silent: true });

  const parts = [];
  if (succeeded > 0) parts.push(`${nextStatus === 'approved' ? 'Approved' : 'Unapproved'} ${succeeded}`);
  if (skipped > 0) parts.push(`skipped ${skipped} (ineligible status)`);
  if (failed > 0) parts.push(`${failed} failed`);
  setToast(parts.join(' · '));
}
```

CSV export:

```js
function handleExportCsv() {
  const selected = chargeSets.filter((cs) => selectedIds.has(cs.id));
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
  const csv = rows
    .map((row) => row.map((v) => (String(v).includes(',') ? `"${String(v).replace(/"/g, '""')}"` : String(v))).join(','))
    .join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `ar-billing-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}
```

Toast state + component (reuse the existing Alert component with `type="success"`; auto-dismiss after 4s):

```js
const [toast, setToast] = useState(null);
useEffect(() => {
  if (!toast) return;
  const id = setTimeout(() => setToast(null), 4000);
  return () => clearTimeout(id);
}, [toast]);

// In JSX:
{toast && <Alert type="success" message={toast} onClose={() => setToast(null)} />}
```

## Permission mapping

No permission changes. Existing permissions apply:

- `/ar/*` endpoints require `ACCOUNTS_RECEIVABLE` or `ALL`
- `/loads/[id]/charge-sets/[csId]` PUT accepts `ORDER_ENTRY`, `ACCOUNTS_RECEIVABLE`, or `ALL`

Bulk actions reuse the same per-row PUT, so permissions are enforced per-call (no new permission surface). A user without the permission would see every row fail — the existing endpoint returns 403 which gets counted as failed in the summary toast.

## Edge cases

| # | Case | Handling |
|---|---|---|
| 1 | Legacy charge set with `bill_to_customer_id = NULL` | OrgPicker shows placeholder; dispatcher can pick a customer |
| 2 | User saves Bill To but the PUT fails | Optimistic local update reverts via `fetchChargeSets()`; inline error message surfaces the real API error |
| 3 | Empty pipeline bucket (0 count) | Card still renders; count shows `0`; sum shows `$0.00` |
| 4 | Mixed-status bulk action | Eligible rows transition; ineligible rows counted as "skipped"; final toast reports both |
| 5 | All bulk rows fail | Toast shows `X failed`; user can retry |
| 6 | Bulk action while another is in-flight | Buttons disabled via `bulkAction != null` guard |
| 7 | User navigates away mid-bulk | Sequential loop continues in background; no transaction rollback; charge sets may be in mixed states (acceptable for this pass — a future improvement is a proper batch endpoint) |
| 8 | Shift-click range spans multiple visible pages | Out of scope — list has no pagination today. Future pagination would need to re-anchor. |
| 9 | Filter changes during selection | `selectedIds` cleared via `useEffect` |
| 10 | Export CSV with 0 selected | Button disabled (hidden, since action bar only shows when `selectedIds.size > 0`) |
| 11 | CSV with a customer name containing `"` | Standard CSV escaping: wrap in quotes, double the quotes |
| 12 | Auto-refetch on overlay close (yesterday's feature) | Still fires. No regression. |
| 13 | `bill_to_customer_id` set on a newly-created charge set | Already happens today; no change |
| 14 | User bulk-approves, then immediately clicks a row | Silent refetch completes before click, so row state is fresh |
| 15 | Browser tab inactive during bulk | Still completes (foreground tab is not required for fetch). Toast shows when tab becomes active. |

## Verification gates

No automated tests (codebase pattern is manual Cowork smoke + per-change verification script where relevant).

### Gate 1 — Bill To (local browser)

- Open a load's Billing tab → see Bill To row above charge set card.
- Row shows current customer if set; placeholder if NULL.
- Pick a new customer from the OrgPicker → `/api/tenant/loads/[id]/charge-sets/[csId]` PUT fires → row shows new customer.
- Reload page → value persisted.
- Trigger a PUT failure (e.g., network throttle in devtools) → inline error appears; local state reverts to previous.

### Gate 2 — Pipeline card sums (local browser)

- Visit `/ar` → cards show a third line with `$X.XX`.
- Compare each card's sum to a DB query: `SELECT status, SUM(total_cents)/100 FROM order_charge_sets WHERE tenant_id = X GROUP BY status` — values match within rounding.
- Uncompleted/Completed Loads buckets match `SELECT CASE WHEN o.status = 'completed' THEN 'completed' ELSE 'uncompleted' END, SUM(cs.total_cents)/100 FROM order_charge_sets cs JOIN orders o ON o.id = cs.order_id WHERE cs.tenant_id = X GROUP BY 1`.
- Zero-count buckets render `$0.00`.

### Gate 3 — Bulk actions (local browser)

- Select 3 draft charge sets via checkboxes → bulk action bar appears above table.
- Click Approve → toast shows "Approved 3"; cards refresh live (silent fetch); selected rows now show `APPROVED` badge.
- Select mixed (2 draft + 1 invoiced) → click Approve → toast: "Approved 2 · skipped 1 (ineligible status)".
- Master checkbox behavior: click with some selected → clears; click with none selected → selects all visible; click with all selected → clears.
- Shift-click: click row 1, shift-click row 5 → rows 1-5 all selected.
- Click a non-checkbox cell on a row → overlay opens (no selection change).
- Close overlay → silent refetch fires (yesterday's feature) → cards reflect any in-overlay changes.
- Click Export CSV → `ar-billing-2026-04-18.csv` downloads; opens in Excel/Numbers with correct columns and quoted values.
- Test CSV escaping: create a customer named `Acme, Inc.` → include in selection → download CSV → open → customer cell shows `Acme, Inc.` (single cell, properly quoted).

### Gate 4 — Regression smoke

- Yesterday's overlay-close-refetch still fires on both `/ar` and `/dispatcher`.
- AR hardening pass behavior (from yesterday) still works: "Approve & Invoice" on load Billing tab creates real `invoices` row + junction (not ghost).
- Previous Send Rate Con / Unapprove / Approve buttons on the load Billing tab still behave the same (no regression — this spec does not touch `updateStatus`).

## Branch discipline

Main workspace at `C:\Users\bento\app-drayagedirect`. Before each commit: `git branch --show-current` must return `main`. The parallel Advanced Route Cowork session has intermittently swapped branches mid-session. Recovery pattern: `git branch <backup> HEAD; git switch main; git cherry-pick <commits>; git push main` (documented in `session_2026_04_17_handoff.md`).

## Risks

**Very low.** All changes are UI-layer plus one API response-shape extension. No migrations, no new endpoints, no new data model.

Specific failure modes:

- **API response shape change** breaks any other consumer of `/api/tenant/ar` that reads `counts`. Mitigation: grep for `counts\[` and `counts\.` in the codebase before committing — only `BillingPipelineTab.js` currently consumes this.
- **Optimistic Bill To update reverts incorrectly** on transient errors. Mitigation: revert via full refetch (`fetchChargeSets`), not via in-memory rollback, so state is guaranteed consistent with server.
- **Bulk action creates N API calls** instead of one batch. Mitigation: accepted — 10-50 per-row calls is fast enough in practice; proper batch endpoint is a future optimization.
- **Shift-click UX bug** if `visibleIds` order changes during selection. Mitigation: selection cleared on filter/search/data-change via `useEffect`.

## Out of scope (future work, not part of this spec)

- Email-sending bulk actions (`Approve & Invoice`, `Send Rate Con`) — sub-project 2a
- Filter sidebar with 20+ filter fields — sub-project 2b
- Saved filter tabs (generic `+` tabs primitive) — sub-project 3
- Dispatcher board adoption of filter + saved tabs — sub-project 4
- Consolidated invoicing (multiple charge sets → one invoice) — future
- Backdated "Invoice" button with date picker — sub-project 2a
- Proper batch-transition endpoint (`/api/tenant/ar/bulk-transition`) — future optimization
- Pagination for long pipeline lists — future

## Success criteria

- All 15 edge cases handled as listed.
- All 4 verification gates pass on local dev.
- Net file count: ~3 files changed, ~150-250 lines added, 0 migrations, 0 new dependencies.
- Implementation fits in one commit or two (Bill To + Card sums could be one commit; Bulk action infra + handlers could be second; consolidation at implementer discretion).
