# AR Filter Bar v2 Phase A — Cross-Section Tabs + Customer Combobox

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert v1's per-section custom tabs into a single global tabs row at the AR module parent, swap the customer multi-select checkbox list for a typeahead combobox with chips, and leave hooks in place for Phase B (new filter dimensions, exclude toggles) and Phase C (computed filters).

**Architecture:** Filter state + `useArUserPreferences` hook lift up to `pages/ar/index.js`. A new `components/ar/ArFiltersBar.js` renders below `SubTabs` and holds the custom-tabs row + "Filters" button + "+ Save as tab" UX. `BillingPipelineTab` and `InvoicesTab` become pure filter *consumers* — they accept `filters` as a prop and drop their local state + their own FilterSidebar/CustomTabsRow renders. Migration 087 wipes existing v1 tabs (user-approved) so no stale per-section tabs carry forward. `CustomTabsRow.js` is deleted. Other AR sub-tabs (Apply Payments, Payments, Credits, Aging) are intentionally NOT wired in Phase A — they'll join in Phase B when their endpoints learn the array-filter params.

**Tech Stack:** Next.js pages/api, React (props-drilling over context — only two consumers in Phase A, YAGNI on context), Supabase (migration 087), Tailwind v4 with mandatory `dark:` variants, `lucide-react` icons.

---

## File Structure

**Database:**
- Create: `supabase/migrations/087_ar_prefs_v2_reset.sql`

**Backend:**
- Modify: `pages/api/tenant/ar/user-preferences.js` (drop `section` from normalizeTab + constants)

**Frontend:**
- Create: `components/ar/ArFiltersBar.js`
- Modify: `components/ar/FilterSidebar.js` (replace customer checkbox section with typeahead combobox)
- Modify: `components/ar/BillingPipelineTab.js` (accept filters prop, drop local state + CustomTabsRow + FilterSidebar)
- Modify: `components/ar/InvoicesTab.js` (same as Billing)
- Modify: `pages/ar/index.js` (lift state, render ArFiltersBar + FilterSidebar once at parent)
- Delete: `components/ar/CustomTabsRow.js` (merged into ArFiltersBar)

**Tests:**
- None added in Phase A — the param-parser + shape tests from v1 still cover the filter-sanitization layer. UI changes get live-gate verification.

---

## Conventions

1. **Migration template** (non-negotiable): `BEGIN;` … `NOTIFY pgrst, 'reload schema';` … `COMMIT;`. Latest applied is 086, next is 087.
2. **Dark mode mandatory**: every `bg-white`/`bg-gray-*`/`text-gray-*`/`border-gray-*` needs a `dark:` partner.
3. **Working dir**: `C:\Users\bento\app-drayagedirect`. Branch: `main`.
4. **Don't touch the other AR tabs** (ApplyPaymentsTab, PaymentsTab, CreditMemosTab, AgingTab, InvoicesTab beyond the filter-consumer conversion). Phase B will wire them.
5. **Tab shape (v2)**: `{ id, name, filters, created_at }` — NO `section` key.

---

## Task 1: Migration 087 — reset existing custom_tabs

**Files:**
- Create: `supabase/migrations/087_ar_prefs_v2_reset.sql`

- [ ] **Step 1: Write the migration**

```sql
-- ============================================================
-- Migration 087: user_ar_preferences — v2 custom_tabs reset
-- ============================================================
-- Phase A of the AR filter-bar v2 redesign drops the per-section
-- `section` key from the custom_tabs JSONB shape (tabs become
-- globally scoped — applied across all AR sub-tabs). Existing rows
-- were created during v1 gate-walkthrough testing and carry the
-- stale shape; the user has approved wiping them.
--
-- New tab shape (v2):
--   { id, name, filters, created_at }
--
-- The custom_tabs column stays JSONB (no DDL change); this migration
-- is a data reset only.
-- ============================================================

BEGIN;

UPDATE user_ar_preferences
SET custom_tabs = '[]'::jsonb
WHERE custom_tabs IS NOT NULL AND custom_tabs != '[]'::jsonb;

NOTIFY pgrst, 'reload schema';

COMMIT;
```

- [ ] **Step 2: Apply migration in Supabase SQL editor**

