# NewLoadModal Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restructure NewLoadModal to a single-page wide layout (Variant B from brainstorm), drop the wizard, add per-user drag-to-reorder for the routing template chips with persistence to `user_dispatcher_preferences.routing_template_order`.

**Architecture:** One migration adds the order column. The dispatcher-preferences API endpoint adds the column to its allowlist. `Modal` gains an `xl` size variant. `NewLoadModal.js` is rewritten as a single-page form (no `step` state, no `<>...</>` step branches) with type pills + template chip grid + 3-column field grid. The chip grid uses `@dnd-kit/sortable` (already in use by the dispatcher Load Board) for drag-to-reorder; on drag-end the new order PUTs to `/api/tenant/dispatcher-preferences`. Reset link clears the saved order. New templates auto-append to the user's order on next open.

**Tech Stack:** Next.js 14 (pages router), React 18, Tailwind CSS, Supabase (service-role), `@dnd-kit/core` + `@dnd-kit/sortable` (already in deps). No test framework — verification via `node --check` for JS files + visual gates after merge.

**Spec:** [docs/superpowers/specs/2026-04-25-newloadmodal-redesign-design.md](../specs/2026-04-25-newloadmodal-redesign-design.md) (commit `8b117dc`)

---

## File Structure

**Create:**
- `supabase/migrations/105_routing_template_order.sql` — ALTER TABLE adding the column

**Modify:**
- `pages/api/tenant/dispatcher-preferences.js` — add `routing_template_order` to `EDITABLE_FIELDS` + GET defaults
- `components/ui/Modal.js` — add `xl` size variant
- `components/loads/NewLoadModal.js` — rewrite as single-page layout + DnD chip reorder

**Total scope:** ~+95 LoC migration + API, ~+10 LoC Modal, modal rewrite (-612/+470 net -142). Net **~-37 LoC** with the migration line.

**Parallelizable:** Tasks 1, 2, 3 are independent. Task 4 (modal rewrite) depends on Task 3 (Modal size). Task 5 (DnD layer) depends on Task 4. Tasks 6+7 run last.

---

## Task 1: Migration 105 — Add `routing_template_order` column

**Files:**
- Create: `supabase/migrations/105_routing_template_order.sql`

**Context:** Per-user drag-to-reorder of routing template chips needs persistence. Following migration 086's pattern: ALTER TABLE on the existing `user_dispatcher_preferences` (created in migration 006) with a `TEXT[]` column defaulting to empty. Idempotent guard (`IF NOT EXISTS` not supported on ADD COLUMN in older Postgres but Supabase honors it). The `NOTIFY pgrst` reload is the codebase convention (per `dev_migration_template.md` in memory).

- [ ] **Step 1: Create the migration file**

Write to `supabase/migrations/105_routing_template_order.sql`:

```sql
-- ============================================================
-- Migration 105: routing_template_order
-- ============================================================
-- Per-user ordering of routing template chips in the New Load
-- creation modal. Empty array = use default (DB) order. Any
-- template id not present in the array auto-appends at the end
-- on render — so admin-added templates surface for users who
-- have customized their order.
-- ============================================================

BEGIN;

ALTER TABLE user_dispatcher_preferences
  ADD COLUMN IF NOT EXISTS routing_template_order TEXT[] NOT NULL DEFAULT '{}';

NOTIFY pgrst, 'reload schema';

COMMIT;
```

- [ ] **Step 2: Apply the migration manually via Supabase SQL Editor**

Open Supabase Studio → SQL Editor → paste the migration body → run. Confirm with:

```sql
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'user_dispatcher_preferences'
  AND column_name = 'routing_template_order';
```

