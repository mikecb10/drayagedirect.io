# UI Hierarchy & Spacing System — Design

**Date:** 2026-04-14
**Status:** Approved, pending implementation plan
**Scope:** Load detail page + settings pages (first consumers). Tokens and primitives are app-wide.

---

## 1. Goals & Scope

### Problem
Across DrayageDirect, density/layout pain is driven by two coupled issues: **inconsistent spacing** and **weak visual hierarchy**. Sections, forms, labels, and helper text all carry inline Tailwind classes that vary between pages. The result is visual noise that makes pages feel cluttered even when the content is correct. This is a design-system problem masquerading as a page problem — fixing individual pages without shared rules will recreate the same drift.

### In scope
- Semantic spacing + typography tokens extending `tailwind.config`.
- Four layout primitives: `PageHeader`, `SectionCard`, `FieldGroup` (+ `Field`), `DetailPane` (+ `DetailRow`).
- Audit of current usage in load detail + settings.
- Refactor of load detail (per-tab PRs) and settings (single PR) against the new system.
- Dark-mode parity and zoom 80–125% verification for every refactored surface.

### Out of scope
- Color palette redesign, iconography, motion/transition system.
- Dispatcher board, modals, AR, and list/index pages (will passively benefit as primitives are adopted).
- Settings IA restructure to left-sidebar layout (remains a separate, previously-planned task).
- ESLint rules enforcing token usage (governance via PR review for now).

### Success criteria
- Every page section on load detail + settings uses a primitive or a documented token — zero one-off `px-5 py-3`-style spacing.
- A reader can rank hierarchy (page title → section → field label → helper text) at a glance in both light and dark themes.
- Side-by-side before/after screenshots show visibly improved scannability without content being removed.

---

## 2. Token Set

Tokens live in `tailwind.config` as semantic aliases. Raw Tailwind classes (`text-sm`, `p-4`, etc.) remain available for genuine one-offs. The rule: **primitives use tokens; consumers use primitives**.

### Spacing scale

| Token | Value | Use |
|---|---|---|
| `space-page-x` | `px-6` | Page horizontal padding |
| `space-page-y` | `py-6` | Page vertical padding |
| `space-section` | `gap-6` | Between section cards |
| `space-section-pad` | `p-5` | Inside a section card |
| `space-section-head` | `px-5 py-3` | Section card header bar |
| `space-field` | `gap-4` | Between fields in a `FieldGroup` grid |
| `space-field-label` | `mb-1.5` | Label → input |
| `space-row` | `py-3` | Settings/detail list row height |
| `space-inline` | `gap-2` | Adjacent inline controls |

### Typography scale

| Token | Value | Use |
|---|---|---|
| `text-page-title` | `text-2xl font-bold` | `<h1>` page title |
| `text-section-title` | `text-sm font-semibold` | Section card header |
| `text-field-label` | `text-xs font-medium uppercase tracking-wide` | Field labels (Linear/Stripe style) |
| `text-body` | `text-sm` | Default body / input text |
| `text-helper` | `text-xs` | Descriptions, helper text, metadata |
| `text-muted` | `text-gray-500 dark:text-slate-400` | Secondary content color |
| `text-strong` | `text-gray-900 dark:text-slate-100` | Primary content color |

### Hierarchy rules (scannability contract)

1. Each page has exactly one `text-page-title`.
2. Section titles are always `text-section-title` on a tinted header bar (`bg-gray-50/70 dark:bg-slate-800/60`). The bar is the hierarchy signal, not font size.
3. Field labels are always `text-field-label text-muted` — smaller and lighter than their values.
4. Helper text sits directly under its owner with `mt-0.5`. Never `mt-1`, never `mt-2`.

### Dark mode

`text-muted` and `text-strong` are the **only** places gray/slate pairings are defined. Every primitive composes from these. No new component hardcodes `text-gray-500 dark:text-slate-400` again. This is the enforcement lever for the existing dark-mode convention (`dev_dark_mode_convention.md`).

### Governance: "3+ uses" rule

Adding tokens requires discipline or the set becomes another inconsistent mess.

1. If a new layout matches an existing token → use the token.
2. If it almost matches but not quite → do **not** bend the token or invent a near-duplicate.
3. **One-off** (1–2 places, not expected to repeat) → raw Tailwind is fine. Don't pollute the token set.
4. **New recurring pattern** (3+ places, or clearly foundational) → discuss, add a semantic token, document its purpose.

---

## 3. The Four Primitives

Consumers never write spacing/typography classes on these. They pass content.

