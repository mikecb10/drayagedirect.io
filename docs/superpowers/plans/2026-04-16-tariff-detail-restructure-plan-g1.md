# Tariff Detail Page Restructure — Plan G1 Implementation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Decompose `pages/settings/tariffs/[id].js` (977 LoC) into a thin page shell + 4 focused sub-components + 2 promoted primitives, with **zero behavior change** to the AR matching engine, payload shape, or charge-autopulldown into loads.

**Architecture:** Page shell at `pages/settings/tariffs/[id].js` retains all 8 useState hooks, all useEffects, all handlers (`update`, `toggleLoadType`, `addChargeSet`, etc.), and `handleSave`/`handleCancel`. New sub-components in `components/settings/tariff-detail/` are dumb — they receive value-props and onChange-props and render JSX. Two truly-shared pickers (`<LoadTypeChips>`, `<EffectiveDateRange>`) get promoted to `components/ui/`.

**Tech Stack:** Next.js 15 (Pages Router), React 19, Tailwind v4. The default export of `pages/settings/tariffs/[id].js` is `TariffForm`, which is dual-purpose: as a route page it wraps in `<SettingsLayout>`; when invoked with `tariffId` + `onClose` props (overlay mode, e.g. from `components/settings/TariffDetail.js`) it renders without `<SettingsLayout>`. **Both modes must continue to work.**

**Spec:** `docs/superpowers/specs/2026-04-16-tariff-detail-restructure-design.md`

**Exemplars:**
- Plan E's settings shell decomposition (`components/settings/SettingsLayout.js` + sub-shells) — same "page shell owns state, sub-components are dumb" pattern.
- `pages/settings/profile.js` — design-system token application.

---

## Hard rule: zero behavior change

Bake into every commit:

- `handleSave` payload (the JSON sent to `/api/tenant/tariffs/...` and `/api/tenant/tariffs/{id}/charge-sets`) must be byte-identical before and after. Verified via Gate 1 (Task 0).
- The 8 useState hooks at the top of `TariffForm` stay exactly as they are. No `useReducer`, no per-component state extraction.
- Every `useEffect` stays in the page shell unchanged.
- The matching engine and the load-side autopulldown of charges are not touched at all.
- The two-panel layout (left matching panel ~280–320px wide, right charge-sets panel) is preserved.
- The dual-mode default export (page-mode + overlay-mode) is preserved. `components/settings/TariffDetail.js` continues to import `TariffForm` from `pages/settings/tariffs/[id]` and pass `{ tariffId, onClose }`.

If a step would require even a key reordering in the saved payload, fix the step before commit, not after.

---

## File structure (target state)

```
pages/settings/tariffs/[id].js                           (~150 LoC — was 977)
  └─ Owns: state hooks, useEffects, all handlers, handleSave, handleCancel,
           dual-mode render (overlay vs page).

components/settings/tariff-detail/
  ├─ TariffHeader.js                  (~50 LoC)
  │    Title + Basic/Advanced Route Matching tab toggle.
  │
  ├─ TariffMatchingPanel.js           (~250 LoC)
  │    Left panel: name, draft, dates, load types, customers, location filters,
  │    container/SSL/CSR/chassis fields, flags, additional conditions toggle.
  │
  ├─ TariffChargeSetsPanel.js         (~250 LoC)
  │    Right panel: charge sets (each with bill-to picker, profile chips,
  │    items table). "+ Add Charge Set" button. "Select Charge Profiles"
  │    trigger that calls onOpenProfilePicker.
  │
  └─ ChargeProfilePickerModal.js      (~210 LoC)
       Extracted verbatim from the bottom of [id].js. Same props.

components/ui/
  ├─ LoadTypeChips.js                 (~50 LoC, NEW promoted primitive)
  │    <LoadTypeChips value={form.load_types} onChange={...} options={LOAD_TYPES} />
  │
  └─ EffectiveDateRange.js            (~60 LoC, NEW promoted primitive)
       <EffectiveDateRange start={...} end={...}
                           onStartChange={...} onEndChange={...} />
```

**Note on the Advanced Route Matching tab:** during code review for this plan, we discovered the tab toggle persists state to `form.matching_mode` but **no render branch exists in the current code** — the same Basic-tab content always renders regardless of `matching_mode`. So there is no `<TariffAdvancedRoute />` to extract. The tab toggle stays in `TariffHeader`. When the Advanced Route render branch is built later, it can be a new sub-component then. We add an inline code comment in `TariffHeader.js` noting this.

---

## Phase 0: Establish payload baseline (verification setup)

Before any code change, capture the current payload from a representative existing tariff. This is the baseline every later commit diffs against.

### Task 0.1: Capture baseline payload

**Files:** None modified. Creates `tmp/tariff-payload-baseline.json` (gitignored).

- [ ] **Step 1: Confirm `tmp/` is gitignored**

Run:
```bash
grep -E "^tmp/?$|^/tmp/?$" .gitignore || echo "MISSING — add tmp/ to .gitignore"
```

Expected: prints either a matching line or `MISSING`. If MISSING, append `tmp/` to `.gitignore` and commit it as `chore: ignore tmp/ baseline files`.

- [ ] **Step 2: Pick a representative existing tariff**

Open the dev server (`mcp__Claude_Preview__preview_start name="next-dev"` if not running). Navigate to `/settings/tariffs` and pick a tariff that has both customers and at least one charge set with profiles. The "CH ROBINSON Tariff" mentioned in `feature_tariffs_charges.md` is a good candidate.

