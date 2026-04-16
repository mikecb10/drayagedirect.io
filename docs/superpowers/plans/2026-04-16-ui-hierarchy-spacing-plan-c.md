# UI Hierarchy & Spacing — Plan C: Settings Pages Refactor

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor the core settings pages onto the design-system primitives shipped in UI Plan A and validated in UI Plan B. Every `<section>` wrapper becomes a `SectionCard`; every `<h1 className="text-2xl font-bold...">` becomes a `<PageHeader>`; every inline `<label>` + input pair becomes a `<Field>` inside a `<FieldGroup>`; every `text-gray-500 dark:text-slate-400` pair collapses onto `text-muted` / `text-strong`. Ships a single `docs/ui-system.md` guardrails doc so future contributors know the rules.

**Architecture:** No new primitives. No new tokens — Plans A and B already shipped everything this needs (spacing + typography tokens, `PageHeader`, `SectionCard`, `FieldGroup`, `Field`, `DetailPane`, `DetailRow`, and the `text-muted` / `text-strong` / `text-section-title` / `text-field-label` / `text-body` / `text-helper` / `text-page-title` utilities). The plan is a pattern-level find-and-replace across 12 settings pages, one commit per page for bisectability, plus one doc commit. Modal shells and communications sub-pages stay untouched (UI Plan D candidates).

**Tech Stack:** Next.js 15 (Pages Router), React 19, Tailwind v4 (CSS-first config), Supabase. Primitives live in `components/ui/`; tokens + `@utility` classes live in `styles/globals.css`. `components/settings/SettingsLayout.js` already provides the PortPro-style left sidebar — no changes needed there.

**Spec:** `docs/superpowers/specs/2026-04-14-ui-hierarchy-spacing-design.md` — §5.2 Audit Results and §5.4 Token Demand are the source of truth for what needs changing.

**Exemplar:** `pages/settings/profile.js` (shipped in Plan A, Step 7) is the reference composition. Every refactor in this plan should end up looking structurally like profile.js.

---

## Scope

### In scope (12 pages + 1 doc)

| # | File | Why it's in scope | §5.2 drift signal |
|---|---|---|---|
| 1 | `pages/settings/index.js` | Redundant card grid (sidebar already navigates) + inline gray/slate pairs | grid-of-links pattern is stale |
| 2 | `pages/settings/document-validation.js` | Simple list + checkbox, quick win | — (tier 2 file) |
| 3 | `pages/settings/terminal-markets.js` | Search + list, similar to terminals | — (tier 2 file) |
| 4 | `pages/settings/terminals.js` | Search + filters + inline-edit list | 28 unpaired gray/bg lines (tier 1) |
| 5 | `pages/settings/per-diem.js` | Stats + filter + table; modal stays untouched | 28 unpaired (tier 1) |
| 6 | `pages/settings/container-owners.js` | Stats + search + table; uses old `FormSection` default import inside modal | 23 unpaired (tier 1) |
| 7 | `pages/settings/chassis-owners.js` | Custom row component + modal with raw `<label>`s | same pattern as #6 |
| 8 | `pages/settings/equipment-reference.js` | Sub-tabs + DnD table | 21 unpaired (tier 1) |
| 9 | `pages/settings/branches.js` | Stats + table + assignment panel | complex, common drift |
| 10 | `pages/settings/dispatcher-colors.js` | Live preview + grouped color pickers | hand-rolled sections |
| 11 | `pages/settings/team.js` | Table + complex user modal (tabs + permission grid) | 36 unpaired (tier 1) |
| 12 | `pages/settings/company.js` | Heaviest drift — 5+ sections, logo uploader, toggles | 37 unpaired (tier 1, highest) |

Plus one doc task:
- Create `docs/ui-system.md` — token table, primitive APIs, "3+ uses" governance rule.

### Out of scope (deferred)

