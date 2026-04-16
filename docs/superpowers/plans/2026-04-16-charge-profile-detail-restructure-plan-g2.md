# Charge Profile Detail Page Restructure — Plan G2 Implementation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Decompose `pages/settings/charge-profiles/[id].js` (811 LoC) into a thin page shell + 11 focused sub-components + 1 shared lib file, with **zero behavior change** to the AR pricing engine, payload shape, or load-side charge autopulldown.

**Architecture:** Page shell at `pages/settings/charge-profiles/[id].js` retains all 7 useState hooks, both useEffects, all handlers (`update`, `updateVersion`, `updateRow`, `addRow`, `removeRow`, `addVersion`, `removeVersion`, `duplicateVersion`, `addMoveEvent`, `removeMoveEvent`, `updateMoveEvent`, `mapTierToRow`), and `handleSave`/`handleCancel`. New sub-components in `components/settings/charge-profile-detail/` are dumb — they receive value-props and onChange-props. Row-shape constants and helpers move to a new `lib/charge-profile-row-shapes.js`.

**Tech Stack:** Next.js 15 (Pages Router), React 19, Tailwind v4. The default export of `pages/settings/charge-profiles/[id].js` is `ChargeProfileForm`, which is dual-purpose: as a route page it wraps in `<SettingsLayout>`; when invoked with `chargeProfileId` + `onClose` props (overlay mode) it renders without `<SettingsLayout>`. **Both modes must continue to work.**

**Spec:** `docs/superpowers/specs/2026-04-16-charge-profile-detail-restructure-design.md`

**Exemplars:**
- Plan G1's tariff-detail decomposition (`pages/settings/tariffs/[id].js` + `components/settings/tariff-detail/*`) — same "page shell owns state, sub-components are dumb" pattern.
- The two-stage review caught real spec-vs-reality regressions in G1 Task 4.1 (chip vs checkbox, missing required asterisk). Subagent prompts must explicitly forbid "while we're here" control-type swaps.

---

## Hard rule: zero behavior change

Bake into every commit:

- `handleSave` payload (the JSON sent to `/api/tenant/charge-profiles/...`) must be byte-identical before and after. Verified via Gate 1 (Phase 0 + per-task re-runs).
- The 7 useState hooks at the top of `ChargeProfileForm` stay exactly as they are.
- Both `useEffect` blocks (load() and the UoM→calc-mode-validity guard) stay in the page shell unchanged.
- The AR engine and the load-side charge autopulldown are not touched at all.
- Visual layout preserved: single-column form, section ordering, field grouping, calculation-mode tabs, row-table column layouts.
- Control types preserved: if the original used a `<select>`, we don't swap to a combobox. If it used a checkbox, we don't swap to a chip. **Verbatim means verbatim.** Lessons learned from G1 Task 4.1.
- Dual-mode default export preserved. `ChargeProfileForm` continues to render `<div className="p-6">` overlay shell when `onClose` is passed; otherwise wraps in `<SettingsLayout>`.

If a step would require even a key reordering in the saved payload or a control type swap, fix the step before commit, not after.

---

## File structure (target state)

```
lib/
  └─ charge-profile-row-shapes.js                          (~50 LoC, NEW)
      Pure constants + helpers. Named exports only.

pages/settings/charge-profiles/[id].js                     (~250 LoC — was 811)
  └─ Owns: 7 useState hooks, both useEffects, all handlers,
           handleSave, handleCancel, dual-mode render.

components/settings/charge-profile-detail/
  ├─ TagInput.js                          (~60 LoC)
  ├─ LaneLocationCell.js                  (~30 LoC)
  ├─ ChargeProfileHeader.js               (~100 LoC)  Section 1
  ├─ VersionManager.js                    (~100 LoC)  Section 2 parent
  ├─ LaneRowsTable.js                     (~80 LoC)   Section 2 child
  ├─ StatusRowsTable.js                   (~50 LoC)   Section 2 child
  ├─ EventRowsTable.js                    (~80 LoC)   Section 2 child
  ├─ MoveRowsTable.js                     (~120 LoC)  Section 2 child
  ├─ RulesPanel.js                        (~25 LoC)   Section 3
  └─ MatchResolutionPanel.js              (~80 LoC)   Section 4
```

---

## Phase 0: Capture baseline payload (controller only)

Same setup as G1's Phase 0 — controller (the user's main session) does this, not a subagent. Subagents can't drive a logged-in browser to capture payloads.

### Task 0.1: Capture baseline payload

**Files:** Creates `tmp/charge-profile-payload-baseline.json` (gitignored — already covered by the existing `tmp/` entry from G1).

- [ ] **Step 1: Pick a baseline charge profile**

Use the dev server (`mcp__Claude_Preview__preview_list` to find current port). The baseline charge profiles already in test data, courtesy of the tariff baseline:

- `7092fbd0-f9ab-4454-8ae8-2477f47d69b7` — "Dallas Line Haul" (LINE_HAUL, fixed)
- `8a1753fc-ea49-4cbd-9246-ed86140f27f3` — "Jolly line haul bryan tx" (LINE_HAUL, fixed)
- `032a5377-92d5-42ac-b42b-6d791de0ddef` — "Standard Fuel Surcharge" (FUEL, percentage)

Pick one with a meaningful versions array. Hit `GET /api/tenant/charge-profiles/<id>` via `mcp__Claude_Preview__preview_eval` to inspect each, then choose the one with the richest data (multiple versions, multiple rows, ideally rows in 2+ calculation modes).

If none of the seeded profiles have rows in 2+ modes, that's still OK — the baseline just covers fewer mode branches. Note the limitation in `tmp/HOW-TO-VERIFY.md`.

- [ ] **Step 2: Derive the handleSave payload from the GET response**

Run this in `mcp__Claude_Preview__preview_eval` (substitute the chosen profile ID):