### 3.1 `PageHeader` (evolves `ModuleHeader`)

```jsx
<PageHeader
  title="Load #ABCD-1234"
  description="DRAYFRT • 40' HC • Pickup 4/15"
  breadcrumb={<Breadcrumb ... />}
  status={<LoadStatusBadge ... />}
  actions={<><Button>Edit</Button><Button>Print</Button></>}
/>
```

- Uses `text-page-title` + `text-helper text-muted`.
- Padding: `space-page-x space-page-y`, bottom border.
- New `status` slot sits next to title.
- API is a superset of current `ModuleHeader` — existing call sites keep working.

### 3.2 `SectionCard` (evolves `FormSection`)

```jsx
<SectionCard
  title="Container"
  description="Size, type, owner, seal"
  actions={<Button variant="ghost" size="sm">Edit</Button>}
>
  <FieldGroup columns={2}>...</FieldGroup>
</SectionCard>
```

- Tinted header bar (`space-section-head` + `text-section-title`), body uses `space-section-pad`.
- New `actions` slot for inline section controls.
- Rendered in a vertical stack with `space-section` gap.
- **No `collapsible` prop.** Tabs already provide progressive disclosure; double disclosure is a UX cost. If a section gets collapsed often, the real fix is moving it to a different tab.

### 3.3 `FieldGroup` + `Field` (new)

```jsx
<FieldGroup columns={2}>
  <Field label="Container Number" required>
    <Input ... />
  </Field>
  <Field label="Seal" helper="Optional">
    <Input ... />
  </Field>
</FieldGroup>
```

- `FieldGroup` owns the grid and `space-field` gap.
- `Field` owns the label (`text-field-label text-muted` uppercase), `space-field-label` gap, and helper/error text.
- Kills duplicated inline `<label>` markup across the app.

### 3.4 `DetailPane` + `DetailRow` (new)

```jsx
<DetailPane>
  <DetailRow label="Container Number" value="ABCD1234567" />
  <DetailRow label="Discharge" value="4/15 14:30" copyable />
  <DetailRow label="LFD" value={<Badge>4/20</Badge>} />
  <DetailRow label="Chassis" value="—" muted />
</DetailPane>
```

- Label left (`text-field-label text-muted`, fixed width). Value right (`text-body text-strong`).
- `space-row` padding, divider between rows.
- `copyable`, `muted` props cover the 80% cases that currently get hand-rolled.

### Mapping: current → new

| Current | New |
|---|---|
| `components/ui/ModuleHeader.js` | `PageHeader` (evolve in place) |
| `components/ui/FormSection.js` | `SectionCard` (evolve in place) |
| Inline `<label>` + input pairs | `Field` inside `FieldGroup` |
| Hand-rolled key-value dl/table blocks | `DetailPane` + `DetailRow` |

---

## 4. Audit Plan

Performed as Step 1 of implementation. Output lives in §5 of this spec (appended during audit).

Scope:
- `components/loads/**` and all tabs under `components/loads/tabs/**`.
- `pages/settings/**` and `components/settings/**`.
- Shared primitives touched by either: `ModuleHeader`, `FormSection`, `DataTable`, `ModuleHeader` consumers.

For each file, catalog:
- Spacing classes in use (`p-*`, `px-*`, `gap-*`, `mt-*`, etc.) → target token.
- Typography classes in use (`text-*`, `font-*`) → target token.
- Label markup pattern.
- Dark-mode gaps (missing `dark:` pairings per convention).

Output: markdown table appended to this spec as §5 "Audit Results" before implementation begins.

---

## 5. Audit Results

*Populated during Plan A, Phase 1. Rows below drive Plans B (load detail) and C (settings). Items counted are representative, not exhaustive — goal is to confirm scope and locate high-density patterns.*

### 5.1 `components/loads/**`

Scope: 20 files under `components/loads/` (incl. `tabs/` and `routing/`). Totals: 646 spacing-class occurrences, 249 `text-gray-*` / 250 `dark:text-slate-*` (≈1:1 paired), 14 `<label>` elements across 6 files. Top 5 files chosen by spacing-class density + variety of typography/label patterns.