Paste the file into the Supabase SQL editor and run.

- [ ] **Step 3: Verify**

```sql
SELECT tenant_id, user_id, custom_tabs
FROM user_ar_preferences;
```

Expected: every row's `custom_tabs` is `[]` (empty JSONB array).

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/087_ar_prefs_v2_reset.sql
git commit -m "feat(ar): migration 087 — reset custom_tabs for v2 shape"
```

---

## Task 2: Update user-preferences endpoint — drop `section`

**Files:**
- Modify: `pages/api/tenant/ar/user-preferences.js`

The v2 shape is `{ id, name, filters, created_at }` (no `section`). Update `normalizeTab` and the cap check accordingly.

- [ ] **Step 1: Replace the entire file with the v2 shape**

```javascript
import {
  requireTenantUser,
  requirePermission,
  getServiceClient,
} from '../../../../lib/tenant-api';
import { PERMISSIONS } from '../../../../lib/permissions';
import { sanitizeFilterSet } from '../../../../lib/ar-filter-params';
import { randomUUID } from 'crypto';

const AR_PERMS = [
  PERMISSIONS.ACCOUNTS_RECEIVABLE,
  PERMISSIONS.ALL,
];

const MAX_TABS_TOTAL = 40;
const MAX_TAB_NAME_LEN = 60;

/**
 * Shape-check + normalize a single tab coming from the client.
 * Returns a canonical tab object (with id + created_at assigned if new),
 * or throws an Error describing the first validation failure.
 *
 * v2 shape: { id, name, filters, created_at }. No `section` — tabs
 * apply globally across AR sub-tabs.
 */
function normalizeTab(raw) {
  if (!raw || typeof raw !== 'object') throw new Error('tab must be an object');
  const name = typeof raw.name === 'string' ? raw.name.trim() : '';
  if (!name) throw new Error('tab.name is required');
  if (name.length > MAX_TAB_NAME_LEN) throw new Error(`tab.name exceeds ${MAX_TAB_NAME_LEN} chars`);
  const filters = sanitizeFilterSet(raw.filters);
  return {
    id: typeof raw.id === 'string' && raw.id.length > 0 ? raw.id : randomUUID(),
    name,
    filters,
    created_at: typeof raw.created_at === 'string' ? raw.created_at : new Date().toISOString(),
  };
}