```js
(async () => {
  const r = await fetch('/api/tenant/charge-profiles/<PROFILE_ID>', { credentials: 'include' });
  const { profile: p } = await r.json();
  // Mirror setForm() in load() (lines 215-223 of pages/settings/charge-profiles/[id].js)
  const form = {
    name: p.name || '', charge_name: p.charge_name || '',
    description: p.description || '', tags: p.tags || (p.tag ? [p.tag] : []),
    unit_of_measure: p.unit_of_measure || 'fixed', auto_add: p.auto_add || false,
    effective_date_basis: p.effective_date_basis || 'CURRENT_DATE',
    calculation_mode: p.calculation_mode || 'by_lane',
    match_resolution: p.match_resolution || 'first_match_wins',
    percentage_based_on: p.percentage_based_on || '', conditions: p.conditions || [],
  };
  // Mirror mapTierToRow() (lines 243-255)
  const mapTierToRow = (t) => ({
    id: t.id, amount_cents: t.amount_cents || 0, minimum_amount_cents: t.minimum_amount_cents || 0,
    free_units: t.free_units || 0, from_status: t.from_status || '', to_status: t.to_status || '',
    event_type: t.event_type || '', event_location_id: t.event_location_id || null,
    event_location_label: '', event_location_type: t.event_location_type || 'org',
    event_location_value: t.event_location_value || '',
    pickup_location_id: t.pickup_location_id || null, pickup_location_label: '',
    delivery_location_id: t.delivery_location_id || null, delivery_location_label: '',
    move_events: t.move_events || [{ event: '', event_time: 'arrived', location_id: null, location_label: '', location_type: 'org', location_value: '' }],
    move_calc_from: t.move_calc_from || 'first_event_arrived', move_calc_to: t.move_calc_to || 'last_event_arrived',
  });
  // Mirror setVersions() in load() (lines 226-236)
  let versions;
  if (p.versions?.length > 0) {
    versions = p.versions.map((v) => ({
      id: v.id, label: v.label || '', effective_from: v.effective_from || '', effective_to: v.effective_to || '',
      rows: (v.tiers || []).map(mapTierToRow),
    }));
  } else if (p.tiers?.length > 0) {
    versions = [{
      label: 'Version 1', effective_from: p.tiers[0]?.start_date || '', effective_to: p.tiers[0]?.end_date || '',
      rows: p.tiers.map(mapTierToRow),
    }];
  } else {
    versions = [];
  }
  // Mirror handleSave() payload construction (lines 351-362)
  return {
    ...form,
    versions: versions.map((v) => ({
      id: v.id || undefined, label: v.label, effective_from: v.effective_from || null, effective_to: v.effective_to || null,
      rows: v.rows.map((r) => ({
        ...r,
        amount_cents: Math.round(parseFloat(r.amount_cents) || 0),
        minimum_amount_cents: Math.round(parseFloat(r.minimum_amount_cents) || 0),
        free_units: parseFloat(r.free_units) || 0,
      })),
    })),
  };
})()
```

- [ ] **Step 3: Save the result to disk**

Save the returned object as `tmp/charge-profile-payload-baseline.json`. Add a `_meta` block at the top documenting which profile ID, when captured, and how to re-verify.

- [ ] **Step 4: Update `tmp/HOW-TO-VERIFY.md`**

Append a "Charge profile baseline" section that mirrors the existing tariff baseline section, with the chosen profile ID and the derivation script above (so any subagent can re-run verification by pasting one block of code).

- [ ] **Step 5: No commit needed**

`tmp/` is already gitignored.

---

## Phase 1: Lib + 2 trivial extractions

Three small commits, all low-risk. No JSX changes.

### Task 1.1: Create `lib/charge-profile-row-shapes.js`

**Context:** The constants block at the top of `pages/settings/charge-profiles/[id].js` (lines 30-77) is pure data and helpers. No React. Move verbatim to a shared lib so future components (Plan G3 driver-tariffs) can import the same shapes.

**Files:**
- Create: `lib/charge-profile-row-shapes.js`
- Modify: `pages/settings/charge-profiles/[id].js` (remove the constants, add import)

- [ ] **Step 1: Read the constants block**

Read `pages/settings/charge-profiles/[id].js` lines 30-77. Note the named exports needed: `EMPTY_ROW_BASE`, `LOCATION_TYPES`, `EMPTY_LANE_ROW`, `EMPTY_STATUS_ROW`, `EMPTY_EVENT_ROW`, `EMPTY_MOVE_ROW`, `emptyRowForMode`, `EMPTY_VERSION`, `newVersion`.

- [ ] **Step 2: Create the lib file**

Create `lib/charge-profile-row-shapes.js`. Header comment + verbatim cut/paste of lines 30-77, with each declaration prefixed with `export`:

```js
// Row-shape constants and helpers for the charge-profile detail page editor.
//
// Originally inlined at the top of pages/settings/charge-profiles/[id].js.
// Moved to a shared lib in Plan G2 so the AP-side driver-tariffs editor
// (Plan G3) can consume the same shapes without copy-paste.
//
// Pure data + helpers. No React. No Next.js imports.

// ── Empty row templates per calculation mode ──────────────────
export const EMPTY_ROW_BASE = { amount_cents: 0, minimum_amount_cents: 0, free_units: 0 };

export const LOCATION_TYPES = [
  { value: 'org', label: 'Organization' },
  { value: 'city_state', label: 'City / State' },
  { value: 'zip', label: 'Zip Code' },
];

export const EMPTY_LANE_ROW = {
  ...EMPTY_ROW_BASE,
  origin_type: 'org', origin_id: null, origin_label: '', origin_value: '',
  dest_type: 'org', dest_id: null, dest_label: '', dest_value: '',
};

export const EMPTY_STATUS_ROW = { ...EMPTY_ROW_BASE, from_status: '', to_status: '' };

export const EMPTY_EVENT_ROW = {
  ...EMPTY_ROW_BASE, event_type: '',
  event_location_id: null, event_location_label: '',
  event_location_type: 'org', event_location_value: '',
};

export const EMPTY_MOVE_ROW = {
  ...EMPTY_ROW_BASE,
  move_events: [{ event: '', event_time: 'arrived', location_id: null, location_label: '', location_type: 'org', location_value: '' }],
  move_calc_from: 'first_event_arrived', move_calc_to: 'last_event_arrived',
};

export function emptyRowForMode(mode) {
  switch (mode) {
    case 'by_lane': return { ...EMPTY_LANE_ROW };
    case 'between_statuses': return { ...EMPTY_STATUS_ROW };
    case 'by_event': return { ...EMPTY_EVENT_ROW };
    case 'by_move': return JSON.parse(JSON.stringify(EMPTY_MOVE_ROW));
    default: return { ...EMPTY_ROW_BASE };
  }
}

export const EMPTY_VERSION = { label: '', effective_from: '', effective_to: '', rows: [] };

export function newVersion(mode, idx = 1) {
  return {
    ...JSON.parse(JSON.stringify(EMPTY_VERSION)),
    label: `Version ${idx}`,
    rows: [emptyRowForMode(mode)],
  };
}
```

- [ ] **Step 3: Update `pages/settings/charge-profiles/[id].js`**

Remove lines 30-77 (the constants block). Add an import at the top alongside other imports:

```jsx
import {
  EMPTY_ROW_BASE,
  LOCATION_TYPES,
  EMPTY_LANE_ROW,
  EMPTY_STATUS_ROW,
  EMPTY_EVENT_ROW,
  EMPTY_MOVE_ROW,
  EMPTY_VERSION,
  emptyRowForMode,
  newVersion,
} from '../../../lib/charge-profile-row-shapes';
```

