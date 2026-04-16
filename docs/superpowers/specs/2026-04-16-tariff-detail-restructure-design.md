# Tariff Detail Page Restructure — Design Spec (Plan G1)

**Date:** 2026-04-16
**Status:** Draft, awaiting plan
**Predecessors:** UI Plans A, B, C (design system), Plan E (settings shell). See `docs/ui-system.md`.

---

## 1. Goal

Decompose `pages/settings/tariffs/[id].js` (977 LoC) into a thin page shell + 5–6 focused sub-components living under `components/settings/tariff-detail/`. Apply Plan C/E design-system primitives where they don't disturb the two-panel layout. **Zero behavior change** — the AR matching engine, the autopulldown of charges into loads, the API payload shape, and every controlled-input value flow stay bit-for-bit identical.

This is base-laying, not feature-building. The pricing module is the AR/AP heart of the app. We're making it so future additions (the charge-profile autofill rule, percentage-of-base UX, conflict-resolution config UI, "Test Your Tariffs" preview) drop into a clean seam instead of requiring surgery on a 977-line monolith.

---

## 2. Why now

- Tariffs power AR billing. Every change risks customer revenue. The current monolith makes "every change" feel scary, which slows the whole pricing roadmap.
- Plan C and Plan E established the design system + the settings shell. The pricing detail pages are the last big sprawl in `/settings/*` that hasn't been touched.
- Features pending design (autofill rule, percentage-base UI, etc.) all need clean seams to land in. Building them on top of the current monolith would mean editing the same 977-line file three more times.

---

## 3. Hard constraint: zero behavior change

This constraint dominates every other decision.

| Aspect | Rule |
|---|---|
| `handleSave` payload | Byte-identical JSON sent to `/api/tenant/tariffs/...`. Same fields, same nesting, same types, same key order if possible. |
| State shape | The 8 useState hooks at the top of `TariffForm` stay exactly as they are. No useReducer, no per-component state extraction. |
| Side effects | All `useEffect` blocks (load-from-API, anything else) stay in the page shell unchanged. |
| Backend code | Not touched. Plan G1 is a pure frontend file refactor. |
| Engine logic | The matching engine that decides which tariff applies to a given load and which charges fire — not touched, not even read. |
| Visual layout | Two-panel structure (left matching panel, right charge-sets panel) preserved. Widths, controls, ordering preserved. |
| User-visible UX | Functionally identical. A user opening a tariff after the refactor should not notice anything different beyond minor color polish from token swaps. |

If a refactor step would require even a key reordering in the saved payload, it doesn't ship.

---

## 4. Architecture

### 4.1 File structure after the refactor

```
pages/settings/tariffs/[id].js                           (~150 LoC — was 977)
  └─ Owns: state hooks (8 useStates), useEffects, handleSave, handleCancel,
           every update/toggle/add/remove handler. Composes the sub-components.

components/settings/tariff-detail/
  ├─ TariffHeader.js                  (~40 LoC)
  │    Title + Basic/Advanced tab toggle. Pure presentational.
  │
  ├─ TariffMatchingPanel.js           (~250 LoC)
  │    Left panel: name, draft, dates, load types, customers, location filters,
  │    container/SSL/CSR/chassis fields, flags. The whole "what does this tariff
  │    apply to" form.
  │
  ├─ TariffChargeSetsPanel.js         (~250 LoC)
  │    Right panel: bill-to picker, charge sets table, "Select Charge Profiles"
  │    trigger, "+ Add Charge Item" rows. The whole "what charges fire" form.
  │
  ├─ TariffAdvancedRoute.js           (~150 LoC)
  │    The Advanced Route Matching tab content. Annotated as "built UI, not
  │    yet connected to engine — see Plan G followups." Treated as relocated,
  │    not modified.
  │
  └─ ChargeProfilePickerModal.js      (~200 LoC)
       Extracted verbatim from the bottom of [id].js. Same props.

components/ui/
  ├─ LoadTypeChips.js                 (~50 LoC, NEW promoted primitive)
  │    <LoadTypeChips value={form.load_types} onChange={...} options={LOAD_TYPES} />
  │
  └─ EffectiveDateRange.js            (~60 LoC, NEW promoted primitive)
       <EffectiveDateRange start={...} end={...}
                           onStartChange={...} onEndChange={...} />
```