Capture the tariff ID from the URL when you open it.

- [ ] **Step 3: Capture baseline POST/PUT payloads via DevTools Network**

In the dev server browser:
1. Open DevTools → Network tab → filter by "tariffs"
2. Open `/settings/tariffs/<id>` and let the GET load
3. Click Save (no edits — this is a no-op save)
4. Right-click the `PUT /api/tenant/tariffs/<id>` request → Copy → Copy as cURL (or copy the request body directly)
5. Right-click the follow-up `PUT /api/tenant/tariffs/<id>/charge-sets` request → copy its body too

Save both bodies to:
- `tmp/tariff-payload-baseline.json` (the main PUT body)
- `tmp/charge-sets-payload-baseline.json` (the charge-sets PUT body)

- [ ] **Step 4: Document the baseline tariff and how to re-verify**

Append to `tmp/HOW-TO-VERIFY.md` (also gitignored):
```
Baseline tariff: <id>
Captured: <date>

To verify a refactor commit:
1. Re-open /settings/tariffs/<id> in dev
2. Click Save (no edits)
3. Capture the PUT bodies from Network tab
4. diff against tmp/tariff-payload-baseline.json and tmp/charge-sets-payload-baseline.json
5. Differences must be only in whitespace or key ordering. ANY structural difference = revert.
```

- [ ] **Step 5: No commit needed for this task**

`tmp/` is gitignored, so nothing to commit. The baseline files exist on disk for the rest of the plan to reference.

---

## Phase 1: Promote shared primitives

Two tiny components that AP (driver-tariffs) will obviously need too. Promote now to skip a copy-rename later. They have no dependency on the rest of the file, so they can ship independently.

### Task 1.1: Create `<LoadTypeChips>` primitive

**Context:** Currently inline at lines ~448–460 of `pages/settings/tariffs/[id].js`. A multi-select chip group bound to `form.load_types`. Generic — takes options as a prop.

**Files:**
- Create: `components/ui/LoadTypeChips.js` (~50 LoC)

- [ ] **Step 1: Read the current inline implementation for reference**

Read `pages/settings/tariffs/[id].js` lines 440–470 to see the exact JSX for the load-type chip selector. Note the styling: rounded chips, blue background when selected, gray border when not.

- [ ] **Step 2: Create the component file**

Write `components/ui/LoadTypeChips.js`:

```jsx
/**
 * LoadTypeChips — multi-select chip group for load type values.
 *
 * Pure presentational. No internal state. Caller passes the options array
 * (e.g. [{value:'IMPORT', label:'Import'}, ...]) and the current selected
 * values; we render one chip per option and emit the next array on toggle.
 *
 *   <LoadTypeChips
 *     value={form.load_types}                 // string[]
 *     onChange={(next) => update('load_types', next)}
 *     options={LOAD_TYPES}                     // [{value, label}]
 *   />
 *
 * Originally inlined in pages/settings/tariffs/[id].js. Promoted to
 * components/ui/ in Plan G1 because the AP driver-tariffs page (Plan G3)
 * will need the same selector.
 */
export default function LoadTypeChips({ value = [], onChange, options = [] }) {
  function toggle(optValue) {
    const next = value.includes(optValue)
      ? value.filter((v) => v !== optValue)
      : [...value, optValue];
    onChange(next);
  }

  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((opt) => {
        const selected = value.includes(opt.value);
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => toggle(opt.value)}
            className={`px-2.5 py-1 rounded text-xs font-medium border transition-colors ${
              selected
                ? 'bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 border-blue-300 dark:border-blue-700'
                : 'bg-white dark:bg-slate-900 text-gray-600 dark:text-slate-300 border-gray-300 dark:border-slate-600 hover:border-gray-400 dark:hover:border-slate-500'
            }`}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 3: Verify compile**

Run: `npm run build 2>&1 | grep "LoadTypeChips"`
Expected: empty output (no errors). Pre-existing lint elsewhere unrelated.

- [ ] **Step 4: Commit**

```bash
git add components/ui/LoadTypeChips.js
git commit -m "$(cat <<'EOF'
feat(ui): add LoadTypeChips primitive

Multi-select chip group for load type values. Originally inlined in
pages/settings/tariffs/[id].js — promoted to components/ui/ as part of
Plan G1 because the AP driver-tariffs refactor (Plan G3) will need the
same selector.

Pure presentational, no internal state. Caller passes options and
current value; component emits next array on toggle.

Part of UI Plan G1.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
EOF
)"
```

---

### Task 1.2: Create `<EffectiveDateRange>` primitive

**Context:** Currently inline at lines ~412–432 — start date and end date pickers stacked. Tariffs and charge profiles both use the same pair, so promote.

**Files:**
- Create: `components/ui/EffectiveDateRange.js` (~60 LoC)

- [ ] **Step 1: Create the component file**

Write `components/ui/EffectiveDateRange.js`:

```jsx
import DatePicker from './DatePicker';