Trim the import to only the symbols actually used in `[id].js` after the move. Most of the constants are only used by sub-components that don't exist yet, so the page shell may only need `emptyRowForMode` and `newVersion`. Check what's actually referenced.

- [ ] **Step 4: Verify compile**

Run: `npm run build 2>&1 | grep -E "(charge-profiles/\[id\]\.js|charge-profile-row-shapes\.js)"`
Expected: no new errors.

- [ ] **Step 5: Verify Gate 1 (payload diff)**

Run the derivation script from `tmp/HOW-TO-VERIFY.md`. Diff against `tmp/charge-profile-payload-baseline.json`. Expected: empty diff (this commit only moves constants — no behavior change is even possible).

- [ ] **Step 6: Commit**

```bash
git add lib/charge-profile-row-shapes.js pages/settings/charge-profiles/[id].js
git commit -m "$(cat <<'EOF'
refactor(charge-profiles): move row-shape constants to shared lib

Move EMPTY_ROW_BASE, LOCATION_TYPES, EMPTY_LANE_ROW, EMPTY_STATUS_ROW,
EMPTY_EVENT_ROW, EMPTY_MOVE_ROW, EMPTY_VERSION, emptyRowForMode, and
newVersion from the top of pages/settings/charge-profiles/[id].js into
a new lib/charge-profile-row-shapes.js. Pure data + helpers, no React.

Lets the AP-side driver-tariffs editor (Plan G3) import the same row
shapes if its rows turn out to share calc-mode semantics. Also lets
the row table sub-components in the next phases of Plan G2 import
emptyRowForMode without depending on the page shell.

Verified Gate 1 (payload diff = empty — pure constant move, no
behavior change is possible).

Part of UI Plan G2.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
EOF
)"
```

---

### Task 1.2: Extract `<TagInput>`

**Context:** `TagInput` is already a self-contained sub-function in `pages/settings/charge-profiles/[id].js` lines 80-139. Verbatim cut/paste — same pattern as `ChargeProfilePickerModal` extraction in G1 Task 2.1.

**Files:**
- Create: `components/settings/charge-profile-detail/TagInput.js` (~60 LoC)
- Modify: `pages/settings/charge-profiles/[id].js` (remove function, add import)

- [ ] **Step 1: Read the function**

Read `pages/settings/charge-profiles/[id].js` lines 79-139. Note its imports: `useState`, `useMemo` from React; `X` icon from lucide.

- [ ] **Step 2: Create the new file**

Create `components/settings/charge-profile-detail/TagInput.js`. Verbatim function body with the imports it needs at top:

```jsx
import { useState, useMemo } from 'react';
import { X } from 'lucide-react';

/**
 * TagInput — labeled tag chip input with autocomplete suggestions.
 *
 * Pure presentational of the tag list (caller owns the array via the
 * onChange callback) but keeps its own internal state for the input
 * field text and the suggestion-dropdown visibility.
 *
 * Originally defined inside pages/settings/charge-profiles/[id].js
 * (line 80). Extracted to its own file in Plan G2 with no behavior
 * change.
 */
export default function TagInput({ tags, onChange, availableTags }) {
  // … verbatim body from [id].js lines 81-138 …
}
```

Paste the function body exactly. Don't refactor anything.

- [ ] **Step 3: Update `pages/settings/charge-profiles/[id].js`**

Remove lines 79-139 (the entire `function TagInput(...)` block + its preceding comment). Add an import alongside others:

```jsx
import TagInput from '../../../components/settings/charge-profile-detail/TagInput';
```

- [ ] **Step 4: Verify compile + Gate 1**

`npm run build 2>&1 | grep -E "(charge-profiles/\[id\]\.js|TagInput\.js)"` — no new errors. Re-run derivation; payload empty diff.

- [ ] **Step 5: Commit**

```bash
git add pages/settings/charge-profiles/[id].js components/settings/charge-profile-detail/TagInput.js
git commit -m "$(cat <<'EOF'
refactor(charge-profiles): extract TagInput sub-component

Move the TagInput sub-function from pages/settings/charge-profiles/[id].js
(~60 LoC) into components/settings/charge-profile-detail/TagInput.js.
Same props, same behavior, same imports. Verbatim cut/paste.

Verified Gate 1 (payload diff = empty).

Part of UI Plan G2.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
EOF
)"
```

---

### Task 1.3: Extract `<LaneLocationCell>`

**Context:** `LaneLocationCell` is a self-contained sub-function at lines 140-164. Same verbatim-extract pattern.

**Files:**
- Create: `components/settings/charge-profile-detail/LaneLocationCell.js` (~30 LoC)
- Modify: `pages/settings/charge-profiles/[id].js`

- [ ] **Step 1: Read the function**

Read lines 140-164 of `pages/settings/charge-profiles/[id].js`. Identify external symbols (lucide icons, OrgPicker, the LOCATION_TYPES constant which moved to lib in Task 1.1).

- [ ] **Step 2: Create the new file**

Create `components/settings/charge-profile-detail/LaneLocationCell.js`:

```jsx
import OrgPicker from '../../ui/OrgPicker';
import { LOCATION_TYPES } from '../../../lib/charge-profile-row-shapes';

/**
 * LaneLocationCell — origin-or-destination cell editor used inside lane-mode
 * charge profile rows. Lets the user pick between an Organization, a
 * City/State string, or a Zip code, and shows the appropriate input.
 *
 * Originally defined inside pages/settings/charge-profiles/[id].js
 * (line 141). Extracted to its own file in Plan G2 with no behavior
 * change.
 */
export default function LaneLocationCell({ typeValue, orgId, orgLabel, textValue, onTypeChange, onOrgChange, onTextChange, orgType, placeholder }) {
  // … verbatim body from [id].js lines 142-163 …
}
```

- [ ] **Step 3: Update `pages/settings/charge-profiles/[id].js`**

Remove lines 140-164. Add an import:

```jsx
import LaneLocationCell from '../../../components/settings/charge-profile-detail/LaneLocationCell';
```

- [ ] **Step 4: Verify + commit**

`npm run build 2>&1 | grep -E "(charge-profiles/\[id\]\.js|LaneLocationCell\.js)"` clean. Re-run Gate 1 derivation; empty diff.

