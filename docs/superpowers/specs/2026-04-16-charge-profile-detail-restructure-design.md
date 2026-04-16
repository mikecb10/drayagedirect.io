# Charge Profile Detail Page Restructure — Design Spec (Plan G2)

**Date:** 2026-04-16
**Status:** Draft, awaiting plan
**Predecessors:** Plans A, B, C (design system), Plan E (settings shell), **Plan G1 (tariff detail restructure — same pattern, AR side)**. See `docs/ui-system.md`.

---

## 1. Goal

Decompose `pages/settings/charge-profiles/[id].js` (811 LoC monolith) into:
- A thin page shell (~250 LoC) holding state hooks, useEffects, all handlers, and the dual-mode render
- 2 already-self-contained sub-functions extracted to their own files (`<TagInput>`, `<LaneLocationCell>`)
- 4 logical render sections extracted into focused sub-components (`<ChargeProfileHeader>`, `<VersionManager>`, `<RulesPanel>`, `<MatchResolutionPanel>`)
- 4 mode-specific row table sub-components for the calculation-mode branches (`<LaneRowsTable>`, `<StatusRowsTable>`, `<EventRowsTable>`, `<MoveRowsTable>`)
- A new `lib/charge-profile-row-shapes.js` holding the row-shape constants and helpers (`EMPTY_*`, `emptyRowForMode`, `newVersion`)

**Hard constraint: zero behavior change.** Same hard rule as Plan G1. The AR pricing engine and the load-side charge autopulldown must remain bit-for-bit identical. The `handleSave` payload shape, the state shape, and every controlled-input value flow are preserved exactly.

---

## 2. Why now

- Plan G1 just shipped the same restructure pattern for the tariff detail page. The pattern works; we're propagating it to the next pricing-module page while the playbook is fresh.
- Charge profile detail is the AR pricing engine's data-entry surface. Future features (the manually-added autofill rule, percentage-of-base UX, conflict-resolution config UI) all need to plug into this page. Building them on top of the current 811-line monolith is the same problem we just solved for tariffs.
- The Section 2 mode-switch render is the most tangled part of the pricing UI. Decomposing it per mode (one file per calculation mode) means future calc-mode additions or per-mode UX work happen in their own focused file.

---

## 3. Hard constraint: zero behavior change

This dominates every other decision (same as Plan G1).

| Aspect | Rule |
|---|---|
| `handleSave` payload | Byte-identical JSON sent to `/api/tenant/charge-profiles/...`. Same fields, same nesting, same types, same versions array shape. |
| State shape | The 7 useState hooks at the top of `ChargeProfileForm` stay exactly as they are (`form`, `versions`, `activeVersionIdx`, `availableTags`, `loading`, `saving`, `error`). No useReducer, no per-component state extraction. |
| Side effects | The `useEffect` load() block stays in the page shell unchanged. |
| Backend code | Not touched. Plan G2 is a pure frontend file refactor. |
| Engine logic | The AR engine that resolves which charge profiles fire on which loads — not touched, not even read. |
| Visual layout | Single-column form structure preserved. Section ordering preserved. Field grouping preserved. Calculation-mode tabs render identically. Row table columns render identically. |
| User-visible UX | Functionally identical. A user opening a charge profile after the refactor should not notice anything different. |
| Control types | If the original used a checkbox, we keep a checkbox. If the original used a radio, we keep a radio. If a control is a `<select>`, we don't swap to a `<Combobox>`. **Lessons learned from Plan G1 Task 4.1 — verbatim means verbatim.** |

If a refactor step would require even a key reordering in the saved payload or a control type swap, it doesn't ship.

---

## 4. Architecture

### 4.1 File structure after the refactor

