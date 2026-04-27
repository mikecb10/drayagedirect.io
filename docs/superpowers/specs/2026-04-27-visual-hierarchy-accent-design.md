# Visual Hierarchy Pass — Umbrella Tint Bump + NewLoadModal Migration

**Date:** 2026-04-27
**Status:** Approved, pending implementation plan
**Tracks:** FU-121
**Scope:** Two surgical fixes that resolve FU-121's headline complaint without expanding the design system's API surface. (1) Bump the umbrella editor's accent body-tint level from `/10` to `/65` for visible group differentiation. (2) Migrate NewLoadModal onto the existing `<SectionCard>` primitive.

---

## 1. Goals & Scope

### Problem

In dark mode, several DrayageDirect pages feel monochromatic — adjacent sections share `bg-slate-900` and read as a flat slab. The audit (see §2 below) traced the complaint to two root causes:

1. **Pages haven't migrated to the existing UI system.** Plans A/B/C (2026-04-14 → 2026-04-16) shipped six primitives. Adoption was completed for load detail tabs, settings pages, and organization detail. Communications/, modals/, dispatcher cells/, and several list pages remain on raw class strings — sections render as flat divs separated only by `space-y-N` or thin `border-t` lines.
2. **Where accent treatment exists, it's too subtle.** The umbrella editor's `GroupCard` rotates a 5-color accent palette (blue / emerald / amber / purple / rose) — colored left-edge + matching badge + body bg tint. The colored left-edge and badge work; the body tint at `bg-{color}-950/10` (10% alpha) over `bg-slate-900` produces a ~4 sRGB-point shift. Imperceptible at normal viewing scale. Five stacked groups in five different colors look identical.

### In scope

This PR ships two coordinated, surgical fixes:

1. **Bump the umbrella editor's `GROUP_ACCENT_PALETTE` body tint from `/10` to `/65`.** Edit five constants in `pages/settings/communications/umbrellas/[id].js`. After the change, stacked Email Groups in different colors are visibly distinct — the FU-121 trigger complaint is resolved. No other behavior changes.
2. **Migrate `components/loads/NewLoadModal.js` onto the existing `<SectionCard>` primitive.** Wrap the current flat 3-column grid into four neutral SectionCard sections: "Routing template" / "Customer" / "Routing" / "Container & schedule." Type pills row stays outside any card. Notify-parties `<details>` collapsible and footer button row stay unchanged.
3. **Capture the lesson learned in [docs/ui-system.md](docs/ui-system.md)** — a brief FAQ entry noting that body tints below ~30% alpha are imperceptible against `slate-900` in dark mode, so accent treatments should land at 50–65% in dark / 30–40% in light.

### Out of scope (deferred)

- **`accent` prop on `<SectionCard>` (or new `<AccentCard>` primitive).** Designed and rejected for this PR. Reason: under the existing system's "3+ uses" rule, a new primitive ships when 3+ confirmed consumers exist. The umbrella editor's `GroupCard` would refactor naturally to consume it, but its custom header structure (badge + eyebrow + editable name + multi-button actions) doesn't fit `<SectionCard>`'s `title`/`description`/`actions` slots without API expansion. Refactoring it via negative-margin tricks would produce uglier code than current. So we wait. When two more concrete consumers materialize (likely candidates: AR FilterSidebar grouped categories, dispatcher color-coded sections, dashboard Recent Activity row tinting), the next FU ships the prop with a clean refactor of all confirmed consumers including `GroupCard`. See followups in §6.
- **Tab-color theming as a system primitive.** Single use site (umbrella `{{}}` dropdown). Stays umbrella-internal.
- **`<HierarchyRow>` primitive** (To-prominent / Cc-Bcc-subdued tier). Single use site. Stays internal.
- **Pattern C fix** for identical-row lists (Recent Activity feed, templates list inside the umbrella editor, etc.). Needs its own design pass.
- **Migration of remaining off-system pages** — AR FilterSidebar, dispatcher FilterSidebar, settings communications/, etc. Each gets its own FU.
- **Tailwind config changes.** No new `@theme` tokens, no new `@utility` classes.