```bash
git add pages/settings/charge-profiles/[id].js components/settings/charge-profile-detail/LaneLocationCell.js
git commit -m "$(cat <<'EOF'
refactor(charge-profiles): extract LaneLocationCell sub-component

Move the LaneLocationCell sub-function from pages/settings/charge-profiles/[id].js
(~25 LoC) into components/settings/charge-profile-detail/LaneLocationCell.js.
Imports LOCATION_TYPES from the new shared lib (Task 1.1) instead of
the page shell. Verbatim body.

Verified Gate 1 (payload diff = empty).

Part of UI Plan G2.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Phase 2: Sections 3 + 4 (small extractions)

Two small commits. Each wraps existing primitives with a thin sub-component layer.

### Task 2.1: Extract `<RulesPanel>`

**Context:** Section 3 (lines ~742-750) is a 7-line wrapper around `<ConditionBuilder>`. Trivial extraction.

**Files:**
- Create: `components/settings/charge-profile-detail/RulesPanel.js` (~25 LoC)
- Modify: `pages/settings/charge-profiles/[id].js`

- [ ] **Step 1: Create the component**

Create `components/settings/charge-profile-detail/RulesPanel.js`:

```jsx
import ConditionBuilder from '../../ui/ConditionBuilder';
import { AR_RULES } from '../../../lib/ar-rule-definitions';

/**
 * RulesPanel — wraps <ConditionBuilder> with the AR_RULES catalog.
 * Section 3 of the charge profile detail page.
 *
 * Pure presentational. Owns no state.
 */
export default function RulesPanel({ conditions, onChange }) {
  return (
    <div className="rounded-xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-5">
      <ConditionBuilder
        rules={AR_RULES}
        conditions={conditions}
        onChange={onChange}
      />
    </div>
  );
}
```

- [ ] **Step 2: Update `pages/settings/charge-profiles/[id].js`**

Find the Section 3 block (the `<div>` that contains `<ConditionBuilder>` directly, around lines 742-750). Replace the entire `<div ...>...</div>` with:

```jsx
<RulesPanel
  conditions={form.conditions || []}
  onChange={(c) => update('conditions', c)}
/>
```

Add the import at top:

```jsx
import RulesPanel from '../../../components/settings/charge-profile-detail/RulesPanel';
```

If the page shell no longer references `ConditionBuilder` or `AR_RULES`, remove those imports too. Check first — they may still be used elsewhere.

- [ ] **Step 3: Verify + Gate 1 + commit**

Build clean. Empty payload diff.

```bash
git add pages/settings/charge-profiles/[id].js components/settings/charge-profile-detail/RulesPanel.js
git commit -m "$(cat <<'EOF'
refactor(charge-profiles): extract RulesPanel sub-component

Section 3 of the charge profile detail page (the ConditionBuilder
wrapper) moves to its own file. Receives conditions + onChange as
props. Verbatim wrapper + JSX.

Verified Gate 1 (payload diff = empty).

Part of UI Plan G2.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2.2: Extract `<MatchResolutionPanel>`

**Context:** Section 4 (lines ~752-785) — disabled "Link to existing charge profile" placeholder + the 4-button match resolution selector.

**Files:**
- Create: `components/settings/charge-profile-detail/MatchResolutionPanel.js` (~80 LoC)
- Modify: `pages/settings/charge-profiles/[id].js`

- [ ] **Step 1: Read the existing block**

Read lines 752-785 of `pages/settings/charge-profiles/[id].js`. Note: imports the `MATCH_RESOLUTION_OPTIONS` constant from `lib/charge-profile-constants`.

- [ ] **Step 2: Create the component**

Create `components/settings/charge-profile-detail/MatchResolutionPanel.js`:

```jsx
import { MATCH_RESOLUTION_OPTIONS } from '../../../lib/charge-profile-constants';

/**
 * MatchResolutionPanel — Section 4 of the charge profile detail page.
 *
 * Two parts:
 *   1. Disabled "Link to existing charge profile" placeholder ("Linking
 *      coming soon"). Not wired to anything yet — left as-is per Plan G2
 *      out-of-scope rule.
 *   2. Match resolution: a 4-button selector for what happens when
 *      multiple charge sets match a load.
 *
 * Pure presentational. Owns no state.
 */
export default function MatchResolutionPanel({ value, onChange }) {
  return (
    <div className="rounded-xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-5 space-y-5">
      <div className="text-sm font-semibold text-gray-900 dark:text-slate-100">Link to existing charge profile</div>
      <div className="flex flex-wrap items-center gap-3">
        <span className="w-6 h-6 rounded-full bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 text-xs font-bold flex items-center justify-center shrink-0">1</span>
        <span className="text-sm text-gray-500 dark:text-slate-400 shrink-0">Select Charge Profile</span>
        <select disabled className="rounded-lg border border-gray-300 dark:border-slate-600 bg-gray-50 dark:bg-slate-900 px-3 py-1.5 text-sm opacity-50 cursor-not-allowed">
          <option>Select Value</option>
        </select>
        <span className="text-[11px] text-gray-400 dark:text-slate-500 italic ml-auto shrink-0">Linking coming soon</span>
      </div>

      <div className="border-t border-gray-200 dark:border-slate-700 pt-5">
        <div className="flex items-center gap-2 mb-3">
          <span className="w-6 h-6 rounded-full bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 text-xs font-bold flex items-center justify-center">2</span>
          <span className="text-sm font-semibold text-gray-900 dark:text-slate-100">When multiple conditions match, then:</span>
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {MATCH_RESOLUTION_OPTIONS.map((opt) => (
            <button key={opt.value} type="button" onClick={() => onChange(opt.value)}
              className={`rounded-xl border p-3 text-left transition-all ${
                value === opt.value
                  ? 'border-blue-500 bg-blue-50 dark:bg-blue-950/40 ring-2 ring-blue-200 dark:ring-blue-800'
                  : 'border-gray-200 dark:border-slate-700 bg-gray-50 dark:bg-slate-900 hover:border-gray-300 dark:hover:border-slate-600'
              }`}>
              <div className="text-sm font-semibold text-gray-900 dark:text-slate-100">{opt.label}</div>
              <div className="text-[11px] text-gray-500 dark:text-slate-400 mt-0.5">{opt.description}</div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
```

This is a **verbatim** copy of the JSX from lines 755-784 with two callback substitutions:
- `() => update('match_resolution', opt.value)` → `() => onChange(opt.value)`
- `form.match_resolution === opt.value` → `value === opt.value`

Don't change any classes, don't swap any control types, don't add Plan C tokens.

- [ ] **Step 3: Update `pages/settings/charge-profiles/[id].js`**

Find the Section 4 block (the entire `<div>` containing the link-to-existing placeholder + match resolution buttons). Replace with:

```jsx
<MatchResolutionPanel
  value={form.match_resolution}
  onChange={(v) => update('match_resolution', v)}
/>
```

Add the import:

```jsx
import MatchResolutionPanel from '../../../components/settings/charge-profile-detail/MatchResolutionPanel';
```

If `MATCH_RESOLUTION_OPTIONS` is no longer referenced in the page shell, remove that named import too.

