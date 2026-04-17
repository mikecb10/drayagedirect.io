# Driver Tariff Detail Page Restructure — Plan G3 Implementation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Decompose `pages/settings/driver-tariffs/[id].js` (920 LoC) into a thin page shell (~220 LoC) + 6 sub-components in `components/settings/driver-tariff-detail/`, with **zero behavior change** to the AP driver-pay engine, payload shape, or load-side charge auto-populate.

**Architecture:** Page shell at `pages/settings/driver-tariffs/[id].js` retains all 7 useState hooks (`form`, `linkedProfiles`, `showAdditional`, `loading`, `saving`, `error`, `profilePickerOpen`), the single `useEffect` load(), every handler (`update`, `toggleLoadType`, `toggleFlag`, `toggleLocationAll`, `addLocationId`, `removeLocationId`, `isLocationAll`, `openProfilePicker`, `handleProfilesSelected`, `removeProfile`), and `handleSave` / `handleCancel`. Sub-components are dumb — they receive value-props and onChange-props. An incidental deletion removes the local `DriverPicker` sub-function (dead code since it's never called in this file).

**Tech Stack:** Next.js 15 (Pages Router), React 19, Tailwind v4. The default export of `pages/settings/driver-tariffs/[id].js` is `DriverTariffForm`, which is dual-purpose: as a route page it wraps in `<SettingsLayout>`; when invoked with `tariffId` + `onClose` props (overlay mode via `components/drivers/pay-rates/DriverTariffsPanel.js`) it renders without `<SettingsLayout>`. **Both modes must continue to work.**

**Spec:** `docs/superpowers/specs/2026-04-16-driver-tariff-detail-restructure-design.md`

**Exemplars:**
- Plan G1's tariff-detail decomposition (`pages/settings/tariffs/[id].js` + `components/settings/tariff-detail/*`) — closest analog (AR → AP symmetry).
- Plan G2's charge-profile-detail decomposition (`pages/settings/charge-profiles/[id].js` + `components/settings/charge-profile-detail/*`) — same playbook (baseline capture, gates, subagent prompts).
- Lesson from G1 Task 4.1: subagent prompts must explicitly forbid "while we're here" control-type swaps. Verbatim means verbatim.

---

## Hard rule: zero behavior change

Bake into every commit:

- `handleSave` payload (the JSON sent to `/api/tenant/ap/tariffs/...`) must be byte-identical before and after. Verified via Gate 1 (Phase 0 + per-task re-runs).
- The 7 useState hooks at the top of `DriverTariffForm` stay exactly as they are.
- The single `useEffect` load() block stays in the page shell unchanged.
- The AP engine (`lib/driver-tariff-engine.js`) and the load-side driver pay auto-populate are not touched at all. `lib/pricing-tier-resolver.js` is not touched.
- Visual layout preserved: two-panel structure (fixed-width left, flex-right), section ordering, field grouping, label copy, input widths.
- Control types preserved: if the original used a `<select>`, we don't swap to a combobox. If it used a checkbox, we don't swap to a chip. **Verbatim means verbatim.** Lessons learned from G1 Task 4.1.
- Dual-mode default export preserved. `DriverTariffForm` continues to render `<div className="p-6">` overlay shell when `onClose` is passed; otherwise wraps in `<SettingsLayout>`.
- Advanced Route Matching toggle stays in `DriverTariffHeader` verbatim. It persists `matching_mode` to DB but renders no content conditionally — a placeholder-stub comment matching G1's `TariffHeader` explains the gap. Build-out is a separate product task.

Permitted incidental cleanup (documented in commit messages):
- **Delete** the local `DriverPicker` function (lines 824-849). Never called in this file; zero-behavior-change by definition.

If a step would require even a key reordering in the saved payload or a control type swap, fix the step before commit, not after.

---

## File structure (target state)

```
pages/settings/driver-tariffs/[id].js                    (~220 LoC — was 920)
  └─ Owns: 7 useState hooks, useEffect load(), all handlers,
           handleSave, handleCancel, dual-mode render.

components/settings/driver-tariff-detail/
  ├─ DriverTariffHeader.js               (~45 LoC)   h1 + Basic/Advanced toggle
  ├─ DriverTariffMatchingPanel.js        (~250 LoC)  left panel (all matching fields)
  ├─ DriverPayPanel.js                   (~60 LoC)   right panel (linked profile list)
  ├─ DriverGroupSelect.js                (~35 LoC)   verbatim extract
  ├─ LocationConditionField.js           (~30 LoC)   verbatim extract
  └─ ChargeProfilePickerModal.js         (~200 LoC)  verbatim extract (AP-specific)
```

---

## Phase 0: Capture baseline payload (controller only)

Controller (the user's main session) does this, not a subagent. Subagents can't drive a logged-in browser to capture payloads.

### Task 0.1: Capture baseline payload

**Files:** Creates `tmp/driver-tariff-payload-baseline.json` (gitignored — `tmp/` entry already present).

- [ ] **Step 1: Pick a baseline driver tariff**

Use the dev server (`mcp__Claude_Preview__preview_list` to find current port). Find an existing driver tariff with linked profiles:

```js
// mcp__Claude_Preview__preview_eval
(async () => {
  const r = await fetch('/api/tenant/ap/tariffs', { credentials: 'include' });
  const { tariffs } = await r.json();
  return tariffs.map(t => ({
    id: t.id,
    name: t.name,
    status: t.status,
    profileCount: (t.charge_sets || []).reduce((s, cs) => s + (cs.profiles || []).length, 0),
  }));
})()
```

Pick the tariff with the richest data — ideally: `status: 'active'`, 2+ linked profiles, non-empty load_types array, at least one location condition that's NOT `all: true`, and at least one flag set.

If no such tariff exists, pick the one with the most profiles + manually set a couple of flags + pickup condition IDs in the UI first, then save, then use that as baseline. Note the modifications in `tmp/HOW-TO-VERIFY.md`.

- [ ] **Step 2: Derive the handleSave payload from the GET response**

Run this in `mcp__Claude_Preview__preview_eval` (substitute the chosen tariff ID):

```js
(async () => {
  const r = await fetch('/api/tenant/ap/tariffs/<TARIFF_ID>', { credentials: 'include' });
  const { tariff: t } = await r.json();
  // Mirror setForm() in load() (lines 115-146 of pages/settings/driver-tariffs/[id].js)
  const form = {
    name: t.name || '',
    status: t.status || 'draft',
    priority: t.priority ?? 0,
    driver_group_id: t.driver_group_id || null,
    effective_start: t.effective_start || '',
    effective_end: t.effective_end || '',
    matching_mode: t.matching_mode || 'basic',
    load_types: t.load_types || [],
    pickup_conditions: t.pickup_conditions || { all: true },
    delivery_conditions: t.delivery_conditions || { all: true },
    return_conditions: t.return_conditions || {},
    container_type: t.container_type || '',
    container_size: t.container_size || '',
    ssl_id: t.ssl_id || null,
    chassis_type: t.chassis_type || '',
    chassis_size: t.chassis_size || '',
    chassis_owner: t.chassis_owner || '',
    is_hazmat: t.is_hazmat,
    is_overweight: t.is_overweight,
    is_liquor: t.is_liquor,
    is_hot: t.is_hot,
    is_genset: t.is_genset,
    is_overheight: t.is_overheight,
    is_scale: t.is_scale,
    is_ev: t.is_ev,
    is_street_turn: t.is_street_turn,
    is_oog: t.is_oog,
    is_bonded: t.is_bonded,
    is_double: t.is_double,
    is_tanker: t.is_tanker,
  };
  // Mirror setLinkedProfiles() in load() (lines 148-176)
  const seen = new Set();
  const linkedProfiles = [];
  for (const cs of (t.charge_sets || [])) {
    for (const p of cs.profiles || []) {
      const pid = p.charge_profile?.id || p.driver_charge_profile_id || p.charge_profile_id;
      if (!pid || seen.has(pid)) continue;
      seen.add(pid);
      linkedProfiles.push({
        charge_profile_id: pid,
        name: p.charge_profile?.name || '',
        charge_name: p.charge_profile?.charge_name || '',
        unit_of_measure: p.charge_profile?.unit_of_measure || 'fixed',
      });
    }
  }
  // Mirror handleSave() payload construction (lines 279-294)
  const charge_sets = linkedProfiles.length > 0
    ? [{
        pay_to_mode: 'load_driver',
        pay_to_driver_id: null,
        profiles: linkedProfiles,
        items: [],
      }]
    : [];
  return {
    ...form,
    priority: Number(form.priority) || 0,
    effective_start: form.effective_start || null,
    effective_end: form.effective_end || null,
    charge_sets,
  };
})()
```

- [ ] **Step 3: Save the result to disk**

Copy the returned JSON and write it to `tmp/driver-tariff-payload-baseline.json` with a `_meta` block prepended:

```json
{
  "_meta": {
    "plan": "G3",
    "tariff_id": "<TARIFF_ID>",
    "tariff_name": "<TARIFF_NAME>",
    "captured": "2026-04-16",
    "notes": "Reconstructed from GET /api/tenant/ap/tariffs/<id> via the derivation script in tmp/HOW-TO-VERIFY.md (Plan G3 section). Represents what handleSave would POST given the current load()→state→handleSave flow."
  },
  <payload fields>
}
```

- [ ] **Step 4: Update `tmp/HOW-TO-VERIFY.md`**

Append a "Plan G3 — Driver Tariff Detail Restructure" section mirroring the existing G1 and G2 sections. Include:
- Baseline tariff ID + name + captured date
- The full derivation script from Step 2 (so any subagent can re-run verification by pasting one block of code)
- A "Modes covered by this baseline" note listing which edge cases the chosen tariff exercises (e.g., "load types: IMPORT,EXPORT; pickup_conditions: specific list; delivery_conditions: all; flags: is_hazmat, is_hot")

- [ ] **Step 5: No commit needed**

`tmp/` is already gitignored.

---

## Phase 1: Cleanup + 3 trivial verbatim extractions

Four small commits, all low-risk. Each is either a deletion or a verbatim cut/paste.

### Task 1.1: Delete dead `DriverPicker` function

**Context:** The local `DriverPicker` sub-function at lines 824-849 is never called in this file — `grep DriverPicker pages/settings/driver-tariffs/[id].js` returns only the definition. Leftover from an earlier "pin a specific driver to a charge set" UI. Deletion is zero-behavior-change by definition (the function never executed).

The `components/ui/DriverPicker.js` primitive is a separate file consumed elsewhere in the app (DriverPayTab, ContainerMoveCard, EditableCell) and is NOT affected by this deletion.

**Files:**
- Modify: `pages/settings/driver-tariffs/[id].js` (delete lines 820-849 including the comment block header)

- [ ] **Step 1: Re-confirm the function is dead**

Run via Grep tool:
- pattern: `DriverPicker`
- path: `pages/settings/driver-tariffs/[id].js`
- output_mode: `content`
- `-n`: true

Expected output: exactly one match (the `function DriverPicker({ value, onChange }) {` definition line). No call sites.

If a second match appears (a call site), STOP — the function is live. File a followup issue and skip this task. Do not proceed to Step 2.

- [ ] **Step 2: Delete the dead code block**

Read `pages/settings/driver-tariffs/[id].js` lines 820-849 to confirm the exact boundaries of the `DriverPicker` function + its comment header. The block looks like:

```js
// ── Reusable Location Condition Field ─────────────────────────
// ── Driver dropdown ─────────────────────────────────────────
// Used for charge sets with pay_to_mode='specified' — pin a specific
// driver to receive pay regardless of which driver runs the load.
function DriverPicker({ value, onChange }) {
  const [drivers, setDrivers] = useState([]);
  useEffect(() => {
    async function load() {
      try {
        const res = await fetch('/api/tenant/drivers');
        if (res.ok) {
          const data = await res.json();
          setDrivers(data.drivers || []);
        }
      } catch { /* silent */ }
    }
    load();
  }, []);
  return (
    <select value={value || ''} onChange={(e) => onChange(e.target.value || null)}
      className="block w-full rounded border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-xs px-2 py-1">
      <option value="">Select driver...</option>
      {drivers.map((d) => (
        <option key={d.id} value={d.id}>
          {d.name || [d.first_name, d.last_name].filter(Boolean).join(' ')}
        </option>
      ))}
    </select>
  );
}
```

Delete the ENTIRE block, starting from the `// ── Driver dropdown ───` comment line (NOT the `// ── Reusable Location Condition Field ───` line above it — that one is a section-divider comment that should stay to label the section where `LocationConditionField` lives below).

Also: the line immediately before the Driver dropdown comment says `// ── Reusable Location Condition Field ─────────────────────────`. Leave that line in place — it correctly labels the remaining `LocationConditionField` function.

After deletion, the file structure around the region should look like:

```js
// ── Reusable Location Condition Field ─────────────────────────

// ── Driver Group dropdown ───────────────────────────────────
// Fetches /api/tenant/ap/driver-groups once and renders a simple select.
// Value is the group id (or null for "all groups").
function DriverGroupSelect({ value, onChange }) {
  ...
}
```

- [ ] **Step 3: Verify compile + Gate 1**

Run: `npm run build 2>&1 | grep -E "driver-tariffs/\[id\]\.js"`
Expected: no errors specific to this file.

Re-run the Gate 1 derivation script from `tmp/HOW-TO-VERIFY.md`. Expected: empty diff (dead code deletion cannot change the save payload).

- [ ] **Step 4: Commit**

```bash
git add pages/settings/driver-tariffs/[id].js
git commit -m "$(cat <<'EOF'
refactor(driver-tariffs): delete dead local DriverPicker function

The local DriverPicker sub-function at the bottom of
pages/settings/driver-tariffs/[id].js was never called — leftover from
an earlier "pin a specific driver to a charge set" UI that was
flattened out when the schema settled on pay_to_mode='load_driver'.

The components/ui/DriverPicker.js primitive (used by DriverPayTab,
ContainerMoveCard, EditableCell) is unaffected — this deletion only
touches the local shadow function.

Zero-behavior-change: the function never executed.

Verified Gate 1 (payload diff = empty — dead code removal).

Part of UI Plan G3.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 1.2: Extract `<ChargeProfilePickerModal>`

**Context:** The `ChargeProfilePickerModal` function at lines 617-818 (`~200 LoC`) is self-contained — it has its own state (profiles, loading, search, filterCharge, filterTag, selected), its own effect for fetching `/api/tenant/ap/charge-profiles`, and its own internal handlers. Verbatim cut/paste.

Note: this is the AP picker. Its data source (`/api/tenant/ap/charge-profiles`) is distinct from G1's AR picker (which hits `/api/tenant/charge-profiles`). They are NOT merged.

**Files:**
- Create: `components/settings/driver-tariff-detail/ChargeProfilePickerModal.js` (~200 LoC)
- Modify: `pages/settings/driver-tariffs/[id].js` (remove function, add import)

- [ ] **Step 1: Read the function**

Read `pages/settings/driver-tariffs/[id].js` lines 617-818. Note its external dependencies:
- React: `useState`, `useEffect`, `useMemo`
- lucide-react: `Search`, `Check`
- Local: `Modal` (from `../../../components/ui/Modal`), `Button` (from `../../../components/ui/Button`)
- Lib: `CHARGE_NAMES`, `chargeNameLabel`, `unitLabel`, `formatCents` (from `../../../lib/charge-profile-constants`)

- [ ] **Step 2: Create the new file**

Create `components/settings/driver-tariff-detail/ChargeProfilePickerModal.js` with this header:

```jsx
import { useState, useEffect, useMemo } from 'react';
import { Search, Check } from 'lucide-react';
import Modal from '../../ui/Modal';
import Button from '../../ui/Button';
import {
  CHARGE_NAMES,
  chargeNameLabel,
  unitLabel,
  formatCents,
} from '../../../lib/charge-profile-constants';

/**
 * ChargeProfilePickerModal — AP driver charge profile picker.
 *
 * Fetches /api/tenant/ap/charge-profiles once on open, renders a
 * searchable/filterable table, and returns the selected profile objects
 * to the caller via onSelect.
 *
 * AP-specific. Not shared with the AR-side picker at
 * components/settings/tariff-detail/ChargeProfilePickerModal.js
 * (different endpoint, different column set).
 *
 * Originally defined inside pages/settings/driver-tariffs/[id].js
 * (line 618). Extracted to its own file in Plan G3 with no behavior
 * change.
 */
export default function ChargeProfilePickerModal({ isOpen, onClose, onSelect, existingIds = [] }) {
  // ... verbatim body from pages/settings/driver-tariffs/[id].js lines 619-817 ...
}
```

Paste the function body exactly — including all the internal `useState`, `useEffect`, `useMemo`, the helper functions (`selectAllFiltered`, `deselectAll`, `toggleProfile`, `handleConfirm`, `getCurrentAmount`), and the full return JSX. Don't refactor, don't change classes, don't swap controls.

- [ ] **Step 3: Update `pages/settings/driver-tariffs/[id].js`**

Delete lines 617-818 (the entire `ChargeProfilePickerModal` function block including its `// ── Charge Profile Picker Modal ─────────────────────────────` header comment).

Add this import at the top of the file (near other component imports, around line 5-12):

```jsx
import ChargeProfilePickerModal from '../../../components/settings/driver-tariff-detail/ChargeProfilePickerModal';
```

The existing `<ChargeProfilePickerModal ... />` usage at lines 594-599 is unchanged — same props, same position.

After deletion, the unused imports at the top of the file may include `Search`, `Check`, `useMemo`, `chargeNameLabel`, `unitLabel`, `formatCents`, `CHARGE_NAMES`, `Modal`, `Button` — but only if NOTHING ELSE in the file uses them. **Check before removing each one.** `Button` is almost certainly still used (the Save / Cancel / Add buttons). `useMemo` is not used elsewhere in the page shell. `chargeNameLabel` and `unitLabel` are still used in the right panel's linked profile cards. Verify with the Grep tool before removing any imports.

- [ ] **Step 4: Verify compile + Gate 1**

Run: `npm run build 2>&1 | grep -E "(driver-tariffs/\[id\]\.js|driver-tariff-detail/ChargeProfilePickerModal\.js)"`
Expected: no new errors.

Re-run Gate 1 derivation; empty payload diff.

- [ ] **Step 5: Verify Gate 2 (smoke test)**

Open the baseline driver tariff in dev. Click "Add Driver Charge Profile" → modal opens. Search a known profile name → list filters. Pick 1-2 profiles → confirm. Confirm they appear in the right-panel linked-profiles list. Cancel-reopen does not re-add already-linked profiles (the `existingIds` prop filters them out — verify this still works).

- [ ] **Step 6: Commit**

```bash
git add pages/settings/driver-tariffs/[id].js components/settings/driver-tariff-detail/ChargeProfilePickerModal.js
git commit -m "$(cat <<'EOF'
refactor(driver-tariffs): extract ChargeProfilePickerModal

Move the ChargeProfilePickerModal sub-function from
pages/settings/driver-tariffs/[id].js (~200 LoC) into
components/settings/driver-tariff-detail/ChargeProfilePickerModal.js.

Verbatim cut/paste including all internal state (profiles, loading,
search, filterCharge, filterTag, selected), the data-fetch effect,
the helpers (selectAllFiltered, deselectAll, toggleProfile,
handleConfirm, getCurrentAmount), and the full return JSX. Same API.

AP-specific — fetches /api/tenant/ap/charge-profiles, distinct from
G1's AR-side picker at components/settings/tariff-detail/
ChargeProfilePickerModal.js (different endpoint, different column
set). Not merged.

Verified Gate 1 (payload diff = empty) and Gate 2 (modal opens,
search/filter/select/confirm works, existingIds filter works).

Part of UI Plan G3.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 1.3: Extract `<DriverGroupSelect>`

**Context:** `DriverGroupSelect` at lines 854-888 (post-Task-1.1 line numbers will shift — re-find before editing) is self-contained: fetches `/api/tenant/ap/driver-groups` once, renders a `<select>`. Verbatim extract.

**Files:**
- Create: `components/settings/driver-tariff-detail/DriverGroupSelect.js` (~35 LoC)
- Modify: `pages/settings/driver-tariffs/[id].js`

- [ ] **Step 1: Locate the function**

Run via Grep tool:
- pattern: `function DriverGroupSelect`
- path: `pages/settings/driver-tariffs/[id].js`
- output_mode: `content`
- `-n`: true

Note the starting line number. Read 35 lines from there to confirm the function body.

- [ ] **Step 2: Create the new file**

Create `components/settings/driver-tariff-detail/DriverGroupSelect.js`:

```jsx
import { useEffect, useState } from 'react';

/**
 * DriverGroupSelect — fetches /api/tenant/ap/driver-groups once and
 * renders a simple <select>. Value is the group id (or null for
 * "all groups"). Owns its own internal state (groups + loading).
 *
 * Originally defined inside pages/settings/driver-tariffs/[id].js.
 * Extracted to its own file in Plan G3 with no behavior change.
 */
export default function DriverGroupSelect({ value, onChange }) {
  const [groups, setGroups] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch('/api/tenant/ap/driver-groups');
        if (res.ok) {
          const data = await res.json();
          setGroups(data.driver_groups || data.groups || []);
        }
      } catch {
        // silent — user will see empty dropdown
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  return (
    <select
      value={value || ''}
      onChange={(e) => onChange(e.target.value || null)}
      disabled={loading}
      className="block w-full rounded-lg border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-950 text-gray-900 dark:text-slate-100 px-3 py-2 text-sm focus:outline-none focus:border-blue-500"
    >
      <option value="">All Driver Groups</option>
      {groups.map((g) => (
        <option key={g.id} value={g.id}>{g.name}</option>
      ))}
    </select>
  );
}
```

- [ ] **Step 3: Update `pages/settings/driver-tariffs/[id].js`**

Delete the `// ── Driver Group dropdown ───` comment header + the entire `function DriverGroupSelect(...)` block.

The existing call site `<DriverGroupSelect value={form.driver_group_id} onChange={...} />` at approximately line 417 is unchanged.

Add the import:

```jsx
import DriverGroupSelect from '../../../components/settings/driver-tariff-detail/DriverGroupSelect';
```

- [ ] **Step 4: Verify compile + Gate 1**

Run: `npm run build 2>&1 | grep -E "(driver-tariffs/\[id\]\.js|DriverGroupSelect\.js)"` — no new errors.

Re-run Gate 1 derivation; empty diff.

- [ ] **Step 5: Commit**

```bash
git add pages/settings/driver-tariffs/[id].js components/settings/driver-tariff-detail/DriverGroupSelect.js
git commit -m "$(cat <<'EOF'
refactor(driver-tariffs): extract DriverGroupSelect sub-component

Move the DriverGroupSelect sub-function from
pages/settings/driver-tariffs/[id].js (~35 LoC) into
components/settings/driver-tariff-detail/DriverGroupSelect.js. Same
props (value, onChange), same API, same internal state (fetches
/api/tenant/ap/driver-groups on mount). Verbatim body.

Verified Gate 1 (payload diff = empty).

Part of UI Plan G3.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 1.4: Extract `<LocationConditionField>`

**Context:** `LocationConditionField` is the last remaining sub-function in the file (post-Task-1.3). Self-contained, purely presentational (no internal state of its own beyond the `<OrgPicker>` child). Verbatim extract.

**Files:**
- Create: `components/settings/driver-tariff-detail/LocationConditionField.js` (~30 LoC)
- Modify: `pages/settings/driver-tariffs/[id].js`

- [ ] **Step 1: Locate the function**

Run via Grep tool:
- pattern: `function LocationConditionField`
- path: `pages/settings/driver-tariffs/[id].js`
- output_mode: `content`
- `-n`: true

Read 35 lines from there to see the function body. Note external symbols:
- lucide-react: `Trash2`
- Local: `OrgPicker` (from `../../../components/ui/OrgPicker`)

- [ ] **Step 2: Create the new file**

Create `components/settings/driver-tariff-detail/LocationConditionField.js`:

```jsx
import { Trash2 } from 'lucide-react';
import OrgPicker from '../../ui/OrgPicker';

/**
 * LocationConditionField — labeled "All Locations" toggle + chip list +
 * OrgPicker for adding more specific locations. Used on the driver
 * tariff detail page for pickup / delivery / return conditions.
 *
 * Pure presentational. Owns no state.
 *
 * Originally defined inside pages/settings/driver-tariffs/[id].js.
 * Extracted to its own file in Plan G3 with no behavior change.
 */
export default function LocationConditionField({ label, field, form, isAll, onSetAll, onAddLocation, onRemoveLocation, orgType }) {
  const conditions = form[field] || {};
  const locationIds = conditions.ids || [];
  const labels = conditions.labels || {};

  return (
    <div>
      <label className="block text-xs font-medium text-gray-600 dark:text-slate-300 mb-1">{label}</label>
      <label className="flex items-center gap-2 cursor-pointer mb-2">
        <input type="checkbox" checked={isAll} onChange={onSetAll}
          className="rounded border-gray-300 dark:border-slate-600 text-blue-600 w-3.5 h-3.5" />
        <span className="text-xs text-gray-700 dark:text-slate-200">All Locations</span>
      </label>
      {!isAll && locationIds.length > 0 && (
        <div className="space-y-1 mb-2">
          {locationIds.map((lid) => (
            <div key={lid} className="flex items-center justify-between bg-gray-50 dark:bg-slate-900 rounded px-2 py-1">
              <span className="text-xs text-gray-700 dark:text-slate-200 truncate">{labels[lid] || lid.slice(0, 8)}</span>
              <button type="button" onClick={() => onRemoveLocation(lid)}
                className="text-gray-400 dark:text-slate-500 hover:text-red-500"><Trash2 className="w-3 h-3" /></button>
            </div>
          ))}
        </div>
      )}
      {!isAll && (
        <OrgPicker type={orgType} placeholder={`Add ${orgType}...`}
          onChange={(org) => { if (org) onAddLocation(org.id, org.name); }} />
      )}
    </div>
  );
}
```

- [ ] **Step 3: Update `pages/settings/driver-tariffs/[id].js`**

Delete the `// ── Reusable Location Condition Field ───` comment + the entire `function LocationConditionField(...)` block at the bottom of the file.

The three existing call sites (lines ~441-474 of the current file: Pick Up Location, Delivery Location, Return Location) are unchanged.

Add the import:

```jsx
import LocationConditionField from '../../../components/settings/driver-tariff-detail/LocationConditionField';
```

At this point, the page shell's helper sub-functions are all extracted. The only sub-function still remaining (`DriverTariffForm` itself) is the main component.

- [ ] **Step 4: Clean up unused imports**

Check which top-of-file imports are now unused. After Phase 1, the page shell should no longer need:
- `OrgPicker` (only used inside `LocationConditionField` now)

Use the Grep tool with pattern `OrgPicker` in the page file to confirm. Remove the import if zero matches outside import lines.

`Trash2` is likely still used in the right-panel linked-profile cards. Verify before removing.

- [ ] **Step 5: Verify compile + Gate 1 + Gate 2**

`npm run build 2>&1 | grep -E "(driver-tariffs/\[id\]\.js|LocationConditionField\.js)"` — no new errors.

Re-run Gate 1 derivation; empty diff.

Gate 2 smoke: open the baseline tariff, confirm all 3 location condition fields render identically — toggle "All Locations" on one of them, confirm the chip list appears/disappears, confirm OrgPicker adds an org and the chip shows, confirm the trash icon removes it.

- [ ] **Step 6: Commit**

```bash
git add pages/settings/driver-tariffs/[id].js components/settings/driver-tariff-detail/LocationConditionField.js
git commit -m "$(cat <<'EOF'
refactor(driver-tariffs): extract LocationConditionField sub-component

Move the LocationConditionField sub-function from
pages/settings/driver-tariffs/[id].js (~30 LoC) into
components/settings/driver-tariff-detail/LocationConditionField.js.
Same props (label, field, form, isAll, onSetAll, onAddLocation,
onRemoveLocation, orgType). Verbatim body.

Used for the three location condition fields (Pick Up, Delivery,
Return). Call sites in the page shell are unchanged.

Also removes the now-unused OrgPicker import from the page shell
(it's still consumed by the extracted LocationConditionField).

Verified Gate 1 (payload diff = empty) and Gate 2 (all 3 location
fields render, toggle All, add/remove org chips).

Part of UI Plan G3.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase 2: Header + PayPanel (smaller section extractions)

Two commits. Each lifts a top-level JSX section into its own file.

### Task 2.1: Extract `<DriverTariffHeader>`

**Context:** The header block — `<h1>Driver Tariff</h1>` + the Basic / Advanced Route Matching tab toggle — at lines 334-346 of the current file. Small, self-contained. Gets a placeholder-stub comment on the Advanced Route Matching tab matching G1's `TariffHeader.js`.

**Files:**
- Create: `components/settings/driver-tariff-detail/DriverTariffHeader.js` (~45 LoC)
- Modify: `pages/settings/driver-tariffs/[id].js`

- [ ] **Step 1: Read the header block**

Use Grep to find the current line number of `<h1 className="text-base font-semibold ...">Driver Tariff</h1>` in the page shell. Read 15 lines from there to see the full header + toggle block.

- [ ] **Step 2: Create the new file**

Create `components/settings/driver-tariff-detail/DriverTariffHeader.js`:

```jsx
/**
 * DriverTariffHeader — title bar + Basic/Advanced Route Matching tab
 * toggle for the driver tariff detail page (AP side).
 *
 * AP analog of components/settings/tariff-detail/TariffHeader.js
 * (AR side). Pure presentational; receives matchingMode +
 * onMatchingModeChange.
 *
 * NOTE on Advanced Route Matching: the tab toggle persists state to
 * form.matching_mode (which is saved with the tariff), but the page
 * does NOT currently render a different content branch when
 * matching_mode === 'advanced_route'. Picking the Advanced tab is a
 * no-op visually beyond the toggle highlight. When the Advanced Route
 * render branch is built (as a feature, not a refactor — spawned as a
 * separate product task during the G3 brainstorming session), it
 * should live in its own sub-component and get conditionally rendered
 * from pages/settings/driver-tariffs/[id].js, NOT here.
 */
export default function DriverTariffHeader({ matchingMode, onMatchingModeChange }) {
  return (
    <div className="flex items-center justify-between mb-5">
      <h1 className="text-base font-semibold text-gray-900 dark:text-slate-100">Driver Tariff</h1>
      <div className="flex items-center gap-2 text-xs text-gray-400 dark:text-slate-500">
        <button
          type="button"
          onClick={() => onMatchingModeChange('basic')}
          className={`px-3 py-1 rounded ${
            matchingMode === 'basic'
              ? 'bg-gray-200 dark:bg-slate-700 text-gray-700 dark:text-slate-200 font-semibold'
              : 'hover:bg-gray-100 dark:hover:bg-slate-800'
          }`}
        >
          Basic
        </button>
        <button
          type="button"
          onClick={() => onMatchingModeChange('advanced_route')}
          className={`px-3 py-1 rounded ${
            matchingMode === 'advanced_route'
              ? 'bg-gray-200 dark:bg-slate-700 text-gray-700 dark:text-slate-200 font-semibold'
              : 'hover:bg-gray-100 dark:hover:bg-slate-800'
          }`}
        >
          Advanced Route Matching
        </button>
      </div>
    </div>
  );
}
```

**Important:** the classes are a verbatim copy of the page shell's current header — specifically `text-gray-900 dark:text-slate-100` on the h1 and `text-gray-400 dark:text-slate-500` on the toggle wrapper. Do NOT substitute Plan C tokens (`text-strong` / `text-muted`) even though G1's `TariffHeader.js` uses them. G3 is purely structural; token migration is out of scope.

- [ ] **Step 3: Update `pages/settings/driver-tariffs/[id].js`**

Replace the header JSX block (from the `{/* Header */}` comment through the closing `</div>` of the header wrapper, approximately lines 333-346 of the current file) with:

```jsx
<DriverTariffHeader
  matchingMode={form.matching_mode}
  onMatchingModeChange={(mode) => update('matching_mode', mode)}
/>
```

Add the import:

```jsx
import DriverTariffHeader from '../../../components/settings/driver-tariff-detail/DriverTariffHeader';
```

- [ ] **Step 4: Verify compile + Gate 1 + Gate 2**

`npm run build 2>&1 | grep -E "(driver-tariffs/\[id\]\.js|DriverTariffHeader\.js)"` — no new errors.

Re-run Gate 1 derivation; empty diff.

Gate 2 smoke: open baseline tariff. Header reads "Driver Tariff". Basic button highlighted initially. Click Advanced Route Matching → it highlights instead; click Basic → it highlights. No content appears / disappears beyond the highlight swap (that's the stub).

- [ ] **Step 5: Commit**

```bash
git add pages/settings/driver-tariffs/[id].js components/settings/driver-tariff-detail/DriverTariffHeader.js
git commit -m "$(cat <<'EOF'
refactor(driver-tariffs): extract DriverTariffHeader sub-component

Move the header block (h1 + Basic/Advanced Route Matching tab toggle)
from pages/settings/driver-tariffs/[id].js into
components/settings/driver-tariff-detail/DriverTariffHeader.js.
Receives matchingMode + onMatchingModeChange as props.

AP analog of components/settings/tariff-detail/TariffHeader.js (from
Plan G1). Includes a placeholder-stub comment matching G1's pattern:
the Advanced Route Matching tab persists state but renders no content
conditionally today. Real build-out is captured as a separate product
task.

Verbatim JSX — uses the original's raw text-gray-*/text-slate-* class
pairs, NOT Plan C's text-strong/text-muted tokens. Token migration
is out of scope for G3.

Verified Gate 1 (payload diff = empty) and Gate 2 (header renders,
Basic/Advanced toggle highlights swap, no content flip behind the tab).

Part of UI Plan G3.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2.2: Extract `<DriverPayPanel>`

**Context:** The right panel of the two-panel layout — header with "Add Driver Charge Profile" button + either the empty state OR the list of linked profile cards. Lines ~540-581 of the current file. Small, purely presentational.

**Files:**
- Create: `components/settings/driver-tariff-detail/DriverPayPanel.js` (~60 LoC)
- Modify: `pages/settings/driver-tariffs/[id].js`

- [ ] **Step 1: Read the right panel block**

Use Grep to find the line number of `{/* RIGHT PANEL — Linked Driver Charge Profiles */}` comment in the page shell. Read from there through the closing `</div>` that balances the `<div className="flex-1 min-w-0">` wrapper (~40-50 lines).

- [ ] **Step 2: Create the new file**

Create `components/settings/driver-tariff-detail/DriverPayPanel.js`:

```jsx
import { Plus, Trash2, DollarSign, Info } from 'lucide-react';
import Button from '../../ui/Button';
import { chargeNameLabel, unitLabel } from '../../../lib/charge-profile-constants';

/**
 * DriverPayPanel — right panel of the driver tariff detail page.
 *
 * Shows either:
 *   - an empty state with a "Add Driver Charge Profile" CTA, or
 *   - a flat list of linked driver charge profile cards (name,
 *     charge_name label, unit_of_measure badge, trash button).
 *
 * Unlike AR tariffs (which group charges by bill_to customer), driver
 * pay is flat: each linked profile produces a pay line on any
 * matching load. No bill-to grouping.
 *
 * Pure presentational. Owns no state.
 */
export default function DriverPayPanel({ linkedProfiles, onOpenPicker, onRemoveProfile }) {
  return (
    <div className="flex-1 min-w-0">
      <div className="px-5 py-3 border-b border-gray-200 dark:border-slate-700 bg-gray-50/60 dark:bg-slate-900/60 flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-xs font-semibold text-gray-700 dark:text-slate-200">
          Driver Pay
          <Info className="w-3.5 h-3.5 text-gray-400 dark:text-slate-500" />
        </div>
        <Button variant="secondary" onClick={onOpenPicker} className="!py-1 !px-3 !text-xs">
          <Plus className="w-3 h-3 mr-1 inline" /> Add Driver Charge Profile
        </Button>
      </div>

      <div className="p-5">
        {linkedProfiles.length === 0 ? (
          <div className="text-center py-16 text-gray-400 dark:text-slate-500">
            <DollarSign className="w-8 h-8 mx-auto mb-3 text-gray-300 dark:text-slate-600" />
            <p className="text-sm">No driver charge profiles linked yet.</p>
            <p className="text-xs mt-1">Each linked profile produces a pay line on any load that matches this tariff. Pay lines accumulate in the driver's settlement period.</p>
            <Button variant="secondary" onClick={onOpenPicker} className="mt-4 !text-xs">
              <Plus className="w-3 h-3 mr-1 inline" /> Add Driver Charge Profile
            </Button>
          </div>
        ) : (
          <div className="space-y-1">
            {linkedProfiles.map((p, idx) => (
              <div key={idx} className="flex items-center justify-between bg-blue-50/50 dark:bg-blue-950/40 rounded-lg px-3 py-2 border border-blue-100 dark:border-blue-800">
                <div className="flex items-center gap-2">
                  <DollarSign className="w-3.5 h-3.5 text-blue-500" />
                  <span className="text-xs font-medium text-gray-900 dark:text-slate-100">{p.name}</span>
                  <span className="text-[10px] text-gray-400 dark:text-slate-500">{chargeNameLabel(p.charge_name)}</span>
                  {p.unit_of_measure && (
                    <span className="text-[9px] bg-gray-100 dark:bg-slate-800 text-gray-500 dark:text-slate-400 px-1.5 py-0.5 rounded">{unitLabel(p.unit_of_measure)}</span>
                  )}
                </div>
                <button type="button" onClick={() => onRemoveProfile(idx)} className="text-gray-400 dark:text-slate-500 hover:text-red-500">
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
```

This JSX is a **verbatim** copy of the current right panel's content. The only allowed transformations:
- `openProfilePicker` → `onOpenPicker` (prop passed in)
- `removeProfile(idx)` → `onRemoveProfile(idx)` (prop passed in)

- [ ] **Step 3: Update `pages/settings/driver-tariffs/[id].js`**

Replace the entire right panel JSX block (from `{/* RIGHT PANEL ... */}` through the matching closing `</div>`, approximately lines 537-582 of the current file) with:

```jsx
<DriverPayPanel
  linkedProfiles={linkedProfiles}
  onOpenPicker={openProfilePicker}
  onRemoveProfile={removeProfile}
/>
```

Add the import:

```jsx
import DriverPayPanel from '../../../components/settings/driver-tariff-detail/DriverPayPanel';
```

- [ ] **Step 4: Clean up unused imports**

After this phase, the page shell no longer renders the right-panel JSX directly. Check which imports are no longer needed in the page shell:
- `DollarSign`, `Info` (lucide) — check with Grep; likely now unused in page shell
- `chargeNameLabel`, `unitLabel` from `charge-profile-constants` — likely unused now
- `Plus`, `Trash2` — check carefully. `Plus` may still be used elsewhere (it isn't — only the right panel uses it in this file). `Trash2` was ALSO used in the deleted `LocationConditionField` which is now extracted — so the only remaining use is inside the right panel. Both can likely go.
- `Button` — still used for the bottom Cancel + Save buttons. Keep.

Verify each removal with a Grep (`pattern: <symbol>`, `path: pages/settings/driver-tariffs/[id].js`) before deleting.

- [ ] **Step 5: Verify compile + Gate 1 + Gate 2**

`npm run build 2>&1 | grep -E "(driver-tariffs/\[id\]\.js|DriverPayPanel\.js)"` — no new errors.

Re-run Gate 1; empty diff.

Gate 2 smoke: open the baseline tariff. Right panel renders. With linked profiles: each card shows name + chargeNameLabel + unitLabel badge + trash icon. Trash icon removes a profile. Without linked profiles: empty state card with DollarSign icon, copy, and CTA. "Add Driver Charge Profile" button opens the modal.

- [ ] **Step 6: Commit**

```bash
git add pages/settings/driver-tariffs/[id].js components/settings/driver-tariff-detail/DriverPayPanel.js
git commit -m "$(cat <<'EOF'
refactor(driver-tariffs): extract DriverPayPanel sub-component

Move the right panel of the driver tariff detail page into
components/settings/driver-tariff-detail/DriverPayPanel.js (~60 LoC).
Receives linkedProfiles + onOpenPicker + onRemoveProfile as props.

Shows either the empty state CTA or the flat list of linked profile
cards (name + chargeNameLabel + unitLabel badge + trash button).
Unlike AR tariffs, no bill-to grouping — driver pay is flat: each
linked profile produces a pay line on matching loads.

Verbatim JSX. Only transformation: openProfilePicker → onOpenPicker
and removeProfile → onRemoveProfile (wired as props).

Page shell drops unused imports: DollarSign, Info, chargeNameLabel,
unitLabel, Plus, Trash2 (all only consumed by the extracted panel).

Verified Gate 1 (payload diff = empty) and Gate 2 (empty state +
filled state render correctly, trash removes a profile, picker button
still opens the modal).

Part of UI Plan G3.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase 3: The big matching panel — atomic extraction

### Task 3.1: Extract `<DriverTariffMatchingPanel>`

**Context:** The left panel is the biggest remaining JSX block (~180-200 lines inside the fixed-width wrapper). It contains:
- Info header
- Tariff name input
- Draft checkbox
- Effective Start/End DatePickers
- Load Types checkbox list (5 items)
- DriverGroupSelect + helper text
- Priority input + helper text
- Three `LocationConditionField` instances (pickup, delivery, return)
- Collapsible Additional Load Conditions section (container_type, container_size, ssl_id, chassis_type, chassis_size, chassis_owner)
- Flags checkbox list (13 items via `FLAG_DEFS`)

This component is the riskiest of the plan because it has the widest prop surface and the most JSX. Still a verbatim move — the whole block moves as one unit with handler-name substitution.

**Files:**
- Create: `components/settings/driver-tariff-detail/DriverTariffMatchingPanel.js` (~250 LoC)
- Modify: `pages/settings/driver-tariffs/[id].js`

- [ ] **Step 1: Read the current left panel**

Use Grep to find the line number of `{/* LEFT PANEL — Load Matching Conditions */}` comment. Read from there through the closing `</div>` that balances the fixed-width wrapper (`<div className="w-[280px] lg:w-[320px] shrink-0 border-r ...">`), approximately 180 lines.

Note that:
- `LOAD_TYPES` and `FLAG_DEFS` are defined at the top of the page shell (lines 22-45). They need to move to the new file OR be exported from the page shell and imported. **Decision: move them to the new file.** They are only used inside the left panel. This keeps `LOAD_TYPES` and `FLAG_DEFS` definitions co-located with their consumer.
- `ReferenceDataPicker`, `ContainerOwnerPicker`, `DatePicker` are imported in the page shell today — they'll need imports in the new file and removal from the page shell.
- `ChevronDown` icon is used for the collapsible toggle.

- [ ] **Step 2: Create the new file**

Create `components/settings/driver-tariff-detail/DriverTariffMatchingPanel.js`. Full structure:

```jsx
import { Info, ChevronDown } from 'lucide-react';
import DatePicker from '../../ui/DatePicker';
import ReferenceDataPicker from '../../ui/ReferenceDataPicker';
import ContainerOwnerPicker from '../../ui/ContainerOwnerPicker';
import DriverGroupSelect from './DriverGroupSelect';
import LocationConditionField from './LocationConditionField';

// Load types available in tariffs.
// Mirrors the canonical LOAD_TYPES list in components/loads/NewLoadModal.js,
// EXCLUDING 'Bill Only' — bill-only loads are manual one-offs (no operations,
// just an invoice) so they should never be matched by an automated tariff.
//
// Stored uppercase in tariffs (e.g. 'IMPORT'), but compared case-insensitively
// against orders.load_type which is stored lowercase ('import').
const LOAD_TYPES = [
  { value: 'IMPORT', label: 'Import' },
  { value: 'INBOUND', label: 'Inbound' },
  { value: 'EXPORT', label: 'Export' },
  { value: 'OUTBOUND', label: 'Outbound' },
  { value: 'ROAD', label: 'Road' },
];

// All flags from FLAG_DEFS
const FLAG_DEFS = [
  { key: 'is_hazmat', label: 'Hazmat' },
  { key: 'is_overweight', label: 'Overweight' },
  { key: 'is_liquor', label: 'Liquor' },
  { key: 'is_hot', label: 'Hot' },
  { key: 'is_genset', label: 'Genset' },
  { key: 'is_ev', label: 'EV' },
  { key: 'is_street_turn', label: 'Street Turn' },
  { key: 'is_overheight', label: 'Overheight' },
  { key: 'is_scale', label: 'Scale' },
  { key: 'is_oog', label: 'OOG' },
  { key: 'is_bonded', label: 'Bonded' },
  { key: 'is_double', label: 'Double' },
  { key: 'is_tanker', label: 'Tanker' },
];

/**
 * DriverTariffMatchingPanel — left panel of the driver tariff detail
 * page. Holds every matching-condition field (name, dates, load types,
 * driver group, priority, location conditions, additional conditions,
 * flags).
 *
 * Pure presentational. Owns no state — the page shell passes `form`
 * and every handler as props.
 */
export default function DriverTariffMatchingPanel({
  form,
  update,
  toggleLoadType,
  toggleFlag,
  toggleLocationAll,
  addLocationId,
  removeLocationId,
  isLocationAll,
  showAdditional,
  onToggleAdditional,
}) {
  return (
    <div className="w-[280px] lg:w-[320px] shrink-0 border-r border-gray-200 dark:border-slate-700 overflow-y-auto">
      <div className="px-4 py-3 border-b border-gray-200 dark:border-slate-700 bg-gray-50/60 dark:bg-slate-900/60">
        <div className="flex items-center gap-1.5 text-xs font-semibold text-gray-700 dark:text-slate-200">
          <Info className="w-3.5 h-3.5 text-gray-400 dark:text-slate-500" />
          Load Matching Conditions
        </div>
      </div>

      <div className="p-4 space-y-4">
        {/* ... verbatim contents of the current left panel's inner <div className="p-4 space-y-4"> ...

            With these transformations:
              - form.X references: keep as-is (form is a prop)
              - update('field', value): keep as-is (update is a prop)
              - toggleLoadType, toggleFlag, toggleLocationAll, addLocationId,
                removeLocationId, isLocationAll: keep as-is (all props)
              - setShowAdditional(!showAdditional): change to onToggleAdditional()
              - <LocationConditionField ... form={form} ... />: keep as-is
                (LocationConditionField is imported as a sibling)
              - <DriverGroupSelect value={form.driver_group_id} onChange={...} />:
                keep as-is (DriverGroupSelect is imported as a sibling)
        */}
      </div>
    </div>
  );
}
```

In the placeholder, paste verbatim the contents of the original file's left panel inner container. Apply ONLY the transformations listed. Do NOT change any classes, do NOT swap any control types (LOAD_TYPES stays as vertical checkboxes — NOT chips), do NOT add Plan C tokens, do NOT rearrange fields.

For reference, the original inner container starts at the line `<div className="p-4 space-y-4">` inside the left panel wrapper (around line 364 of the current file) and ends with its matching closing `</div>`.

- [ ] **Step 3: Update `pages/settings/driver-tariffs/[id].js`**

Replace the entire left panel JSX block (the `<div className="w-[280px] lg:w-[320px] ...">` wrapper with all its contents — approximately lines 356-535 of the current file, minus the `{/* LEFT PANEL — Load Matching Conditions */}` comment) with:

```jsx
<DriverTariffMatchingPanel
  form={form}
  update={update}
  toggleLoadType={toggleLoadType}
  toggleFlag={toggleFlag}
  toggleLocationAll={toggleLocationAll}
  addLocationId={addLocationId}
  removeLocationId={removeLocationId}
  isLocationAll={isLocationAll}
  showAdditional={showAdditional}
  onToggleAdditional={() => setShowAdditional((s) => !s)}
/>
```

Add the import:

```jsx
import DriverTariffMatchingPanel from '../../../components/settings/driver-tariff-detail/DriverTariffMatchingPanel';
```

Delete the top-of-file `LOAD_TYPES` and `FLAG_DEFS` constants (lines 22-28 and 31-45 of the current file). They now live in the new file.

- [ ] **Step 4: Clean up unused imports**

After this extraction, the page shell should be down to ~220 LoC. Remove now-unused imports:
- `DatePicker`, `ReferenceDataPicker`, `ContainerOwnerPicker` — only the matching panel uses them now
- `ChevronDown`, `Info` from lucide-react — only the matching panel uses them
- `DriverGroupSelect`, `LocationConditionField` — only the matching panel uses them (the page shell doesn't render them directly; the matching panel imports them as siblings)

Verify each with Grep before removing (`pattern: <symbol>`, `path: pages/settings/driver-tariffs/[id].js`).

Imports that likely remain in the page shell:
- `useEffect`, `useState` (React)
- `useRouter` (Next)
- `SettingsLayout`
- `Modal` (if still used — actually `Modal` was only used inside `ChargeProfilePickerModal` and is now unused in the page shell, verify and remove)
- `Button` (Save / Cancel buttons)
- `Alert` (error banner)
- `DriverTariffHeader`, `DriverTariffMatchingPanel`, `DriverPayPanel`, `ChargeProfilePickerModal` (the 4 new sibling imports)

- [ ] **Step 5: Verify compile**

`npm run build 2>&1 | grep -E "(driver-tariffs/\[id\]\.js|DriverTariffMatchingPanel\.js)"` — no new errors.

- [ ] **Step 6: Verify Gate 1 — CRITICAL**

This is the highest-risk commit in Plan G3. Re-run the Gate 1 derivation script. **Empty diff required.** If it's not empty, STOP and investigate — do not commit.

- [ ] **Step 7: Verify Gate 2 (exhaustive smoke)**

Open the baseline driver tariff in dev. Walk every field in the left panel:

1. Tariff Name input — shows current value, edits update state (inspect via React DevTools)
2. Draft checkbox — checked state matches `form.status === 'draft'`; toggling flips status between 'draft' and 'active'
3. Effective Start / End DatePickers — show current dates, picking new dates updates state
4. Load Types — 5 checkboxes, checked ones match `form.load_types` array, toggling adds/removes
5. Driver Group select — shows current group (or "All Driver Groups"), switching updates `form.driver_group_id`
6. Priority number input — current value, editing updates state
7. Pick Up Location field — `isLocationAll('pickup_conditions')` determines "All Locations" check; org chips render when not-all; adding/removing works
8. Delivery Location field — same validation as Pick Up
9. Return Location field — same validation as Pick Up (note: its default is `{}` not `{all: true}`, so the All checkbox behavior may differ slightly — verify it matches pre-refactor)
10. Additional Load Conditions toggle — expands / collapses correctly, preserves `showAdditional` state
11. Inside Additional: Container Type, Container Size, SSL picker, Chassis Type, Chassis Size, Chassis Owner input — each shows current value, editing works
12. Flags list — 13 checkboxes, each shows correct `!!form[key]` state, toggling flips between `null` and `true` (NOT `false`) — verify by inspecting state after a toggle

Then test both render modes:
- Page mode: visit `/settings/driver-tariffs/<baseline-tariff-id>` directly
- Overlay mode: go to Drivers → Pay Rates → click the baseline tariff's edit pencil icon → confirm the overlay renders the same form and closing it via the X button / Esc / backdrop click works

If anything looks different — even visually — investigate before commit.

- [ ] **Step 8: Commit**

```bash
git add pages/settings/driver-tariffs/[id].js components/settings/driver-tariff-detail/DriverTariffMatchingPanel.js
git commit -m "$(cat <<'EOF'
refactor(driver-tariffs): extract DriverTariffMatchingPanel

Move the left panel of the driver tariff detail page (tariff name,
draft toggle, effective dates, load types checkboxes, driver group
select, priority, 3 location condition fields, additional load
conditions collapsible with container/SSL/chassis fields, flags
checkboxes) into components/settings/driver-tariff-detail/
DriverTariffMatchingPanel.js (~250 LoC).

Receives form + every handler as props. The 8-prop surface mirrors
G1's TariffMatchingPanel smell — fixing it would require restructuring
state, which violates the hard zero-behavior-change rule. Accepted.

LOAD_TYPES and FLAG_DEFS constants move into the new file (only the
matching panel uses them).

Page shell sheds unused imports: DatePicker, ReferenceDataPicker,
ContainerOwnerPicker, ChevronDown, Info, DriverGroupSelect,
LocationConditionField, Modal (the latter two are now consumed
internally by the matching panel / picker modal respectively). Shell
is down to ~220 LoC from the original 920.

Verbatim JSX — checkboxes stay checkboxes (LOAD_TYPES is NOT migrated
to G1's chips primitive), DatePicker pairs stay as separate labeled
blocks (NOT migrated to G1's EffectiveDateRange), no Plan C tokens.

Verified Gate 1 (payload diff = empty) and Gate 2 (every field renders
the same value, every interaction mutates state identically, both
page-mode and overlay-mode render correctly).

Part of UI Plan G3.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase 4: Final QA + push

### Task 4.1: Whole-plan verification + push

- [ ] **Step 1: Confirm final file shape**

Run:

```bash
wc -l pages/settings/driver-tariffs/[id].js
```

Expected: ~220 lines (down from 920).

Run via Glob tool with pattern `components/settings/driver-tariff-detail/**/*.js`:

Expected: 6 files — `DriverTariffHeader.js`, `DriverTariffMatchingPanel.js`, `DriverPayPanel.js`, `DriverGroupSelect.js`, `LocationConditionField.js`, `ChargeProfilePickerModal.js`.

- [ ] **Step 2: Clean build**

```bash
npm run build 2>&1 | grep -E "(driver-tariff|driver-tariffs)" | head -20
```

Expected: no NEW errors specific to driver-tariff files. Pre-existing lint warnings elsewhere are unchanged.

- [ ] **Step 3: Final Gate 1 payload verification**

Re-run the derivation script from `tmp/HOW-TO-VERIFY.md` Plan G3 section. Empty diff against `tmp/driver-tariff-payload-baseline.json`. Required.

- [ ] **Step 4: Final smoke test against the baseline driver tariff**

Restart dev server if needed (build clobbers `.next`):

```bash
rm -rf .next
# then mcp__Claude_Preview__preview_start (if not already running)
```

Open the baseline driver tariff. Exhaustively walk:
- Header (h1 + Basic/Advanced toggle)
- Every left-panel field: name, draft, dates, load types, driver group, priority, 3 location fields, additional conditions (collapsed + expanded), flags (toggle 2-3)
- Right-panel: empty state (if applicable) + profile cards; open picker, add a profile, remove a profile
- Save without changes → reopen → every value persisted identically

Both page mode (`/settings/driver-tariffs/<id>`) and overlay mode (via Drivers → Pay Rates → edit pencil).

- [ ] **Step 5: Engine canary (USER walks this)**

Tell the user it's time for Gate 3:

> "Plan G3 is fully refactored and Gates 1 + 2 are clean. Gate 3 is the AP engine canary — it requires you to walk a real driver-pay calculation on a load and confirm the pay amounts match what they were before. Specifically:
>
> 1. Open the baseline driver tariff and confirm every linked driver charge profile still shows on the right panel with the correct name + charge_name + unit badge.
> 2. Assign a real driver to a load that matches the tariff's conditions (driver group, load type, pickup/delivery/return, flags).
> 3. Confirm `order_driver_pay_lines` rows fire for the same charge profiles with the same cents amounts as before the refactor. Nuanced cases to eyeball: per_day per-diem, percentage-of-base fuel surcharge, radius_rate.
>
> If anything looks off, stop and tell me. If everything matches, give me the green light to push."

Wait for user confirmation before pushing.

- [ ] **Step 6: Verify the overlay use case still works**

Search for callers that pass `tariffId` + `onClose`:

```bash
grep -rn "DriverTariffForm\|tariffId" components/ pages/ --include="*.js" | head -10
```

The known caller is `components/drivers/pay-rates/DriverTariffsPanel.js` (dynamic import at the top of the file). Manually verify it still mounts / closes correctly — the overlay should open on edit-pencil click, render the full form, close on X / Esc / backdrop click, and refresh the tariff list afterward.

- [ ] **Step 7: Git log sanity**

```bash
git log --oneline <spec-commit-sha>..HEAD
```

(The spec commit is `d094068` — adjust if HEAD diverges.)

Expected: 8 commits:
1. docs(g3): design spec  (d094068)
2. refactor: delete dead DriverPicker  (Task 1.1)
3. refactor: extract ChargeProfilePickerModal  (Task 1.2)
4. refactor: extract DriverGroupSelect  (Task 1.3)
5. refactor: extract LocationConditionField  (Task 1.4)
6. refactor: extract DriverTariffHeader  (Task 2.1)
7. refactor: extract DriverPayPanel  (Task 2.2)
8. refactor: extract DriverTariffMatchingPanel  (Task 3.1)

All 7 refactor commits should end with `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>`.

- [ ] **Step 8: Push**

```bash
git push origin main
```

Write a brief release note in chat summarizing what shipped. Update memory if anything new about driver tariffs surfaced during the work (per the user's prompt instruction).

---

## Summary

8 commits across 4 phases (plus the already-shipped spec commit). 6 new sub-components in `components/settings/driver-tariff-detail/`. `pages/settings/driver-tariffs/[id].js` shrinks from 920 LoC to ~220 LoC. Zero behavior change verified at every commit via payload diffs against a baseline driver tariff.

The AP side of the pricing module is now symmetric with the AR side. Both `pages/settings/tariffs/[id].js` (AR) and `pages/settings/driver-tariffs/[id].js` (AP) are thin shells composing focused sub-components. Adding a new matching field, a new flag, or future Advanced Route Matching build-out drops into a clean seam instead of requiring surgery on a ~900 LoC monolith.

Plan G-family is complete after this ships. Any future work on driver charge profile detail (the `DriverChargeProfilesPanel.js` calc-mode / versions / rows surface) would be a Plan G4 that could finally consume `lib/charge-profile-row-shapes.js` if the AP rows share shapes with the AR side.