### Success criteria

- After this PR, opening the umbrella editor in dark mode with 3+ Email Groups present shows visibly distinct cards from across the room.
- After this PR, opening the New Load modal in dark mode shows four clearly-separated sections with header bars (Routing template, Customer, Routing, Container & schedule) instead of one flat 3-column grid mixing six concept clusters.
- No existing `<SectionCard>` consumer has visible regressions — the primitive itself is unchanged.
- `docs/ui-system.md` documents the tint-level threshold so future accent attempts don't repeat the mistake.

---

## 2. Audit context (informational)

The full audit covered six representative pages plus the dashboard. Key adoption findings:

| Page | Status | Notes |
|---|---|---|
| Umbrella editor | Reference (recently shipped) | Prior session shipped tab-color theming + recipient hierarchy + group accent. Body tint = the missing piece this PR fixes. |
| NewLoadModal | Off-system | All raw class strings. Flat 3-column grid mixes 6 concept groups. → migrated this PR. |
| AR FilterSidebar | Off-system | Long flat `<section>` list, identical eyebrow labels. → deferred per-page FU. |
| Dispatcher board cells | Mostly OK | Tinted header + `divide-y` rows + state-color tinting + accent stripe. Possible gap: column dividers (no `divide-x`). |
| DriverModal | Mostly OK | Outer chrome uses `<DetailTabs>`; tab content uses `<SectionCard>`/`<FormSection>`. |
| Organizations List | Reference | Fully on system primitives. |

Three repeating patterns were identified:

- **Pattern A — Flat-Section Page** (NewLoadModal). Fixed this PR.
- **Pattern B — Monolithic Filter Panel** (AR FilterSidebar, likely dispatcher FilterSidebar). Deferred.
- **Pattern C — Identical-Row List** (dashboard Recent Activity, umbrella templates list). Deferred.

The umbrella editor surfaced four reusable visual patterns that future migrations should consume: Numbered Accent Card, Type-Aware Row, Tab-Color Themed Tabs, Elevated Floating Panel. None ship as primitives this PR; they're documented as reference patterns to converge on later.

---

## 3. Umbrella editor — tint bump

Edit `GROUP_ACCENT_PALETTE` at lines 977–983 of `pages/settings/communications/umbrellas/[id].js`. Change the `bg` field on each entry; leave `border` and `badgeBg` unchanged.

```js
// BEFORE — body tint imperceptible against slate-900
const GROUP_ACCENT_PALETTE = [
  { border: 'border-l-blue-500',    bg: 'bg-blue-50/30 dark:bg-blue-950/10',    badgeBg: 'bg-blue-600' },
  { border: 'border-l-emerald-500', bg: 'bg-emerald-50/30 dark:bg-emerald-950/10', badgeBg: 'bg-emerald-600' },
  { border: 'border-l-amber-500',   bg: 'bg-amber-50/30 dark:bg-amber-950/10',  badgeBg: 'bg-amber-600' },
  { border: 'border-l-purple-500',  bg: 'bg-purple-50/30 dark:bg-purple-950/10', badgeBg: 'bg-purple-600' },
  { border: 'border-l-rose-500',    bg: 'bg-rose-50/30 dark:bg-rose-950/10',    badgeBg: 'bg-rose-600' },
];

// AFTER — visible differentiation across colors
const GROUP_ACCENT_PALETTE = [
  { border: 'border-l-blue-500',    bg: 'bg-blue-50/40 dark:bg-blue-950/65',    badgeBg: 'bg-blue-600' },
  { border: 'border-l-emerald-500', bg: 'bg-emerald-50/40 dark:bg-emerald-950/65', badgeBg: 'bg-emerald-600' },
  { border: 'border-l-amber-500',   bg: 'bg-amber-50/40 dark:bg-amber-950/65',  badgeBg: 'bg-amber-600' },
  { border: 'border-l-purple-500',  bg: 'bg-purple-50/40 dark:bg-purple-950/65', badgeBg: 'bg-purple-600' },
  { border: 'border-l-rose-500',    bg: 'bg-rose-50/40 dark:bg-rose-950/65',    badgeBg: 'bg-rose-600' },
];
```