/**
 * EffectiveDateRange — paired start/end DatePicker fields with consistent
 * labels. Used wherever a record has effective_start/effective_end dates
 * (tariffs, charge profiles, driver tariffs).
 *
 *   <EffectiveDateRange
 *     start={form.effective_start}
 *     end={form.effective_end}
 *     onStartChange={(val) => update('effective_start', val)}
 *     onEndChange={(val) => update('effective_end', val)}
 *     startLabel="Effective Start Date"   // optional, defaults shown
 *     endLabel="Effective End Date"       // optional
 *     startRequired                        // optional, prepends *
 *   />
 *
 * Originally inlined in pages/settings/tariffs/[id].js. Promoted in
 * Plan G1 for AP driver-tariffs reuse (Plan G3) and charge-profile reuse
 * (Plan G2).
 */
export default function EffectiveDateRange({
  start,
  end,
  onStartChange,
  onEndChange,
  startLabel = 'Effective Start Date',
  endLabel = 'Effective End Date',
  startRequired = false,
  endRequired = false,
}) {
  return (
    <>
      <div>
        <label className="block text-xs font-medium text-gray-600 dark:text-slate-300 mb-1">
          {startRequired && '* '}
          {startLabel}
        </label>
        <DatePicker
          value={start || ''}
          onChange={onStartChange}
          placeholder="Select start date"
        />
      </div>
      <div>
        <label className="block text-xs font-medium text-gray-600 dark:text-slate-300 mb-1">
          {endRequired && '* '}
          {endLabel}
        </label>
        <DatePicker
          value={end || ''}
          onChange={onEndChange}
          placeholder="Select end date"
        />
      </div>
    </>
  );
}
```

- [ ] **Step 2: Verify compile**

Run: `npm run build 2>&1 | grep "EffectiveDateRange"`
Expected: empty output.

- [ ] **Step 3: Commit**

```bash
git add components/ui/EffectiveDateRange.js
git commit -m "$(cat <<'EOF'
feat(ui): add EffectiveDateRange primitive

Paired start/end DatePicker fields with consistent labels. Originally
inlined in pages/settings/tariffs/[id].js — promoted to components/ui/
as part of Plan G1 for reuse in the upcoming charge-profile (G2) and
driver-tariffs (G3) refactors.

Renders as two siblings (no wrapping div) so the parent's grid/stack
layout governs spacing. Optional startLabel/endLabel/startRequired/
endRequired props for flexibility.

Part of UI Plan G1.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Phase 2: Extract `<ChargeProfilePickerModal>`

Already a self-contained sub-function inside `[id].js` at line 744. Verbatim cut/paste with no behavior change.

### Task 2.1: Move `ChargeProfilePickerModal` to its own file

**Files:**
- Create: `components/settings/tariff-detail/ChargeProfilePickerModal.js` (~210 LoC)
- Modify: `pages/settings/tariffs/[id].js` (remove the function, add import)

- [ ] **Step 1: Read the function in `[id].js`**

Read `pages/settings/tariffs/[id].js` from line 744 to end of file (end of `ChargeProfilePickerModal`). Note its imports (Modal, Button, the `CHARGE_NAMES`/`UNITS_OF_MEASURE` constants if any).

- [ ] **Step 2: Create the new file**

Create `components/settings/tariff-detail/ChargeProfilePickerModal.js`. Copy the entire `function ChargeProfilePickerModal({ isOpen, onClose, onSelect, existingIds = [] }) { … }` body verbatim. At the top of the new file, add the imports it needs (look at what symbols the function references; copy the corresponding import lines from `[id].js`). Convert the function to a default export:

```jsx
import { useEffect, useState } from 'react';
import { Search, X, Check } from 'lucide-react';
import Modal from '../../ui/Modal';
import Button from '../../ui/Button';
import { CHARGE_NAMES, chargeNameLabel } from '../../../lib/charge-profile-constants';

/**
 * ChargeProfilePickerModal — modal for selecting one or more existing
 * charge profiles to attach to a tariff's charge set.
 *
 * Originally defined inside pages/settings/tariffs/[id].js (line 744).
 * Extracted to its own file in Plan G1 with no behavior change.
 *
 * Props (unchanged from inline version):
 *   isOpen        - boolean
 *   onClose       - () => void
 *   onSelect      - (profiles: ChargeProfile[]) => void
 *   existingIds   - charge_profile.id[] already attached (filtered out)
 */
export default function ChargeProfilePickerModal({ isOpen, onClose, onSelect, existingIds = [] }) {
  // … [verbatim function body from [id].js line 744 through end of function] …
}
```