| File | Spacing drift (sample) | Typography drift | Label pattern | Dark-mode gaps |
|---|---|---|---|---|
| `tabs/BillingTab.js` (78 spacing hits) | mix of `px-3 py-2`, `px-2.5 py-1`, `gap-2/3/4`, `mt-0.5/1/2`, `space-y-2/3` | `text-xs font-medium`, `text-sm font-semibold`, `text-[10px]`, `text-[11px]` | `block text-xs font-medium text-gray-600 dark:text-slate-300 mb-1` (x5 repeated inline) | 0 (all gray paired) |
| `tabs/DocumentsTab.js` (49 spacing hits) | `px-3 py-2`, `p-3/4`, `gap-2/3`, `mb-1/1.5/2`, `mt-0.5/1` | `text-xs font-semibold`, `text-sm font-medium`, `text-[11px]`, `uppercase tracking-wide` | `block text-xs font-semibold text-gray-700 dark:text-slate-300 mb-1.5` (x2, diverges from BillingTab) | 0 |
| `tabs/TrackingTab.js` (35 spacing hits) | `p-3/4`, `px-3 py-2`, `gap-2/3/4`, `mt-0.5`, 11 `text-gray-500 dark:text-slate-400` repeats | `text-xs`, `text-sm font-medium/semibold`, `font-semibold`, uppercase mixed | no `<label>` (card-style detail rows instead) | 0 |
| `tabs/DriverPayTab.js` (30 spacing hits) | `px-3 py-2`, `px-2 py-1`, `gap-2/3`, `mt-1`, `space-y-2` | `text-xs`, `text-sm`, `font-medium/semibold` | no `<label>` | 0 |
| `tabs/RoutingTab.js` (22 spacing hits) | `p-3/4`, `gap-2/3`, `mb-2/3`, `space-y-3` | `text-xs`, `text-sm font-semibold` | no `<label>` (delegates to `routing/` subcomponents) | 0 |

**Recurring patterns to map to tokens:**
- `text-gray-900 dark:text-slate-100` (57x across 20 files) → `text-strong`
- `text-gray-500 dark:text-slate-400` (63x; 11 in TrackingTab) → `text-muted`
- `text-xs font-medium` (25x) vs `text-xs font-semibold` (17x) → one canonical `text-field-label`
- `px-3 py-2` card/input padding (27x) + `px-2.5 py-1` pill padding → tokenize both
- 5 distinct `<label>` variants across 6 files (sm/xs, medium/semibold, mb-1/1.5) → `Field`
- `mt-0.5` helper-text offset (46x) → `space-field-helper` (matches §2 contract)
- `gap-3` (37x) and `gap-2` (46x) for inline controls → `space-inline` (gap-2) canonical
- `mb-1` (14x) vs `mb-1.5` (3x) on label→input → `space-field-label` = mb-1.5 per §2
- `uppercase tracking-wide/wider` on pseudo-labels (28x) → encapsulate in `text-field-label`

**Recurring dark-mode fixes needed:**
- 0 `text-gray-*` lines without a `dark:` pairing (249 gray ≈ 250 slate). Convention holds.
- 11 `text-slate-*`-only lines in `routing/RailSlipPreviewModal.js` — dark phone mockup, exclude.
- Real gap is duplication: 63x muted pairs + 57x strong pairs inline → fold into the two tokens.

### 5.2 `pages/settings/**`

Scope: 29 files under `pages/settings/` (incl. `communications/`, `tariffs/`, `charge-profiles/`, `team/` subfolders). Totals: 1264 spacing-class occurrences, 719 typography-class occurrences, 83 `<label>` elements, 269 `text-gray-*`/`bg-gray-*` lines missing a `dark:` pairing on the same line. Unlike §5.1, the dark-mode column is non-trivial here — several older pages predate the `dark:` convention. Top 5 files chosen by combined spacing+typography density.

| File | Spacing drift (sample) | Typography drift | Label pattern | Dark-mode gaps |
|---|---|---|---|---|
| `tariffs/[id].js` (88 spacing hits) | `px-3 py-2`, `py-2.5`, `gap-3/4`, `mb-1/2/3`, `space-y-1/3/4`, `mt-0.5/2/3` | `text-xs`, `text-sm`, `font-medium/semibold`, `text-[11px]` | `block text-xs font-medium text-gray-600 dark:text-slate-300 mb-1` (19x inline) | 0 (all gray paired) |
| `charge-profiles/[id].js` (92 spacing hits) | `px-2/3`, `py-1/1.5/2`, `gap-1.5/3/4`, `mb-1/1.5`, `space-y-1.5/4/5` | `text-[10px]`, `text-[11px]`, `text-xs`, `text-sm`, `font-medium/semibold` | `block text-xs font-medium text-gray-600 dark:text-slate-300 mb-1` (8x) + `text-xs font-semibold text-gray-700` (1x) | 0 (all gray paired) |
| `communications/umbrellas/[id].js` (96 spacing hits) | `px-2/3/4`, `py-1/1.5/2/2.5`, `gap-1.5/2/3/4`, `mb-1/2/3`, `p-3/4/5` | `text-xs`, `text-sm`, `font-medium/semibold`, mixed uppercase | `block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1` — diverges from tariffs (sm vs xs) | 0 (all gray paired) |
| `communications/templates/[id].js` (78 spacing hits) | `px-3 py-2`, `px-4 py-2.5`, `gap-2/3`, `mb-1/1.5`, `space-y-3/4` | `text-xs`, `text-sm`, `font-medium/semibold` | `text-sm font-medium mb-1` + `text-xs font-semibold mb-1.5` (two variants in one file) | 0 (all gray paired) |
| `communications/trigger-activity/index.js` (65 spacing hits) | `px-3 py-2`, `px-4 py-2.5`, `gap-2/3`, `mb-1/2`, `py-10` empty state | `text-[11px]`, `text-xs`, `text-sm`, `font-semibold/medium` | `block text-[11px] font-semibold text-gray-600 dark:text-slate-300 mb-1` (5x) — third distinct label variant | 0 (all gray paired) |