- [ ] **Step 4: Verify + Gate 1 + commit**

```bash
git add pages/settings/charge-profiles/[id].js components/settings/charge-profile-detail/MatchResolutionPanel.js
git commit -m "$(cat <<'EOF'
refactor(charge-profiles): extract MatchResolutionPanel sub-component

Section 4 of the charge profile detail page (the "Link to existing"
placeholder + the 4-button match resolution selector) moves to its
own file. Receives value + onChange as props. Verbatim JSX with the
two expected callback substitutions.

The "Linking coming soon" placeholder stays disabled — out of Plan G2
scope to wire it up.

Verified Gate 1 (payload diff = empty).

Part of UI Plan G2.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Phase 3: Section 1 (header)

### Task 3.1: Extract `<ChargeProfileHeader>`

**Context:** Section 1 (lines ~397-441) — the header card with name, charge_name, description, tag input, auto-add radio, plus (later) UoM, effective date basis, calculation mode tabs. About 100 lines of fields.

Read carefully — Section 1 has multiple sub-rows:
- Row 1: Name | Charge Name | Description (lines 401-422)
- Row 2: Tag | Auto Add (lines 425-440)
- And probably more below in the same `<div>` wrapper for UoM and calc-mode tabs

The full Section 1 wrapper goes from `<div className="rounded-xl border ... bg-white ... p-5 space-y-4">` (line 399) to the matching closing `</div>` just before Section 2's wrapper at line 446.

**Files:**
- Create: `components/settings/charge-profile-detail/ChargeProfileHeader.js` (~100 LoC)
- Modify: `pages/settings/charge-profiles/[id].js`

- [ ] **Step 1: Read the full Section 1 block**

Read `pages/settings/charge-profiles/[id].js` lines 397-441 (and beyond if Section 1 contains more rows for UoM, effective date basis, calculation mode tabs — verify by finding where the Section 1 wrapper `<div>` closes).

Note every form field rendered: which `form.X` it reads, which `update('X', ...)` it writes. Note any constants referenced (`CHARGE_NAMES`, `UNITS_OF_MEASURE`, `EFFECTIVE_DATE_OPTIONS`, `STATUS_OPTIONS`, `availableModes`).

- [ ] **Step 2: Create the component**

Create `components/settings/charge-profile-detail/ChargeProfileHeader.js`:

```jsx
import {
  CHARGE_NAMES,
  UNITS_OF_MEASURE,
  EFFECTIVE_DATE_OPTIONS,
} from '../../../lib/charge-profile-constants';
import TagInput from './TagInput';

/**
 * ChargeProfileHeader — Section 1 of the charge profile detail page.
 *
 * Renders the header card with name, charge name, description, tag input,
 * auto-add radio, unit of measure, effective date basis, calculation
 * mode tabs.
 *
 * Pure presentational. Owns no state.
 */
export default function ChargeProfileHeader({
  form,
  update,
  availableTags,
  availableModes,
  isPercentage,
  isNew,
}) {
  return (
    <div className="rounded-xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-5 space-y-4">
      {/* … verbatim contents of Section 1 from pages/settings/charge-profiles/[id].js … */}
    </div>
  );
}
```

In the placeholder, paste **verbatim** the contents of the Section 1 wrapper from the original file. The only allowed transformations:

- `update('X', value)` calls inside event handlers stay as `update('X', value)` (the `update` is now a prop, identical name).
- `form.X` references stay as `form.X` (the `form` is a prop).
- `<TagInput ...>` reference stays — but now it's the imported sibling, not the inline function (already extracted in Task 1.2).
- `CHARGE_NAMES`, `UNITS_OF_MEASURE`, `EFFECTIVE_DATE_OPTIONS`, `availableModes`, `isPercentage`, `isNew` references all resolve to the imports + props at the top.

**Don't change any control types. Don't swap classes. Don't add Plan C tokens. The lesson from Plan G1 Task 4.1: verbatim means verbatim.**

- [ ] **Step 3: Update `pages/settings/charge-profiles/[id].js`**

Find the Section 1 wrapper (line 399's `<div className="rounded-xl border ... p-5 space-y-4">` through its matching close). Replace the entire block with:

```jsx
<ChargeProfileHeader
  form={form}
  update={update}
  availableTags={availableTags}
  availableModes={availableModes}
  isPercentage={isPercentage}
  isNew={isNew}
/>
```

Add the import:

```jsx
import ChargeProfileHeader from '../../../components/settings/charge-profile-detail/ChargeProfileHeader';
```

If any of `CHARGE_NAMES`, `UNITS_OF_MEASURE`, `EFFECTIVE_DATE_OPTIONS`, `TagInput` are no longer used in the page shell, remove those imports too.

- [ ] **Step 4: Verify Gate 1 (payload diff)**

Re-run the derivation script. Expected: empty diff.

- [ ] **Step 5: Verify Gate 2 (smoke test) — controller via MCP**

Open the baseline charge profile in dev. Confirm the header renders identically:
- Name input shows current value
- Charge Name select shows current selection
- Description input shows current value
- Tag chips render
- Auto Add radio is set correctly
- UoM dropdown shows current selection
- Effective Date Basis dropdown shows current selection
- Calculation mode tabs render with the active one highlighted

If something looks different visually, investigate before commit. (Common subagent regression: silently restructuring grid columns or label order.)

- [ ] **Step 6: Commit**

```bash
git add pages/settings/charge-profiles/[id].js components/settings/charge-profile-detail/ChargeProfileHeader.js
git commit -m "$(cat <<'EOF'
refactor(charge-profiles): extract ChargeProfileHeader sub-component

Section 1 of the charge profile detail page (header card with name,
charge_name, description, tag input, auto-add radio, UoM, effective
date basis, calculation mode tabs) moves to its own file. Receives
form + update + a small set of derived values (availableTags,
availableModes, isPercentage, isNew) as props.

Verbatim JSX. Imports CHARGE_NAMES/UNITS_OF_MEASURE/EFFECTIVE_DATE_OPTIONS
directly from lib/charge-profile-constants instead of via the page
shell. The previously-extracted <TagInput> is consumed as a sibling
sub-component.

Verified Gate 1 (payload diff = empty) and Gate 2 (every header field
renders the same value, edits the same field, and the auto-add radio
plus calc-mode tabs both still update form state).

Part of UI Plan G2.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Phase 4: Section 2 (the big one) — atomic decomposition

This is the highest-risk phase. Section 2 is the version box + per-mode row tables, ~300 lines spanning the entire mode-switch render. The 5 new files (`<VersionManager>` + 4 row tables) are tightly coupled — splitting them across commits would mean intermediate commits where the file is broken or only partially refactored. Atomic = bisectable as a single point.