(The exact import set depends on what the function uses — when reading `[id].js`, list every named symbol the function references from outside its body and copy the matching imports. Don't omit any.)

- [ ] **Step 3: Update `pages/settings/tariffs/[id].js`**

Remove the inline `function ChargeProfilePickerModal(...) { ... }` definition (lines 744 to end of function — likely ~210 lines).

Add an import at the top of the file (alongside existing imports):
```jsx
import ChargeProfilePickerModal from '../../../components/settings/tariff-detail/ChargeProfilePickerModal';
```

Leave the JSX usage of `<ChargeProfilePickerModal ... />` (around line 720) exactly as it is — the import resolves it from the new location.

- [ ] **Step 4: Verify compile**

Run: `npm run build 2>&1 | grep -E "(tariffs/\[id\]\.js|ChargeProfilePickerModal\.js)"`
Expected: no new errors. Pre-existing lint warnings on `[id].js` unrelated to this change may still appear — that's fine.

- [ ] **Step 5: Verify smoke test (Gate 2)**

Dev server should be running. Use preview MCP:
1. Navigate to the baseline tariff: `window.location.href = 'http://localhost:<port>/settings/tariffs/<baseline-id>'`
2. Wait for load
3. Click "Select Charge Profiles" inside an existing charge set — confirm the modal opens
4. Confirm filters work (search, charge name dropdown, tag dropdown)
5. Toggle a checkbox to select a profile
6. Confirm the modal still functions identically

- [ ] **Step 6: Verify payload (Gate 1)**

Open DevTools Network. Click Save (no edits). Capture `PUT /api/tenant/tariffs/<id>` body. Diff against `tmp/tariff-payload-baseline.json`:

```bash
diff <(cat tmp/tariff-payload-baseline.json | jq -S .) <(echo '<paste new body>' | jq -S .)
```

Expected: empty diff (modulo whitespace/key order).

- [ ] **Step 7: Commit**

```bash
git add pages/settings/tariffs/[id].js components/settings/tariff-detail/ChargeProfilePickerModal.js
git commit -m "$(cat <<'EOF'
refactor(tariffs): extract ChargeProfilePickerModal to its own file

Move the ChargeProfilePickerModal sub-function from the bottom of
pages/settings/tariffs/[id].js (~210 LoC) into
components/settings/tariff-detail/ChargeProfilePickerModal.js. Same
props, same behavior, same imports. Verbatim cut/paste.

Verified Gate 1 (payload diff against baseline = empty) and Gate 2
(modal opens, filters work, save round-trips identically).

Part of UI Plan G1.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Phase 3: Extract `<TariffHeader>`

Smallest of the four sub-components. Title bar + Basic/Advanced tab toggle.

### Task 3.1: Create `TariffHeader` and wire it up

**Files:**
- Create: `components/settings/tariff-detail/TariffHeader.js` (~50 LoC)
- Modify: `pages/settings/tariffs/[id].js` (replace the header JSX with `<TariffHeader>`)

- [ ] **Step 1: Create the component**

Write `components/settings/tariff-detail/TariffHeader.js`:

```jsx
/**
 * TariffHeader — title bar + Basic/Advanced Route Matching tab toggle.
 *
 * Part of the Plan G1 decomposition of pages/settings/tariffs/[id].js.
 * Pure presentational; receives matchingMode + onMatchingModeChange.
 *
 * NOTE on Advanced Route Matching: the tab toggle persists state to
 * form.matching_mode (which is saved with the tariff), but the page
 * does NOT currently render a different content branch when
 * matching_mode === 'advanced_route'. Picking the Advanced tab is a
 * no-op visually beyond the toggle highlight. When the Advanced Route
 * render branch is built, it should live in its own sub-component
 * (e.g. <TariffAdvancedRoute />) and get conditionally rendered from
 * pages/settings/tariffs/[id].js, NOT here.
 */
export default function TariffHeader({ matchingMode, onMatchingModeChange }) {
  return (
    <div className="flex items-center justify-between mb-5">
      <h1 className="text-base font-semibold text-strong">Load Tariff</h1>
      <div className="flex items-center gap-2 text-helper text-muted">
        <button
          type="button"
          onClick={() => onMatchingModeChange('basic')}
          className={`px-3 py-1 rounded ${
            matchingMode === 'basic'
              ? 'bg-gray-200 dark:bg-slate-700 text-strong font-semibold'
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
              ? 'bg-gray-200 dark:bg-slate-700 text-strong font-semibold'
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

Note the small Plan C token cleanup: `text-gray-900 dark:text-slate-100` → `text-strong`, `text-gray-400 dark:text-slate-500` → `text-muted`. These are the only token swaps in this component.

- [ ] **Step 2: Update `pages/settings/tariffs/[id].js`**

Add the import alongside other imports:
```jsx
import TariffHeader from '../../../components/settings/tariff-detail/TariffHeader';
```

Find the existing header JSX (around lines 364–377) — the `<div className="flex items-center justify-between mb-5">` block ending right before `{error && <Alert ... />}`. Replace it with:

```jsx
<TariffHeader
  matchingMode={form.matching_mode}
  onMatchingModeChange={(mode) => update('matching_mode', mode)}
/>
```

- [ ] **Step 3: Verify compile**

Run: `npm run build 2>&1 | grep -E "(tariffs/\[id\]\.js|TariffHeader\.js)"`
Expected: no new errors.

- [ ] **Step 4: Verify smoke test (Gate 2)**

Open the baseline tariff in dev. Confirm:
- Title "Load Tariff" displays
- Basic tab is highlighted by default
- Clicking Advanced Route Matching highlights it (and updates `form.matching_mode` — verify in React DevTools or by saving and re-opening)
- Clicking Basic re-highlights Basic
- Tab styling identical to before (gray pill on active, hover on inactive)

- [ ] **Step 5: Verify payload (Gate 1)**

Save (no edits). Diff payload against baseline. Expected: empty diff.

- [ ] **Step 6: Commit**

```bash
git add pages/settings/tariffs/[id].js components/settings/tariff-detail/TariffHeader.js
git commit -m "$(cat <<'EOF'
refactor(tariffs): extract TariffHeader sub-component

Move the title bar + Basic/Advanced Route Matching tab toggle from
pages/settings/tariffs/[id].js into TariffHeader.js. Pure presentational,
receives matchingMode + onMatchingModeChange. Minor token swaps
(text-gray-* → text-strong/text-muted) per Plan C convention; no
layout change.

Inline comment notes that the Advanced Route Matching tab persists
state but does not yet have a render branch.

Verified Gate 1 (payload diff = empty) and Gate 2 (toggle behaves
identically, mode persists across save).

Part of UI Plan G1.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Phase 4: Extract `<TariffMatchingPanel>`

The biggest sub-component. ~180 lines of left-panel JSX (lines ~387–571 today).

### Task 4.1: Create `TariffMatchingPanel` and wire it up

**Files:**
- Create: `components/settings/tariff-detail/TariffMatchingPanel.js` (~250 LoC)
- Modify: `pages/settings/tariffs/[id].js` (replace the left-panel JSX with `<TariffMatchingPanel>`)

- [ ] **Step 1: Read the existing left panel**

Read `pages/settings/tariffs/[id].js` lines 384–571. Identify every form field: name, draft, dates, load types, customers, pickup/delivery/return location pickers, additional load conditions toggle, container type, container size, SSL, CSR, chassis fields, flags. Note which handlers each field uses (`update`, `toggleLoadType`, `toggleFlag`, `toggleLocationAll`, `addLocationId`, `removeLocationId`, `isLocationAll`).

- [ ] **Step 2: Identify the LOAD_TYPES + FLAG_DEFS constants**

Lines 22–28 define `LOAD_TYPES`, lines 31–45 define `FLAG_DEFS`. These are used inside the left panel's JSX. Decision: leave the constants in `pages/settings/tariffs/[id].js` and pass them as props OR move them to the new sub-component file. Choice: **move to the sub-component file** since they're only used by left-panel JSX. The sub-component becomes the owner of those domain constants.

- [ ] **Step 3: Create the component**

Write `components/settings/tariff-detail/TariffMatchingPanel.js`. The structure:

```jsx
import { useState } from 'react';
import { Info, ChevronDown, X } from 'lucide-react';
import OrgPicker from '../../ui/OrgPicker';
import ReferenceDataPicker from '../../ui/ReferenceDataPicker';
import ContainerOwnerPicker from '../../ui/ContainerOwnerPicker';
import LoadTypeChips from '../../ui/LoadTypeChips';
import EffectiveDateRange from '../../ui/EffectiveDateRange';

// Load types available in tariffs.
// Mirrors the canonical LOAD_TYPES list in components/loads/NewLoadModal.js,
// EXCLUDING 'Bill Only' — bill-only loads are manual one-offs (no operations,
// just an invoice) so they should never be matched by an automated tariff.
const LOAD_TYPES = [
  { value: 'IMPORT', label: 'Import' },
  { value: 'INBOUND', label: 'Inbound' },
  { value: 'EXPORT', label: 'Export' },
  { value: 'OUTBOUND', label: 'Outbound' },
  { value: 'ROAD', label: 'Road' },
];

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
 * TariffMatchingPanel — left panel of the tariff detail page.
 *
 * Owns no state of its own beyond a local "show additional conditions" toggle
 * (the parent already has showAdditional in state — passed as prop). Receives
 * the entire form object plus handler callbacks and renders all the matching
 * conditions: name, draft, dates, load types, customers, location filters,
 * container/SSL/CSR/chassis fields, flags.
 *
 * Part of the Plan G1 decomposition. Behavior is verbatim from the original
 * inline JSX in pages/settings/tariffs/[id].js.
 */
export default function TariffMatchingPanel({
  form,
  update,
  toggleLoadType,
  toggleFlag,
  toggleLocationAll,
  addLocationId,
  removeLocationId,
  isLocationAll,
  showAdditional,
  onShowAdditionalChange,
  customerLabels,
}) {
  const hasActiveFlags = FLAG_DEFS.some((f) => form[f.key]);

  return (
    <div className="w-[280px] lg:w-[320px] shrink-0 border-r border-gray-200 dark:border-slate-700 overflow-y-auto">
      <div className="px-4 py-3 border-b border-gray-200 dark:border-slate-700 bg-gray-50/60 dark:bg-slate-900/60">
        <div className="flex items-center gap-1.5 text-xs font-semibold text-gray-700 dark:text-slate-200">
          <Info className="w-3.5 h-3.5 text-gray-400 dark:text-slate-500" />
          Load Matching Conditions
        </div>
      </div>

      <div className="p-4 space-y-4">
        {/* Tariff Name */}
        <div>
          <label className="block text-xs font-medium text-gray-600 dark:text-slate-300 mb-1">* Load Tariff Name</label>
          <input
            type="text"
            value={form.name}
            onChange={(e) => update('name', e.target.value)}
            placeholder="Enter Tariff Name"
            className="block w-full rounded-lg border border-gray-300 dark:border-slate-600 px-3 py-2 text-sm focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 dark:focus:ring-blue-900/40"
          />
        </div>

        {/* Draft toggle */}
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={form.status === 'draft'}
            onChange={(e) => update('status', e.target.checked ? 'draft' : 'active')}
            className="rounded border-gray-300 dark:border-slate-600 text-blue-600 w-4 h-4"
          />
          <span className="text-sm text-gray-700 dark:text-slate-200">Draft</span>
        </label>

        {/* Effective Dates — promoted primitive */}
        <EffectiveDateRange
          start={form.effective_start}
          end={form.effective_end}
          onStartChange={(val) => update('effective_start', val)}
          onEndChange={(val) => update('effective_end', val)}
          startRequired
        />

        {/* Load Type — promoted primitive */}
        <div>
          <label className="block text-xs font-medium text-gray-600 dark:text-slate-300 mb-1">Load Type</label>
          <LoadTypeChips
            value={form.load_types}
            onChange={(next) => update('load_types', next)}
            options={LOAD_TYPES}
          />
        </div>

        {/* … remainder of left-panel JSX, copied VERBATIM from
              pages/settings/tariffs/[id].js lines ~462–569 … */}
      </div>
    </div>
  );
}
```

**Critical:** the `// … remainder …` comment above is a placeholder for the implementer. The actual implementer must:
1. Read `pages/settings/tariffs/[id].js` lines 462 through the end of the left panel (just before `{/* RIGHT PANEL — Charge Sets */}` comment at line 573)
2. Paste that JSX verbatim into the position marked by the placeholder
3. Verify that every JSX expression resolves: `form.X` references are fine (form is in props), handler calls (`update`, `toggleFlag`, etc.) are fine (in props), constant references (`LOAD_TYPES`, `FLAG_DEFS`, `hasActiveFlags`) are fine (defined at top of file)
4. The `setShowAdditional` direct setter call — the original inlined uses `setShowAdditional`, but in the sub-component we use `onShowAdditionalChange` (the prop). Replace `setShowAdditional(...)` with `onShowAdditionalChange(...)` everywhere it appears in the pasted JSX. Same arguments.

- [ ] **Step 4: Update `pages/settings/tariffs/[id].js`**

Remove the `LOAD_TYPES` and `FLAG_DEFS` constants from the top of the file (now lives in `TariffMatchingPanel.js`).

Add the import:
```jsx
import TariffMatchingPanel from '../../../components/settings/tariff-detail/TariffMatchingPanel';
```

Find the left-panel JSX (the entire `<div className="w-[280px] lg:w-[320px] shrink-0 border-r ...">` block from ~line 387 to ~line 571) and replace it with:

```jsx
<TariffMatchingPanel
  form={form}
  update={update}
  toggleLoadType={toggleLoadType}
  toggleFlag={toggleFlag}
  toggleLocationAll={toggleLocationAll}
  addLocationId={addLocationId}
  removeLocationId={removeLocationId}
  isLocationAll={isLocationAll}
  showAdditional={showAdditional}
  onShowAdditionalChange={setShowAdditional}
  customerLabels={customerLabels}
/>
```

- [ ] **Step 5: Verify compile**

Run: `npm run build 2>&1 | grep -E "(tariffs/\[id\]\.js|TariffMatchingPanel\.js)"`
Expected: no new errors.

- [ ] **Step 6: Verify smoke test (Gate 2)**

Open the baseline tariff. Walk every left-panel field:
- Name input — type something, confirm it updates
- Draft checkbox — toggle, confirm it updates
- Date pickers — open, pick a date, confirm
- Load Type chips — toggle several, confirm
- Customer multi-select — add and remove customers
- Pickup / Delivery / Return location pickers — toggle "all" vs specific
- Additional Conditions toggle — expand it, fill in a field, collapse
- Container Type, Container Size, SSL, CSR, Chassis fields — pick values
- Flags — toggle several

Then revert all your test edits (or hard-refresh without saving) so you don't pollute the baseline tariff.

- [ ] **Step 7: Verify payload (Gate 1)**

Save (no edits — refresh first if needed to discard test changes from Step 6). Diff payload against baseline. Expected: empty diff.

- [ ] **Step 8: Commit**

```bash
git add pages/settings/tariffs/[id].js components/settings/tariff-detail/TariffMatchingPanel.js
git commit -m "$(cat <<'EOF'
refactor(tariffs): extract TariffMatchingPanel sub-component

Move the entire left panel of pages/settings/tariffs/[id].js (~180
lines of JSX: name, draft, dates, load types, customers, location
filters, container/SSL/CSR/chassis fields, flags) into
TariffMatchingPanel.js. Receives form + handler callbacks as props;
owns no state of its own.

LOAD_TYPES and FLAG_DEFS constants relocated alongside the JSX that
uses them. Promoted primitives <LoadTypeChips> and <EffectiveDateRange>
adopted in place of the inline JSX they replace.

Verified Gate 1 (payload diff = empty after a no-op save) and Gate 2
(every left-panel field edits, persists, and renders identically).

Part of UI Plan G1.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Phase 5: Extract `<TariffChargeSetsPanel>`

The right panel. ~150 lines of charge-sets table JSX (lines ~574–725 today).

### Task 5.1: Create `TariffChargeSetsPanel` and wire it up

**Files:**
- Create: `components/settings/tariff-detail/TariffChargeSetsPanel.js` (~250 LoC)
- Modify: `pages/settings/tariffs/[id].js` (replace the right-panel JSX with `<TariffChargeSetsPanel>`)

- [ ] **Step 1: Read the existing right panel**

Read `pages/settings/tariffs/[id].js` lines 573 through ~725 (just before the `<ChargeProfilePickerModal ... />` JSX usage at line ~720, but include any wrapping divs that close after that). Identify: the panel header bar, "Add Charge Set" button, the loop over `chargeSets`, each charge set's bill-to picker + profile chips + items table + "+ Add Charge Item" row.

- [ ] **Step 2: Create the component**

Write `components/settings/tariff-detail/TariffChargeSetsPanel.js`:

```jsx
import { Plus, Trash2, X, DollarSign, Info } from 'lucide-react';
import Button from '../../ui/Button';
import OrgPicker from '../../ui/OrgPicker';
import CentsInput from '../../ui/CentsInput';
import { CHARGE_NAMES, UNITS_OF_MEASURE, chargeNameLabel, unitLabel, formatCents } from '../../../lib/charge-profile-constants';

/**
 * TariffChargeSetsPanel — right panel of the tariff detail page.
 *
 * Renders the charge sets list and bubbles every mutation up via callback
 * props. Owns no state.
 *
 * Part of the Plan G1 decomposition. Behavior is verbatim from the original
 * inline JSX in pages/settings/tariffs/[id].js.
 */
export default function TariffChargeSetsPanel({
  chargeSets,
  onAddChargeSet,
  onRemoveChargeSet,
  onOpenProfilePicker,
  onRemoveProfile,
  onAddChargeItem,
  onUpdateChargeItem,
  onRemoveChargeItem,
  onUpdateChargeSet,  // for bill-to mode/customer changes — see Step 3
}) {
  return (
    <div className="flex-1 min-w-0">
      {/* … verbatim right-panel JSX from pages/settings/tariffs/[id].js
            lines 576–725, with these substitutions:
              setChargeSets((prev) => prev.map(...)) for bill_to_mode and
                bill_to_customer_id changes  →  onUpdateChargeSet(idx, field, value)
              addChargeSet()                  →  onAddChargeSet()
              removeChargeSet(idx)            →  onRemoveChargeSet(idx)
              openProfilePicker(idx)          →  onOpenProfilePicker(idx)
              removeProfile(csIdx, pIdx)      →  onRemoveProfile(csIdx, pIdx)
              addChargeItem(idx)              →  onAddChargeItem(idx)
              updateChargeItem(...)           →  onUpdateChargeItem(...)
              removeChargeItem(csIdx, itemIdx) →  onRemoveChargeItem(csIdx, itemIdx)
        … */}
    </div>
  );
}
```

**Critical implementer note for the bill-to change handler:**

Today the right panel directly calls `setChargeSets((prev) => prev.map(...))` inline when the bill-to mode or customer changes (not through a named handler like `addChargeSet` or `removeProfile`). For example:

```jsx
<select
  value={cs.bill_to_mode}
  onChange={(e) => setChargeSets((prev) => prev.map((c, i) =>
    i === idx ? { ...c, bill_to_mode: e.target.value } : c
  ))}
  ...
/>
```

To keep state ownership in the page shell, we need a new named handler `updateChargeSet(idx, field, value)`. Add it to `pages/settings/tariffs/[id].js` (next to `addChargeSet`/`removeChargeSet`):

```jsx
function updateChargeSet(idx, field, value) {
  setChargeSets((prev) => prev.map((cs, i) =>
    i === idx ? { ...cs, [field]: value } : cs
  ));
}
```

Then in the JSX moved into `TariffChargeSetsPanel.js`, replace inline `setChargeSets(...)` calls with `onUpdateChargeSet(idx, 'bill_to_mode', e.target.value)` etc.

- [ ] **Step 3: Add `updateChargeSet` handler in the page shell**

In `pages/settings/tariffs/[id].js`, add the new handler alongside existing ones (e.g., right after `removeChargeSet`):

```jsx
function updateChargeSet(idx, field, value) {
  setChargeSets((prev) => prev.map((cs, i) =>
    i === idx ? { ...cs, [field]: value } : cs
  ));
}
```

- [ ] **Step 4: Update `pages/settings/tariffs/[id].js`**

Add the import:
```jsx
import TariffChargeSetsPanel from '../../../components/settings/tariff-detail/TariffChargeSetsPanel';
```

Find the right-panel JSX (the entire `<div className="flex-1 min-w-0">` block starting at ~line 576 and ending just before the `<ChargeProfilePickerModal ... />` usage). Replace with:

```jsx
<TariffChargeSetsPanel
  chargeSets={chargeSets}
  onAddChargeSet={addChargeSet}
  onRemoveChargeSet={removeChargeSet}
  onOpenProfilePicker={openProfilePicker}
  onRemoveProfile={removeProfile}
  onAddChargeItem={addChargeItem}
  onUpdateChargeItem={updateChargeItem}
  onRemoveChargeItem={removeChargeItem}
  onUpdateChargeSet={updateChargeSet}
/>
```

The `<ChargeProfilePickerModal ... />` JSX usage stays in `pages/settings/tariffs/[id].js` exactly where it is (line ~720) — that's not part of the panel.

- [ ] **Step 5: Verify compile**

Run: `npm run build 2>&1 | grep -E "(tariffs/\[id\]\.js|TariffChargeSetsPanel\.js)"`
Expected: no new errors.

- [ ] **Step 6: Verify smoke test (Gate 2)**

Open the baseline tariff. Test every right-panel interaction:
- Existing charge set displays with all profiles + items
- Click "Add Charge Set" → new empty set appears
- Click trash on the new set → it disappears
- Click "Select Charge Profiles" → modal opens, pick a profile, confirm it appears as a chip
- Click X on a profile chip → it disappears
- Click "+ Add Charge Item" → new row appears
- Edit the row's fields (charge name dropdown, UOM dropdown, amount, free units)
- Click X on the item row → it disappears
- Change bill-to mode dropdown → state updates
- If bill-to mode is "specific customer", pick a customer

Discard all test edits (refresh without saving).

- [ ] **Step 7: Verify payload (Gate 1)**

Save (no edits). Diff against baseline:
```bash
diff <(jq -S . tmp/tariff-payload-baseline.json) <(jq -S . <(<paste new body>))
diff <(jq -S . tmp/charge-sets-payload-baseline.json) <(jq -S . <(<paste new charge-sets body>))
```

Expected: empty diff for both. **Pay special attention here** — this is the highest-risk commit because the bill-to mode/customer state mutation moved through a new handler.

- [ ] **Step 8: Commit**

```bash
git add pages/settings/tariffs/[id].js components/settings/tariff-detail/TariffChargeSetsPanel.js
git commit -m "$(cat <<'EOF'
refactor(tariffs): extract TariffChargeSetsPanel sub-component

Move the entire right panel of pages/settings/tariffs/[id].js (~150
lines of JSX: charge sets list with bill-to pickers, profile chips,
items tables, + Add buttons) into TariffChargeSetsPanel.js. Receives
chargeSets array + handler callbacks as props; owns no state.

Adds a small new handler updateChargeSet(idx, field, value) in the
page shell to replace the inline setChargeSets((prev) => prev.map())
calls that previously lived in the right panel for bill-to changes.
Same setState semantics, just routed through a named handler so the
sub-component stays dumb.

ChargeProfilePickerModal mount stays in the page shell (already its
own file as of the previous commit).

Verified Gate 1 (payload diff against baseline = empty for both
PUT bodies — main tariff and charge-sets) and Gate 2 (every charge-set
interaction round-trips identically: add/remove sets, attach/detach
profiles, add/edit/remove items, change bill-to mode and customer).

Part of UI Plan G1.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Phase 6: Final verification + push

### Task 6.1: Whole-plan verification + push

- [ ] **Step 1: Confirm final file shape**

```bash
wc -l pages/settings/tariffs/[id].js
```
Expected: ~150 lines (down from 977).

```bash
ls -la components/settings/tariff-detail/
```
Expected: 4 files (TariffHeader.js, TariffMatchingPanel.js, TariffChargeSetsPanel.js, ChargeProfilePickerModal.js).

```bash
ls -la components/ui/LoadTypeChips.js components/ui/EffectiveDateRange.js
```
Expected: both files exist.

- [ ] **Step 2: Clean build**

```bash
npm run build 2>&1 | tail -30
```

Expected: no NEW errors introduced. Pre-existing errors elsewhere are unchanged. The `tariffs/[id].js` file should NOT appear in the error list.

- [ ] **Step 3: Final smoke test against the baseline tariff**

Restart dev server if needed (build clobbers `.next`):
```bash
rm -rf .next && # then mcp__Claude_Preview__preview_start
```

Open `/settings/tariffs/<baseline-id>` and exhaustively walk:
- Every left-panel field
- Every right-panel interaction
- Save → reopen → all values present
- Open a load assigned to this tariff's customer → confirm the same charges still auto-populate (this is the behavior-change canary)

- [ ] **Step 4: Final payload verification**

One last `diff` of `PUT /api/tenant/tariffs/<id>` and `PUT /api/tenant/tariffs/<id>/charge-sets` payloads against the baselines. Empty diff required.

- [ ] **Step 5: Verify the overlay use case still works**

`components/settings/TariffDetail.js` imports `TariffForm` from `pages/settings/tariffs/[id]` and passes `{ tariffId, onClose }`. Find a route in the app that uses `TariffDetail` (search for `<TariffDetail` or imports of it). If none in use yet, manually invoke it: open a route that mounts it, confirm the form renders without `<SettingsLayout>` chrome and that closing it via the X button calls `onClose` correctly.

If `TariffDetail` isn't actively used anywhere in routing, document this in the commit message and skip the live test.

- [ ] **Step 6: Cleanup tmp baseline files (optional, no commit needed)**

```bash
rm -rf tmp/tariff-payload-baseline.json tmp/charge-sets-payload-baseline.json tmp/HOW-TO-VERIFY.md
```

(These are gitignored anyway. Removal is optional — keeping them around for the next plan iteration is fine.)

- [ ] **Step 7: Git log sanity**

```bash
git log --oneline 5b90d86..HEAD
```

Expected: 6 commits (Phase 1 = 2, Phase 2 = 1, Phase 3 = 1, Phase 4 = 1, Phase 5 = 1). All ending with `Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>`. Optionally a 7th if Phase 0 needed a `chore: ignore tmp/` commit.

- [ ] **Step 8: Push**

```bash
git push origin main
```

Write a brief release note in chat summarizing what shipped.

---

## Summary

6 commits across 5 phases. 4 new files in `components/settings/tariff-detail/`, 2 new primitives in `components/ui/`, `pages/settings/tariffs/[id].js` shrinks from 977 LoC to ~150 LoC. Zero behavior change verified at every commit via payload diffs against a baseline tariff.

The pricing module's tariff detail page is now decomposable surface area. Future plans (the autofill rule, percentage-of-base UX, Advanced Route Matching wiring, "Test Your Tariffs" preview) drop into focused files instead of editing a monolith.

Plans G2 (`charge-profiles/[id].js`, 811 LoC) and G3 (`driver-tariffs/[id].js`, 920 LoC) follow the same pattern when the user is ready.