**Recurring patterns to map to tokens:**
- `text-xs` (302x) + `text-sm` (237x) — two dominant body sizes → `text-helper` / `text-body`
- `font-semibold` (246x) vs `font-medium` (111x) — pick one per role (label vs title)
- `px-3 py-2` (100x) form-input padding, plus `py-2.5` (54x) and `px-4 py-2` (41x) variants
- `gap-3` (102x) and `gap-2` (98x) — split between section rhythm and inline controls
- `mb-4` (74x), `mt-1` (68x), `mb-1` (62x), `mt-0.5` (49x) — offsets drift 0.5/1/1.5
- `space-y-4` (29x) card-internal stacks → `space-section-pad` / internal stack token
- 335 half-step spacings (`0.5/1.5/2.5`) across 29 files — primary source of visual drift
- 134 arbitrary `text-[10/11/13/15]px` off-token sizes — mostly badges/pills
- 83 `<label>` elements across 14 files, at least 4 distinct class combos → `Field`
- 149x `text-gray-900 dark:text-slate-100` + 170x `text-gray-500 dark:text-slate-400` → tokens

**Notable inconsistencies:**
- `profile.js` uses raw `<section>` + manual classes, not `FormSection`. Phase 5 refactor target.
- `company.js` uses 6 raw `<section>` blocks, no `dark:` pairs — 37 unpaired lines (top gap).
- Label size differs: `tariffs` `text-xs`, `umbrellas` `text-sm`, `trigger-activity` `text-[11px]`.
- `mb-1` (62x) vs `mb-1.5` (17x) on label→input — §2 picks `mb-1.5` (`space-field-label`).
- 7 files hold >20 unpaired `text-gray-*` lines (company, team, terminals, per-diem, +3 indexes).

---

## 6. Rollout Plan

### Step 1 — Audit (half day)
Sweep the files in §4. Append results to §5 of this spec.

### Step 2 — Tokens + primitives (one PR)
- Extend `tailwind.config` with §2 tokens.
- Evolve `ModuleHeader` → `PageHeader` and `FormSection` → `SectionCard` (additive, non-breaking).
- Add `FieldGroup`/`Field` and `DetailPane`/`DetailRow`.
- Verify by rendering the simplest settings page (likely `pages/settings/profile.js`) using only primitives.

### Step 3 — Refactor load detail (per-tab PRs)
Walk the 10 tabs in order. One PR per tab. Each PR:
- Replaces ad-hoc markup with primitives.
- Removes inline spacing/typography classes.
- Dark-mode pass.
- Zoom 80/100/125% pass (per `qa_zoom_responsive.md`).
- No visual regressions on golden path.

### Step 4 — Refactor settings (single PR)
Settings is smaller and more uniform. Apply `PageHeader` + `SectionCard` + `DetailPane` consistently across all settings pages. Same verification gates as Step 3.

### Step 5 — Guardrails
Add `docs/ui-system.md` with:
- Token table (copied from §2).
- Primitive APIs (copied from §3).
- "3+ uses" governance rule.

No ESLint enforcement this pass. If drift reappears in 2–3 months, revisit.

---

## 7. Open Questions

None at spec-approval time. All decisions were made inline during brainstorming:
- Semantic tokens (not t-shirt).
- Linear/Stripe uppercase field label style.
- Evolve primitives in place (no deprecation cycle).
- No `collapsible` on `SectionCard`.
- Per-tab PRs for load detail; single PR for settings.
- Audit results inline in this spec, not a separate doc.