The light-mode tint bumps from `/30` to `/40` (small adjustment for parity); the dark-mode tint bumps from `/10` to `/65` (the actual fix). `GroupCard` consumes the palette unchanged — no behavioral or structural changes to the component.

The new tint level was validated against three stacked colors (blue / emerald / amber) in the visual companion brainstorming session. Five colors stacked at `/65` were judged distinct without becoming visually noisy — the saturation level reads as "intentional identity" rather than "rainbow alert."

### Why we don't refactor `GroupCard` here

`GroupCard`'s custom header (badge + eyebrow + editable name input + save indicator + active checkbox + delete button) doesn't fit `<SectionCard>`'s `title`/`description`/`actions` slots cleanly. Refactoring requires either an API expansion to SectionCard (new `headerContent` slot) or a negative-margin trick that defeats the purpose of using a primitive. Both create more debt than they retire for a single-consumer change. Deferred to a future FU once 2–3 consumers are confirmed.

---

## 4. NewLoadModal migration

### Section grouping

Wrap the existing form into four sections inside `<SectionCard>`. Order preserved.

| # | Section title | Description | Contents |
|---|---|---|---|
| pre | (no card) | — | Type pills row (5 chips) — discriminator, not a section |
| 1 | "Routing template" | "Drag to reorder · {N} available for {load_type}" | DnD chip grid |
| 2 | "Customer" | "Bill-to + branch assignment" | Customer picker (col-span 2) + Branch picker |
| 3 | "Routing" | "Pickup → Delivery → Return locations" | Up to 3 OrgPicker slots (slot1/slot2/slot3, plus optional Final Delivery) |
| 4 | "Container & schedule" | "Container details + appointments + references" | Container # + Size + Trailer (when applicable) + Pickup Apt + Delivery Apt + Master BOL + Booking # |
| post | (no card) | — | Notify parties `<details>` collapsible (only when customer set) + footer button row |