### 4.2 State ownership

The page shell at `pages/settings/tariffs/[id].js` owns ALL state. The 8 useState hooks stay there exactly as they are today. Sub-components are dumb — they receive value-props and onChange-props.

No internal state in any sub-component beyond local UI state that's already there (e.g., the picker modal's "selected IDs" buffer, which is already inside `<ChargeProfilePickerModal />`).

### 4.3 Per-component contracts

```jsx
// TariffHeader.js
<TariffHeader
  matchingMode="basic" | "advanced_route"
  onMatchingModeChange={(mode) => void}
/>

// TariffMatchingPanel.js
<TariffMatchingPanel
  form={form}                        // the whole form state object
  update={(field, value) => void}    // existing update() helper, passed down
  toggleLoadType={(type) => void}
  toggleFlag={(key) => void}
  toggleLocationAll={(field) => void}
  addLocationId={(field, orgId, orgName) => void}
  removeLocationId={(field, orgId) => void}
  isLocationAll={(field) => bool}
/>

// TariffChargeSetsPanel.js
<TariffChargeSetsPanel
  chargeSets={chargeSets}
  onAddChargeSet={() => void}
  onRemoveChargeSet={(idx) => void}
  onOpenProfilePicker={(csIdx) => void}
  onRemoveProfile={(csIdx, pIdx) => void}
  onAddChargeItem={(csIdx) => void}
  onUpdateChargeItem={(csIdx, itemIdx, field, value) => void}
  onRemoveChargeItem={(csIdx, itemIdx) => void}
/>

// TariffAdvancedRoute.js
<TariffAdvancedRoute
  form={form}
  update={(field, value) => void}
/>

// ChargeProfilePickerModal.js — UNCHANGED API
<ChargeProfilePickerModal
  isOpen={pickerOpen}
  onClose={() => void}
  onSelect={(profiles) => void}
  existingIds={[...]}
/>

// LoadTypeChips.js (promoted to components/ui/)
<LoadTypeChips
  value={form.load_types}             // string[]
  onChange={(nextArray) => void}
  options={LOAD_TYPES}                 // [{value, label}] — caller passes
/>

// EffectiveDateRange.js (promoted to components/ui/)
<EffectiveDateRange
  start={form.effective_start}
  end={form.effective_end}
  onStartChange={(val) => void}
  onEndChange={(val) => void}
/>
```

### 4.4 Why "page shell owns state, dumb sub-components"

This pattern preserves the zero-behavior-change guarantee with the smallest possible delta. We're literally moving JSX into separate files and threading the same props through. No new hooks, no new abstractions, no new state machines. A reviewer can compare the old and new render trees and verify "same elements, same props, same handlers" in their head.

If a future plan needs a richer state model (e.g., for a "test your tariff" preview that needs to track simulated-load state), that's a non-trivial change that gets its own design pass. Not now.

---

## 5. Design-system token application

Where the existing JSX uses raw `text-gray-* dark:text-slate-*` pairs, swap to `text-muted` / `text-strong` per the Plan C convention. Where a logical group exists (header bar, left panel header, right panel header, modal header), wrap in `<SectionCard>` if it improves readability without disturbing the two-panel layout.

**Don't:**
- Don't restructure the two-panel layout itself. The fixed-left-with-scrolling-right pattern is intentional and works.
- Don't add `<PageHeader>` to the tariff detail page — it doesn't fit. The current `<h1>Load Tariff</h1>` + tab toggle pattern is the page header. Keep it but tokenize.
- Don't rewrite the charge sets table into a `<DataTable>` primitive. That's a future-feature scope, not base-laying.

---

## 6. Advanced Route Matching tab

Status today: built UI, not yet connected to the engine. The user has not tested it. It exists in the JSX behind the "Advanced Route Matching" tab toggle.

Plan G1 treatment:
- Pull verbatim into `TariffAdvancedRoute.js`.
- Add a top-of-file comment: `/* Advanced Route Matching — UI built but not yet wired to the matching engine. Filling out this form does not currently affect tariff matching. See followup plan when wiring this up. */`
- Don't modify the JSX. Don't fix anything. Don't try to wire it.