```
lib/
  └─ charge-profile-row-shapes.js          (~50 LoC, NEW)
      Pure constants + helpers, no React. Named exports:
      EMPTY_ROW_BASE, LOCATION_TYPES, EMPTY_LANE_ROW, EMPTY_STATUS_ROW,
      EMPTY_EVENT_ROW, EMPTY_MOVE_ROW, EMPTY_VERSION,
      emptyRowForMode(mode), newVersion(mode, idx).

pages/settings/charge-profiles/[id].js     (~250 LoC — was 811)
  └─ Owns: 7 useState hooks, useEffect load(), all handlers
           (update, updateVersion, updateRow, addRow, removeRow,
           addVersion, removeVersion, duplicateVersion,
           addMoveEvent, removeMoveEvent, updateMoveEvent),
           handleSave, handleCancel, dual-mode render (overlay vs page).

components/settings/charge-profile-detail/
  ├─ TagInput.js                           (~60 LoC)
  │    Existing self-contained sub-function, extracted verbatim.
  │    Owns: input + suggestions visibility (already its own state).
  │
  ├─ LaneLocationCell.js                   (~30 LoC)
  │    Existing self-contained sub-function, extracted verbatim.
  │
  ├─ ChargeProfileHeader.js                (~100 LoC)
  │    Section 1 — name, charge_name, tag, description, auto-add radio,
  │    UoM, effective date basis, calculation mode tabs.
  │
  ├─ VersionManager.js                     (~100 LoC)
  │    Section 2 parent — version selector dropdown + add/duplicate/remove
  │    buttons + version metadata fields (label, effective_from,
  │    effective_to). Branches on `mode` to render the appropriate row
  │    table below.
  │
  ├─ LaneRowsTable.js                      (~80 LoC)
  │    "By Lane" mode rows. Origin/dest pickers via <LaneLocationCell>.
  │
  ├─ StatusRowsTable.js                    (~50 LoC)
  │    "Between Statuses" mode rows. From/to status selects.
  │
  ├─ EventRowsTable.js                     (~80 LoC)
  │    "By Event" mode rows. Event-type select + location picker.
  │
  ├─ MoveRowsTable.js                      (~120 LoC)
  │    "By Move" mode rows. Most complex — each row contains a nested
  │    sub-list of move events with their own add/remove/update handlers.
  │
  ├─ RulesPanel.js                         (~25 LoC)
  │    Section 3 — wraps <ConditionBuilder> with the AR_RULES catalog.
  │
  └─ MatchResolutionPanel.js               (~80 LoC)
       Section 4 — disabled "Link to existing charge profile" placeholder
       + match resolution 4-button selector.
```

### 4.2 State ownership

The page shell at `pages/settings/charge-profiles/[id].js` owns ALL state. The 7 useState hooks stay there exactly as they are. Sub-components are dumb — they receive value-props and onChange-props.

The one exception: `<TagInput>` keeps its existing internal state for the input field's text and the suggestion-dropdown visibility (these are local-only UI state that never leaves the component).

### 4.3 Per-component prop contracts

```jsx
// lib/charge-profile-row-shapes.js — pure data, no JSX
export const EMPTY_ROW_BASE = { ... };
export const LOCATION_TYPES = [ ... ];
export const EMPTY_LANE_ROW = { ... };
export const EMPTY_STATUS_ROW = { ... };
export const EMPTY_EVENT_ROW = { ... };
export const EMPTY_MOVE_ROW = { ... };
export const EMPTY_VERSION = { ... };
export function emptyRowForMode(mode) { ... }
export function newVersion(mode, idx = 1) { ... }


// TagInput.js — same API as the existing inline function
<TagInput
  tags={form.tags || []}
  onChange={(nextArray) => update('tags', nextArray)}
  availableTags={availableTags}
/>

// LaneLocationCell.js — same API as the existing inline function
<LaneLocationCell
  typeValue={row.origin_type}
  orgId={row.origin_id}
  orgLabel={row.origin_label}
  textValue={row.origin_value}
  onTypeChange={(v) => onUpdate(rIdx, 'origin_type', v)}
  onOrgChange={(org) => { onUpdate(rIdx, 'origin_id', org?.id);
                          onUpdate(rIdx, 'origin_label', org?.name); }}
  onTextChange={(v) => onUpdate(rIdx, 'origin_value', v)}
  orgType="customer"
  placeholder="Origin"
/>

// ChargeProfileHeader.js
<ChargeProfileHeader
  form={form}
  update={update}
  availableTags={availableTags}
  availableModes={availableModes}    // memoized in page shell
  isPercentage={isPercentage}        // derived in page shell
  isNew={isNew}
/>

// VersionManager.js
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

// LaneRowsTable.js / StatusRowsTable.js / EventRowsTable.js
<XxxRowsTable
  rows={activeVersion.rows}
  onUpdateRow={onUpdateRow}            // (rIdx, field, value) => void
  onRemoveRow={onRemoveRow}            // (rIdx) => void
  isPercentage={isPercentage}
/>

// MoveRowsTable.js — same as above plus 3 move-event handlers
<MoveRowsTable
  rows={activeVersion.rows}
  onUpdateRow={onUpdateRow}
  onRemoveRow={onRemoveRow}
  onAddMoveEvent={onAddMoveEvent}      // (rIdx) => void
  onRemoveMoveEvent={onRemoveMoveEvent}// (rIdx, eIdx) => void
  onUpdateMoveEvent={onUpdateMoveEvent}// (rIdx, eIdx, field, value) => void
  isPercentage={isPercentage}
/>

// RulesPanel.js
<RulesPanel
  conditions={form.conditions || []}
  onChange={(c) => update('conditions', c)}
/>

// MatchResolutionPanel.js
<MatchResolutionPanel
  value={form.match_resolution}
  onChange={(v) => update('match_resolution', v)}
/>
```

### 4.4 Why per-mode row tables instead of one shared `<RowsTable>`

Each mode renders fundamentally different columns:
- "By Lane" rows have origin + destination location pickers
- "Between Statuses" rows have from-status + to-status selects
- "By Event" rows have event-type + location picker
- "By Move" rows have a nested sub-list of move events with their own add/remove/update