export default async function handler(req, res) {
  const ctx = await requireTenantUser(req, res);
  if (!ctx) return;
  if (!requirePermission(ctx, AR_PERMS, res)) return;

  const svc = getServiceClient();

  if (req.method === 'GET') {
    const { data, error } = await svc
      .from('user_ar_preferences')
      .select('custom_tabs')
      .eq('tenant_id', ctx.tenantId)
      .eq('user_id', ctx.userId)
      .limit(1);

    if (error) {
      console.error('[ar/user-preferences] select failed:', error.message);
      return res.status(500).json({ error: 'query_failed' });
    }
    const row = data?.[0];
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({ custom_tabs: row?.custom_tabs ?? [] });
  }

  if (req.method === 'PUT') {
    const { custom_tabs } = req.body || {};
    if (!Array.isArray(custom_tabs)) {
      return res.status(400).json({ error: 'custom_tabs must be an array' });
    }

    let normalized;
    try {
      normalized = custom_tabs.map(normalizeTab);
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }

    if (normalized.length > MAX_TABS_TOTAL) {
      return res.status(400).json({ error: `max ${MAX_TABS_TOTAL} tabs` });
    }

    const { error } = await svc
      .from('user_ar_preferences')
      .upsert(
        {
          tenant_id: ctx.tenantId,
          user_id: ctx.userId,
          custom_tabs: normalized,
        },
        { onConflict: 'tenant_id,user_id' }
      );

    if (error) {
      console.error('[ar/user-preferences] upsert failed:', error.message);
      return res.status(500).json({ error: 'save_failed' });
    }

    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({ custom_tabs: normalized });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
```

- [ ] **Step 2: Commit**

```bash
git add pages/api/tenant/ar/user-preferences.js
git commit -m "feat(ar): user-preferences v2 shape — drop per-section key"
```

---

## Task 3: Create `ArFiltersBar` component

**Files:**
- Create: `components/ar/ArFiltersBar.js`

Replaces `CustomTabsRow` with a section-agnostic variant. No `section` prop. Shows "Filters" button + "All" tab + custom tabs + "+ Save as tab" / inline name input.

- [ ] **Step 1: Write the component**

```javascript
import React, { useState } from 'react';
import { Plus, X, Filter } from 'lucide-react';

/**
 * Global AR custom-tabs row. Renders once at the AR module parent
 * (pages/ar/index.js) and applies its filter selection across all
 * AR sub-tabs (Billing, Invoices, Apply Payments, etc.) that consume
 * the shared `filters` state.
 *
 * Props:
 *   customTabs       - full array from useArUserPreferences
 *   activeTabId      - currently-active tab id, or null for "All"
 *   currentFilters   - live filter set (drives Save-as-tab visibility)
 *   onSelectTab(id)  - id or null
 *   onSaveTab(tab)   - tab = { name, filters } — id + created_at filled server-side
 *   onDeleteTab(id)
 *   onOpenFilters    - opens the FilterSidebar
 */
export default function ArFiltersBar({
  customTabs,
  activeTabId,
  currentFilters,
  onSelectTab,
  onSaveTab,
  onDeleteTab,
  onOpenFilters,
}) {
  const [saving, setSaving] = useState(false);
  const [newName, setNewName] = useState('');

  const filtersAreEmpty =
    !currentFilters ||
    ((currentFilters.customer_ids?.length ?? 0) === 0 &&
     (currentFilters.branch_ids?.length ?? 0) === 0 &&
     !currentFilters.from &&
     !currentFilters.to);

  const matchesExistingTab = customTabs.some((t) => filtersMatch(t.filters, currentFilters));
  const canSave = !filtersAreEmpty && !matchesExistingTab;

  const handleSave = () => {
    const name = newName.trim();
    if (!name) return;
    onSaveTab({ name, filters: currentFilters });
    setNewName('');
    setSaving(false);
  };

  return (
    <div className="flex items-center gap-2 flex-wrap pb-2 border-b border-gray-200 dark:border-slate-800">
      <button
        onClick={onOpenFilters}
        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-semibold text-gray-600 dark:text-slate-400 hover:bg-gray-100 dark:hover:bg-slate-800 border border-gray-200 dark:border-slate-700"
      >
        <Filter className="w-3.5 h-3.5" /> Filters
      </button>

      <TabButton
        label="All"
        active={activeTabId == null}
        onClick={() => onSelectTab(null)}
      />

      {customTabs.map((t) => (
        <TabButton
          key={t.id}
          label={t.name}
          active={activeTabId === t.id}
          onClick={() => onSelectTab(t.id)}
          onDelete={() => {
            if (window.confirm(`Delete saved tab "${t.name}"?`)) onDeleteTab(t.id);
          }}
        />
      ))}

      {canSave && !saving && (
        <button
          onClick={() => setSaving(true)}
          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-semibold text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-950/40 border border-blue-200 dark:border-blue-900"
        >
          <Plus className="w-3.5 h-3.5" /> Save as tab
        </button>
      )}

      {canSave && saving && (
        <div className="inline-flex items-center gap-1">
          <input
            type="text"
            autoFocus
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleSave();
              if (e.key === 'Escape') { setSaving(false); setNewName(''); }
            }}
            placeholder="Tab name"
            className="px-2 py-1 text-xs border border-gray-300 dark:border-slate-600 rounded-md bg-white dark:bg-slate-800 text-gray-900 dark:text-slate-100 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
          <button
            onClick={handleSave}
            disabled={!newName.trim()}
            className="px-2 py-1 rounded-md text-xs font-semibold bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
          >
            Save
          </button>
          <button
            onClick={() => { setSaving(false); setNewName(''); }}
            className="px-2 py-1 rounded-md text-xs font-semibold text-gray-600 dark:text-slate-400 hover:bg-gray-100 dark:hover:bg-slate-800"
          >
            Cancel
          </button>
        </div>
      )}
    </div>
  );
}