---

## 7. Verification gates

Three gates must pass before each commit (and especially the final one).

### 7.1 Gate 1 — Payload diff (programmatic)

- **Before refactor:** open an existing tariff (e.g., the CH ROBINSON tariff which already has charges attached). In dev, hit Save with a no-op edit. Capture the JSON the API receives via DevTools Network tab. Save as `tmp/tariff-payload-baseline.json`.
- **After each commit that touches state-passing or controlled inputs:** re-capture the payload from the same tariff and `diff` against the baseline. Must be byte-identical (whitespace/key-ordering tolerated).
- If they differ → fix before commit, not after.

### 7.2 Gate 2 — Manual smoke (human-in-loop)

After the page-shell extraction lands:
- Open `/settings/tariffs/<existing-tariff-id>` in the dev server.
- Confirm every field shows the same value as before.
- Edit a field, save, reopen. Confirm the edit persists.
- Open a load assigned to that tariff's customer in another tab. Confirm the same charges auto-populate as before.

### 7.3 Gate 3 — AR engine sanity (automated, optional)

If the existing "Click Here To Test Your Tariffs" button (or its equivalent endpoint) is reachable:
- Run a hypothetical load through the matching engine before the refactor → capture output.
- Run the same hypothetical load after the refactor → diff outputs. Must be identical.
- If the endpoint isn't easily callable from a script, we skip Gate 3 and rely on Gates 1 + 2. This is a "nice to have," not a "must."

These gates appear in the implementation plan as explicit task steps, not as an aspirational appendix.

---

## 8. Out of scope

- Touching `handleSave` payload shape, the `/api/tenant/tariffs/...` API, or any backend code.
- Touching the matching engine that resolves which tariff/charges apply to a given load.
- Wiring up Advanced Route Matching to the engine.
- Adding a "test your tariff" preview, the autofill rule UI, percentage-of-base UI, or any other future feature.
- `pages/settings/charge-profiles/[id].js` (Plan G2) and `pages/settings/driver-tariffs/[id].js` (Plan G3) — those are separate plans. If the patterns from G1 hold up, G2 and G3 will follow the same shape.
- Pre-existing lint warnings unrelated to the file changes in this plan.
- Promoting more than `<LoadTypeChips>` and `<EffectiveDateRange>` to `components/ui/`. Other reusable-looking pieces stay tariff-local until a second consumer materializes.

---

## 9. Success criteria

A reviewer (or the user) can:

1. Read `pages/settings/tariffs/[id].js` end-to-end in under 5 minutes and understand what the page does.
2. Open any sub-component in `components/settings/tariff-detail/` and read it end-to-end in under 2 minutes.
3. Add a new field to the matching panel without touching `TariffChargeSetsPanel` or `TariffAdvancedRoute`.
4. Open an existing tariff in dev and verify it looks and behaves identically to before the refactor.
5. Create a new tariff, attach a charge profile, save, and confirm the load-side autopulldown still fires correctly for a matching load.
6. `npm run build` clean. No new lint errors introduced (pre-existing errors in this file may remain or get cleaned up incidentally — judgment call).
7. Dark mode + compact mode + zoom 80/100/125 all clean on the tariff detail page in both Basic and Advanced tabs.

---

## 10. Open questions

None at design time. All clarifications resolved during brainstorming:

- Q: How aggressively should we restructure state? **A: Not at all. Page shell owns all state, sub-components are dumb.**
- Q: Tariff-specific or general-purpose components? **A: Tariff-specific by default. Promote only `<LoadTypeChips>` and `<EffectiveDateRange>` because they're tiny and obvious for the AP refactor.**
- Q: What about the Advanced Route Matching tab? **A: Pull into its own file unchanged. Annotate it as "built but not wired."**
- Q: Extract `<ChargeProfilePickerModal />`? **A: Yes, into `components/settings/tariff-detail/`. Same props.**
- Q: What's the real motivation for the restructure? **A: Build the base so future additions drop in easily. Not visual consistency, not subagent ergonomics — extensibility.**