### Task 4.1: Extract `<VersionManager>` and 4 mode-specific row tables

**Files:**
- Create: `components/settings/charge-profile-detail/VersionManager.js` (~100 LoC)
- Create: `components/settings/charge-profile-detail/LaneRowsTable.js` (~80 LoC)
- Create: `components/settings/charge-profile-detail/StatusRowsTable.js` (~50 LoC)
- Create: `components/settings/charge-profile-detail/EventRowsTable.js` (~80 LoC)
- Create: `components/settings/charge-profile-detail/MoveRowsTable.js` (~120 LoC)
- Modify: `pages/settings/charge-profiles/[id].js` (replace the entire Section 2 block with `<VersionManager>`)

- [ ] **Step 1: Read the full Section 2 block**

Read `pages/settings/charge-profiles/[id].js` from line 446 (the Section 2 opening `<div className="rounded-xl border border-blue-200 ...">`) through its matching close just before the Section 3 wrapper at line 744.

Identify:
- Version selector + add/duplicate/remove buttons + per-version metadata fields (label, effective_from, effective_to)
- The mode-switch rendering: `{mode === 'by_lane' && ...}`, `{mode === 'between_statuses' && ...}`, `{mode === 'by_event' && ...}`, `{mode === 'by_move' && ...}`
- The colgroup logic (different col widths per mode)
- The `<tbody>` rendering with row mapping

Note every handler each part uses (`updateVersion`, `addVersion`, `removeVersion`, `duplicateVersion`, `updateRow`, `addRow`, `removeRow`, `addMoveEvent`, `removeMoveEvent`, `updateMoveEvent`).

Note every constant referenced (`EVENT_TYPES`, `EVENT_TIME_OPTIONS`, `MOVE_CALC_FROM`, `MOVE_CALC_TO`, `RADIUS_RATE_TYPES`, `STATUS_OPTIONS`).

- [ ] **Step 2: Plan the split**

Based on the mode-switch branches in Section 2, identify:
- The version-header part (selector + buttons + version metadata) → goes in `<VersionManager>`
- The "by_lane" rows table → goes in `<LaneRowsTable>`
- The "between_statuses" rows table → goes in `<StatusRowsTable>`
- The "by_event" rows table → goes in `<EventRowsTable>`
- The "by_move" rows table → goes in `<MoveRowsTable>`
- Any rendering shared across modes (e.g. the `<table>` wrapper, the colgroup, "Add Charge" button at the bottom) → decision: probably stays in `<VersionManager>` and the row tables only render `<tbody>` contents. **OR** each row table renders its own full `<table>`. Pick whichever requires less restructuring of the original JSX.

Recommended approach: each mode-specific row table renders its OWN full `<table>` (with its own colgroup + thead + tbody). `<VersionManager>` renders the version header, then a switch on mode that picks one of the 4 row tables. That keeps the per-mode JSX in one cohesive block per file instead of split between `<VersionManager>` (table chrome) and `<XxxRowsTable>` (rows).

- [ ] **Step 3: Create `<LaneRowsTable>`**

Create `components/settings/charge-profile-detail/LaneRowsTable.js`. Verbatim cut/paste of the `mode === 'by_lane'` rendering (the colgroup, thead, tbody, and the row-mapping JSX), wrapped in a default-export function:

```jsx
import { Plus, Trash2 } from 'lucide-react';
import LaneLocationCell from './LaneLocationCell';
import CentsInput from '../../ui/CentsInput';

/**
 * LaneRowsTable — "By Lane" mode rows for the charge profile detail page.
 * Origin/dest location pickers via <LaneLocationCell>.
 *
 * Pure presentational. Owns no state.
 */
export default function LaneRowsTable({ rows, onUpdateRow, onRemoveRow, onAddRow, isPercentage }) {
  return (
    <table className="w-full text-sm">
      {/* … verbatim colgroup + thead + tbody from pages/settings/charge-profiles/[id].js
            for the mode === 'by_lane' branch, with these handler substitutions:
              updateRow(rIdx, field, value)  →  onUpdateRow(rIdx, field, value)
              removeRow(rIdx)                →  onRemoveRow(rIdx)
              addRow()                       →  onAddRow()
        … */}
    </table>
  );
}
```

Adjust imports based on what the row JSX actually references (lucide icons, CentsInput, LaneLocationCell, any constants).

- [ ] **Step 4: Create `<StatusRowsTable>`**

Same pattern, for `mode === 'between_statuses'`. Create `components/settings/charge-profile-detail/StatusRowsTable.js`:

```jsx
import { Plus, Trash2 } from 'lucide-react';
import CentsInput from '../../ui/CentsInput';
import { STATUS_OPTIONS } from '../../../lib/charge-profile-constants';

/**
 * StatusRowsTable — "Between Statuses" mode rows for the charge profile
 * detail page. From-status / to-status select fields.
 *
 * Pure presentational. Owns no state.
 */
export default function StatusRowsTable({ rows, onUpdateRow, onRemoveRow, onAddRow, isPercentage }) {
  return (
    <table className="w-full text-sm">
      {/* … verbatim from the mode === 'between_statuses' branch with the same
            handler substitutions … */}
    </table>
  );
}
```

- [ ] **Step 5: Create `<EventRowsTable>`**

Same pattern, for `mode === 'by_event'`. Create `components/settings/charge-profile-detail/EventRowsTable.js`:

```jsx
import { Plus, Trash2 } from 'lucide-react';
import OrgPicker from '../../ui/OrgPicker';
import CentsInput from '../../ui/CentsInput';
import { EVENT_TYPES, LOCATION_TYPES } from '../../../lib/charge-profile-constants';
// (LOCATION_TYPES is in lib/charge-profile-row-shapes from Task 1.1; choose one source)

/**
 * EventRowsTable — "By Event" mode rows for the charge profile detail
 * page. Event-type select + location picker (org/city-state/zip).
 *
 * Pure presentational. Owns no state.
 */
export default function EventRowsTable({ rows, onUpdateRow, onRemoveRow, onAddRow, isPercentage }) {
  return (
    <table className="w-full text-sm">
      {/* … verbatim from the mode === 'by_event' branch with the same
            handler substitutions … */}
    </table>
  );
}
```

