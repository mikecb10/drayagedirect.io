# Driver Tariff Detail Page Restructure — Design Spec (Plan G3)

**Date:** 2026-04-16
**Status:** Draft, awaiting plan
**Predecessors:** Plans A, B, C (design system), Plan E (settings shell), **Plan G1 (AR tariff detail restructure — AR side of the same pattern)**, **Plan G2 (AR charge profile detail restructure — same session's playbook)**. See `docs/ui-system.md`.

---

## 1. Goal

Decompose `pages/settings/driver-tariffs/[id].js` (920 LoC) — the AP-side driver tariff detail editor — into:
- A thin page shell (~220 LoC) holding the 7 useState hooks, the `useEffect` load block, every handler, `handleSave`, `handleCancel`, and the dual-mode render (overlay vs `<SettingsLayout>`).
- 6 sub-components in `components/settings/driver-tariff-detail/`:
  - 3 already-self-contained sub-functions pulled to their own files (`<DriverGroupSelect>`, `<LocationConditionField>`, `<ChargeProfilePickerModal>`)
  - 3 logical render sections (`<DriverTariffHeader>`, `<DriverTariffMatchingPanel>`, `<DriverPayPanel>`)
- An incidental deletion: the local `DriverPicker` sub-function (lines 824–849) is dead code in this file and is removed.

**Hard constraint: zero behavior change.** Same rule as Plans G1 and G2. The AP driver-pay engine, the load-side driver charge auto-populate, and the `handleSave` payload shape must remain bit-for-bit identical. State shape, controlled-input flow, and visual layout are preserved exactly.

Plan G3 is the AP analog of Plan G1 (AR tariff detail), not of Plan G2 (AR charge profile detail). The driver tariff page has no rows, no versions, no calculation modes — it's a matching-conditions form on the left and a flat list of linked driver charge profiles on the right. The `lib/charge-profile-row-shapes.js` lib promoted in G2 is NOT reusable here; row/version/calc-mode surface lives in `components/drivers/pay-rates/DriverChargeProfilesPanel.js` (a hypothetical future G4 target).

---

## 2. Why now

- Plans G1 (AR tariff detail) and G2 (AR charge profile detail) just shipped the same decomposition pattern. The playbook is fresh; propagate to the AP-side symmetric page while the reviewer's pattern-match is still sharp.
- Driver pay is the AP heart of the app. Every change risks driver compensation correctness. A 920-line monolith makes "every change" feel scary and slows the AP roadmap (per-state row colors on driver pay lines, oo_benchmark data source, per_road_toll_miles, the profile_group location type — all deferred behind the monolith).
- After G1 + G2 + G3, all three pricing detail pages (AR tariff, AR charge profile, AP driver tariff) share the same "page shell owns state, dumb sub-components" shape. New pricing features land in a focused file instead of requiring surgery on a 900+ LoC page.

---

## 3. Hard constraint: zero behavior change

This dominates every other decision. Same rule as G1 and G2.

| Aspect | Rule |
|---|---|
| `handleSave` payload | Byte-identical JSON sent to `/api/tenant/ap/tariffs/...`. Same fields, same nesting, same `charge_sets` wrapping shape (the implicit-single-charge-set + `pay_to_mode: 'load_driver'` contract). Same types. |
| State shape | The 7 useState hooks at the top of `DriverTariffForm` stay exactly as they are (`form`, `linkedProfiles`, `showAdditional`, `loading`, `saving`, `error`, `profilePickerOpen`). No useReducer, no per-component state extraction, no context. |
| Side effects | The `useEffect` load() block stays in the page shell unchanged. |
| Backend code | Not touched. Plan G3 is a pure frontend file refactor. |
| Engine logic | `lib/driver-tariff-engine.js` and `lib/pricing-tier-resolver.js` — not touched, not even read. The just-fixed percentage-of-base bug (commits `077ecda`, `cae3229`) stays fixed. |
| Visual layout | Two-panel structure (fixed-width left matching panel + scrollable right pay panel) preserved. Section ordering, field grouping, label copy, input widths — all preserved. |
| Dual-mode render | `DriverTariffForm` continues to render `<div className="p-6">` overlay shell when `onClose` is passed; otherwise wraps in `<SettingsLayout>`. The overlay caller at `components/drivers/pay-rates/DriverTariffsPanel.js` keeps working. |
| Control types | If the original used a checkbox, we keep a checkbox. If it used a select, we keep a select. **No chip-vs-checkbox swaps.** Lesson from G1 Task 4.1. |
| User-visible UX | Functionally identical. A user opening a driver tariff after the refactor should not notice anything different. |

If a step would require even a key reordering in the saved payload or a control-type swap, fix the step before commit — not after.

**Incidental deletion allowed:** the local `DriverPicker` sub-function (lines 824–849) is never called in this file. It's pre-existing dead code left from an earlier "pin a specific driver to a charge set" UI that was flattened out. Deletion is zero-behavior-change by definition (the function never executed). Document the deletion in the relevant commit message.

---

## 4. Architecture

### 4.1 File structure after the refactor

```
pages/settings/driver-tariffs/[id].js                (~220 LoC — was 920)
  └─ Owns: 7 useState hooks, useEffect load(), every handler
           (update, toggleLoadType, toggleFlag, toggleLocationAll,
           addLocationId, removeLocationId, isLocationAll,
           openProfilePicker, handleProfilesSelected, removeProfile),
           handleSave, handleCancel, the dual-mode render switch
           (overlay vs <SettingsLayout>-wrapped).

components/settings/driver-tariff-detail/
  ├─ DriverTariffHeader.js            (~45 LoC)
  │    h1 + Basic/Advanced Route Matching tab toggle. Same shape as
  │    G1's TariffHeader. Placeholder-stub comment matching G1's on the
  │    Advanced tab having no render content today.
  │
  ├─ DriverTariffMatchingPanel.js     (~250 LoC)
  │    Left panel: tariff name, draft toggle, effective start/end
  │    DatePickers, load types checkbox list, driver group select
  │    (via the extracted <DriverGroupSelect>), priority, 3 location
  │    condition fields (via the extracted <LocationConditionField>),
  │    collapsible Additional Load Conditions (container type/size,
  │    SSL, chassis type/size/owner), flags checkbox list.
  │
  ├─ DriverPayPanel.js                (~60 LoC)
  │    Right panel: header with "Add Driver Charge Profile" button,
  │    empty-state card, or list of linked profile cards (name +
  │    chargeNameLabel + unitLabel badge + trash button per card).
  │
  ├─ DriverGroupSelect.js             (~35 LoC)
  │    Extracted verbatim from lines 854-888. Same API. Fetches
  │    /api/tenant/ap/driver-groups once and renders a select.
  │
  ├─ LocationConditionField.js        (~30 LoC)
  │    Extracted verbatim from lines 890-920. Same API. "All Locations"
  │    checkbox + OrgPicker + chip list when not-all.
  │
  └─ ChargeProfilePickerModal.js      (~200 LoC)
       Extracted verbatim from lines 617-818. Same API. AP-specific
       (hits /api/tenant/ap/charge-profiles, distinct from G1's AR
       picker which hits /api/tenant/charge-profiles). The two pickers
       are NOT merged — different data sources, different column sets.
```

### 4.2 State ownership

The page shell at `pages/settings/driver-tariffs/[id].js` owns ALL state. The 7 useState hooks stay there exactly as they are. Sub-components are dumb — they receive value-props and onChange-props.

Two exceptions — both pre-existing and preserved verbatim:

1. `<ChargeProfilePickerModal>` owns its internal state for the loaded profile list, search text, filter selections, and the in-progress selection Set.
2. `<DriverGroupSelect>` owns its fetched driver-groups list + a loading flag — it hits `/api/tenant/ap/driver-groups` on mount and renders the select when done.

Both existed as internal state inside sub-functions in the original file. That pattern stays. Neither of these hooks count against the page shell's 7 useState hooks.

### 4.3 Per-component prop contracts

```jsx
// DriverTariffHeader.js
<DriverTariffHeader
  matchingMode={form.matching_mode}           // 'basic' | 'advanced_route'
  onMatchingModeChange={(mode) => update('matching_mode', mode)}
/>

// DriverTariffMatchingPanel.js
<DriverTariffMatchingPanel
  form={form}                                  // whole form object
  update={update}                              // (field, value) => void
  toggleLoadType={toggleLoadType}              // (type) => void
  toggleFlag={toggleFlag}                      // (key) => void
  toggleLocationAll={toggleLocationAll}        // (field) => void
  addLocationId={addLocationId}                // (field, orgId, name) => void
  removeLocationId={removeLocationId}          // (field, orgId) => void
  isLocationAll={isLocationAll}                // (field) => boolean
  showAdditional={showAdditional}
  onToggleAdditional={() => setShowAdditional((s) => !s)}
/>

// DriverPayPanel.js
<DriverPayPanel
  linkedProfiles={linkedProfiles}              // array of { charge_profile_id, name, charge_name, unit_of_measure }
  onOpenPicker={openProfilePicker}             // () => void
  onRemoveProfile={removeProfile}              // (idx) => void
/>

// DriverGroupSelect.js — UNCHANGED API, verbatim extract
<DriverGroupSelect
  value={form.driver_group_id}
  onChange={(val) => update('driver_group_id', val)}
/>

// LocationConditionField.js — UNCHANGED API, verbatim extract
<LocationConditionField
  label="..."
  field="..."
  form={form}
  isAll={isLocationAll(...)}
  onSetAll={() => toggleLocationAll(...)}
  onAddLocation={(id, name) => addLocationId(..., id, name)}
  onRemoveLocation={(id) => removeLocationId(..., id)}
  orgType="..."
/>

// ChargeProfilePickerModal.js — UNCHANGED API, verbatim extract
<ChargeProfilePickerModal
  isOpen={profilePickerOpen}
  onClose={() => setProfilePickerOpen(false)}
  onSelect={handleProfilesSelected}
  existingIds={linkedProfiles.map((p) => p.charge_profile_id)}
/>
```

### 4.4 Ownership notes

- `<DriverGroupSelect>` and `<LocationConditionField>` are consumed **inside** `<DriverTariffMatchingPanel>`, not directly by the page shell. The page shell doesn't import them. Same pattern Plan G2 used for `<TagInput>` ↔ `<ChargeProfileHeader>`.
- `<ChargeProfilePickerModal>` **is** rendered by the page shell alongside the two panels, not inside `<DriverPayPanel>`. This avoids threading the picker open/close state through the pay panel. Same pattern Plan G1 used for its AR picker modal.
- The `<DriverTariffMatchingPanel>` prop list is wide (8 props including 6 handlers). That's a smell — the same smell G1's `<TariffMatchingPanel>` has. Fixing it requires restructuring state (useReducer, context, etc.), which violates the hard rule. Accept the smell in G3.

### 4.5 Why no shared primitives promoted to `components/ui/`

G1 promoted `<LoadTypeChips>` and `<EffectiveDateRange>` to `components/ui/`. Neither is reusable in G3:

- `<LoadTypeChips>` renders chips. G3's driver-tariff load types use a **vertical checkbox list** (lines 402-410 of the current file), which is a different control type. Using `<LoadTypeChips>` in G3 would swap the control and violate the verbatim rule — exactly the kind of regression G1 Task 4.1 taught us to guard against.
- `<EffectiveDateRange>` wraps two DatePickers into a labeled range. G3's current file uses two separate `<DatePicker>` blocks with individual labels ("* Effective Start Date" / "* Effective End Date") and a space-y-4 stacked layout. Adopting `<EffectiveDateRange>` would restructure the label/layout and potentially reorder the form.

No new primitives are promoted from G3 either. `<DriverGroupSelect>` and `<LocationConditionField>` stay driver-tariff-specific until a second consumer materializes.

### 4.6 Advanced Route Matching toggle

The header has a "Basic / Advanced Route Matching" tab toggle (lines 336-345 of the current file). The toggle persists `form.matching_mode` to the DB but **renders no content conditionally** — picking the Advanced tab only highlights the button; no alternate UI appears. This matches G1's state on the AR side (see the note in `components/settings/tariff-detail/TariffHeader.js`).

Plan G3 treatment: keep the toggle in `DriverTariffHeader.js` verbatim, add the same placeholder-stub comment G1's `TariffHeader` has. Do NOT remove the toggle (that would stop persisting `matching_mode` writes — a behavior change, even if the field is inert today).

The full build-out of Advanced Route Matching (a real feature spanning schema + UI + engine + tests, for BOTH AR and AP sides) is captured as a separate followup task spawned during this brainstorming session. It is out of scope for Plan G3.

### 4.7 Dead-code deletion: local `DriverPicker`

Lines 824-849 define a local `function DriverPicker({ value, onChange })` that renders a dropdown of drivers. It's never called anywhere in this file — `grep DriverPicker pages/settings/driver-tariffs/[id].js` returns only the definition, no call sites. (The `components/ui/DriverPicker.js` primitive is a separate file consumed elsewhere in the app — DriverPayTab, ContainerMoveCard, EditableCell — and is not affected by this deletion.)

The local function is leftover from an earlier "pin a specific driver to a charge set" UI that was flattened out when the UI moved to the `pay_to_mode: 'load_driver'` simplification. Deletion is zero-behavior-change by definition.

Document the deletion in the first phase's commit message so a future grep for "when did this go away?" lands.

---

## 5. Out of scope

- `handleSave` payload shape or `/api/tenant/ap/tariffs/...` API. Backend not touched.
- `lib/driver-tariff-engine.js` — the AP engine that resolves which tariffs and profiles fire. Not touched.
- `lib/pricing-tier-resolver.js` — the shared pricing resolver. The just-fixed percentage-with-`event_location_type='org'` bug (commits `077ecda`, `cae3229`) stays fixed; we don't touch this file.
- `components/drivers/pay-rates/DriverChargeProfilesPanel.js` (710 LoC) — the AP-side driver charge profile editor with calc modes / versions / rows. That's a hypothetical Plan G4.
- `lib/charge-profile-row-shapes.js` — not applicable to this page (no rows, no versions, no calc modes).
- Advanced Route Matching feature build-out — spawned as a separate product task.
- Promoting anything to `components/ui/`. No second-consumer signal for G3.
- Visual token swaps (`text-gray-* → text-strong / text-muted`). Defer to a follow-up to keep G3 purely structural.
- Pre-existing lint warnings in this file unrelated to the refactor.

---

## 6. Success criteria

A reviewer (or the user) can:

1. Read `pages/settings/driver-tariffs/[id].js` end-to-end in under 5 minutes and understand what the page does.
2. Open any sub-component in `components/settings/driver-tariff-detail/` and read it end-to-end in under 2 minutes.
3. Add a new matching field (e.g., a chassis-bonded flag) by touching only `DriverTariffMatchingPanel` and the page shell's `form` initial state — without touching `DriverPayPanel`, the picker modal, or the header.
4. Open an existing driver tariff in dev (both via the deep-link `/settings/driver-tariffs/[id]` route AND via the Pay Rates tab overlay) and verify pixel-identical UX vs pre-refactor.
5. Save a driver tariff, assign a driver to a matching load, confirm `order_driver_pay_lines` rows match pre-refactor amounts.
6. `npm run build` clean. No new lint errors.
7. Dark mode + zoom 80/100/125 unchanged on the driver tariff detail page in both overlay and page modes.

---

## 7. Verification gates

Three gates, same triad as G1 / G2. G3 has no row-shape / version / calc-mode surface, so the payload reconstruction script is substantially simpler than G2's.

### 7.1 Gate 1 — Payload diff (controller runs Phase 0 + after every commit)

- **Before refactor (Phase 0):** pick a real driver tariff with attached driver charge profiles. Hit `GET /api/tenant/ap/tariffs/<id>` via `mcp__Claude_Preview__preview_eval` (the endpoint is `/api/tenant/ap/tariffs/`, NOT `/api/tenant/ap/driver-tariffs/` — confirmed at line 111 of the current file). Reconstruct what `handleSave` would produce by mirroring the `load()` → `setForm({...})` + `setLinkedProfiles([...])` → `handleSave` charge-set wrapping. Save as `tmp/driver-tariff-payload-baseline.json` (tmp/ already gitignored).
- **After each commit that touches state, controlled inputs, or the save payload:** re-run the derivation script and diff against the baseline. Must be byte-equivalent (modulo whitespace and key ordering).
- If they differ → fix before commit, not after.

Append a "Driver tariff baseline" section to `tmp/HOW-TO-VERIFY.md` mirroring the existing G1 / G2 sections, with the chosen tariff ID and the derivation script pasted in full (so any subagent can re-run verification by pasting one block).

### 7.2 Gate 2 — Manual smoke (controller via MCP, fallback to user if auth fails)

After each major extraction (Phases 2, 3, 4 of the implementation plan):

- Open the baseline tariff in dev.
- Every left-panel field renders the same value as before (name, draft checkbox, effective start/end, load type checkboxes, driver group select, priority, 3 location condition fields with the right "All" state, additional-conditions collapsible with its open-state matching, flag checkboxes).
- Right panel: each linked profile card shows name + `chargeNameLabel` + `unitLabel` badge + trash button. The empty state renders when no profiles are linked.
- Open `<ChargeProfilePickerModal>` via "Add Driver Charge Profile" — search, filter by charge name, filter by tag, select one, select all filtered, deselect all, confirm.
- Save with no edits → reopen → every field persists identically.
- Both overlay mode (via `components/drivers/pay-rates/DriverTariffsPanel.js`) and page mode (via the deep-link route) render correctly.

### 7.3 Gate 3 — Engine canary (USER walks after the final phase)

Assign the baseline driver tariff to a real driver. Open a load that matches the tariff's conditions (load type + pickup / delivery / return matches). Confirm:

1. The AP driver-pay engine fires the same charge profiles as pre-refactor.
2. `order_driver_pay_lines` rows have the same cents amounts.
3. For a load with nuanced pricing (per_day per-diem, percentage fuel surcharge, radius_rate), calculated amounts match pre-refactor.

If anything looks off, stop and investigate. This is the AP billing-integrity canary — the counterpart to G2's Gate 3.

---

## 8. Open questions

None at design time. All clarifications resolved during brainstorming:

- Q: Does G3 reuse `lib/charge-profile-row-shapes.js` from G2? **A: No. Driver tariffs have no rows / versions / calc modes — this file is the AP analog of G1, not G2.**
- Q: What about the Advanced Route Matching toggle that renders no content? **A: Keep it verbatim in `DriverTariffHeader` with a placeholder-stub comment matching G1's. Build-out spawned as a followup product task.**
- Q: The dead `DriverPicker` local function — leave, delete, or extract? **A: Delete. It's never called, pre-existing dead code from an earlier UI iteration.**
- Q: Right panel name — `DriverPayPanel` or something else? **A: `DriverPayPanel`. Matches the JSX label "Driver Pay" in the section header.**
- Q: Merge the AP picker modal with G1's AR picker modal? **A: No. Different endpoints (`/api/tenant/ap/charge-profiles` vs `/api/tenant/charge-profiles`), different column sets. Keep separate.**
- Q: Promote any new primitives to `components/ui/`? **A: No. No second-consumer signal. `<LoadTypeChips>` and `<EffectiveDateRange>` from G1 are NOT reused in G3 because G3 uses different controls (checkboxes vs chips; stacked labeled DatePickers vs a labeled range).**
- Q: Decomposition granularity? **A: 6 files total, mirrors G1's pattern. Not finer (would fragment the matching panel's readability), not coarser (would inflate the matching panel past 300 LoC).**