All four sections use neutral `<SectionCard>` (no accent — the primitive doesn't have an accent prop yet). Each section uses `columns={0}` and owns its own internal grid layout — this preserves the existing `grid-cols-1 md:grid-cols-3 gap-3` breakpoints already in the modal.

### What stays unchanged

- All field-level inputs (`<OrgPicker>`, `<DatePicker>`, `<Input>`, `<Select>`) keep their existing call shape.
- All conditional rendering logic (`typeCfg.showContainer`, `typeCfg.slot1`, etc.) is preserved — sections render the same conditional contents, just inside SectionCard chrome.
- The pendingCustomerOrg confirmation dialog overlay is unchanged.
- Form submission, validation, error handling — unchanged.

### What changes visually

- Each of the 4 sections gets a tinted header bar with its title + description (per `<SectionCard>`'s default chrome). Eye reads "Routing template → Customer → Routing → Container & schedule" as distinct beats instead of one long grid.
- Sections separate visually via SectionCard's `border` + `rounded-xl` chrome plus the `space-y-[var(--space-section)]` (24px) gap between cards.
- Today's `space-y-4` outer spacing collapses into the SectionCard's standard rhythm — adjusted as needed during implementation.

### Layout in compact mode

`<SectionCard>` already consumes the `--space-section-pad` and `--space-section-head-y` tokens; compact mode (the `[data-compact]` root attribute) reduces these automatically. NewLoadModal does not currently use compact mode — no change needed.

---

## 5. Documentation update — `docs/ui-system.md`

### New entry in §9 (FAQ)

```md
**Q: I want to add a tinted-color background to a section. What alpha level works?**
A: Validated against `bg-slate-900` page background in dark mode:
  - Below ~30% — imperceptible. Eye reads as no tint at all.
  - 30–50% — visible but subtle. Good for "these cards belong to a series" cues
    where you don't want competing chroma.
  - 50–70% — clearly tinted. Cards read as colored without becoming saturated.
  - Above ~70% — saturated. Cards feel like alerts, not sections. Avoid for neutral grouping.
  In light mode, halve the alpha (15% / 30% / 40%) — the white background takes color
  more readily. The umbrella editor's GROUP_ACCENT_PALETTE uses 65% / 40% (dark / light)
  as the canonical "visible differentiation across multiple stacked cards" level.

  Future-tense note: a `<SectionCard>` `accent` prop encoding this guidance is planned —
  see followup FU when 2–3 consumers materialize.
```

No changes to §1–§8. The Tokens, Primitives, Governance, Dark mode, Compact mode, and Consumers sections remain accurate.

---

## 6. Files affected

| File | Change | LoC delta (estimated) |
|---|---|---|
| `pages/settings/communications/umbrellas/[id].js` | Bump `GROUP_ACCENT_PALETTE` `bg` field on 5 entries | 0 net (5 lines edited in place) |
| `components/loads/NewLoadModal.js` | Wrap 4 sections in `<SectionCard>`, import SectionCard, remove redundant `border-t` dividers | +25 |
| `docs/ui-system.md` | Append FAQ entry on tint alpha levels | +14 |

Total: ~40 net LoC across 3 files.

---

## 7. Testing

### Unit (component-level)

No new tests needed for the umbrella tint bump (constant-value change with no behavior delta). For NewLoadModal:
- If existing tests cover the modal's submit / validation / conditional-section logic, those pass unchanged. The migration is mechanical wrapping.
- No new test for NewLoadModal's structure beyond what existed.
- A snapshot or DOM-shape test on `<SectionCard>` itself confirming default rendering is unchanged would be defensive but isn't strictly required (we made no API changes).

### Visual (manual)

1. Dark mode + light mode at viewport zoom 80% / 100% / 125%, on:
   - Umbrella editor with 3+ Email Groups present — confirm cards visibly differentiate across colors. Ideally test with 5 groups present to validate full palette rotation.
   - New Load modal across all load_type values (import / export / inbound / outbound / road / bill_only / chassis_reposition) — confirm 4 sections render with proper conditional content; type pills sit above first card; notify-parties `<details>` and footer button row sit below the last card.
2. Cross-check that `pages/settings/profile.js` (Plan A exemplar) renders identically to before. If Profile changes visually, the migration accidentally affected the primitive — investigate.

### Regression risk

Low. The umbrella tint change is a constant-value edit with no logic delta. The NewLoadModal migration wraps existing children — the underlying form fields and submit logic are untouched. `<SectionCard>` itself is not modified.

---

## 8. Open questions / followups

- **`accent` prop on `<SectionCard>` (or new `<AccentCard>` primitive)** — deferred. Open a follow-up FU when 2–3 consumers materialize. Likely candidates: (a) AR FilterSidebar grouped filter categories, (b) dashboard Recent Activity row tinting, (c) `GroupCard` in umbrella editor (refactor target). The follow-up should also handle SectionCard's slot expansion (`headerContent` or similar) so `GroupCard` can refactor cleanly.
- **Tab-color theming primitive** — deferred. Same gating: 3+ uses required.
- **Pattern C — identical-row list fix** — deferred. Needs its own design pass.
- **Pattern B — AR FilterSidebar / dispatcher FilterSidebar / settings comms migration** — deferred to per-page FUs.

---

## 9. Implementation plan

To be drafted via the writing-plans skill once this spec is approved.