function TabButton({ label, active, onClick, onDelete }) {
  return (
    <div className="group inline-flex items-center">
      <button
        onClick={onClick}
        className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-semibold ${
          active
            ? 'bg-blue-600 text-white'
            : 'bg-gray-100 text-gray-700 dark:bg-slate-800 dark:text-slate-300 hover:bg-gray-200 dark:hover:bg-slate-700'
        }`}
      >
        {label}
      </button>
      {onDelete && (
        <button
          onClick={onDelete}
          aria-label={`Delete tab ${label}`}
          className="ml-0.5 p-0.5 rounded opacity-0 group-hover:opacity-100 text-gray-400 dark:text-slate-500 hover:text-red-600 dark:hover:text-red-400"
        >
          <X className="w-3 h-3" />
        </button>
      )}
    </div>
  );
}

function filtersMatch(a, b) {
  const arrEq = (x, y) => {
    const xs = [...(x ?? [])].sort();
    const ys = [...(y ?? [])].sort();
    return xs.length === ys.length && xs.every((v, i) => v === ys[i]);
  };
  return (
    arrEq(a.customer_ids, b.customer_ids) &&
    arrEq(a.branch_ids, b.branch_ids) &&
    (a.from ?? '') === (b.from ?? '') &&
    (a.to ?? '') === (b.to ?? '')
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add components/ar/ArFiltersBar.js
git commit -m "feat(ar): ArFiltersBar — section-agnostic tabs row"
```

---

## Task 4: Lift filter state to `pages/ar/index.js`

**Files:**
- Modify: `pages/ar/index.js`

The AR module parent now owns `filters`, `activeTabId`, `filterSidebarOpen`, and the `useArUserPreferences` hook. It renders `ArFiltersBar` below `SubTabs` and `FilterSidebar` once at the bottom. Each section tab receives `filters` as a prop (wired in Tasks 5 + 6 for Billing + Invoices; other tabs ignore it for Phase A).

- [ ] **Step 1: Replace `pages/ar/index.js` with**

```javascript
import { useState } from 'react';
import TenantLayout from '../../components/tenant/TenantLayout';
import ModuleHeader from '../../components/ui/ModuleHeader';
import SubTabs from '../../components/ui/SubTabs';
import { PERMISSIONS } from '../../lib/permissions';

import BillingPipelineTab from '../../components/ar/BillingPipelineTab';
import InvoicesTab from '../../components/ar/InvoicesTab';
import ApplyPaymentsTab from '../../components/ar/ApplyPaymentsTab';
import PaymentsTab from '../../components/ar/PaymentsTab';
import CreditMemosTab from '../../components/ar/CreditMemosTab';
import AgingTab from '../../components/ar/AgingTab';

import ArFiltersBar from '../../components/ar/ArFiltersBar';
import FilterSidebar from '../../components/ar/FilterSidebar';
import { useArUserPreferences } from '../../components/ar/useArUserPreferences';

const AR_TABS = [
  { id: 'billing', label: 'Billing' },
  { id: 'invoices', label: 'Invoices' },
  { id: 'apply_payments', label: 'Apply Payments & Credits' },
  { id: 'payments', label: 'Payments' },
  { id: 'credit_memos', label: 'Credit Memos' },
  { id: 'aging', label: 'Aging' },
];

export default function AccountsReceivable() {
  const [activeTab, setActiveTab] = useState('billing');

  // Global AR filter state — applies across all sub-tabs that consume it.
  // Phase A: Billing + Invoices consume. Other sub-tabs ignore for now;
  // Phase B wires them up when their endpoints learn array filters.
  const [filters, setFilters]                     = useState({});
  const [activeTabId, setActiveTabId]             = useState(null);
  const [filterSidebarOpen, setFilterSidebarOpen] = useState(false);
  const { customTabs, saveCustomTab, deleteCustomTab } = useArUserPreferences();

  return (
    <TenantLayout title="Accounts Receivable" requiredPermission={[PERMISSIONS.ACCOUNTS_RECEIVABLE, PERMISSIONS.ALL]}>
      <div className="space-y-5">
        <ModuleHeader
          title="Accounts Receivable"
          description="Manage billing, invoices, payments, credits, and aging reports."
        />

        <SubTabs tabs={AR_TABS} active={activeTab} onChange={setActiveTab} />

        <ArFiltersBar
          customTabs={customTabs}
          activeTabId={activeTabId}
          currentFilters={filters}
          onSelectTab={(id) => {
            setActiveTabId(id);
            if (id == null) {
              setFilters({});
            } else {
              const tab = customTabs.find((t) => t.id === id);
              if (tab) setFilters(tab.filters || {});
            }
          }}
          onSaveTab={(tab) => saveCustomTab(tab)}
          onDeleteTab={(id) => {
            if (activeTabId === id) { setActiveTabId(null); setFilters({}); }
            deleteCustomTab(id);
          }}
          onOpenFilters={() => setFilterSidebarOpen(true)}
        />

        {activeTab === 'billing'        && <BillingPipelineTab filters={filters} />}
        {activeTab === 'invoices'       && <InvoicesTab filters={filters} />}
        {activeTab === 'apply_payments' && <ApplyPaymentsTab />}
        {activeTab === 'payments'       && <PaymentsTab />}
        {activeTab === 'credit_memos'   && <CreditMemosTab />}
        {activeTab === 'aging'          && <AgingTab />}

        <FilterSidebar
          isOpen={filterSidebarOpen}
          onClose={() => setFilterSidebarOpen(false)}
          filters={filters}
          onApply={(next) => {
            setFilters(next);
            setActiveTabId(null);
          }}
        />
      </div>
    </TenantLayout>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add pages/ar/index.js
git commit -m "feat(ar): lift filter state to AR module parent"
```

Note: after this commit the build will be temporarily in a transitional state — `BillingPipelineTab` and `InvoicesTab` still have their own local filter state + CustomTabsRow + FilterSidebar. Tasks 5 + 6 clean them up. Tests + UI will still work in this intermediate state because the parent-rendered ArFiltersBar + FilterSidebar will simply coexist with the per-tab ones until removed.

---

## Task 5: Convert `BillingPipelineTab` to filter-consumer

**Files:**
- Modify: `components/ar/BillingPipelineTab.js`

Remove local filter state + local CustomTabsRow + local FilterSidebar. Accept `filters` as a prop. The fetch logic stays but reads from `props.filters` instead of local state.

- [ ] **Step 1: Read current file to understand what to remove**

```bash
cat components/ar/BillingPipelineTab.js
```

Identify these specific pieces added by v1 (Task 9, commit 52a520d):
- `import FilterSidebar from './FilterSidebar'`
- `import CustomTabsRow from './CustomTabsRow'`
- `import { useArUserPreferences } from './useArUserPreferences'`
- `const [filters, setFilters] = useState({})`
- `const [activeTabId, setActiveTabId] = useState(null)`
- `const [filterSidebarOpen, setFilterSidebarOpen] = useState(false)`
- `const { customTabs, saveCustomTab, deleteCustomTab } = useArUserPreferences()`
- `<CustomTabsRow section="billing" ... />` block in JSX
- `<FilterSidebar ... />` block in JSX

- [ ] **Step 2: Apply these edits**

**Edit A — imports.** Delete these three lines:

```javascript
import FilterSidebar from './FilterSidebar';
import CustomTabsRow from './CustomTabsRow';
import { useArUserPreferences } from './useArUserPreferences';
```

**Edit B — function signature.** Accept `filters` prop:

Old:
```javascript
export default function BillingPipelineTab() {
```

New:
```javascript
export default function BillingPipelineTab({ filters = {} }) {
```

**Edit C — delete local state block.** Remove the four lines:

```javascript
const [filters, setFilters]                     = useState({});
const [activeTabId, setActiveTabId]             = useState(null);
const [filterSidebarOpen, setFilterSidebarOpen] = useState(false);
const { customTabs, saveCustomTab, deleteCustomTab } = useArUserPreferences();
```

**Edit D — delete the `<CustomTabsRow ...>` JSX block** (the whole element Element, entirely).

**Edit E — delete the `<FilterSidebar ...>` JSX block** at the bottom (entire element).

**Edit F — existing fetch code that reads `filters.customer_ids` / `filters.branch_ids` / `filters.from` / `filters.to` stays as-is** — it now reads from props instead of local state, identical surface. Ensure `filters` is still in the useEffect dep array (from v1 Task 9).

- [ ] **Step 3: Read the file back and verify**

After edits:
- No `useArUserPreferences` / `CustomTabsRow` / `FilterSidebar` references remain
- Component function signature destructures `filters` from props
- Fetch still forwards customer_ids / branch_ids / from / to when populated
- All pre-v1 existing behavior (sub-box cards, search, bulk actions, row rendering) intact

- [ ] **Step 4: Commit**

```bash
git add components/ar/BillingPipelineTab.js
git commit -m "refactor(ar): BillingPipelineTab reads filters from props"
```

---

## Task 6: Convert `InvoicesTab` to filter-consumer + delete `CustomTabsRow`

**Files:**
- Modify: `components/ar/InvoicesTab.js`
- Delete: `components/ar/CustomTabsRow.js`

Same edits as Task 5 but for Invoices. `CustomTabsRow` is now unused — delete it.

- [ ] **Step 1: Apply the same set of edits to `components/ar/InvoicesTab.js`**

Mirror Task 5 edits A–F on `InvoicesTab.js`:
- Delete three imports (FilterSidebar, CustomTabsRow, useArUserPreferences)
- Change `export default function InvoicesTab()` → `export default function InvoicesTab({ filters = {} })`
- Delete the four state lines (filters, activeTabId, filterSidebarOpen, useArUserPreferences destructure)
- Delete `<CustomTabsRow section="invoices" ... />` block
- Delete `<FilterSidebar ... />` block
- Leave the existing fetch's filter-forwarding logic untouched

- [ ] **Step 2: Verify by reading the file back**

Same checks as Task 5: no stale imports, signature destructures `filters`, fetch still forwards params.

- [ ] **Step 3: Delete `components/ar/CustomTabsRow.js`**

```bash
rm components/ar/CustomTabsRow.js
```

- [ ] **Step 4: Confirm no references remain**

```bash
git grep -n "CustomTabsRow" -- ':!docs/' ':!memory/'
```

Expected output: empty. (The plan doc in `docs/` and memory files may still reference it — that's fine; they're historical.)

If anything pops up in `components/` or `pages/`, surface that reference and fix.

- [ ] **Step 5: Commit**

```bash
git add components/ar/InvoicesTab.js
git add -u components/ar/CustomTabsRow.js
git commit -m "refactor(ar): InvoicesTab reads filters from props; delete CustomTabsRow"
```

---

## Task 7: Customer typeahead combobox in `FilterSidebar`

**Files:**
- Modify: `components/ar/FilterSidebar.js`

Replace the Customers checkbox list with a typeahead combobox: chips for selected customers, type-to-search dropdown, arrow/Enter keyboard navigation, Backspace removes last chip. Branches stay as checkboxes (typically <20 per tenant).

- [ ] **Step 1: Identify the Customers section to replace**

Locate the `{/* Customers */}` comment in `components/ar/FilterSidebar.js` and the `<section>` block immediately after it — that's the entire block to replace. The Branches section and Date-range section below it stay intact.

- [ ] **Step 2: Replace the Customers section**

Replace everything from the opening `<section>` (the Customers one, just after `{/* Customers */}`) through its closing `</section>` with:

```jsx
          {/* Customers — typeahead combobox with chips */}
          <section>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-slate-400">Customers</label>
              {(draft.customer_ids?.length ?? 0) > 0 && (
                <span className="text-[10px] text-gray-500 dark:text-slate-400">{draft.customer_ids.length} selected</span>
              )}
            </div>
            <CustomerCombobox
              options={customers}
              selectedIds={draft.customer_ids ?? []}
              onChange={(ids) => setDraft((d) => ({ ...d, customer_ids: ids }))}
              query={customerQuery}
              onQueryChange={setCustomerQuery}
            />
          </section>
```

- [ ] **Step 3: Add the `CustomerCombobox` inline component definition at the bottom of the file**

Below the default-exported `FilterSidebar` function (outside its body), add:

```jsx
// ──────────────────────────────────────────────────────────────
// Customer typeahead combobox with chips.
// Kept inline because (a) it's only used here and (b) it closes
// over the parent's customers list / query state. If a second
// consumer appears (Phase B pickup/delivery location filters may),
// lift this to components/ui/.
// ──────────────────────────────────────────────────────────────
function CustomerCombobox({ options, selectedIds, onChange, query, onQueryChange }) {
  const [highlight, setHighlight] = React.useState(0);
  const inputRef = React.useRef(null);

  const selectedSet = React.useMemo(() => new Set(selectedIds), [selectedIds]);
  const selectedItems = React.useMemo(
    () => options.filter((o) => selectedSet.has(o.id)),
    [options, selectedSet]
  );

  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    const unselected = options.filter((o) => !selectedSet.has(o.id));
    if (!q) return unselected.slice(0, 50);
    return unselected
      .filter((o) => o.name?.toLowerCase().includes(q))
      .slice(0, 50);
  }, [options, query, selectedSet]);

  // Clamp highlight when filtered list changes.
  React.useEffect(() => {
    if (highlight >= filtered.length) setHighlight(Math.max(0, filtered.length - 1));
  }, [filtered.length, highlight]);

  const addId = (id) => {
    if (!id || selectedSet.has(id)) return;
    onChange([...selectedIds, id]);
    onQueryChange('');
    setHighlight(0);
    inputRef.current?.focus();
  };

  const removeId = (id) => {
    onChange(selectedIds.filter((x) => x !== id));
    inputRef.current?.focus();
  };

  const handleKeyDown = (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlight((h) => Math.min(filtered.length - 1, h + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlight((h) => Math.max(0, h - 1));
    } else if (e.key === 'Enter') {
      if (filtered[highlight]) {
        e.preventDefault();
        addId(filtered[highlight].id);
      }
    } else if (e.key === 'Backspace' && !query && selectedIds.length > 0) {
      // Backspace on empty input removes the last chip.
      removeId(selectedIds[selectedIds.length - 1]);
    }
  };

  return (
    <div className="relative">
      <div
        onClick={() => inputRef.current?.focus()}
        className="flex flex-wrap items-center gap-1 min-h-[34px] px-1.5 py-1 border border-gray-200 dark:border-slate-700 rounded-md bg-white dark:bg-slate-800 focus-within:ring-1 focus-within:ring-blue-500 cursor-text"
      >
        {selectedItems.map((c) => (
          <span
            key={c.id}
            className="inline-flex items-center gap-0.5 pl-2 pr-1 py-0.5 rounded-md bg-blue-100 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300 text-xs"
          >
            <span className="truncate max-w-[120px]">{c.name}</span>
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); removeId(c.id); }}
              aria-label={`Remove ${c.name}`}
              className="p-0.5 rounded hover:bg-blue-200 dark:hover:bg-blue-900/60"
            >
              <X className="w-3 h-3" />
            </button>
          </span>
        ))}
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => { onQueryChange(e.target.value); setHighlight(0); }}
          onKeyDown={handleKeyDown}
          placeholder={selectedItems.length === 0 ? 'Search customers…' : ''}
          className="flex-1 min-w-[80px] text-xs bg-transparent outline-none text-gray-900 dark:text-slate-100 placeholder-gray-400 dark:placeholder-slate-500"
        />
      </div>
      {query.length > 0 && (
        <div className="absolute z-10 left-0 right-0 mt-1 max-h-48 overflow-y-auto border border-gray-200 dark:border-slate-700 rounded-md bg-white dark:bg-slate-800 shadow-lg">
          {filtered.length === 0 ? (
            <div className="px-3 py-2 text-xs text-gray-400 dark:text-slate-500">No matches</div>
          ) : (
            filtered.map((c, i) => (
              <button
                key={c.id}
                type="button"
                onClick={() => addId(c.id)}
                onMouseEnter={() => setHighlight(i)}
                className={`w-full text-left px-3 py-1.5 text-xs truncate ${
                  i === highlight
                    ? 'bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300'
                    : 'text-gray-700 dark:text-slate-300 hover:bg-gray-50 dark:hover:bg-slate-700'
                }`}
              >
                {c.name}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Import React**

If `FilterSidebar.js` only has `import React, { useEffect, useState } from 'react';`, that's fine — `React.useMemo`, `React.useRef`, `React.useEffect` in the combobox resolve through the default React namespace. No import changes needed. If you prefer named imports, change the combobox body to use `useMemo`, `useRef`, `useEffect` and add them to the top-level import — either style works, pick one and be consistent.

- [ ] **Step 5: Verify visually**

Read the file end-to-end. Confirm:
- Customers `<section>` now contains `<CustomerCombobox />` (not checkbox list)
- Branches section still renders its checkbox list (unchanged)
- Date-range section still renders (unchanged)
- `CustomerCombobox` function is defined at the bottom of the file
- No stray references to the old customer-checkbox markup

- [ ] **Step 6: Commit**

```bash
git add components/ar/FilterSidebar.js
git commit -m "feat(ar): FilterSidebar customer filter is now a typeahead combobox"
```

---

## Task 8: End-to-end integration check

**Files:**
- None modified (verification only)

- [ ] **Step 1: Start the dev server** (if not already running)

User's server is on port 3004. If it's still running, HMR will have rebuilt as tasks land.

- [ ] **Step 2: Smoke-test manually in browser**

1. Navigate to `/ar`
2. See the new **global ArFiltersBar row** beneath the SubTabs (All tab + Filters button, no custom tabs yet)
3. Click **Filters** → sidebar opens → Customers section shows an empty chip input with placeholder "Search customers…"
4. Type two letters → dropdown appears with matches → click one → it becomes a chip; type again to add a second
5. Apply → sidebar closes, rows + counts narrow on Billing
6. Click "+ Save as tab" → name "Big B" → Enter → tab appears in the global row
7. Switch to **Invoices** sub-tab → the "Big B" tab is STILL THERE (global!) → rows narrow accordingly
8. Switch to **Payments / Aging / etc.** → "Big B" tab visible but the tab content is unfiltered (those sections don't consume filters yet — Phase B)
9. Refresh → "Big B" persists
10. Hover "Big B" → X appears → delete → confirm → tab gone, filters clear

- [ ] **Step 3: Confirm in DevTools Network**

- Single GET `/api/tenant/ar/user-preferences` fires on AR page load (not once per sub-tab)
- Billing + Invoices fetches still forward `customer_ids=...` when a tab with customers is active

- [ ] **Step 4: No commit**

Verification only — if issues surfaced, create a fix commit with a focused edit.

---

## Live Gates

After all tasks:

- **Gate 1:** Migration 087 applied; `SELECT custom_tabs FROM user_ar_preferences;` returns `[]` for every row
- **Gate 2:** `/ar` page load fires exactly ONE GET to `/api/tenant/ar/user-preferences` (not once per sub-tab)
- **Gate 3:** ArFiltersBar renders below SubTabs, visible from any AR sub-tab
- **Gate 4:** Customer combobox — type → dropdown appears → click → chip appears; chip X removes it; Backspace on empty input removes last chip
- **Gate 5:** Save a tab on Billing → switch to Invoices → tab still visible and selectable → filters apply to Invoices fetch
- **Gate 6:** Switch to Payments / Aging → tab visible, but tab's filter set has no effect on those sections (their endpoints don't consume filters yet — this is intentional for Phase A)
- **Gate 7:** Delete tab → confirm → tab gone, filters reset
- **Gate 8:** Refresh → saved tabs persist globally

---

## Self-Review

**1. Spec coverage**
- Cross-section tabs: ✅ Tasks 2 (endpoint), 3 (ArFiltersBar), 4 (parent wiring)
- Customer combobox: ✅ Task 7
- Drop per-section tabs: ✅ Task 1 (migration reset), Task 2 (endpoint)
- BillingPipelineTab + InvoicesTab as consumers: ✅ Tasks 5, 6
- Delete CustomTabsRow: ✅ Task 6
- Other AR tabs explicitly NOT wired: documented in Task 4 note + Gate 6

**2. Placeholder scan**
No "TBD", "TODO", "similar to", "add error handling" lines. Each step has concrete code or an exact bash command.

**3. Type consistency**
- v2 tab shape `{ id, name, filters, created_at }` consistent: migration comment (Task 1), endpoint normalizeTab (Task 2), ArFiltersBar (Task 3), hook consumer (Task 4).
- Filter keys `customer_ids`, `branch_ids`, `from`, `to` consistent across endpoint, sidebar, combobox, fetch forwarding.
- `CustomerCombobox` props (`options`, `selectedIds`, `onChange`, `query`, `onQueryChange`) match the call site in the Customers section.