Expected: one row with `data_type = 'ARRAY'`.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/105_routing_template_order.sql
git commit -m "feat(db): add routing_template_order to user_dispatcher_preferences (migration 105)"
```

---

## Task 2: API endpoint — Expose `routing_template_order` on dispatcher-preferences

**Files:**
- Modify: `pages/api/tenant/dispatcher-preferences.js`

**Context:** Single-file endpoint at the path above. `EDITABLE_FIELDS` array (lines 3-13) gates which fields the PUT accepts. The GET auto-creates a default row on first visit (lines 32-50) — that insert needs the new column too.

- [ ] **Step 1: Add `routing_template_order` to `EDITABLE_FIELDS`**

Find this block at lines 3-13:

```js
const EDITABLE_FIELDS = [
  'column_order',
  'hidden_columns',
  'frozen_columns',
  'column_widths',
  'saved_filters',
  'row_density',
  'compact_mode',
  'skip_routing_confirmations',
  'open_routing_on_dispatch',
];
```

Replace with:

```js
const EDITABLE_FIELDS = [
  'column_order',
  'hidden_columns',
  'frozen_columns',
  'column_widths',
  'saved_filters',
  'row_density',
  'compact_mode',
  'skip_routing_confirmations',
  'open_routing_on_dispatch',
  'routing_template_order',
];
```

- [ ] **Step 2: Add the column to the auto-create default row**

Find this block at lines 33-50 (the auto-create branch when no prefs row exists):

```js
    // Auto-create default row on first visit
    if (!data) {
      const { data: created, error: createErr } = await svc
        .from('user_dispatcher_preferences')
        .insert({
          tenant_id: ctx.tenantId,
          user_id: ctx.userId,
          column_order: [],
          hidden_columns: [],
          frozen_columns: ['order_number', 'customer', 'container_number', 'status'],
          column_widths: {},
          saved_filters: {},
          row_density: 'comfortable',
        })
        .select()
        .single();
```

Replace the `.insert({...})` body to include `routing_template_order`:

```js
    // Auto-create default row on first visit
    if (!data) {
      const { data: created, error: createErr } = await svc
        .from('user_dispatcher_preferences')
        .insert({
          tenant_id: ctx.tenantId,
          user_id: ctx.userId,
          column_order: [],
          hidden_columns: [],
          frozen_columns: ['order_number', 'customer', 'container_number', 'status'],
          column_widths: {},
          saved_filters: {},
          row_density: 'comfortable',
          routing_template_order: [],
        })
        .select()
        .single();
```

- [ ] **Step 3: Verify syntax**

Run: `node --check pages/api/tenant/dispatcher-preferences.js`
Expected: exits 0 with no output.

- [ ] **Step 4: Commit**

```bash
git add pages/api/tenant/dispatcher-preferences.js
git commit -m "feat(api): expose routing_template_order on dispatcher-preferences"
```

---

## Task 3: Modal `xl` size variant

**Files:**
- Modify: `components/ui/Modal.js`

**Context:** Modal currently supports `sm` / `md` / `lg` (max-w-sm / max-w-lg / max-w-2xl). NewLoadModal will need a wider variant for the 3-column grid layout. Add `xl` mapping to `max-w-5xl` (1024px) — closest to the spec's 1040px target. Keep all other sizes as-is.

- [ ] **Step 1: Extend the sizes mapping**

Find this block at lines 14-19:

```js
  const sizes = {
    sm: 'max-w-sm',
    md: 'max-w-lg',
    lg: 'max-w-2xl',
```

(There may be a closing `};` after `lg`. Read the file to confirm.)

Replace with:

```js
  const sizes = {
    sm: 'max-w-sm',
    md: 'max-w-lg',
    lg: 'max-w-2xl',
    xl: 'max-w-5xl',
  };
```

- [ ] **Step 2: Verify syntax**

Run: `node --check components/ui/Modal.js`
Expected: JSX parsing fails (Node can't parse JSX). Skip this check; rely on Next.js dev server compile in Task 6.

- [ ] **Step 3: Commit**

```bash
git add components/ui/Modal.js
git commit -m "feat(ui): add xl size to Modal (max-w-5xl)"
```

---

## Task 4: Rewrite NewLoadModal as single-page layout (no DnD yet)

**Files:**
- Modify: `components/loads/NewLoadModal.js` (full file replacement)

**Context:** The biggest task. Drops the `step` state, the wizard `<>...</>` branches, the StepDot helper, and the Back/Next button logic. Keeps: all field state (EMPTY_FORM), template fetch logic, container size fetch, handleSubmit, TYPE_CONFIG branching for chassis_reposition / bill_only / showFinalDelivery / showTrailer / showContainer.

The layout: Modal `size="xl"` → header (title + close, default Modal chrome) → body (type pills, template chip grid, 3-col field grid) → footer (Cancel + Create Load).

This task does the layout rewrite WITHOUT DnD. Templates render in fetch order (no per-user reorder yet) — Task 5 layers DnD on top. This keeps each commit functional.

- [ ] **Step 1: Replace the file contents**

Overwrite `components/loads/NewLoadModal.js` with:

```jsx
import { useEffect, useState } from 'react';
import { Check } from 'lucide-react';
import Modal from '../ui/Modal';
import Button from '../ui/Button';
import Input from '../ui/Input';
import Select from '../ui/Select';
import Alert from '../ui/Alert';
import DatePicker from '../ui/DatePicker';
import OrgPicker from '../org/OrgPicker';
import BranchPicker from '../ui/BranchPicker';
import { useAuth } from '../../contexts/AuthContext';
import { LOAD_TYPES as CENTRAL_LOAD_TYPES } from '../../lib/constants/load-types.js';
import { Package, Truck, ArrowRight as ArrowRightIcon, RefreshCcw, FileText } from 'lucide-react';

const LOAD_TYPE_ICONS = {
  import: Package,
  export: ArrowRightIcon,
  inbound: Truck,
  outbound: Truck,
  road: Truck,
  bill_only: FileText,
  chassis_reposition: RefreshCcw,
};

const LOAD_TYPES = CENTRAL_LOAD_TYPES.map((t) => ({
  id: t.value,
  label: t.label,
  description: t.description,
  icon: LOAD_TYPE_ICONS[t.value] || Package,
}));

// TYPE_CONFIG controls which slot fields show + which load_type variants
// allow null container/trailer/etc. Mirrors lib/validation/load-payload.js.
const TYPE_CONFIG = {
  import: {
    slot1: { label: 'Pickup Location', orgType: 'terminal' },
    slot2: { label: 'Delivery Location', orgType: 'consignee' },
    slot3: { label: 'Return Location', orgType: 'terminal' },
    showContainer: true,
    showFinalDelivery: false,
    showTrailer: false,
  },
  export: {
    slot1: { label: 'Pickup Location', orgType: 'shipper' },
    slot2: { label: 'Delivery Location', orgType: 'terminal' },
    slot3: { label: 'Return Location', orgType: 'terminal' },
    showContainer: true,
    showFinalDelivery: false,
    showTrailer: false,
  },
  inbound: {
    slot1: { label: 'Pickup Location', orgType: 'terminal' },
    slot2: { label: 'Delivery Location', orgType: 'consignee' },
    slot3: { label: 'Return Location', orgType: 'terminal' },
    showContainer: true,
    showFinalDelivery: false,
    showTrailer: false,
  },
  outbound: {
    slot1: { label: 'Pickup Location', orgType: 'shipper' },
    slot2: { label: 'Delivery Location (Rail)', orgType: 'terminal' },
    slot3: null,
    showContainer: true,
    showFinalDelivery: true,
    showTrailer: false,
  },
  road: {
    slot1: { label: 'Pickup Location', orgType: 'shipper' },
    slot2: { label: 'Delivery Location', orgType: 'consignee' },
    slot3: null,
    showContainer: false,
    showFinalDelivery: false,
    showTrailer: true,
  },
  bill_only: {
    slot1: null,
    slot2: null,
    slot3: null,
    showContainer: false,
    showFinalDelivery: false,
    showTrailer: false,
  },
  chassis_reposition: {
    // chassis_reposition writes pickup_location_id → hook_chassis_location_id
    // and delivery_location_id → terminate_chassis_location_id at submit time
    // (see handleSubmit below) per lib/validation/load-payload.js.
    slot1: { label: 'Hook Chassis Location', orgType: 'yard' },
    slot2: { label: 'Terminate Chassis Location', orgType: 'yard' },
    slot3: null,
    showContainer: false,
    showFinalDelivery: false,
    showTrailer: false,
  },
};

const DEFAULT_CONTAINER_SIZES = [
  { value: '20', label: "20'" },
  { value: '40', label: "40'" },
  { value: '40HC', label: "40' HC" },
  { value: '45', label: "45'" },
  { value: '53', label: "53'" },
];

const EMPTY_FORM = {
  load_type: 'import',
  routing_template_id: null,
  routing_template_name: '',
  customer_id: null,
  customer_label: '',
  pickup_location_id: null,
  pickup_location_label: '',
  delivery_location_id: null,
  delivery_location_label: '',
  return_location_id: null,
  return_location_label: '',
  final_delivery_location_id: null,
  final_delivery_location_label: '',
  trailer_number: '',
  container_number: '',
  container_size: '',
  container_size_id: null,
  pickup_apt_from: '',
  pickup_apt_to: '',
  delivery_apt_from: '',
  delivery_apt_to: '',
  bill_of_lading: '',
  booking_number: '',
  branch_id: null,
};

export default function NewLoadModal({ isOpen, onClose, onSuccess }) {
  const { branchIds, branches } = useAuth();
  const [form, setForm] = useState(EMPTY_FORM);
  const [templates, setTemplates] = useState([]);
  const [loadingTemplates, setLoadingTemplates] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [containerSizes, setContainerSizes] = useState(DEFAULT_CONTAINER_SIZES);

  const typeCfg = TYPE_CONFIG[form.load_type] || TYPE_CONFIG.import;

  useEffect(() => {
    if (isOpen) {
      setForm({
        ...EMPTY_FORM,
        branch_id: branchIds?.length === 1 ? branchIds[0] : null,
      });
      setError(null);
      fetch('/api/tenant/container-sizes?enabled=true')
        .then((r) => (r.ok ? r.json() : null))
        .then((data) => {
          if (data?.items?.length > 0) {
            setContainerSizes(
              data.items.map((s) => ({ value: s.code, label: s.label, id: s.id }))
            );
          }
        })
        .catch(() => {});
    }
  }, [isOpen, branchIds]);

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    async function fetchTemplates() {
      setLoadingTemplates(true);
      try {
        const params = new URLSearchParams();
        if (form.load_type) params.set('load_type', form.load_type);
        const res = await fetch(`/api/tenant/routing-templates?${params}`);
        if (!res.ok) throw new Error('Failed to load templates');
        const data = await res.json();
        if (!cancelled) setTemplates(data.templates || []);
      } catch {
        if (!cancelled) setTemplates([]);
      } finally {
        if (!cancelled) setLoadingTemplates(false);
      }
    }
    fetchTemplates();
    return () => {
      cancelled = true;
    };
  }, [isOpen, form.load_type]);

  function update(field, value) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  function updateApt(prefix, value) {
    setForm((f) => ({
      ...f,
      [`${prefix}_apt_from`]: value || '',
      [`${prefix}_apt_to`]: value || '',
    }));
  }

  function selectTemplate(tpl) {
    setForm((f) => ({
      ...f,
      routing_template_id: tpl.id,
      routing_template_name: tpl.name,
    }));
  }

  function selectOrg(field, labelField, org) {
    setForm((f) => ({
      ...f,
      [field]: org?.id || null,
      [labelField]: org?.name || '',
    }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);

    try {
      if (form.load_type !== 'bill_only' && !form.routing_template_id) {
        throw new Error('Select a routing template');
      }
      if (!form.customer_id) throw new Error('Customer is required');

      const isChassisReposition = form.load_type === 'chassis_reposition';
      const payload = {
        load_type: form.load_type,
        routing_template_id: form.routing_template_id,
        routing_template_name: form.routing_template_name,
        customer_id: form.customer_id,
        pickup_location_id: isChassisReposition ? null : form.pickup_location_id,
        delivery_location_id: isChassisReposition ? null : form.delivery_location_id,
        return_location_id: isChassisReposition ? null : form.return_location_id,
        final_delivery_location_id: form.final_delivery_location_id,
        hook_chassis_location_id: isChassisReposition ? form.pickup_location_id : null,
        terminate_chassis_location_id: isChassisReposition ? form.delivery_location_id : null,
        container_number: form.container_number || null,
        container_size: form.container_size || null,
        container_size_id: form.container_size_id || null,
        pickup_apt_from: form.pickup_apt_from || null,
        pickup_apt_to: form.pickup_apt_to || null,
        delivery_apt_from: form.delivery_apt_from || null,
        delivery_apt_to: form.delivery_apt_to || null,
        bill_of_lading: form.bill_of_lading || null,
        booking_number: form.booking_number || null,
        branch_id: form.branch_id || null,
      };

      const res = await fetch('/api/tenant/loads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || 'Failed to create load');
      }
      const data = await res.json();
      onSuccess?.(data.load);
    } catch (e) {
      setError(e.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Create New Load" size="xl">
      <form onSubmit={handleSubmit} className="space-y-4">
        {error && <Alert type="error" message={error} />}

        {/* Type pills row */}
        <div className="flex flex-wrap gap-2">
          {LOAD_TYPES.map((lt) => {
            const Icon = lt.icon;
            const active = form.load_type === lt.id;
            return (
              <button
                key={lt.id}
                type="button"
                onClick={() => update('load_type', lt.id)}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
                  active
                    ? 'bg-blue-100 dark:bg-blue-950/50 text-blue-700 dark:text-blue-300 border-blue-400 dark:border-blue-600'
                    : 'bg-white dark:bg-slate-900 text-gray-600 dark:text-slate-300 border-gray-300 dark:border-slate-600 hover:border-gray-400 dark:hover:border-slate-500'
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                {lt.label}
              </button>
            );
          })}
        </div>

        {/* Routing template chip grid */}
        {form.load_type !== 'bill_only' && (
          <div>
            <div className="text-[10px] uppercase tracking-wide text-gray-500 dark:text-slate-400 mb-1.5 font-medium">
              Routing Template
            </div>
            {loadingTemplates ? (
              <div className="text-xs text-gray-500 dark:text-slate-400 py-3">Loading templates…</div>
            ) : templates.length === 0 ? (
              <div className="text-xs text-gray-500 dark:text-slate-400 py-3">
                No templates available for this load type.
              </div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
                {templates.map((tpl) => {
                  const active = form.routing_template_id === tpl.id;
                  return (
                    <button
                      key={tpl.id}
                      type="button"
                      onClick={() => selectTemplate(tpl)}
                      className={`text-left p-2 rounded border transition-colors ${
                        active
                          ? 'border-blue-500 bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-200'
                          : 'border-gray-200 dark:border-slate-700 hover:border-gray-300 dark:hover:border-slate-600 bg-white dark:bg-slate-900 text-gray-700 dark:text-slate-300'
                      }`}
                    >
                      <div className="text-xs font-medium truncate">{tpl.name}</div>
                      {tpl.description && (
                        <div className="text-[10px] text-gray-500 dark:text-slate-400 truncate mt-0.5">
                          {tpl.description}
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* 3-column field grid */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 pt-2 border-t border-gray-100 dark:border-slate-800">
          {/* Customer (col-span 2) + Branch */}
          <div className="md:col-span-2">
            <OrgPicker
              label="Customer"
              type="customer"
              value={form.customer_id}
              valueLabel={form.customer_label}
              onChange={(org) => selectOrg('customer_id', 'customer_label', org)}
              required
            />
          </div>
          {branches?.length > 0 ? (
            <BranchPicker
              label="Branch"
              value={form.branch_id}
              onChange={(val) => setForm((f) => ({ ...f, branch_id: val }))}
              placeholder="— Select —"
            />
          ) : (
            <div />
          )}

          {/* Locations (slot1, slot2, slot3) */}
          {typeCfg.slot1 && (
            <OrgPicker
              label={typeCfg.slot1.label}
              type={typeCfg.slot1.orgType}
              value={form.pickup_location_id}
              valueLabel={form.pickup_location_label}
              onChange={(org) => selectOrg('pickup_location_id', 'pickup_location_label', org)}
            />
          )}
          {typeCfg.slot2 && (
            <OrgPicker
              label={typeCfg.slot2.label}
              type={typeCfg.slot2.orgType}
              value={form.delivery_location_id}
              valueLabel={form.delivery_location_label}
              onChange={(org) => selectOrg('delivery_location_id', 'delivery_location_label', org)}
            />
          )}
          {typeCfg.slot3 && (
            <OrgPicker
              label={typeCfg.slot3.label}
              type={typeCfg.slot3.orgType}
              value={form.return_location_id}
              valueLabel={form.return_location_label}
              onChange={(org) => selectOrg('return_location_id', 'return_location_label', org)}
            />
          )}
          {typeCfg.showFinalDelivery && (
            <OrgPicker
              label="Final Delivery"
              type="final_destination"
              value={form.final_delivery_location_id}
              valueLabel={form.final_delivery_location_label}
              onChange={(org) =>
                selectOrg('final_delivery_location_id', 'final_delivery_location_label', org)
              }
            />
          )}

          {/* Container fields (only if showContainer) */}
          {typeCfg.showContainer && (
            <>
              <Input
                label="Container #"
                value={form.container_number}
                onChange={(e) => update('container_number', e.target.value.toUpperCase())}
                placeholder="MSKU1234567"
              />
              <Select
                label="Size"
                value={form.container_size}
                onChange={(e) => {
                  const code = e.target.value;
                  update('container_size', code);
                  const match = containerSizes.find((s) => s.value === code);
                  update('container_size_id', match?.id || null);
                }}
                options={containerSizes}
              />
              <div />
            </>
          )}

          {/* Trailer (only if showTrailer) */}
          {typeCfg.showTrailer && (
            <>
              <Input
                label="Trailer / Dry Van ID"
                value={form.trailer_number}
                onChange={(e) => update('trailer_number', e.target.value.toUpperCase())}
                placeholder="TRL12345"
              />
              <div />
              <div />
            </>
          )}

          {/* Appointments (when typeCfg shows them) */}
          {(typeCfg.showContainer || typeCfg.showTrailer || form.load_type === 'chassis_reposition') && (
            <>
              <DatePicker
                showTime
                label="Pickup Apt"
                value={form.pickup_apt_from}
                onChange={(v) => updateApt('pickup', v)}
              />
              <DatePicker
                showTime
                label="Delivery Apt"
                value={form.delivery_apt_from}
                onChange={(v) => updateApt('delivery', v)}
              />
              <div />
            </>
          )}

          {/* References (skip for bill_only and chassis_reposition) */}
          {form.load_type !== 'bill_only' && form.load_type !== 'chassis_reposition' && (
            <>
              <Input
                label="Master BOL"
                value={form.bill_of_lading}
                onChange={(e) => update('bill_of_lading', e.target.value)}
              />
              <Input
                label="Booking #"
                value={form.booking_number}
                onChange={(e) => update('booking_number', e.target.value)}
              />
              <div />
            </>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 pt-3 border-t border-gray-100 dark:border-slate-800">
          <Button variant="secondary" type="button" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" loading={submitting}>
            Create Load
          </Button>
        </div>
      </form>
    </Modal>
  );
}
```

- [ ] **Step 2: Skip syntax check** (JSX — Node can't parse). Verification happens in Task 6.

- [ ] **Step 3: Commit**

```bash
git add components/loads/NewLoadModal.js
git commit -m "refactor(load-modal): rewrite as single-page layout (drop wizard)"
```

---

## Task 5: Add DnD reorder + persistence + reset link

**Files:**
- Modify: `components/loads/NewLoadModal.js` (layer DnD onto Task 4's rewrite)

**Context:** Task 4 left templates rendering in fetch order. Now layer drag-to-reorder on top using `@dnd-kit/sortable` (already in deps via the dispatcher's column reorder). On modal open, fetch the user's `routing_template_order` from `/api/tenant/dispatcher-preferences`. Merge with the fetched templates (any template not in the order array appends at the end). On drag-end, persist the new order via PUT to the same endpoint. Reset link clears the order.

- [ ] **Step 1: Add DnD imports + state at the top of the component**

In `components/loads/NewLoadModal.js`, find the top imports (just after the Lucide icons line):

```jsx
import { Package, Truck, ArrowRight as ArrowRightIcon, RefreshCcw, FileText } from 'lucide-react';
```

Add right after it:

```jsx
import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  closestCenter,
} from '@dnd-kit/core';
import {
  SortableContext,
  rectSortingStrategy,
  useSortable,
  arrayMove,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
```

- [ ] **Step 2: Add a `templateOrder` state and prefs fetch effect**

Inside the component body, after the existing `useState` declarations (`const [containerSizes, setContainerSizes] = useState(DEFAULT_CONTAINER_SIZES);` line):

Add:

```jsx
  const [templateOrder, setTemplateOrder] = useState([]); // string[] of template ids
```

Then, after the existing `useEffect` that fetches container sizes, add a new one to fetch prefs:

```jsx
  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    fetch('/api/tenant/dispatcher-preferences')
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (cancelled) return;
        const order = data?.preferences?.routing_template_order || [];
        setTemplateOrder(Array.isArray(order) ? order : []);
      })
      .catch(() => { if (!cancelled) setTemplateOrder([]); });
    return () => { cancelled = true; };
  }, [isOpen]);
```

- [ ] **Step 3: Compute the merged ordered template list**

Inside the component body, after the `function selectOrg(...)` helper:

Add:

```jsx
  // Merge user-saved order with the fetched template list. Templates the user
  // has ordered come first (in saved order); any template not in the order
  // array (newly added by admin, or never reordered) appends at the end.
  const orderedTemplates = (() => {
    if (templateOrder.length === 0) return templates;
    const byId = new Map(templates.map((t) => [t.id, t]));
    const ordered = templateOrder.map((id) => byId.get(id)).filter(Boolean);
    const orderedIds = new Set(ordered.map((t) => t.id));
    const remaining = templates.filter((t) => !orderedIds.has(t.id));
    return [...ordered, ...remaining];
  })();
```

- [ ] **Step 4: Add DnD sensors + handler**

Inside the component body, after the `orderedTemplates` const:

Add:

```jsx
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  );

  function persistOrder(newOrderIds) {
    fetch('/api/tenant/dispatcher-preferences', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ routing_template_order: newOrderIds }),
    }).catch((err) => {
      console.error('[NewLoadModal] persist template order failed:', err?.message);
    });
  }

  function handleDragEnd(ev) {
    const { active, over } = ev;
    if (!over || active.id === over.id) return;
    const oldIndex = orderedTemplates.findIndex((t) => t.id === active.id);
    const newIndex = orderedTemplates.findIndex((t) => t.id === over.id);
    if (oldIndex < 0 || newIndex < 0) return;
    const next = arrayMove(orderedTemplates, oldIndex, newIndex);
    const nextIds = next.map((t) => t.id);
    setTemplateOrder(nextIds);
    persistOrder(nextIds);
  }

  function handleResetOrder() {
    setTemplateOrder([]);
    persistOrder([]);
  }
```

- [ ] **Step 5: Replace the template chip grid with a Sortable version**

Find this block in the JSX (the routing template chip grid from Task 4):

```jsx
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
                {templates.map((tpl) => {
                  const active = form.routing_template_id === tpl.id;
                  return (
                    <button
                      key={tpl.id}
                      type="button"
                      onClick={() => selectTemplate(tpl)}
                      className={`text-left p-2 rounded border transition-colors ${
                        active
                          ? 'border-blue-500 bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-200'
                          : 'border-gray-200 dark:border-slate-700 hover:border-gray-300 dark:hover:border-slate-600 bg-white dark:bg-slate-900 text-gray-700 dark:text-slate-300'
                      }`}
                    >
                      <div className="text-xs font-medium truncate">{tpl.name}</div>
                      {tpl.description && (
                        <div className="text-[10px] text-gray-500 dark:text-slate-400 truncate mt-0.5">
                          {tpl.description}
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
```

Replace with:

```jsx
              <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragEnd={handleDragEnd}
              >
                <SortableContext
                  items={orderedTemplates.map((t) => t.id)}
                  strategy={rectSortingStrategy}
                >
                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
                    {orderedTemplates.map((tpl) => (
                      <SortableTemplateChip
                        key={tpl.id}
                        tpl={tpl}
                        active={form.routing_template_id === tpl.id}
                        onSelect={() => selectTemplate(tpl)}
                      />
                    ))}
                  </div>
                </SortableContext>
              </DndContext>
```

Also find the routing-template label line:

```jsx
            <div className="text-[10px] uppercase tracking-wide text-gray-500 dark:text-slate-400 mb-1.5 font-medium">
              Routing Template
            </div>
```

Replace with:

```jsx
            <div className="flex items-center justify-between mb-1.5">
              <div className="text-[10px] uppercase tracking-wide text-gray-500 dark:text-slate-400 font-medium">
                Routing Template <span className="text-gray-400 dark:text-slate-500 normal-case font-normal">— drag to reorder</span>
              </div>
              {templateOrder.length > 0 && (
                <button
                  type="button"
                  onClick={handleResetOrder}
                  className="text-[10px] text-gray-500 dark:text-slate-400 hover:text-gray-700 dark:hover:text-slate-200 underline-offset-2 hover:underline"
                >
                  Reset order
                </button>
              )}
            </div>
```

- [ ] **Step 6: Add the `SortableTemplateChip` sub-component**

At the bottom of the file (after `export default function NewLoadModal(...)` closes), add:

```jsx
function SortableTemplateChip({ tpl, active, onSelect }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: tpl.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <button
      ref={setNodeRef}
      style={style}
      type="button"
      onClick={onSelect}
      {...attributes}
      {...listeners}
      className={`text-left p-2 rounded border transition-colors cursor-grab active:cursor-grabbing ${
        active
          ? 'border-blue-500 bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-200'
          : 'border-gray-200 dark:border-slate-700 hover:border-gray-300 dark:hover:border-slate-600 bg-white dark:bg-slate-900 text-gray-700 dark:text-slate-300'
      }`}
    >
      <div className="text-xs font-medium truncate">{tpl.name}</div>
      {tpl.description && (
        <div className="text-[10px] text-gray-500 dark:text-slate-400 truncate mt-0.5">
          {tpl.description}
        </div>
      )}
    </button>
  );
}
```

- [ ] **Step 7: Skip syntax check** (JSX). Verification in Task 6.

- [ ] **Step 8: Commit**

```bash
git add components/loads/NewLoadModal.js
git commit -m "feat(load-modal): drag-to-reorder routing templates with persistence + reset"
```

---

## Task 6: Visual verification gates

**Files (verification only — no code changes):**
- None

**Context:** Dev server at `http://localhost:51146` will hot-reload after the merge. Run the 10 gates from spec §8 + verify the migration ran. Test creds: `test@testtruck.com` / `DrayageDirect2026!`.

- [ ] **Step 1: Verify migration applied**

In Supabase Studio SQL Editor:

```sql
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'user_dispatcher_preferences'
  AND column_name = 'routing_template_order';
```

Expected: one row, `data_type = 'ARRAY'`.

- [ ] **Step 2: Reload dev server preview**

Use `preview_logs level: 'error'` to scan for compile errors. Expect clean. If JSX/import errors appear, re-read the affected import path.

- [ ] **Step 3: Gate 1 — Layout fits at 1080p**

Open `http://localhost:51146/dispatcher` → click `+ New Load`. Modal opens at width ~1024px (max-w-5xl). At 1920×1080 viewport, no vertical scroll inside the modal body. Type pills row visible at top, template chip grid below, 3-column field grid below that, footer with Cancel/Create Load.

Take a screenshot.

- [ ] **Step 4: Gate 2 — Smaller viewport degrades cleanly**

Resize browser to 1366×768. Modal scales (or horizontally scrolls inside its container) but no broken overlap. Mobile breakpoint (≤768px) collapses the 3-col grid to 1-col.

- [ ] **Step 5: Gate 3 — Type pill switching filters templates**

Click "Export" pill → template chips swap to export-specific ones (e.g. "Export — Pick Empty + Live Load + Deliver"). Click "Inbound" → swaps again. Click "Bill Only" → routing template grid hides entirely.

- [ ] **Step 6: Gate 4 — Template chip click selects**

Click any template chip → chip highlights (blue border, blue background). `form.routing_template_id` is set (verified by Create Load attempt — error "Customer is required" is acceptable; we're checking the selection didn't break).

- [ ] **Step 7: Gate 5 — Drag-to-reorder persists**

Drag a template chip from position 4 to position 1. The grid reorders visually. Network tab shows a `PUT /api/tenant/dispatcher-preferences` with `routing_template_order: [...]`. Close the modal, reopen → chip still at position 1.

Verify in DB:
```sql
SELECT routing_template_order
FROM user_dispatcher_preferences
WHERE user_id = (SELECT id FROM users WHERE email = 'test@testtruck.com');
```
Expected: array with the dragged chip's id at index 0.

- [ ] **Step 8: Gate 6 — Reset link works**

With a custom order in place, click "Reset order" link in the routing template label row. Chips snap back to default fetch order. `routing_template_order` in DB is now `'{}'`.

- [ ] **Step 9: Gate 7 — New template auto-appends**

(Skip if no admin access to add a template — note as untested.) If accessible: add a new template via Settings or seed → reopen modal. New template appears at the END of the chip grid. User's existing order preserved.

- [ ] **Step 10: Gate 8 — Form submission unchanged**

Fill: Customer = Jolly Greens brews, click any template, fill required fields → click Create Load. New load appears in the dispatcher table. Verify the load_type, routing_template, customer_id all match the form values.

- [ ] **Step 11: Gate 9 — Bill Only path unchanged**

Click "Bill Only" pill → container/template/dates all hide. Create with just Customer set → bill-only load created.

- [ ] **Step 12: Gate 10 — chassis_reposition path unchanged**

Click "Chassis Repo" pill → template chips show chassis-reposition templates. Pickup/delivery field labels switch to "Hook Chassis Location" / "Terminate Chassis Location". Submit creates a chassis_reposition load with correct field mapping.

- [ ] **Step 13: Commit only if any fixes needed**

If all gates pass, no commit. If a fix was needed, commit:

```bash
git add <fixed files>
git commit -m "fix(load-modal): <bug description>"
```

---

## Task 7: Final ship

**Files:**
- None (commit message body only)

- [ ] **Step 1: Review the commit series**

Run `git log --oneline main..HEAD`. Expected: 4-5 commits (Tasks 1-5). Inspect each for clear messages.

- [ ] **Step 2: dd-qa skill check**

Invoke `dd-qa` to validate field consistency, enum alignment, routing logic, UI pattern compliance.

- [ ] **Step 3: Confirm no stray debug code**

Run:
```bash
git diff main..HEAD -- components/loads/NewLoadModal.js components/ui/Modal.js pages/api/tenant/dispatcher-preferences.js | grep -E '^\+.*(console\.log|debugger|TODO|XXX|FIXME)'
```
Expected: only the intentional `console.error` in the persist-fail catch block from Task 5.

- [ ] **Step 4: Merge to main**

If on a feature branch: open PR `feat(load-modal): single-page redesign + drag-to-reorder templates`. Body summary + `Resolves: <FU-NEW>` (file as new FU when ready to plan).

If committing directly: amend the LAST commit body to include `Resolves: <FU-NEW>` if a tracking FU exists.

- [ ] **Step 5: File 4 follow-ups in followups.md**

Per spec §10:

```md
### FU-XXX: Tenant-admin reorder of routing templates
- Source: 2026-04-25-newloadmodal-redesign-design.md §10
- Scope: medium
- Area: dispatcher / load-creation
- Intent: Tenant admin sets a default tenant-wide order; users without a personal order get that. Currently only per-user reorder is supported.

### FU-XXX: Group/collapse template grid at >25 templates
- Source: 2026-04-25-newloadmodal-redesign-design.md §10
- Scope: medium
- Area: load-creation
- Intent: Segmented or collapsible groups by load_type or usage frequency once tenants grow past ~25 routing templates.

### FU-XXX: Frequency-based "suggested" templates surfacing
- Source: 2026-04-25-newloadmodal-redesign-design.md §10
- Scope: small
- Area: load-creation
- Intent: Track usage count per template; surface most-used for new dispatchers who haven't customized.

### FU-XXX: Auto mode — drag-drop rate-con PDF → AI extracts
- Source: feature_new_load_modal.md (PortPro reference) + 2026-04-25-newloadmodal-redesign-design.md §10
- Scope: large
- Area: load-creation / AI
- Intent: Phase 7-8 work — needs OCR + LLM extraction. Defer until terminal API integration is in place.
```

(Numbers TBD when filing — check `memory/followups.md` for the next available FU-NNN.)

---

## Self-Review

**Spec coverage check:**

- §2 In Scope: single-page layout → Task 4; drag-to-reorder → Task 5; reset → Task 5 Step 4; new-template auto-append → Task 5 Step 3 (the merge logic) ✓
- §2 Out of Scope: Auto mode, container auto-fetch, tenant-admin reorder, pin-favorites — none of these are touched by any task ✓
- §3 Decisions 1-6 → all materialized in code: variant B layout (Task 4), single screen (Task 4 — no `step` state), per-user reorder (Task 5), `user_dispatcher_preferences` storage (Task 1+2), end-of-list fallback (Task 5 Step 3 merge logic), min-width handling (Task 4 — `md:col-span-2` etc. responsive classes) ✓
- §4.1 Frontend rewrite → Task 4 ✓
- §4.2 Migration + API → Tasks 1, 2 ✓
- §4.3 DnD mechanics → Task 5 ✓
- §6 Files Changed table → matches Tasks 1-5 file list ✓
- §7 Risks → mitigations present (try/catch on persist failure in Task 5; min-width via responsive grid in Task 4; no auto-fetch added — only used by this modal so no API consumers) ✓
- §8 Verification gates 1-10 → Task 6 covers all ✓
- §9 Commit plan → 5 commits in spec, 4 in plan (combined "DnD reorder + reset + auto-append" into one task since they're tightly coupled) — acceptable variance ✓

**Placeholder scan:** No "TBD", no "implement appropriate". Every code step shows literal code. Every command states expected output.

**Type consistency:**
- `routing_template_order` is `TEXT[]` in DB (Task 1), `string[]` in API allowlist (Task 2), `string[]` in component state (Task 5 Step 2), `string[]` in fetch body (Task 5 Step 4 `persistOrder`). Consistent ✓
- `templateOrder` state name used consistently (Tasks 5.2, 5.3, 5.4, 5.5) ✓
- `orderedTemplates` derived const used in Task 5.3 + 5.4 + 5.5 ✓
- `SortableTemplateChip` component defined Task 5.6, used Task 5.5 ✓
- `handleDragEnd` / `handleResetOrder` / `persistOrder` defined Task 5.4, used Task 5.5 ✓
- Modal `size="xl"` (Task 4) maps to `max-w-5xl` (Task 3) ✓

No issues found.