A shared `<RowsTable>` would be a switch statement inside a switch statement. Splitting per mode means each file is small, focused, and readable end-to-end without holding the other 3 modes in your head.

`<VersionManager>` dispatches to the appropriate table via a small switch:

```jsx
{mode === 'by_lane' && <LaneRowsTable ... />}
{mode === 'between_statuses' && <StatusRowsTable ... />}
{mode === 'by_event' && <EventRowsTable ... />}
{mode === 'by_move' && <MoveRowsTable ... />}
```

Adding a 5th mode in the future = add a 5th file under `charge-profile-detail/` + a 1-line case in this switch.

---

## 5. Out of scope

- Touching `handleSave` payload shape, the `/api/tenant/charge-profiles/...` API, or any backend code.
- Touching the AR engine that resolves which charge profiles fire on which loads.
- Wiring up the disabled "Link to existing charge profile" placeholder (Section 4 has a "Linking coming soon" note — that stays).
- Promoting any of these sub-components to `components/ui/` primitives. They're all charge-profile-specific.
- Visual token swaps (Plan C-style `text-gray-* → text-strong/text-muted` cleanup). Defer for a follow-up to keep this purely structural.
- The `pages/settings/driver-tariffs/[id].js` page (920 LoC) — that's Plan G3. If patterns from G2 hold up, G3 follows the same shape.
- Pre-existing lint warnings in this file unrelated to the refactor.

---

## 6. Success criteria

A reviewer (or the user) can:

1. Read `pages/settings/charge-profiles/[id].js` end-to-end in under 5 minutes and understand what the page does.
2. Open any sub-component in `components/settings/charge-profile-detail/` and read it end-to-end in under 2 minutes.
3. Add a 5th calculation mode by adding one new file under `charge-profile-detail/` and one case to `<VersionManager>`'s switch — without touching any of the other 4 mode tables or the page shell's handlers.
4. Open an existing charge profile in dev and verify it looks and behaves identically to before the refactor.
5. Save a charge profile and verify a load that previously matched it still gets the same charge calculated at the same amount (the canary test for engine integrity).
6. `npm run build` clean. No new lint errors.
7. Dark mode on the charge profile detail page renders correctly (no regressions from the existing dark-mode setup).

---

## 7. Verification gates

### 7.1 Gate 1 — Payload diff (automated, controller runs)

Same approach as Plan G1: we don't compare GET responses to GET responses; we reconstruct what `handleSave` *would produce* from the load() → state flow and diff that against the baseline.

- **Before refactor (Phase 0):** pick an existing charge profile with a meaningful `versions` array and rows in at least 2 different calculation modes. Run a derivation script that calls `GET /api/tenant/charge-profiles/<id>`, applies the same `setForm({...})` and `setVersions([...])` transformations the page's `useEffect` load() applies, then constructs the same `payload` object `handleSave` would POST. Save the derived payload as `tmp/charge-profile-payload-baseline.json` (gitignored).
- **After each commit that touches state-passing or controlled inputs:** re-run the same derivation script and diff against the baseline. Must be byte-equivalent (modulo whitespace and key ordering).
- If they differ → fix before commit, not after.

### 7.2 Gate 2 — Manual smoke (controller runs via preview MCP, falls back to user if auth fails)

After each major extraction (Phases 3, 4, 5):

- Open the baseline charge profile in dev
- Confirm every section renders with the correct values
- Switch between calculation modes (the dropdown / tabs)
- Add a row, fill it in, remove it
- Add a version, duplicate it, switch between versions
- Save without changes and reopen — confirm everything persisted

### 7.3 Gate 3 — Engine canary (USER walks this after Phase 5)

This is the part the user has to validate, since it involves "are these the right amounts" judgment that I can't make:

1. Open the baseline tariff ("All Customers Import Tariff") — confirm the 3 attached charge profiles still show on the right panel
2. Open a load assigned to that tariff's customer (any Import load on the test tenant) — confirm the autopulldown still fires the same charges with the same rates
3. **Bonus check:** for a load with nuanced pricing (per-day per-diem, percentage fuel surcharge), confirm the calculated amounts match what they were before the refactor

If anything looks off — even slightly — stop and investigate. This is the load-side billing-integrity canary.

---

## 8. Open questions

None at design time. All clarifications resolved during brainstorming:

- Q: How aggressive should Section 2 decomposition be? **A: Aggressive — split per mode (4 row tables under <VersionManager>).**
- Q: Where do the row-shape constants live? **A: New `lib/charge-profile-row-shapes.js`. Both `<VersionManager>` and the page shell import from there.**
- Q: Same hard rule as G1 on save path? **A: Yes — zero behavior change. handleSave untouched. If we discover a bug while refactoring, file a followup, don't fix in G2.**