- **`pages/settings/charge-profiles/*`** (list + detail) — AR pricing detail page is 1800+ LoC and deeply coupled to a tariff editor; touching it now risks breaking the in-flight pricing engine QA. UI Plan D candidate.
- **`pages/settings/tariffs/*`** — same reasoning as charge-profiles.
- **`pages/settings/driver-tariffs/[id].js`** — AP counterpart of tariffs; same reasoning.
- **`pages/settings/team/[id].js`** — detail page; tier-2 coverage, defer until team/index is validated.
- **`pages/settings/communications/**`** — 9 sub-pages (formatting, templates, umbrellas, configurations, shared-accounts, sender-addresses, sender-domains, trigger-activity). Complex email template editors with their own design language. UI Plan D candidate.
- **Modal shells inside settings pages** — `components/settings/PerDiemRuleModal.js`, the inline modals in `container-owners.js` / `chassis-owners.js` / `team.js` / `branches.js`. Modal ergonomics are UI Plan D scope (matches Plan B's stance). If a modal's _body_ uses raw labels, the per-page task swaps them to `<Field>` where trivial — but the modal chrome (backdrop, header bar, footer actions) stays untouched.
- **`components/settings/SettingsLayout.js`** — the PortPro sidebar shell. Works fine; do not touch.
- **Spec §5.4 eyebrow/badge token (`text-[9px]` / `text-[10px]` / `text-[11px]`)** — spec names this a Plan C target, but promoting it to a token requires observing 3+ _consistent_ usages post-refactor. The per-page refactors in this plan treat sub-`text-xs` sizes as drift-to-migrate-to-`text-field-label` first; any residual eyebrow sizes that clearly survive review become a token proposal in a follow-up.

### Success criteria

Every refactored page:
- Uses `<PageHeader>` exactly once.
- Uses `<SectionCard>` for every logical grouping (no raw `<section>` with `rounded-xl border bg-white` chrome).
- Uses `<Field>` inside `<FieldGroup>` for every form input that carries a label.
- Uses `text-muted` / `text-strong` / `text-section-title` / `text-field-label` / `text-body` / `text-helper` — zero inline `text-gray-*` / `dark:text-slate-*` pairs.
- Uses `space-y-[var(--space-section)]` between sections, `gap-[var(--space-field)]` inside field grids, `gap-[var(--space-inline)]` for inline controls.
- `npm run build` clean. No new ESLint warnings.
- Renders in dark mode without visual regressions.
- Renders in compact mode (`[data-compact]` on root) without clipping or overflow.
- Zoom 80% / 100% / 125% clean per `qa_zoom_responsive.md`.

---

## File Structure

**Modified files (all exist):**
- `pages/settings/index.js` — Phase 2.1
- `pages/settings/document-validation.js` — Phase 2.2
- `pages/settings/terminal-markets.js` — Phase 2.3
- `pages/settings/terminals.js` — Phase 2.4
- `pages/settings/per-diem.js` — Phase 2.5
- `pages/settings/container-owners.js` — Phase 2.6
- `pages/settings/chassis-owners.js` — Phase 2.7
- `pages/settings/equipment-reference.js` — Phase 2.8
- `pages/settings/branches.js` — Phase 2.9
- `pages/settings/dispatcher-colors.js` — Phase 2.10
- `pages/settings/team.js` — Phase 2.11
- `pages/settings/company.js` — Phase 2.12

**New files:**
- `docs/ui-system.md` — Phase 3.1

**Imports each refactored page adopts** (some subset, based on what the page actually needs):

```jsx
import { PageHeader } from '../../components/ui/ModuleHeader';
import { SectionCard } from '../../components/ui/FormSection';
import FieldGroup from '../../components/ui/FieldGroup';
import Field from '../../components/ui/Field';
import DetailPane from '../../components/ui/DetailPane';
import DetailRow from '../../components/ui/DetailRow';
```

Note: `PageHeader` is the **named** export (new primitive). `SectionCard` is the **named** export. Importing the default of `ModuleHeader.js` gives you the backward-compat wrapper that forces `variant="plain"`; importing the default of `FormSection.js` gives you `SectionCard` under the old name. Always prefer the named imports in refactored code.

---

## Pattern Library (universal swaps)

Every page task in Phase 2 runs these swaps. Per-page tasks specify only the particulars beyond these universals.

### 1. Page-level header

**Before** (11 out of 12 pages use some variant of this):
```jsx
<div className="mb-6">
  <h1 className="text-2xl font-bold text-gray-900 dark:text-slate-100 flex items-center gap-2">
    <Icon className="w-6 h-6 text-blue-600" />
    Page Title
  </h1>
  <p className="text-sm text-gray-500 dark:text-slate-400 mt-1">
    Description copy.
  </p>
</div>
```

**After:**
```jsx
<PageHeader
  variant="plain"
  title={<><Icon className="w-6 h-6 text-blue-600 inline -mt-0.5 mr-2" />Page Title</>}
  description="Description copy."
  className="mb-[var(--space-section)]"
/>
```

When the header also has a primary CTA (e.g. "Add X" button) use the `actions` slot:
```jsx
<PageHeader
  variant="plain"
  title="Page Title"
  description="Description copy."
  actions={<Button onClick={openNew}><Plus className="w-4 h-4 mr-1 inline -mt-0.5" />Add X</Button>}
  className="mb-[var(--space-section)]"
/>
```

Why `variant="plain"`? Settings pages live _inside_ `SettingsLayout`, which already owns page padding. `variant="chrome"` adds `px-[var(--space-page-x)] py-[var(--space-page-y)] border-b` — on a settings page that would double-pad. Match `pages/settings/profile.js` (the exemplar) which uses `variant="plain"`.

### 2. Section wrapper

**Before:**
```jsx
<section className="bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-xl p-6 shadow-sm">
  <h2 className="text-base font-semibold text-gray-900 dark:text-slate-100 mb-1">
    Section Title
  </h2>
  <p className="text-xs text-gray-500 dark:text-slate-400 mb-4">
    Description.
  </p>
  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
    {/* fields */}
  </div>
</section>
```

**After:**
```jsx
<SectionCard title="Section Title" description="Description." columns={0}>
  <FieldGroup columns={2}>
    {/* <Field> components */}
  </FieldGroup>
</SectionCard>
```

Why `columns={0}` on SectionCard? Because FieldGroup owns the grid. If you pass `columns={2}` to both, you get a grid-inside-a-grid. `columns={0}` tells SectionCard to render children unwrapped in a single padded body.

When the section has a right-aligned action (button / link) in its header bar, use SectionCard's `actions` slot:
```jsx
<SectionCard
  title="Section Title"
  description="Description."
  columns={0}
  actions={<Button variant="secondary" onClick={handleAction}>Action</Button>}
>
  {/* body */}
</SectionCard>
```

### 3. Field with label + input

**Before:**
```jsx
<div>
  <label className="block text-xs font-medium text-gray-600 dark:text-slate-400 mb-1">
    Field Name
  </label>
  <input
    type="text"
    value={value}
    onChange={(e) => setValue(e.target.value)}
    className="block w-full rounded-lg border border-gray-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-gray-900 dark:text-slate-100 px-3 py-2 text-sm focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
    placeholder="Enter value"
  />
  <p className="text-xs text-gray-500 dark:text-slate-400 mt-0.5">Optional helper</p>
</div>
```

**After:**
```jsx
<Field label="Field Name" helper="Optional helper">
  <Input
    value={value}
    onChange={(e) => setValue(e.target.value)}
    placeholder="Enter value"
  />
</Field>
```

If the input has a validation error:
```jsx
<Field label="Field Name" error={errors.name}>
  <Input value={value} onChange={...} />
</Field>
```

### 4. Read-only key/value rows

**Before:**
```jsx
<div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
  <div>
    <div className="text-xs font-medium text-gray-500 dark:text-slate-400 uppercase">Label</div>
    <div className="text-sm text-gray-900 dark:text-slate-100 mt-0.5">{value || '—'}</div>
  </div>
  {/* … */}
</div>
```

**After:**
```jsx
<DetailPane>
  <DetailRow label="Label" value={value || '—'} muted={!value} />
  {/* … */}
</DetailPane>
```

When the value is copyable (SCAC code, slug, etc.):
```jsx
<DetailRow label="Slug" value={tenant.slug} copyable />
```

### 5. Inline-uppercase "eyebrow" text on stats/cards

**Before:**
```jsx
<div className="text-[11px] uppercase tracking-wide text-gray-500 dark:text-slate-400">
  Total Rules
</div>
<div className="text-2xl font-bold text-gray-900 dark:text-slate-100">{count}</div>
```

**After:**
```jsx
<div className="text-field-label text-muted">Total Rules</div>
<div className="text-2xl font-bold text-strong">{count}</div>
```

Why: `text-field-label` already resolves to `text-xs font-medium uppercase tracking-wide`. The arbitrary `text-[11px]` was half-step drift (spec §5.4). The `text-2xl font-bold` is a stat counter, not a page title — leave it raw; it's only used in ~10 places as a numeric counter.

### 6. Inline color / token swaps (universal)

| Before | After |
|---|---|
| `text-gray-500 dark:text-slate-400` | `text-muted` |
| `text-gray-600 dark:text-slate-300` (body-muted) | `text-muted` (consolidate — both are "secondary content") |
| `text-gray-900 dark:text-slate-100` | `text-strong` |
| `text-gray-700 dark:text-slate-200` (near-strong) | `text-strong` unless paired with `font-medium/semibold` — leave those alone if they're inside a pill/badge |
| `text-sm font-semibold text-gray-900 dark:text-slate-100` (section heading, not in a SectionCard) | `text-section-title text-strong` |
| `text-xs font-medium text-gray-600 dark:text-slate-400 uppercase tracking-wide` | `text-field-label text-muted` |
| `text-xs` (as helper / descriptor) | `text-helper` |
| `text-sm` (as body / input text) | `text-body` |
| `space-y-6` on form wrapper | `space-y-[var(--space-section)]` |
| `space-y-4` on sub-stack inside a section | `space-y-[var(--space-field)]` |
| `gap-4` between field cells | `gap-[var(--space-field)]` (FieldGroup already does this) |
| `gap-3` between inline controls | `gap-[var(--space-inline)]` (note: spec says `gap-2` is canonical, but existing code commonly uses `gap-3` for button rows — keep `gap-3` if that's the existing spacing) |
| `mb-4` on sub-headings | `mb-[var(--space-field)]` |
| `mt-1` label→input (drift) | leave it — goes away when swapping to `<Field>` |
| `mt-0.5` helper-text offset | leave it — matches `--space-field-helper` already in use |

### 7. What NOT to swap

- **Badges / pills** — Tailwind utility salad for `text-[10px] uppercase tracking-wide font-semibold px-1.5 py-0.5 rounded bg-blue-100 text-blue-700` inside a badge is the `Badge` primitive's job. Don't hand-migrate badges in these files; leave them as-is if they aren't already using `<Badge>`. (Upgrading to `<Badge>` is a separate pass.)
- **Table cells** — Tables keep their raw class structure (tables are tight; swapping them onto `<DetailRow>` breaks the tabular alignment). Just swap the color pairs (`text-gray-500 dark:text-slate-400` → `text-muted`).
- **Inputs wrapped by `<Input>` primitive** — `<Input>` already owns its own styling. Leave it alone beyond wrapping it in a `<Field>` when a label is involved.
- **Custom components consumed by the page** — e.g. `ColorPicker`, `PerDiemRuleModal`, `LogoUploader`. Out of scope for this plan.
- **Modal chrome** — the modal backdrop + header bar + footer bar are UI Plan D scope. Inside the modal body, if raw `<label>` + input pairs appear, swap them to `<Field>` — but only if it's a low-risk change. Skip if the modal uses custom grid layouts (e.g. `grid-cols-[1fr_140px]`).

### 8. Footer action row (every form page)

**Before:**
```jsx
<div className="flex justify-end gap-3">
  <Button variant="secondary" type="button" onClick={load}>Reset</Button>
  <Button type="submit" loading={saving}>Save Changes</Button>
</div>
```

**After:**
```jsx
<div className="flex justify-end gap-[var(--space-inline)]">
  <Button variant="secondary" type="button" onClick={load}>Reset</Button>
  <Button type="submit" loading={saving}>Save Changes</Button>
</div>
```

The `gap-3` → `gap-[var(--space-inline)]` is the universal swap. Match `pages/settings/profile.js:166`.

---

## Phase 1: Pre-flight (no tasks)

This plan does **not** ship new tokens or new primitives. Plan A shipped the tokens (§2 of spec) and the 6 primitives (§3). Plan B added `--space-field-helper`. Everything Plan C needs is already live.

If during a per-page refactor you genuinely encounter a pattern that recurs 3+ times across settings pages and has no existing token, stop and surface it in a comment inside the plan PR — don't add the token inline. Token additions belong to a follow-up plan so they can be reviewed against the spec's governance rule.

---

## Phase 2: Per-page refactors

Twelve tasks, one commit each. Order is simplest → most complex so the pattern library gets exercised on easy pages first.

---

### Task 2.1: pages/settings/index.js

**Context:** Current index is a card grid that mirrors the sidebar — redundant. With `SettingsLayout` now rendering a sticky left sidebar for navigation, the overview page's job becomes a friendly welcome + "what's here" summary, not a second copy of the nav. Keep it under 60 LoC.

**Files:**
- Modify: `pages/settings/index.js` (60 LoC → ~55 LoC)

- [ ] **Step 1: Rewrite `pages/settings/index.js`**

```jsx
import { Settings } from 'lucide-react';
import SettingsLayout from '../../components/settings/SettingsLayout';
import { PageHeader } from '../../components/ui/ModuleHeader';
import { SectionCard } from '../../components/ui/FormSection';
import DetailPane from '../../components/ui/DetailPane';
import DetailRow from '../../components/ui/DetailRow';
import { SETTINGS_SECTIONS } from '../../lib/settings-nav';

export default function SettingsIndex() {
  const groups = SETTINGS_SECTIONS.filter((s) => s.group !== 'Coming Soon');
  const comingSoon = SETTINGS_SECTIONS.find((s) => s.group === 'Coming Soon')?.items || [];

  return (
    <SettingsLayout title="Settings">
      <div className="max-w-3xl">
        <PageHeader
          variant="plain"
          title={<><Settings className="w-6 h-6 text-blue-600 inline -mt-0.5 mr-2" />Settings</>}
          description="Configure your company, team, and operational preferences. Pick a section from the sidebar to get started."
          className="mb-[var(--space-section)]"
        />

        <div className="space-y-[var(--space-section)]">
          <SectionCard title="What's here" columns={0}>
            <DetailPane>
              {groups.map((section) => (
                <DetailRow
                  key={section.group}
                  label={section.group}
                  value={section.items.map((i) => i.label).join(' · ')}
                />
              ))}
            </DetailPane>
          </SectionCard>

          {comingSoon.length > 0 && (
            <SectionCard
              title="Coming soon"
              description="Planned features not yet available."
              columns={0}
            >
              <p className="text-helper text-muted">
                {comingSoon.map((i) => i.label).join(' · ')}
              </p>
            </SectionCard>
          )}
        </div>
      </div>
    </SettingsLayout>
  );
}
```

- [ ] **Step 2: Verify no links are orphaned**

Run: `npm run build`
Expected: Compiles clean. No "unused import" warnings. The `SETTINGS_SECTIONS` groups show up in the overview. Sidebar still navigates correctly.

- [ ] **Step 3: Verify dark mode**

Manually open `http://localhost:3000/settings` in browser with dark mode on. Confirm text is readable, section backgrounds shift to slate, DetailRow borders are visible.

- [ ] **Step 4: Commit**

```bash
git add pages/settings/index.js
git commit -m "$(cat <<'EOF'
refactor(settings): simplify /settings index onto design-system primitives

The index page used a card grid that duplicated the left sidebar's
navigation. Now that SettingsLayout ships with a sticky sidebar, the
overview page becomes a friendly summary — PageHeader + SectionCard +
DetailPane listing what's available.

Part of UI Plan C. Follows pages/settings/profile.js as the exemplar.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2.2: pages/settings/document-validation.js

**Context:** Simple list of document types with checkbox toggles. One section, one action button. Small file (~150 LoC).

**Files:**
- Modify: `pages/settings/document-validation.js`

- [ ] **Step 1: Read the current file**

Read `pages/settings/document-validation.js` fully (starts with imports, state setup, `toggleType`, then the JSX). Identify the outer `<div>` structure, the header block, and the check-box list section.

- [ ] **Step 2: Swap the page header**

**Before** (roughly lines 80–95 of the current file):
```jsx
<div className="mb-6">
  <h1 className="text-2xl font-bold text-gray-900 dark:text-slate-100 flex items-center gap-2">
    <FileCheck className="w-6 h-6 text-blue-600" />
    Document Validation
  </h1>
  <p className="text-sm text-gray-500 dark:text-slate-400 mt-1">
    Choose which document types require dispatcher approval...
  </p>
</div>
```

**After:**
```jsx
<PageHeader
  variant="plain"
  title={<><FileCheck className="w-6 h-6 text-blue-600 inline -mt-0.5 mr-2" />Document Validation</>}
  description="Choose which document types require dispatcher approval before being finalized. Documents of types NOT in this list are auto-approved on upload."
  className="mb-[var(--space-section)]"
/>
```

Add the import at top: `import { PageHeader } from '../../components/ui/ModuleHeader';`

- [ ] **Step 3: Swap the checkbox list section**

Wrap the existing `Common` / `Extended` groups in a `SectionCard`:

```jsx
<SectionCard
  title="Require validation for"
  description="Dispatchers must approve these document types before they're finalized. Unchecked types auto-approve on upload."
  columns={0}
>
  {/* existing Common group: render checkboxes inside */}
  <div className="mb-[var(--space-field)]">
    <h3 className="text-field-label text-muted mb-[var(--space-field-label)]">Common</h3>
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-[var(--space-inline)]">
      {/* existing .map checkbox elements */}
    </div>
  </div>
  {/* existing Extended group, same pattern */}
</SectionCard>
```

Add the import: `import { SectionCard } from '../../components/ui/FormSection';`

- [ ] **Step 4: Color-pair swaps**

Search-replace in this file:
- `text-gray-500 dark:text-slate-400` → `text-muted`
- `text-gray-900 dark:text-slate-100` → `text-strong`
- `text-gray-700 dark:text-slate-200` → `text-strong` (for titles) OR `text-muted` (for body copy) — use judgment; ambiguous cases stay raw.
- `text-xs` (standalone helper) → `text-helper`
- `text-sm` (body content) → `text-body`

- [ ] **Step 5: Footer actions**

Replace the save-button row `flex justify-end gap-3` → `flex justify-end gap-[var(--space-inline)]`.

- [ ] **Step 6: Verify**

Run: `npm run build`
Expected: Clean build. No new warnings.

Manually open `http://localhost:3000/settings/document-validation`. Toggle a few checkboxes, confirm save button enables/disables correctly, confirm dark mode looks right.

- [ ] **Step 7: Commit**

```bash
git add pages/settings/document-validation.js
git commit -m "$(cat <<'EOF'
refactor(settings): document-validation onto design-system primitives

PageHeader + single SectionCard wraps the Common/Extended type groups.
Inline text-gray-*/dark:text-slate-* pairs collapse onto text-muted /
text-strong. text-xs helper copy → text-helper.

Part of UI Plan C.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2.3: pages/settings/terminal-markets.js

**Context:** Search input + market rows grouped by country. ~200 LoC. Similar structure to terminals.js but simpler (no inline-edit).

**Files:**
- Modify: `pages/settings/terminal-markets.js`

- [ ] **Step 1: Read the full file**

Use the Read tool on `pages/settings/terminal-markets.js`. Identify:
- Header block with `<h1>` (Globe icon)
- Stats / counts block
- Search input
- Grouped-by-country list

- [ ] **Step 2: Swap the page header**

```jsx
<PageHeader
  variant="plain"
  title={<><Globe className="w-6 h-6 text-blue-600 inline -mt-0.5 mr-2" />Terminal Markets</>}
  description="Enable the geographic markets where your operation runs. Terminals in disabled markets won't appear in pickers."
  className="mb-[var(--space-section)]"
/>
```

Add import: `import { PageHeader } from '../../components/ui/ModuleHeader';`

- [ ] **Step 3: Wrap the search + list in a single SectionCard**

```jsx
<SectionCard title="Markets" columns={0}>
  <div className="mb-[var(--space-field)]">
    {/* existing search input with its Search icon — keep raw, don't wrap in Field */}
  </div>
  {/* existing grouped-by-country list */}
</SectionCard>
```

Add import: `import { SectionCard } from '../../components/ui/FormSection';`

- [ ] **Step 4: Color-pair swaps (universal, Pattern §6)**

Run the same `text-gray-*` / `dark:text-slate-*` → `text-muted` / `text-strong` swaps across the file. The country-group eyebrow (e.g. `text-[11px] uppercase tracking-wide text-gray-500 dark:text-slate-400`) becomes `text-field-label text-muted`.

- [ ] **Step 5: Verify build**

Run: `npm run build`
Expected: Clean.

- [ ] **Step 6: Manual QA**

Open `http://localhost:3000/settings/terminal-markets`. Toggle a market on/off; confirm optimistic update works. Open dark mode, verify readability.

- [ ] **Step 7: Commit**

```bash
git add pages/settings/terminal-markets.js
git commit -m "$(cat <<'EOF'
refactor(settings): terminal-markets onto design-system primitives

PageHeader + SectionCard wraps the search + grouped-country list.
Country eyebrows use text-field-label; color pairs collapse onto
text-muted / text-strong tokens.

Part of UI Plan C.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2.4: pages/settings/terminals.js

**Context:** Search + filters + inline-edit table. ~350 LoC. §5.2 flagged 28 unpaired gray/bg lines here — the tier-1 drift file.

**Files:**
- Modify: `pages/settings/terminals.js`

- [ ] **Step 1: Read the full file**

Read `pages/settings/terminals.js`. Identify: header block, search+filters block, terminals table (with inline edit).

- [ ] **Step 2: Swap the page header**

```jsx
<PageHeader
  variant="plain"
  title={<><MapPin className="w-6 h-6 text-blue-600 inline -mt-0.5 mr-2" />Terminals</>}
  description="Enable/disable individual port and rail terminals. Customize their display names. Only enabled terminals appear in load pickers."
  className="mb-[var(--space-section)]"
/>
```

- [ ] **Step 3: Wrap search+filter in a SectionCard**

```jsx
<SectionCard title="Filter" columns={0}>
  <FieldGroup columns={3}>
    <Field label="Search">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted pointer-events-none" />
        {/* existing <input> — keep raw (Search icon overlay), not via <Input> primitive */}
      </div>
    </Field>
    <Field label="Market">
      {/* existing market <select> */}
    </Field>
    <Field label="Type">
      {/* existing type <select> */}
    </Field>
  </FieldGroup>
</SectionCard>
```

- [ ] **Step 4: Wrap the table in a SectionCard**

```jsx
<SectionCard title="Terminals" columns={0}>
  <div className="overflow-x-auto">
    <table className="w-full text-body">
      {/* existing thead / tbody */}
    </table>
  </div>
</SectionCard>
```

Note: the existing table cells use `text-xs text-gray-600 dark:text-slate-300` — swap to `text-helper text-muted`. The header row (`text-[11px] uppercase tracking-wide text-gray-500 dark:text-slate-400`) becomes `text-field-label text-muted`.

- [ ] **Step 5: Universal color swaps**

Pattern §6 across the file.

- [ ] **Step 6: Verify build**

Run: `npm run build`
Expected: Clean.

- [ ] **Step 7: Manual QA**

Open `http://localhost:3000/settings/terminals`. Confirm search/filters work, inline-edit terminal names works, toggle enable works. Dark + compact + zoom 80/125.

- [ ] **Step 8: Commit**

```bash
git add pages/settings/terminals.js
git commit -m "$(cat <<'EOF'
refactor(settings): terminals onto design-system primitives

Two SectionCards (Filter + Terminals) using FieldGroup+Field for the
search/market/type inputs. Table header eyebrows use text-field-label.
28 unpaired gray/slate lines (spec §5.2 tier-1) collapse onto
text-muted / text-strong / text-helper.

Part of UI Plan C.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2.5: pages/settings/per-diem.js

**Context:** Stats (3 counters) + filter + table + "Add Per Diem Rule" button that opens a modal. ~300 LoC. Modal (`components/settings/PerDiemRuleModal.js`) stays untouched (modal scope is UI Plan D).

**Files:**
- Modify: `pages/settings/per-diem.js`

- [ ] **Step 1: Read the full file**

Read `pages/settings/per-diem.js`. Identify header, stats grid, filter, table, modal mount.

- [ ] **Step 2: Swap the page header with the primary CTA**

```jsx
<PageHeader
  variant="plain"
  title={<><Calculator className="w-6 h-6 text-blue-600 inline -mt-0.5 mr-2" />Per Diem Free Day Pricing</>}
  description="Configure tiered per-diem rates by Customer × Steamship Line × Container Type × Load Type. When a load sits past its free days, the matching rule's tiers will be charged."
  actions={<Button onClick={openNew}><Plus className="w-4 h-4 mr-1 inline -mt-0.5" />Add Per Diem Rule</Button>}
  className="mb-[var(--space-section)]"
/>
```

- [ ] **Step 3: Convert the stats counter grid**

Stats are already 3 tiny cards — they work fine as a flex/grid layout, not as a SectionCard. Just swap the eyebrow text to `text-field-label text-muted` and the counter to `text-2xl font-bold text-strong` (leave `text-2xl font-bold` raw — that's a stat counter, not a page title).

```jsx
<div className="grid grid-cols-2 sm:grid-cols-3 gap-[var(--space-inline)]">
  <div className="rounded-xl border border-gray-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-[var(--space-section-pad)]">
    <div className="text-field-label text-muted">Total Rules</div>
    <div className="text-2xl font-bold text-strong">{rules.length}</div>
  </div>
  <div className="rounded-xl border border-gray-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-[var(--space-section-pad)]">
    <div className="text-field-label text-muted">Enabled</div>
    <div className="text-2xl font-bold text-emerald-600">{enabledCount}</div>
  </div>
  <div className="rounded-xl border border-gray-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-[var(--space-section-pad)]">
    <div className="text-field-label text-muted">Disabled</div>
    <div className="text-2xl font-bold text-muted">{rules.length - enabledCount}</div>
  </div>
</div>
```

- [ ] **Step 4: Wrap the filter in a SectionCard**

```jsx
<SectionCard title="Filter" columns={0}>
  <FieldGroup columns={2}>
    <Field label="Load Type">
      <Select
        value={filter.load_type}
        onChange={(e) => setFilter({ ...filter, load_type: e.target.value })}
        options={LOAD_TYPE_OPTIONS}
      />
    </Field>
  </FieldGroup>
</SectionCard>
```

(The `<Select label="Filter by Load Type" />` primitive already renders its own label — when wrapping in `<Field>`, drop the `label` prop from `<Select>` to avoid duplication.)

- [ ] **Step 5: Wrap the table in a SectionCard**

```jsx
<SectionCard title="Rules" columns={0}>
  <div className="overflow-x-auto">
    <table className="w-full text-body">
      {/* existing thead (swap header eyebrows), tbody */}
    </table>
  </div>
</SectionCard>
```

- [ ] **Step 6: Universal color swaps**

Pattern §6. Pay attention to table cell classes (`text-xs text-gray-700 dark:text-slate-200` → `text-helper text-strong` for data cells, or `text-helper text-muted` for "Any" placeholders).

- [ ] **Step 7: Verify**

Run: `npm run build`
Expected: Clean.

Open `http://localhost:3000/settings/per-diem`. Create a rule (modal still works — untouched). Toggle enable/disable. Dark + compact.

- [ ] **Step 8: Commit**

```bash
git add pages/settings/per-diem.js
git commit -m "$(cat <<'EOF'
refactor(settings): per-diem onto design-system primitives

PageHeader with actions slot (Add Per Diem Rule). Stats grid tokens
its eyebrows. Two SectionCards (Filter + Rules). Modal shell
(PerDiemRuleModal) untouched — belongs to UI Plan D.

Part of UI Plan C.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2.6: pages/settings/container-owners.js

**Context:** Stats + search + table + "Add Container Owner" button + modal. The modal body already uses `FormSection` (default import). ~450 LoC. Similar structure to per-diem.js.

**Files:**
- Modify: `pages/settings/container-owners.js`

- [ ] **Step 1: Read the full file**

Read `pages/settings/container-owners.js`. Identify: header, search, stats, table, modal.

- [ ] **Step 2: Swap the page header**

```jsx
<PageHeader
  variant="plain"
  title={<><Ship className="w-6 h-6 text-blue-600 inline -mt-0.5 mr-2" />Container Owners</>}
  description={`Steamship lines and container owners. DrayageDirect seeds ${systemCount} common SSLs — add your own for regional carriers or bonded partners.`}
  actions={<Button onClick={openNew}><Plus className="w-4 h-4 mr-1 inline -mt-0.5" />Add Container Owner</Button>}
  className="mb-[var(--space-section)]"
/>
```

- [ ] **Step 3: Search row stays raw (Search icon overlay)**

Wrap the `<Search>` icon + `<input>` combo in a single `SectionCard`:

```jsx
<SectionCard title="Search" columns={0}>
  <div className="relative">
    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted pointer-events-none" />
    <input
      type="text"
      value={search}
      onChange={(e) => setSearch(e.target.value)}
      placeholder="Search by name or SCAC..."
      className="w-full rounded-lg border border-gray-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-body text-strong pl-9 pr-3 py-2 focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
    />
  </div>
</SectionCard>
```

- [ ] **Step 4: Stats tokens**

Same pattern as per-diem (Task 2.5, Step 3): 3-counter grid with `text-field-label text-muted` eyebrows + `text-xl font-bold text-strong` counters (note: this file uses `text-xl` not `text-2xl` — keep original sizes).

- [ ] **Step 5: Wrap the table in a SectionCard**

```jsx
<SectionCard title="Container Owners" columns={0}>
  <div className="overflow-x-auto">
    <table className="w-full text-body">
      {/* existing markup */}
    </table>
  </div>
</SectionCard>
```

- [ ] **Step 6: Table cell swaps**

Universal color swaps. Specifically:
- `text-xs text-gray-700 dark:text-slate-200` → `text-helper text-strong`
- `text-xs text-gray-600 dark:text-slate-300` → `text-helper text-muted`
- `text-gray-300 dark:text-slate-600` (empty placeholders "—") → `text-muted`

SCAC badge pill `text-[10px] uppercase tracking-wide font-mono font-semibold bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded` stays raw (it's a badge — see pattern §7).

- [ ] **Step 7: Inside-modal form fields (optional)**

The modal already uses `<FormSection>` default import, which is now `SectionCard` via back-compat. Inside each `<FormSection>`, fields are `<Input label="..." />` primitives — those already render their own labels and look fine. **Skip** modal body edits unless you see raw `<label>` + `<input>` — you won't. Modal chrome stays.

- [ ] **Step 8: Verify**

Run: `npm run build`
Expected: Clean.

Manually: CRUD flows work, search works, toggle enable works, dark + compact.

- [ ] **Step 9: Commit**

```bash
git add pages/settings/container-owners.js
git commit -m "$(cat <<'EOF'
refactor(settings): container-owners onto design-system primitives

PageHeader + actions slot (Add Container Owner). SectionCards for
Search and Container Owners list. Modal body (using <Input label>)
already consumes primitives — left untouched. 23 unpaired color
pairs (spec §5.2 tier-1) collapse onto tokens.

Part of UI Plan C.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2.7: pages/settings/chassis-owners.js

**Context:** Custom row component + create/edit modal with raw `<label>` + `<input>`. ~660 LoC. The modal body uses raw labels (unlike container-owners which uses `<Input label>`) — so within the modal, the `<label>` sections are eligible for `<Field>` swaps. But the modal shell (backdrop, header bar, footer) stays untouched.

**Files:**
- Modify: `pages/settings/chassis-owners.js`

- [ ] **Step 1: Read the full file**

Read `pages/settings/chassis-owners.js`. Note the three main parts: page, `ChassisOwnerRow` component, `ChassisOwnerModal` component.

- [ ] **Step 2: Page header**

```jsx
<PageHeader
  variant="plain"
  title={<><Truck className="w-6 h-6 text-blue-600 inline -mt-0.5 mr-2" />Chassis Owners</>}
  description="Directory of chassis provider profiles — pool operators (FlexiVan, TRAC, DCLI), leased fleets, and your own fleet. These profiles populate the Chassis Owner dropdown on loads and in the Umbrella editor."
  actions={<Button onClick={openCreate}><Plus className="w-4 h-4 mr-1 inline -mt-0.5" />Add Chassis Owner</Button>}
  className="mb-[var(--space-section)]"
/>
```

Replace the original 3-column flex header (icon div + text div + button) with the above.

- [ ] **Step 3: Search + stats bar — leave raw**

This file uses a compact single-line `flex items-center gap-3 flex-wrap` with search + inline stats. Don't wrap in SectionCard — it's a chrome bar, not a section. Just swap color pairs (`text-gray-500 dark:text-slate-400` → `text-muted`, strong pairs → `text-strong`).

- [ ] **Step 4: Empty state / list — wrap list in SectionCard**

```jsx
<SectionCard title="Chassis Owners" columns={0}>
  {loading ? (
    /* existing spinner */
  ) : filtered.length === 0 ? (
    /* existing empty-state — swap color pairs to tokens */
  ) : (
    <div className="space-y-[var(--space-inline)]">
      {filtered.map((owner) => (
        <ChassisOwnerRow /* existing props */ />
      ))}
    </div>
  )}
</SectionCard>
```

- [ ] **Step 5: ChassisOwnerRow component — color-pair swaps only**

Inside `ChassisOwnerRow`, the complex layout (icon + name + meta + action buttons) is kept — it's a custom list row, not a standard primitive. Just swap:
- `text-gray-500 dark:text-slate-400` → `text-muted`
- `text-gray-900 dark:text-slate-100` → `text-strong`

The `text-[9px] uppercase tracking-wider font-mono font-semibold` code pill stays raw (badge-ish, pattern §7).

- [ ] **Step 6: ChassisOwnerModal — swap raw `<label>` blocks to `<Field>`**

Inside the modal body (the form sections for Identity, Point of Contact, Address, Options, Notes), replace `<Input label="..." />` usages with `<Field label="..."><Input .../></Field>` where it improves clarity. But actually — `<Input label>` already works — skip wrapping. The real win is the uppercase section eyebrows (`text-[10px] uppercase tracking-wider font-semibold text-gray-500 dark:text-slate-400`) → `text-field-label text-muted`.

Example before:
```jsx
<div>
  <div className="text-[10px] uppercase tracking-wider font-semibold text-gray-500 dark:text-slate-400 mb-2">
    Identity
  </div>
  <div className="grid grid-cols-1 sm:grid-cols-[1fr_140px] gap-3">
    <Input label="Name *" ... />
    <Input label="Code" ... />
  </div>
</div>
```

After:
```jsx
<div>
  <h3 className="text-field-label text-muted mb-[var(--space-field-label)]">Identity</h3>
  <div className="grid grid-cols-1 sm:grid-cols-[1fr_140px] gap-[var(--space-field)]">
    <Input label="Name *" ... />
    <Input label="Code" ... />
  </div>
</div>
```

The raw `<textarea>` for Notes stays — wrap its label in a `<Field>`:

```jsx
<Field label="Notes">
  <textarea
    value={form.notes}
    onChange={(e) => handleChange('notes', e.target.value)}
    rows={2}
    placeholder="Internal notes..."
    className="block w-full rounded-lg border border-gray-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-body text-strong placeholder-gray-400 dark:placeholder-slate-500 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
  />
</Field>
```

- [ ] **Step 7: Verify**

Run: `npm run build`
Expected: Clean.

Open `http://localhost:3000/settings/chassis-owners`. Create a chassis owner, edit one, toggle enable, delete one. Dark + compact.

- [ ] **Step 8: Commit**

```bash
git add pages/settings/chassis-owners.js
git commit -m "$(cat <<'EOF'
refactor(settings): chassis-owners onto design-system primitives

PageHeader + actions slot. SectionCard wraps the list. ChassisOwnerRow
custom layout retained — only color pairs swap to tokens. Inside the
modal, section eyebrows adopt text-field-label and the Notes textarea
is wrapped in a Field. Modal shell (backdrop/header/footer) still
UI Plan D scope.

Part of UI Plan C.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2.8: pages/settings/equipment-reference.js

**Context:** Sub-tabs (Container Types / Container Sizes / Chassis Types / Chassis Sizes) + drag-and-drop table + create/edit modal. ~500 LoC.

**Files:**
- Modify: `pages/settings/equipment-reference.js`

- [ ] **Step 1: Read the full file**

Read `pages/settings/equipment-reference.js`. Note the top TABS constant, the DnD setup, the render tree: header → SubTabs → table.

- [ ] **Step 2: Page header**

```jsx
<PageHeader
  variant="plain"
  title={<><Box className="w-6 h-6 text-blue-600 inline -mt-0.5 mr-2" />Equipment Reference</>}
  description="Manage the lookup lists for container types, container sizes, chassis types, and chassis sizes. These populate load-form dropdowns across the app."
  actions={<Button onClick={openNew}><Plus className="w-4 h-4 mr-1 inline -mt-0.5" />Add {currentTab?.label.replace(' Types', ' Type').replace(' Sizes', ' Size')}</Button>}
  className="mb-[var(--space-section)]"
/>
```

- [ ] **Step 3: Keep SubTabs as-is**

`<SubTabs>` is a separate primitive; do not wrap or refactor. Just ensure it sits above the table card.

- [ ] **Step 4: Wrap the table + DnD in a SectionCard**

```jsx
<SectionCard
  title={currentTab?.label}
  description={currentTab?.description}
  columns={0}
>
  {/* existing DndContext + SortableContext + table */}
</SectionCard>
```

- [ ] **Step 5: Table cell color swaps**

Same pattern as tasks 2.4–2.6. Header eyebrows → `text-field-label text-muted`. Data cells → `text-body text-strong` (or `text-helper text-muted` where muted).

- [ ] **Step 6: Modal body (inside the same file)**

Modal uses `<Input label>` primitives for Code / Label / Description. Those already render correct labels. Do not wrap in `<Field>`. Modal shell stays.

- [ ] **Step 7: Verify**

Run: `npm run build`
Expected: Clean.

Manually: Switch sub-tabs, verify table loads for each. Drag-reorder works. Create/edit/delete rows. Dark + compact.

- [ ] **Step 8: Commit**

```bash
git add pages/settings/equipment-reference.js
git commit -m "$(cat <<'EOF'
refactor(settings): equipment-reference onto design-system primitives

PageHeader with dynamic actions label ("Add Container Type" /
"Add Chassis Size" etc. based on active sub-tab). SubTabs kept raw.
Table wrapped in SectionCard using the sub-tab's own label+description
as the header. DnD-sortable rows unchanged structurally; color
pairs collapse to tokens. 21 unpaired lines (spec §5.2 tier-1) fixed.

Part of UI Plan C.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2.9: pages/settings/branches.js

**Context:** Stats + table + complex assignment panel (users / customers / carriers / vendors sub-tabs). ~700+ LoC.

**Files:**
- Modify: `pages/settings/branches.js`

- [ ] **Step 1: Read the full file**

Read `pages/settings/branches.js`. Identify: header, stats, search, table, assignment side-panel (conditional).

- [ ] **Step 2: Page header**

```jsx
<PageHeader
  variant="plain"
  title={<><GitBranch className="w-6 h-6 text-blue-600 inline -mt-0.5 mr-2" />Branches</>}
  description="Regional offices or divisions. Assign users, customers, and other entities to scope dashboards, loads, and reports."
  actions={<Button onClick={openAdd}><Plus className="w-4 h-4 mr-1 inline -mt-0.5" />Add Branch</Button>}
  className="mb-[var(--space-section)]"
/>
```

- [ ] **Step 3: Stats row tokens**

Same pattern as per-diem / container-owners. `text-[11px]` eyebrow → `text-field-label text-muted`.

- [ ] **Step 4: Search — raw or in SectionCard?**

Branches has just a search input (no multi-filter row). Keep raw with the Search icon overlay, tokens-only swap.

- [ ] **Step 5: Wrap table in SectionCard**

```jsx
<SectionCard title="Branches" columns={0}>
  {/* existing table structure with tokens applied */}
</SectionCard>
```

- [ ] **Step 6: Assignment panel**

The assignment panel is rendered conditionally when a branch is selected. Wrap it in a `SectionCard`:

```jsx
{assignBranch && (
  <SectionCard
    title={`Assignments — ${assignBranch.name}`}
    description="Users and customers scoped to this branch."
    columns={0}
    actions={<Button variant="secondary" onClick={() => setAssignBranch(null)}><X className="w-4 h-4" />Close</Button>}
  >
    {/* existing SubTabs + list */}
  </SectionCard>
)}
```

- [ ] **Step 7: Modal form fields — swap raw `<label>` to `<Field>` only if trivial**

If the branch create/edit modal uses `<Input label>`, leave it. If it uses raw `<label>` + `<input>`, promote those to `<Field>` in a single pass.

- [ ] **Step 8: Universal color swaps**

Pattern §6 across the whole file.

- [ ] **Step 9: Verify**

Run: `npm run build`
Expected: Clean.

Manually: CRUD, search, assignment panel opens/closes, assignment add/remove works, dark + compact.

- [ ] **Step 10: Commit**

```bash
git add pages/settings/branches.js
git commit -m "$(cat <<'EOF'
refactor(settings): branches onto design-system primitives

PageHeader + actions slot (Add Branch). Stats eyebrows tokenized.
SectionCards for the branches table and the conditional assignment
panel. Modal form fields swap raw <label> to <Field> where trivial.

Part of UI Plan C.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2.10: pages/settings/dispatcher-colors.js

**Context:** Live preview row + color pickers grouped by state phase + load type colors + save/reset actions. ~330 LoC. Lots of hand-rolled `<section>` blocks.

**Files:**
- Modify: `pages/settings/dispatcher-colors.js`

- [ ] **Step 1: Read the full file**

Read `pages/settings/dispatcher-colors.js`. Identify: header (with Copy Company Preferences banner for non-admins), Live Preview section, Event State Colors section (grouped by STATE_GROUPS), Load Type Colors section, Actions.

- [ ] **Step 2: Page header**

```jsx
<PageHeader
  variant="plain"
  title={<><Palette className="w-6 h-6 text-blue-600 inline -mt-0.5 mr-2" />Dispatcher Colors</>}
  description={<>Customize how loads appear on the Dispatcher board. Row background uses the <strong className="text-strong">Status color</strong>, and a thin left-edge stripe uses the <strong className="text-strong">Load Type color</strong> so you can see both at a glance.</>}
  className="mb-[var(--space-section)]"
/>
```

- [ ] **Step 3: Copy Company Preferences banner — leave raw**

The amber/blue informational banner is not a standard SectionCard pattern. Only swap color pairs (the `text-blue-800`/`text-blue-600` stays; they're semantic colors, not neutral).

- [ ] **Step 4: Live Preview → SectionCard**

```jsx
<SectionCard
  title="Live Preview"
  description="How loads in different states look on the board."
  columns={0}
>
  <div className="space-y-[var(--space-inline)]">
    {LOAD_TYPE_KEYS.map((type, idx) => {
      /* existing preview-row rendering */
    })}
  </div>
</SectionCard>
```

- [ ] **Step 5: Event State Colors → SectionCard**

```jsx
<SectionCard
  title="Event State Colors (Row Background)"
  description="Each load's row background reflects its current operational state — derived from the order status + current routing event + timestamps. States are grouped by the phase they belong to."
  columns={0}
>
  <div className="space-y-[var(--space-section-pad)]">
    {STATE_GROUPS.map((group) => (
      <div key={group}>
        <h3 className="text-field-label text-muted mb-[var(--space-field-label)]">{group}</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-[var(--space-inline)]">
          {STATES_BY_GROUP[group].map((state) => (
            <ColorPicker /* existing props */ />
          ))}
        </div>
      </div>
    ))}
  </div>
</SectionCard>
```

- [ ] **Step 6: Load Type Colors → SectionCard**

```jsx
<SectionCard
  title="Load Type Colors (Accent Stripe)"
  description="A thin left-edge stripe on every row so you can tell Import vs Export vs Road at a glance."
  columns={0}
>
  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-[var(--space-inline)]">
    {LOAD_TYPE_KEYS.map((key) => (
      <ColorPicker /* existing props */ />
    ))}
  </div>
</SectionCard>
```

- [ ] **Step 7: Footer actions**

`flex justify-end gap-3` → `flex justify-end gap-[var(--space-inline)]`.

- [ ] **Step 8: Universal color swaps**

Pattern §6 across the file. Note: preview rows use inline `style={{ backgroundColor: rowBg }}` — do not touch; that's runtime-dynamic.

- [ ] **Step 9: Verify**

Run: `npm run build`
Expected: Clean.

Manually: Pick new colors, confirm preview updates, Save, Reset to Defaults, dark + compact.

- [ ] **Step 10: Commit**

```bash
git add pages/settings/dispatcher-colors.js
git commit -m "$(cat <<'EOF'
refactor(settings): dispatcher-colors onto design-system primitives

Three SectionCards: Live Preview, Event State Colors (with per-phase
subheaders using text-field-label), and Load Type Colors. PageHeader
replaces the old <h1>+<p> block. Copy-Company-Preferences banner stays
raw (semantic colors). ColorPicker components unchanged.

Part of UI Plan C.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2.11: pages/settings/team.js

**Context:** Table + complex user create/edit modal with tabs (User Info / Permissions) + permission grid + password reveal modal. ~500 LoC in main file. §5.2 flagged 36 unpaired lines — tier-1 drift.

**Files:**
- Modify: `pages/settings/team.js`

- [ ] **Step 1: Read the full file**

Read `pages/settings/team.js`. Identify: header, filters (search + role select), table, UserModal (inline component), temp-password Modal.

- [ ] **Step 2: Page header**

```jsx
<PageHeader
  variant="plain"
  title={<><Users className="w-6 h-6 text-blue-600 inline -mt-0.5 mr-2" />Users & Permissions</>}
  description="Manage users and their granted permissions."
  actions={<Button onClick={openAdd}><UserPlus className="w-4 h-4 mr-1 inline -mt-0.5" />Add New User</Button>}
  className="mb-[var(--space-section)]"
/>
```

Add `Users` to the icon imports (`import { Users, UserPlus, ... } from 'lucide-react'`).

- [ ] **Step 3: Filter row → SectionCard**

```jsx
<SectionCard title="Filter" columns={0}>
  <FieldGroup columns={2}>
    <Field label="Search">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted" />
        <input
          type="text"
          placeholder="Search..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="block w-full rounded-lg border border-gray-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-body text-strong pl-9 pr-3 py-2 focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
        />
      </div>
    </Field>
    <Field label="Role">
      <select
        value={roleFilter}
        onChange={(e) => setRoleFilter(e.target.value)}
        className="rounded-lg border border-gray-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-body text-strong px-3 py-2 w-full"
      >
        <option value="all">All</option>
        {SYSTEM_ROLES.filter((r) => r.value !== 'custom').map((r) => (
          <option key={r.value} value={r.value}>{r.label}</option>
        ))}
      </select>
    </Field>
  </FieldGroup>
</SectionCard>
```

- [ ] **Step 4: Table → SectionCard**

```jsx
<SectionCard title="Users" columns={0}>
  <div className="overflow-x-auto">
    <table className="w-full text-body">
      {/* existing thead (swap header eyebrows to text-field-label) / tbody */}
    </table>
  </div>
</SectionCard>
```

Inside the table:
- Header `text-xs uppercase tracking-wide font-semibold text-gray-600 dark:text-slate-300` → `text-field-label text-muted`
- Username cell keep `font-medium text-strong` (merged)
- Meta cells (`text-xs text-gray-600 dark:text-slate-300`) → `text-helper text-muted`

- [ ] **Step 5: UserModal inside the file**

The modal has two tabs (`User Info` and `Permissions`) rendered via a custom button strip. Leave the tab strip structure; just swap color pairs.

Inside the `User Info` tab, the General Information section uses raw `<label>` + `<input>` repeatedly. Swap them to `<Field>`:

Before (repeated 4+ times):
```jsx
<div>
  <label className="block text-xs font-medium text-gray-600 dark:text-slate-400 mb-1">* First name</label>
  <input type="text" value={form.first_name} onChange={(e) => setForm((f) => ({ ...f, first_name: e.target.value }))}
    placeholder="Enter First Name"
    className="block w-full rounded-lg border border-gray-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-gray-900 dark:text-slate-100 px-3 py-2 text-sm focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100" />
</div>
```

After:
```jsx
<Field label="First name" required>
  <Input
    value={form.first_name}
    onChange={(e) => setForm((f) => ({ ...f, first_name: e.target.value }))}
    placeholder="Enter First Name"
  />
</Field>
```

Repeat for Last name, Phone, Email, Password, Confirm Password. This requires importing the `<Input>` primitive at the top: `import Input from '../../components/ui/Input';`.

- [ ] **Step 6: Permissions tab**

The permissions grid with category checkboxes is complex, bespoke layout. Don't rewrite it. Just swap color pairs:
- Category labels `text-sm font-semibold text-gray-800 dark:text-slate-200` → `text-body font-semibold text-strong`
- Count badges `text-[10px] text-gray-400 dark:text-slate-500` → `text-helper text-muted`
- Permission items `text-xs text-gray-700 dark:text-slate-300` → `text-helper text-strong`

- [ ] **Step 7: Temp password reveal Modal**

Same Modal primitive; color pairs only.

- [ ] **Step 8: Universal color swaps**

Pattern §6 across the whole file.

- [ ] **Step 9: Verify**

Run: `npm run build`
Expected: Clean.

Manually: Add a user (temp password reveals), edit permissions, toggle a role, save. Dark + compact.

- [ ] **Step 10: Commit**

```bash
git add pages/settings/team.js
git commit -m "$(cat <<'EOF'
refactor(settings): team onto design-system primitives

PageHeader + actions slot (Add New User). SectionCards for Filter and
Users table. Inside the UserModal, the User Info tab's 6 raw <label>+
<input> pairs become <Field><Input/></Field>. Permissions tab keeps
its bespoke grid — color pairs swap to tokens. 36 unpaired lines
(spec §5.2 tier-1) collapse. Modal shell UI Plan D scope.

Part of UI Plan C.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2.12: pages/settings/company.js

**Context:** Heaviest drift file — 5 sections (Account Info, Display, Branding, Invoice Defaults, Regional, Collaboration), logo uploader component, toggle switch. ~515 LoC. §5.2 flagged 37 unpaired lines — the tier-1 peak.

**Files:**
- Modify: `pages/settings/company.js`

- [ ] **Step 1: Read the full file**

Read `pages/settings/company.js`. Identify the six sections listed above + the inline `LogoUploader` helper component at the bottom.

- [ ] **Step 2: Page header**

```jsx
<PageHeader
  variant="plain"
  title="Company Settings"
  description="Manage your company info, invoice defaults, and operational preferences."
  className="mb-[var(--space-section)]"
/>
```

No icon per the existing design (the original uses `text-2xl font-bold` with no icon).

- [ ] **Step 3: SCAC warning banner — leave raw**

The amber warning banner stays as-is. Only swap `text-amber-*` hierarchy (strong amber vs muted amber) — but since amber is semantic, not neutral, it stays raw. No changes here except `mb-4` → `mb-[var(--space-field)]` if you want consistency.

- [ ] **Step 4: Account Information → SectionCard + DetailPane**

Before:
```jsx
<section className="bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-xl p-6 shadow-sm">
  <h2 className="text-base font-semibold text-gray-900 dark:text-slate-100 mb-1">
    Account Information
  </h2>
  <p className="text-xs text-gray-500 dark:text-slate-400 mb-4">
    Managed by your DrayageDirect account representative. Contact support to update.
  </p>
  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
    {/* 6 <div> blocks each with eyebrow + value */}
  </div>
</section>
```

After:
```jsx
<SectionCard
  title="Account Information"
  description="Managed by your DrayageDirect account representative. Contact support to update."
  columns={0}
>
  <DetailPane>
    <DetailRow label="Company Name" value={tenant?.name || '—'} muted={!tenant?.name} />
    <DetailRow label="Slug" value={tenant?.slug || '—'} muted={!tenant?.slug} copyable={!!tenant?.slug} />
    <DetailRow
      label="Status"
      value={tenant?.status ? <Badge variant={tenant.status === 'active' ? 'green' : 'yellow'}>{tenant.status}</Badge> : '—'}
    />
    <DetailRow label="Contact Email" value={tenant?.contact_email || '—'} muted={!tenant?.contact_email} />
    <DetailRow label="MC Number" value={tenant?.mc_number || '—'} muted={!tenant?.mc_number} />
    <DetailRow label="DOT Number" value={tenant?.dot_number || '—'} muted={!tenant?.dot_number} />
  </DetailPane>
</SectionCard>
```

- [ ] **Step 5: Display Preferences → SectionCard + Field**

```jsx
<SectionCard
  title="Display Preferences"
  description="How your company name appears in the portal and on documents."
  columns={0}
>
  <FieldGroup columns={1}>
    <Field label="Company Display Name">
      <Input
        value={settings.company_display_name || ''}
        onChange={(e) => handleChange('company_display_name', e.target.value)}
        placeholder={tenant?.name}
      />
    </Field>
  </FieldGroup>
</SectionCard>
```

(Drop `<Input label=...>` in favor of `<Field><Input/></Field>` for consistency with the rest of the file.)

- [ ] **Step 6: Company Branding → SectionCard + LogoUploader**

```jsx
<SectionCard
  title="Company Branding"
  description="Upload your company logos. These appear in the sidebar navigation and throughout your portal."
  columns={0}
>
  <div className="grid grid-cols-1 sm:grid-cols-2 gap-[var(--space-field)]">
    <LogoUploader {/* existing props */} />
    <LogoUploader {/* existing props */} />
  </div>
</SectionCard>
```

The `LogoUploader` inline component (at bottom of file) uses raw `<label>` + `<p>` — swap them to use tokens:
- `text-sm font-medium text-gray-700 dark:text-slate-200` → `text-body font-medium text-strong`
- `text-xs text-gray-500 dark:text-slate-400` → `text-helper text-muted`

Don't swap to `<Field>` — LogoUploader has a complex upload-button UI that isn't a standard field.

- [ ] **Step 7: Invoice & Order Defaults → SectionCard + FieldGroup**

```jsx
<SectionCard
  id="invoices"
  title="Invoice & Order Defaults"
  description="These values pre-fill when you create a new invoice or order."
  columns={0}
>
  <FieldGroup columns={2}>
    <Field label="Carrier SCAC Code" required helper="Required for invoicing. 4-character Standard Carrier Alpha Code (first 3 chars are used as the invoice number prefix, e.g. ABC001001). Also used for load number prefix.">
      <Input
        value={settings.scac_code || ''}
        onChange={(e) => handleChange('scac_code', e.target.value.toUpperCase().slice(0, 4))}
        maxLength={4}
        placeholder="ABCD"
      />
    </Field>
    <Field label="Invoice Prefix">
      <Input
        value={settings.invoice_prefix || ''}
        onChange={(e) => handleChange('invoice_prefix', e.target.value)}
        placeholder="INV"
      />
    </Field>
    <Field label="Order Prefix (legacy fallback)" helper="Used only if no SCAC code is set above.">
      <Input
        value={settings.order_prefix || ''}
        onChange={(e) => handleChange('order_prefix', e.target.value)}
        placeholder="ORD"
      />
    </Field>
    <Field label="Default Payment Terms (days)">
      <Input
        type="number"
        value={settings.default_payment_terms ?? ''}
        onChange={(e) => handleChange('default_payment_terms', e.target.value)}
      />
    </Field>
    <Field label="Quote Validity (days)">
      <Input
        type="number"
        value={settings.quote_validity_days ?? ''}
        onChange={(e) => handleChange('quote_validity_days', e.target.value)}
      />
    </Field>
    <Field label="Default Fuel Surcharge (%)">
      <Input
        type="number"
        step="0.01"
        value={settings.default_fuel_surcharge_pct ?? ''}
        onChange={(e) => handleChange('default_fuel_surcharge_pct', e.target.value)}
      />
    </Field>
    <Field label="Default Labor Fee" helper="Applied to quotes and invoices by default">
      <CurrencyInput
        valueCents={settings.labor_fee_cents}
        onChangeCents={(cents) => handleChange('labor_fee_cents', cents)}
      />
    </Field>
  </FieldGroup>
</SectionCard>
```

Note: the existing `id="invoices"` on the `<section>` is a deep-link anchor. Pass it through `<SectionCard>` — SectionCard doesn't forward arbitrary props by default. **Fix:** add `id` prop support to SectionCard first, or wrap the SectionCard in a `<div id="invoices">`. Simplest: wrap:

```jsx
<div id="invoices">
  <SectionCard title="Invoice & Order Defaults" /* ... */>
    {/* … */}
  </SectionCard>
</div>
```

- [ ] **Step 8: Regional Settings → SectionCard + FieldGroup**

```jsx
<SectionCard
  title="Regional Settings"
  description="Control how dates and times display across the portal."
  columns={0}
>
  <FieldGroup columns={3}>
    <Field label="Timezone">
      <Select
        value={settings.timezone || 'America/New_York'}
        onChange={(e) => handleChange('timezone', e.target.value)}
        options={TIMEZONES.map((tz) => ({ value: tz, label: tz }))}
      />
    </Field>
    <Field label="Date Format">
      <Select
        value={settings.date_format || 'MM/DD/YYYY'}
        onChange={(e) => handleChange('date_format', e.target.value)}
        options={DATE_FORMATS.map((df) => ({ value: df, label: df }))}
      />
    </Field>
    <Field label="Time Format">
      <Select
        value={settings.time_format || '12h'}
        onChange={(e) => handleChange('time_format', e.target.value)}
        options={[
          { value: '12h', label: '12-hour (AM/PM) — 2:30 PM' },
          { value: '24h', label: '24-hour (Military) — 14:30' },
        ]}
      />
    </Field>
  </FieldGroup>
</SectionCard>
```

Drop the `<Select label=...>` prop in favor of `<Field><Select/></Field>`.

- [ ] **Step 9: Collaboration → SectionCard**

```jsx
{isAdmin && (
  <SectionCard
    title={<><Users className="w-4 h-4 text-muted inline -mt-0.5 mr-1.5" />Collaboration</>}
    description="Live multi-user features on the dispatcher board."
    columns={0}
  >
    <label className="flex items-start justify-between gap-[var(--space-field)] p-[var(--space-section-pad)] rounded-lg border border-gray-200 dark:border-slate-800 hover:bg-gray-50 dark:hover:bg-slate-800/60 cursor-pointer">
      <div className="flex-1">
        <div className="text-body font-medium text-strong">Live presence &amp; cursors</div>
        <div className="text-helper text-muted mt-[var(--space-field-helper)]">
          Show avatars of teammates currently viewing the dispatcher board and display their mouse cursors in real-time.
        </div>
      </div>
      <div className="shrink-0 pt-0.5">
        {/* existing toggle button — unchanged */}
      </div>
    </label>
  </SectionCard>
)}
```

- [ ] **Step 10: Footer actions**

Replace `flex justify-end gap-3` with `flex justify-end gap-[var(--space-inline)]` and wrap in the form stack via `space-y-[var(--space-section)]`.

- [ ] **Step 11: Wrap the whole form in a token'd stack**

```jsx
<form onSubmit={handleSave} className="space-y-[var(--space-section)]">
  {/* all 6 SectionCards above */}
  <div className="flex justify-end gap-[var(--space-inline)]">
    <Button variant="secondary" type="button" onClick={load}>Reset</Button>
    <Button type="submit" loading={saving}>Save Changes</Button>
  </div>
</form>
```

- [ ] **Step 12: Universal color swaps + extra imports**

Pattern §6. Add imports at top:
```jsx
import { PageHeader } from '../../components/ui/ModuleHeader';
import { SectionCard } from '../../components/ui/FormSection';
import FieldGroup from '../../components/ui/FieldGroup';
import Field from '../../components/ui/Field';
import DetailPane from '../../components/ui/DetailPane';
import DetailRow from '../../components/ui/DetailRow';
```

- [ ] **Step 13: Verify**

Run: `npm run build`
Expected: Clean.

Manually: Load the page, confirm all 6 sections render, DetailPane shows readonly tenant info, logo uploader still works, Save/Reset work, toggle Live Presence. Dark + compact + zoom.

- [ ] **Step 14: Commit**

```bash
git add pages/settings/company.js
git commit -m "$(cat <<'EOF'
refactor(settings): company onto design-system primitives

Six SectionCards: Account Info (DetailPane for read-only fields),
Display Preferences, Company Branding (LogoUploader inside),
Invoice & Order Defaults (7 Fields), Regional Settings (3 Fields),
Collaboration (admin-only toggle). PageHeader replaces the old title.
All <Input label> and <Select label> primitives now wrapped in <Field>
for consistency. SCAC warning banner untouched (semantic amber).
37 unpaired color lines (spec §5.2 peak drift file) collapse onto
tokens.

Part of UI Plan C.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Phase 3: Guardrails

### Task 3.1: Create docs/ui-system.md

**Context:** Plans A + B + C together form a coherent design system. Future contributors need a single doc that says: "here's the tokens, here's the primitives, here's the rule for when to add one." Without this, drift reappears in 3 months.

**Files:**
- Create: `docs/ui-system.md`

- [ ] **Step 1: Write the file**

````markdown
# DrayageDirect UI System

This is the contract for building UI in DrayageDirect. Tokens + primitives, not one-off class salad. If your page has a label, it uses `<Field>`. If your page has a section header, it uses `<SectionCard>`. If your page has a page title, it uses `<PageHeader>`. The rule is enforced by **code review**, not ESLint — the set is small enough to memorize.

**Status:** Shipped across UI Plans A, B, C (2026-04-14 → 2026-04-16).

---

## 1. Tokens

All tokens live in `styles/globals.css` inside `@theme inline`. Two categories:

### Spacing (CSS custom properties, consumed via arbitrary values)

| Token | Value | Use |
|---|---|---|
| `--space-page-x` | `1.5rem` (px-6) | Page horizontal padding |
| `--space-page-y` | `1.5rem` (py-6) | Page vertical padding |
| `--space-section` | `1.5rem` (gap-6) | Between section cards (vertical stack) |
| `--space-section-pad` | `1.25rem` (p-5) | Inside a section card body |
| `--space-section-head-x` | `1.25rem` (px-5) | Section card header bar horizontal |
| `--space-section-head-y` | `0.75rem` (py-3) | Section card header bar vertical |
| `--space-field` | `1rem` (gap-4) | Between fields in a `<FieldGroup>` |
| `--space-field-label` | `0.375rem` (mb-1.5) | Label → input offset |
| `--space-field-helper` | `0.125rem` (mt-0.5) | Helper text → input offset |
| `--space-row` | `0.75rem` (py-3) | DetailRow + table row vertical |
| `--space-inline` | `0.5rem` (gap-2) | Adjacent inline controls |

Consume in JSX with Tailwind arbitrary values:
```jsx
<div className="space-y-[var(--space-section)]">...</div>
<div className="gap-[var(--space-field)]">...</div>
<p className="mt-[var(--space-field-helper)]">...</p>
```

Compact mode (`[data-compact]` on the root) overrides every token via CSS-var cascade. Primitives that consume tokens automatically tighten; nothing to do in component code.

### Typography (`@utility` classes)

| Utility | Composes | Use |
|---|---|---|
| `text-page-title` | `text-2xl font-bold` | `<h1>` page title |
| `text-section-title` | `text-sm font-semibold` | Section card header bar |
| `text-field-label` | `text-xs font-medium uppercase tracking-wide` | Field labels, eyebrow headings, stat counters' top line |
| `text-body` | `text-sm` | Default body / input text |
| `text-helper` | `text-xs` | Descriptions, helper text, metadata |
| `text-muted` | `color: var(--color-muted)` → gray-500 / slate-400 | Secondary content color |
| `text-strong` | `color: var(--color-strong)` → gray-900 / slate-100 | Primary content color |

**`text-muted` and `text-strong` are the ONLY places gray/slate pairings are declared.** Every other component composes them. Never hand-write `text-gray-500 dark:text-slate-400` in new code.

---

## 2. Primitives

Six primitives. All live in `components/ui/`.

### `<PageHeader>` — page title + description + optional status/actions/breadcrumb

```jsx
import { PageHeader } from '../../components/ui/ModuleHeader';

<PageHeader
  variant="chrome"  // "chrome" adds padding+border; "plain" is bare
  title="Load #ABCD-1234"
  description="DRAYFRT • 40' HC • Pickup 4/15"
  breadcrumb={<Breadcrumb ... />}
  status={<LoadStatusBadge status="dispatched" />}
  actions={<><Button>Edit</Button><Button>Print</Button></>}
/>
```

- Uses `text-page-title` + `text-helper text-muted` for description.
- `variant="chrome"` (default) adds `px-[var(--space-page-x)] py-[var(--space-page-y)]` + bottom border. Use at the top of a standalone page.
- `variant="plain"` removes chrome. Use inside layouts that already pad (e.g. `SettingsLayout`).
- One per page. If you need a second "section header", that's a `<SectionCard>`.

### `<SectionCard>` — grouped content with a tinted header bar

```jsx
import { SectionCard } from '../../components/ui/FormSection';

<SectionCard
  title="Container"
  description="Size, type, owner, seal"
  actions={<Button variant="ghost" size="sm">Edit</Button>}
  columns={0}  // see below
>
  <FieldGroup columns={2}>...</FieldGroup>
</SectionCard>
```

- Tinted header bar (`bg-gray-50/70 dark:bg-slate-800/60`) with `text-section-title text-strong`.
- `columns={0}` → render children unwrapped in a padded body. Use when a `<FieldGroup>` (or anything else) owns layout inside.
- `columns={1..4}` → wrap children in a grid with `gap-[var(--space-field)]`. Use for simple field lists that don't need a `<FieldGroup>`.
- `actions` slot sits right of the title.
- **No `collapsible` prop.** Collapsibility is a UX cost. If your section is often collapsed, the real fix is moving it to a different tab.

### `<FieldGroup>` + `<Field>` — labeled form inputs

```jsx
import FieldGroup from '../../components/ui/FieldGroup';
import Field from '../../components/ui/Field';

<FieldGroup columns={2}>
  <Field label="Container Number" required>
    <Input ... />
  </Field>
  <Field label="Seal" helper="Optional — 8 digits">
    <Input ... />
  </Field>
  <Field label="Zip" error="Must be 5 digits">
    <Input ... />
  </Field>
</FieldGroup>
```

- `<FieldGroup>` owns the grid (1/2/3/4 columns responsive) + `gap-[var(--space-field)]`.
- `<Field>` owns the label (uppercase `text-field-label text-muted`), the `mb-[var(--space-field-label)]` gap, and helper/error text below.
- Pass any input/select/textarea/custom control as children.

### `<DetailPane>` + `<DetailRow>` — read-only key/value list

```jsx
import DetailPane from '../../components/ui/DetailPane';
import DetailRow from '../../components/ui/DetailRow';

<DetailPane>
  <DetailRow label="Container #" value="ABCD1234567" copyable />
  <DetailRow label="Discharge" value="4/15 14:30" />
  <DetailRow label="LFD" value={<Badge>4/20</Badge>} />
  <DetailRow label="Chassis" value="—" muted />
</DetailPane>
```

- Label left (`text-field-label text-muted`, fixed `w-40`). Value right (`text-body text-strong`).
- `py-[var(--space-row)]` row padding + border divider between rows.
- `copyable` — shows copy icon that clipboard-writes the string value.
- `muted` — renders value in `text-muted` instead of `text-strong` (for `—` placeholders).
- `value` can be a string or any React node (badges, links, etc.).

---

## 3. Governance

### The "3+ uses" rule

Tokens and primitives are added **only** when a pattern recurs 3+ times with identical semantic intent. Before adding a token:

1. If a new layout matches an existing token → use the token. (This is 90% of cases.)
2. If it almost matches but not quite → **don't bend** the token or invent a near-duplicate. Raw Tailwind is fine for 1–2 one-offs.
3. If the pattern clearly recurs 3+ times and has no existing token → propose it in a plan PR, get review, then add. Don't add inline during a refactor.

### Why this matters

The spec (`docs/superpowers/specs/2026-04-14-ui-hierarchy-spacing-design.md` §2) explicitly guards against token sprawl — a 30-token palette is as bad as no tokens because nobody remembers which one to use. The set is intentionally small.

### Red flags in PRs

Reviewers should push back on:
- Raw `text-gray-*` / `dark:text-slate-*` pairs (should be `text-muted` / `text-strong`)
- Inline `<label>` + `<input>` pairs with manual class salad (should be `<Field>` inside `<FieldGroup>`)
- Custom section wrappers with `rounded-xl border` + `<h2 className="text-sm font-semibold">` chrome (should be `<SectionCard>`)
- `<h1 className="text-2xl font-bold">` (should be `<PageHeader>`)
- `gap-3` on button rows (should be `gap-[var(--space-inline)]`)
- `mb-1` on label→input (should be `mb-[var(--space-field-label)]` — or just use `<Field>`)
- `mt-1` / `mt-2` on helper text (should be `mt-[var(--space-field-helper)]` — or just use `<Field>`'s helper prop)
- New `--space-*` / `--text-*` tokens added during a refactor (should be proposed separately)

### Exceptions (don't swap)

- **Badges / pills** — `text-[10px] uppercase tracking-wide font-semibold bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded` belongs to the `<Badge>` primitive's internals. Don't hand-migrate.
- **Table cells** — tables keep their raw class structure for tight alignment. Just swap the color pairs.
- **Semantic colors** — `text-amber-*`, `text-emerald-*`, `text-red-*`, `text-blue-*` inside alerts / warnings / status badges are semantic, not neutral. Don't collapse them.
- **Dynamic inline styles** — `style={{ backgroundColor: user.color }}` / `style={{ color: state.textColor }}` are runtime-driven. Don't touch.

---

## 4. Dark mode

Every component inherits dark mode for free by using `text-muted` / `text-strong` (and the other @utility classes that reference `--color-*` vars). The `.dark` class on `<html>` swaps the CSS variables; everything else cascades.

**Never write** `dark:text-slate-*` pairs in new code. If the existing page has them, collapse onto tokens during the refactor.

See `memory/dev_dark_mode_convention.md` for the broader convention this fits into.

---

## 5. Compact mode

`[data-compact]` on a root element shrinks every spacing token + typography size. All primitives automatically tighten. No component-level work required.

See `styles/globals.css` lines 140+ for the token overrides and the legacy `!important` class overrides that still apply during the transition.

---

## 6. When to add a new primitive

Rarely. Before adding:

1. Can an existing primitive be composed to achieve the new pattern? (Usually yes.)
2. Does the new pattern recur 3+ times across different pages?
3. Does it have a clear, simple API that won't need to grow into a kitchen-sink component?

If yes to all three: propose it in a plan PR (not inline). Get sign-off. Then add — with docstring, usage examples, and a test page.

If you just need a one-off layout: raw Tailwind is fine. Don't pollute `components/ui/`.

---

## 7. Consumers (at time of writing)

- **Load detail tabs** — Plan B (2026-04-15): `NotesTab`, `TrackingTab`, `DocumentsTab`, `AuditTab`, `BillingTab`, `LoadInfoTab`. `DriverPayTab`, `RoutingTab`, and the modal layer are Plan D candidates.
- **Settings pages** — Plan C (2026-04-16): `index`, `document-validation`, `terminal-markets`, `terminals`, `per-diem`, `container-owners`, `chassis-owners`, `equipment-reference`, `branches`, `dispatcher-colors`, `team`, `company`. `charge-profiles/*`, `tariffs/*`, `driver-tariffs/*`, and `communications/**` are Plan D candidates.
- **Profile page** — Plan A exemplar: `pages/settings/profile.js`. Use this as your reference composition.

---

## 8. FAQ

**Q: My page has a `<label className="text-sm font-medium">` that doesn't match `text-field-label` (uppercase).**
A: That's the Linear/Stripe uppercase style we picked intentionally. Fields always have uppercase labels. If it looks wrong on your page, the right fix is usually "this isn't a field — it's body text with a leading word."

**Q: I need a section without a header.**
A: Pass `title={null}` and `description={null}` to `<SectionCard>` (or just pass neither). The header bar won't render.

**Q: I need inline controls next to the section header.**
A: Use the `actions` slot on `<SectionCard>`.

**Q: Can I add a new variant to `<PageHeader>`?**
A: No. Two variants (`chrome` / `plain`) cover every case we've encountered. If a third genuinely recurs, propose it in a plan.

**Q: `<Field>` doesn't let me put the label on the right.**
A: That's a table, not a form. Use a `<DetailPane>` + `<DetailRow>` or a raw `<table>`.

**Q: My section has 4 columns on large screens, 2 on medium, 1 on mobile.**
A: `<FieldGroup columns={4}>` gives you `grid-cols-1 sm:grid-cols-2 lg:grid-cols-4`.

**Q: I want a collapsible section.**
A: No you don't — the spec explicitly bans it. If your section gets collapsed often, move its content to a different tab or page.
````

- [ ] **Step 2: Commit**

```bash
git add docs/ui-system.md
git commit -m "$(cat <<'EOF'
docs(ui-system): guardrails for the tokens + primitives shipped in
Plans A, B, C

Single source of truth for how to build UI in DrayageDirect post-Plan-C:
- Token tables (spacing + typography)
- Primitive APIs with usage examples (PageHeader, SectionCard,
  FieldGroup+Field, DetailPane+DetailRow)
- "3+ uses" governance rule
- Red flags for PR reviewers
- FAQ covering the common "why can't I..." questions

Part of UI Plan C, Phase 3.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Phase 4: Verification

### Task 4.1: Build + manual QA + final commit notes

**Context:** Every per-page commit had its own verify step. Phase 4 is the whole-plan sanity check.

- [ ] **Step 1: Clean build**

```bash
npm run build
```

Expected: compiles cleanly. Zero new warnings from our code. Any deprecation warnings from Next.js/React are pre-existing and unrelated.

- [ ] **Step 2: Dev server boot**

```bash
npm run dev
```

Visit `http://localhost:3000/settings` and walk every refactored page:

- /settings
- /settings/document-validation
- /settings/terminal-markets
- /settings/terminals
- /settings/per-diem
- /settings/container-owners
- /settings/chassis-owners
- /settings/equipment-reference
- /settings/branches
- /settings/dispatcher-colors
- /settings/team
- /settings/company
- /settings/profile (untouched but verify nothing broke)

For each: confirm the page loads, the sidebar highlights the right nav item, primary CTAs still work.

- [ ] **Step 3: Dark mode pass**

Toggle `<html class="dark">` (either via the app's theme switcher or DevTools). Visit the same 13 pages. Confirm:
- All text is readable (no dark-on-dark or light-on-light).
- Section borders and backgrounds shift correctly.
- Muted text is distinguishable from strong text.
- Badges retain their semantic colors.

- [ ] **Step 4: Compact mode pass**

Toggle `[data-compact]` on the app root (via the existing compact toggle, usually in user preferences or a dev dropdown). Visit the same 13 pages. Confirm:
- Spacing tightens across the board.
- Font sizes shrink.
- Layout stays intact — no fields clip, no rows overflow, no buttons wrap badly.

- [ ] **Step 5: Zoom QA per qa_zoom_responsive.md**

Browser zoom to 80%, 100%, 125% on the 13 pages. Per the existing protocol:
- No horizontal scrollbars on the content pane.
- Sidebar doesn't collide with content.
- Field grids reflow gracefully.
- Stats counter rows don't clip.

- [ ] **Step 6: Browser console + dev server terminal**

During the manual walk, keep:
- Browser DevTools console open → zero red errors from our code.
- Dev server terminal visible → zero unexpected warnings.

Pre-existing warnings unrelated to this plan (third-party lib noise, Next.js deprecation) are OK to ignore.

- [ ] **Step 7: Git log sanity**

```bash
git log --oneline main..HEAD
```

Expected: 13 commits, one per refactored page + one for the docs. All ending with `Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>`.

- [ ] **Step 8: Push**

```bash
git push origin main
```

No PR needed — commits land on main per the repo's solo-dev workflow (matches Plans A and B).

Write a brief release note in chat summarizing what shipped.

---

## Summary

13 commits, 12 settings pages + 1 guardrails doc, zero new tokens, zero new primitives. Every inline `text-gray-500 dark:text-slate-400` across 12 settings pages replaced with `text-muted`. Every inline `<label>` + `<input>` pair replaced with `<Field>` inside `<FieldGroup>`. Every hand-rolled section wrapper replaced with `<SectionCard>`. Every `<h1 className="text-2xl font-bold">` replaced with `<PageHeader>`.

When a new contributor joins DrayageDirect, they read `docs/ui-system.md` in 10 minutes, then they know the rules. Drift stops.

Plans D candidates identified during this work:
- Charge profiles + tariffs + driver-tariffs detail pages (pricing module, complex custom editors)
- Communications subsystem (9 pages with email template editors)
- Modal shells across the app (backdrop, header bar, footer — their own primitive pass)
- Eyebrow/badge sub-text-xs token promotion (defer until drift is observed post-refactor)