(For LOCATION_TYPES: it lives in `lib/charge-profile-row-shapes.js` after Task 1.1. Import from there. If the original used `LOCATION_TYPES` from a different lib, switch to the row-shapes version since they're identical.)

- [ ] **Step 6: Create `<MoveRowsTable>`**

The most complex. For `mode === 'by_move'`. Create `components/settings/charge-profile-detail/MoveRowsTable.js`:

```jsx
import { Plus, Trash2 } from 'lucide-react';
import OrgPicker from '../../ui/OrgPicker';
import CentsInput from '../../ui/CentsInput';
import {
  EVENT_TYPES,
  EVENT_TIME_OPTIONS,
  MOVE_CALC_FROM,
  MOVE_CALC_TO,
} from '../../../lib/charge-profile-constants';

/**
 * MoveRowsTable — "By Move" mode rows for the charge profile detail page.
 * Each row contains a nested sub-list of move events with their own
 * add/remove/update handlers.
 *
 * Most complex of the 4 mode tables. Pure presentational. Owns no state.
 */
export default function MoveRowsTable({
  rows,
  onUpdateRow,
  onRemoveRow,
  onAddRow,
  onAddMoveEvent,
  onRemoveMoveEvent,
  onUpdateMoveEvent,
  isPercentage,
}) {
  return (
    <table className="w-full text-sm">
      {/* … verbatim from the mode === 'by_move' branch with these
            handler substitutions:
              updateRow(rIdx, field, value)        →  onUpdateRow(rIdx, field, value)
              removeRow(rIdx)                      →  onRemoveRow(rIdx)
              addRow()                             →  onAddRow()
              addMoveEvent(rIdx)                   →  onAddMoveEvent(rIdx)
              removeMoveEvent(rIdx, eIdx)          →  onRemoveMoveEvent(rIdx, eIdx)
              updateMoveEvent(rIdx, eIdx, f, v)    →  onUpdateMoveEvent(rIdx, eIdx, f, v)
        … */}
    </table>
  );
}
```

- [ ] **Step 7: Create `<VersionManager>`**

Create `components/settings/charge-profile-detail/VersionManager.js`. This is the parent. It renders the version header (selector + buttons + metadata) and dispatches to the right row table:

```jsx
import { Plus, Copy, Trash2 } from 'lucide-react';
import LaneRowsTable from './LaneRowsTable';
import StatusRowsTable from './StatusRowsTable';
import EventRowsTable from './EventRowsTable';
import MoveRowsTable from './MoveRowsTable';
// (plus DatePicker, Select, Button, etc. as needed for the version header)

/**
 * VersionManager — Section 2 of the charge profile detail page.
 *
 * Renders the version selector + add/duplicate/remove buttons + per-version
 * metadata (label, effective dates), then dispatches to one of 4 mode-
 * specific row tables based on `mode`.
 *
 * Pure presentational. Owns no state.
 */
export default function VersionManager({
  versions,
  activeVersionIdx,
  mode,
  onSelectVersion,
  onUpdateVersion,
  onAddVersion,
  onRemoveVersion,
  onDuplicateVersion,
  onUpdateRow,
  onAddRow,
  onRemoveRow,
  onAddMoveEvent,
  onRemoveMoveEvent,
  onUpdateMoveEvent,
  isPercentage,
}) {
  const activeVersion = versions[activeVersionIdx] || versions[0];

  return (
    <div className="rounded-xl border border-blue-200 dark:border-blue-800 bg-blue-50/30 dark:bg-blue-950/40">
      {/* … verbatim version header from the original Section 2 (the version
            selector dropdown, add/duplicate/remove buttons, and the
            label/effective_from/effective_to inputs), with these handler
            substitutions:
              setActiveVersionIdx                  →  onSelectVersion
              updateVersion(field, value)          →  onUpdateVersion(field, value)
              addVersion()                         →  onAddVersion()
              removeVersion()                      →  onRemoveVersion()
              duplicateVersion()                   →  onDuplicateVersion()
        … */}

      {/* Mode dispatch */}
      <div className="p-4">
        {mode === 'by_lane' && (
          <LaneRowsTable
            rows={activeVersion.rows}
            onUpdateRow={onUpdateRow}
            onRemoveRow={onRemoveRow}
            onAddRow={onAddRow}
            isPercentage={isPercentage}
          />
        )}
        {mode === 'between_statuses' && (
          <StatusRowsTable
            rows={activeVersion.rows}
            onUpdateRow={onUpdateRow}
            onRemoveRow={onRemoveRow}
            onAddRow={onAddRow}
            isPercentage={isPercentage}
          />
        )}
        {mode === 'by_event' && (
          <EventRowsTable
            rows={activeVersion.rows}
            onUpdateRow={onUpdateRow}
            onRemoveRow={onRemoveRow}
            onAddRow={onAddRow}
            isPercentage={isPercentage}
          />
        )}
        {mode === 'by_move' && (
          <MoveRowsTable
            rows={activeVersion.rows}
            onUpdateRow={onUpdateRow}
            onRemoveRow={onRemoveRow}
            onAddRow={onAddRow}
            onAddMoveEvent={onAddMoveEvent}
            onRemoveMoveEvent={onRemoveMoveEvent}
            onUpdateMoveEvent={onUpdateMoveEvent}
            isPercentage={isPercentage}
          />
        )}
      </div>
    </div>
  );
}
```

The `mode === 'by_move' && activeVersion.rows.length > 0 && ...` guard from line 538 of the original file — preserve any pre-render guards exactly (e.g. if there's a "no rows yet" empty state, it stays inside the relevant row table or in `<VersionManager>` at the dispatch point).

- [ ] **Step 8: Update `pages/settings/charge-profiles/[id].js`**

Find the Section 2 block (line 446 through its matching close). Replace with:

```jsx
<VersionManager
  versions={versions}
  activeVersionIdx={activeVersionIdx}
  mode={form.calculation_mode}
  onSelectVersion={setActiveVersionIdx}
  onUpdateVersion={updateVersion}
  onAddVersion={addVersion}
  onRemoveVersion={removeVersion}
  onDuplicateVersion={duplicateVersion}
  onUpdateRow={updateRow}
  onAddRow={addRow}
  onRemoveRow={removeRow}
  onAddMoveEvent={addMoveEvent}
  onRemoveMoveEvent={removeMoveEvent}
  onUpdateMoveEvent={updateMoveEvent}
  isPercentage={isPercentage}
/>
```

Add the import:

```jsx
import VersionManager from '../../../components/settings/charge-profile-detail/VersionManager';
```

After Section 2 is gone, many constants and components are no longer used in the page shell. Clean up imports — remove anything no longer referenced (likely: `EVENT_TYPES`, `EVENT_TIME_OPTIONS`, `MOVE_CALC_FROM`, `MOVE_CALC_TO`, `RADIUS_RATE_TYPES`, `OrgPicker`, `CentsInput`, `DatePicker`, several lucide icons, `LaneLocationCell`).

- [ ] **Step 9: Verify compile**

Run: `npm run build 2>&1 | grep -E "(charge-profiles/\[id\]\.js|VersionManager|LaneRowsTable|StatusRowsTable|EventRowsTable|MoveRowsTable)"`
Expected: no new errors.

- [ ] **Step 10: Verify Gate 1 (payload diff) — CRITICAL**

This is the highest-risk commit in Plan G2. Re-run the derivation script. **Empty diff required.** If it's not empty, STOP and investigate.

- [ ] **Step 11: Verify Gate 2 (smoke test)**

Open the baseline charge profile in dev. For EACH of the 4 modes:

1. Switch the calculation mode tab to that mode (via the header tab strip in Section 1)
2. Confirm the version manager renders the appropriate row table for that mode
3. Click "+ Add Charge" / "Add row" — confirm a new row appears
4. Edit a field in the new row — confirm the value updates in React DevTools
5. Click the row's trash button — confirm the row disappears
6. (Only for "by_move"): click "+ Add Move Event" inside an existing row, confirm a sub-event row appears, edit/remove it

If something breaks — even visually — investigate before commit.

- [ ] **Step 12: Commit**

```bash
git add pages/settings/charge-profiles/[id].js components/settings/charge-profile-detail/VersionManager.js components/settings/charge-profile-detail/LaneRowsTable.js components/settings/charge-profile-detail/StatusRowsTable.js components/settings/charge-profile-detail/EventRowsTable.js components/settings/charge-profile-detail/MoveRowsTable.js
git commit -m "$(cat <<'EOF'
refactor(charge-profiles): extract VersionManager + 4 mode row tables

Section 2 of the charge profile detail page (the version box + the
mode-switch render) decomposes into 5 new files in
components/settings/charge-profile-detail/:

  - VersionManager.js: parent. Renders the version selector + add/
    duplicate/remove buttons + version metadata, then dispatches to
    one of 4 row tables based on mode.
  - LaneRowsTable.js: "By Lane" mode rows.
  - StatusRowsTable.js: "Between Statuses" mode rows.
  - EventRowsTable.js: "By Event" mode rows.
  - MoveRowsTable.js: "By Move" mode rows. Most complex — has the
    nested move-event sub-list with its own add/remove/update.

Atomic commit because the 5 files are tightly coupled — splitting
them across commits would create intermediate states where the file
is broken or only partially refactored.

Adding a 5th calculation mode in the future is now: add a 5th file
under charge-profile-detail/ + a 1-line case in VersionManager's
mode switch.

Page shell shrinks substantially — many constants and components
(EVENT_TYPES, MOVE_CALC_FROM, OrgPicker, CentsInput, DatePicker,
LaneLocationCell, several lucide icons) are no longer referenced
and have their imports removed.

Verified Gate 1 (payload diff = empty) and Gate 2 (each of the 4
calc modes renders, adds rows, edits fields, removes rows; by_move's
nested move-events also work).

Part of UI Plan G2.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Phase 5: Final QA + push

### Task 5.1: Whole-plan verification + push

- [ ] **Step 1: Confirm final file shape**

```bash
wc -l pages/settings/charge-profiles/[id].js
```
Expected: ~250 lines (down from 811).

```bash
ls -la components/settings/charge-profile-detail/
```
Expected: 9 files (TagInput, LaneLocationCell, ChargeProfileHeader, VersionManager, LaneRowsTable, StatusRowsTable, EventRowsTable, MoveRowsTable, RulesPanel, MatchResolutionPanel — counting 10 actually).

```bash
ls -la lib/charge-profile-row-shapes.js
```
Expected: file exists.

- [ ] **Step 2: Clean build**

```bash
npm run build 2>&1 | grep -E "(charge-profile|tariff)" | head -20
```

Expected: no NEW errors specific to charge-profile files. Pre-existing lint warnings elsewhere are unchanged.

- [ ] **Step 3: Final smoke test against the baseline charge profile**

Restart dev server if needed (build clobbers `.next`):
```bash
rm -rf .next
# then mcp__Claude_Preview__preview_start
```

Open the baseline charge profile and exhaustively walk:
- Header section: every field
- Version box: switch versions, add/duplicate/remove a version
- Switch through all 4 calc modes
- For each mode: add a row, edit, remove
- Rules panel: add a rule, modify, save
- Match resolution: change selection
- Save the profile → reopen → all values persisted

- [ ] **Step 4: Final payload verification**

Re-run derivation script. Empty diff against baseline. Required.

- [ ] **Step 5: Engine canary (USER walks this)**

Tell the user it's time for Gate 3:

> "Plan G2 is fully refactored and Gates 1 + 2 are clean. Gate 3 is the engine canary — it requires you to walk a real load through the system and confirm the calculated billing amounts match what they were before. Specifically:
>
> 1. Open the baseline tariff (`All Customers Import Tariff`) — confirm the 3 attached charge profiles still show on the right panel
> 2. Open a load assigned to that tariff's customer — confirm the same charges still auto-populate with the same rates
> 3. (Bonus) For a load with nuanced pricing (per-day per-diem, percentage fuel surcharge), confirm the calculated amounts match
>
> If anything looks off, stop and tell me. If everything matches, give me the green light to push."

Wait for user confirmation before the next step.

- [ ] **Step 6: Verify the overlay use case still works**

`ChargeProfileForm` is dual-purpose. Search for callers that pass `chargeProfileId` + `onClose`:

```bash
grep -rn "ChargeProfileForm\|chargeProfileId" components/ pages/ --include="*.js" | head -10
```

If any caller exists, manually verify it still mounts/closes correctly. If no caller exists in the current routing (the overlay path is dead code), document this in the commit message and skip the live test.

- [ ] **Step 7: Git log sanity**

```bash
git log --oneline cdcb84b..HEAD
```

Expected: 8 commits (Phase 1 = 3, Phase 2 = 2, Phase 3 = 1, Phase 4 = 1, plus the spec commit `cdcb84b` itself which is the boundary). All ending with `Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>`.

- [ ] **Step 8: Push**

```bash
git push origin main
```

Write a brief release note in chat summarizing what shipped.

---

## Summary

8 commits across 5 phases. 1 new shared lib file, 10 new sub-components in `components/settings/charge-profile-detail/`, `pages/settings/charge-profiles/[id].js` shrinks from 811 LoC to ~250 LoC. Zero behavior change verified at every commit via payload diffs against a baseline charge profile.

The AR pricing module's most-complex data-entry surface is now decomposable. Future plans (the autofill rule, percentage-of-base UI, conflict-resolution config UI) drop into focused files instead of editing a monolith. Adding a 5th calculation mode = 1 new file + 1 line in `<VersionManager>`'s switch.

Plan G3 (`driver-tariffs/[id].js`, 920 LoC, AP side) follows the same pattern when the user is ready. The `lib/charge-profile-row-shapes.js` from Task 1.1 may be reusable if the AP rows share shapes; otherwise G3 ships its own driver-pay-row-shapes lib.
