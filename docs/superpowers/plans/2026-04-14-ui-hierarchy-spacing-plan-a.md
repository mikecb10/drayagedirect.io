# UI Hierarchy & Spacing System — Plan A: Audit + Tokens + Primitives

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Establish the foundational design system (semantic tokens + four primitives) so load detail and settings refactors (Plans B and C) can proceed against a consistent vocabulary.

**Architecture:** Tokens live as CSS custom properties in `styles/globals.css` (Tailwind v4 `@theme` block). Spacing tokens are consumed by primitives via Tailwind arbitrary values (e.g. `p-[var(--space-section-pad)]`). Typography tokens are consumed via custom `@utility` classes (e.g. `text-page-title`) because they carry multiple declarations (size + weight + transform). Both mechanisms honor the existing `[data-compact]` mode by letting compact overrides each CSS var in a one-liner. The existing legacy `!important` compact rules stay intact for non-primitive code.

**Tech Stack:** Next.js 15 (Pages Router), React 19, Tailwind v4 (CSS-first config), Supabase, lucide-react icons. No test framework — verification is build-check + manual visual/dark-mode/zoom QA per `qa_zoom_responsive.md`.

**Spec:** `docs/superpowers/specs/2026-04-14-ui-hierarchy-spacing-design.md` (authoritative, except tailwind.config language superseded by this plan's Tailwind v4 approach).

---

## File Structure

Files that will be created or modified, grouped by concern:

### Touched (modified)
- `docs/superpowers/specs/2026-04-14-ui-hierarchy-spacing-design.md` — §5 "Audit Results" populated during Phase 1.
- `styles/globals.css` — token declarations (Phase 2) + compact-mode token overrides.
- `components/ui/ModuleHeader.js` — evolved into `PageHeader` (Phase 3). File keeps the same path; default export renamed; a `ModuleHeader` alias re-export is added for backward compat so existing imports keep working until Plan C.
- `components/ui/FormSection.js` — evolved into `SectionCard` (Phase 3). Same pattern: file keeps path, `SectionCard` is the new name, `FormSection` alias stays.
- `pages/settings/profile.js` — refactored end-to-end in Phase 5 to exercise all four primitives.

### Created
- `components/ui/FieldGroup.js` — the labeled-form grid primitive (Phase 4).
- `components/ui/Field.js` — single labeled form field (Phase 4). Separate file so `FieldGroup` stays focused on layout.
- `components/ui/DetailPane.js` — read-only key/value pane (Phase 4).
- `components/ui/DetailRow.js` — single row inside `DetailPane` (Phase 4).

### Not touched (out of scope for Plan A)
- `components/loads/**`, `components/loads/tabs/**` — consumers of the primitives. Refactored in Plan B.
- `pages/settings/**` except `profile.js` — refactored in Plan C.
- `components/settings/**` — same as above.
- Any ESLint/governance tooling — spec §1 "Out of scope".

### Responsibility boundaries
- `globals.css` owns token definitions. Primitives reference them; consumers never read them directly.
- Each primitive file owns one concept. `FieldGroup` does layout only; `Field` does label + helper only; pairing is done by consumers composing them.
- The `PageHeader`/`SectionCard` evolutions must remain additive: every existing prop on `ModuleHeader`/`FormSection` keeps working with its existing semantics. New props (`breadcrumb`, `status`, `actions` on SectionCard) are optional.

---

## Conventions

- **Commits:** Per-task. Commit message format: `feat(ui): <concise summary>` for new primitives; `refactor(ui): <summary>` for evolutions; `docs(spec): <summary>` for spec edits. Every commit must end with the trailing `Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>` line to match the baseline commit.
- **Verification step after code-writing steps:** Run `npm run dev` if it is not already running, hit the relevant page/component in a browser, eyeball the result. No automated tests — project has none.
- **Dark mode:** Toggle via the existing `ThemeProvider` (applies `.dark` class on `<html>`). Primitives must look correct in both modes without conditional gray/slate pairings in consumer code — only `--color-muted` / `--color-strong` tokens.
- **Compact mode:** Trigger is a `[data-compact]` attribute on the root div. The existing legacy `!important` rules stay; we add CSS-var overrides on `[data-compact]` so primitives using arbitrary values also tighten up.

---

## Phase 1 — Audit

Goal: inventory every spacing/typography/label-markup drift in the Plan B/C surfaces so that Plans B and C have a concrete target. Output is a markdown table appended to `docs/superpowers/specs/2026-04-14-ui-hierarchy-spacing-design.md` §5.

The audit has no code changes. It is pattern-grepping + summarization. Use `Grep` and `Read` tools. Do NOT refactor anything during Phase 1.

### Task 1.1 — Audit `components/loads/**` and `components/loads/tabs/**`

**Files:**
- Read: `components/loads/**/*.js` (all files under that directory)
- Modify: `docs/superpowers/specs/2026-04-14-ui-hierarchy-spacing-design.md` (append into §5)

- [ ] **Step 1: Inventory spacing classes**

Run:
```
grep -rnoE '(px|py|p|mx|my|m|gap|space-y|space-x|mt|mb)-[0-9.]+' components/loads/ | wc -l
grep -rnE '(px|py|p|mx|my|m|gap|space-y|space-x|mt|mb)-[0-9.]+' components/loads/ | head -50
```

Expected: a count (informational) and a sample of the actual usages. Do not attempt to list all — the sample shows the variety.

- [ ] **Step 2: Inventory typography classes**

Run:
```
grep -rnE '(text|font)-(xs|sm|base|lg|xl|2xl|medium|semibold|bold|uppercase|tracking)' components/loads/ | head -50
```

- [ ] **Step 3: Inventory inline label markup**

Run:
```
grep -rnB1 -A2 '<label' components/loads/ | head -80
```

Look for `<label>` patterns: what classes are on them, what wraps them, whether helper text follows.

- [ ] **Step 4: Inventory dark-mode gaps**

Run:
```
grep -rnE 'text-gray-[0-9]+|bg-gray-[0-9]+|border-gray-[0-9]+' components/loads/ | grep -v 'dark:' | head -30
grep -rnE 'text-slate-[0-9]+|bg-slate-[0-9]+' components/loads/ | grep -v 'dark:' | head -30
```

Expected: lines using `text-gray-*` without a `dark:` pairing on the same element. Each one is a dark-mode gap.

- [ ] **Step 5: Append section 5 header + load-detail subsection to the spec**

Open `docs/superpowers/specs/2026-04-14-ui-hierarchy-spacing-design.md`, locate the line exactly:

```
## 5. Audit Results

*To be filled during Step 1 of implementation.*
```

Replace that block with:

```markdown
## 5. Audit Results

*Populated during Plan A, Phase 1. Rows below drive Plans B (load detail) and C (settings). Items counted are representative, not exhaustive — goal is to confirm scope and locate high-density patterns.*

### 5.1 `components/loads/**`

| File | Spacing drift (sample) | Typography drift | Label pattern | Dark-mode gaps |
|---|---|---|---|---|
| _fill from step 1–4 findings_ | | | | |

**Recurring patterns to map to tokens:**
- _e.g._ `p-5` on card bodies → `space-section-pad`
- _e.g._ `px-5 py-3` on card headers → `space-section-head-x` + `space-section-head-y`

**Recurring dark-mode fixes needed:**
- _e.g._ 7 files use `text-gray-500` without `dark:text-slate-400` → adopt `text-muted` utility once introduced in Phase 2.
```

Replace the underscores with the actual findings from steps 1-4. Keep each bullet under 100 characters. If there are fewer than 3 files with meaningful drift, list them all; otherwise list the top 5 by drift density.

- [ ] **Step 6: Commit**

```bash
git add docs/superpowers/specs/2026-04-14-ui-hierarchy-spacing-design.md
git commit -m "$(cat <<'EOF'
docs(spec): fill Audit Results §5.1 — components/loads

Phase 1.1 of Plan A: cataloged spacing, typography, label, and
dark-mode drift in load detail components. Findings will drive
Plan B (per-tab refactor).

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

Expected: commit succeeds with one file changed.

---

### Task 1.2 — Audit `pages/settings/**`

**Files:**
- Read: `pages/settings/*.js`
- Modify: `docs/superpowers/specs/2026-04-14-ui-hierarchy-spacing-design.md` (append §5.2)

- [ ] **Step 1: Inventory spacing classes**

Run:
```
grep -rnE '(px|py|p|mx|my|m|gap|space-y|space-x|mt|mb)-[0-9.]+' pages/settings/ | head -40
```

- [ ] **Step 2: Inventory typography + label patterns**

Run:
```
grep -rnE '(text|font)-(xs|sm|base|lg|xl|2xl|medium|semibold|bold)' pages/settings/ | head -40
grep -rnB1 '<label' pages/settings/ | head -40
```

- [ ] **Step 3: Inventory dark-mode gaps**

Run:
```
grep -rnE 'text-gray-[0-9]+|bg-gray-[0-9]+' pages/settings/ | grep -v 'dark:' | head -20
```

- [ ] **Step 4: Append §5.2 to the spec**

After the §5.1 block added in Task 1.1, append:

```markdown
### 5.2 `pages/settings/**`

| File | Spacing drift (sample) | Typography drift | Label pattern | Dark-mode gaps |
|---|---|---|---|---|
| _fill from step 1-3_ | | | | |

**Recurring patterns to map to tokens:**
- _e.g._ `rounded-xl p-6 shadow-sm` on sections → `SectionCard`
- _e.g._ `mb-6` title-to-body spacing → `space-section`

**Notable inconsistencies:**
- _e.g._ `pages/settings/profile.js` uses raw `<section>` + manual classes, not `FormSection`. Refactor target for Phase 5 verification.
```

- [ ] **Step 5: Commit**

```bash
git add docs/superpowers/specs/2026-04-14-ui-hierarchy-spacing-design.md
git commit -m "$(cat <<'EOF'
docs(spec): fill Audit Results §5.2 — pages/settings

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 1.3 — Audit `components/settings/**`

**Files:**
- Read: `components/settings/**/*.js`
- Modify: `docs/superpowers/specs/2026-04-14-ui-hierarchy-spacing-design.md` (append §5.3)

- [ ] **Step 1: List files in scope**

Run:
```
find components/settings -name '*.js' | head -20
```

Expected: list of settings-specific components (layouts, modals, panels).

- [ ] **Step 2: Inventory same four categories**

Run the same four greps from Task 1.1 Steps 1-4, scoped to `components/settings/`.

- [ ] **Step 3: Append §5.3 to the spec**

Same template as §5.1/§5.2 but scoped. Also include a "Shared layout primitives" subsection noting whether `SettingsLayout.js` or similar wrappers need updating (they should not, in this plan — only flagging).

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/specs/2026-04-14-ui-hierarchy-spacing-design.md
git commit -m "$(cat <<'EOF'
docs(spec): fill Audit Results §5.3 — components/settings

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 1.4 — Consolidated audit summary + token demand list

**Files:**
- Modify: `docs/superpowers/specs/2026-04-14-ui-hierarchy-spacing-design.md` (append §5.4)

- [ ] **Step 1: Compare findings to the token set in §2**

Re-read spec §2 (Token Set). Does every recurring pattern identified in §5.1–§5.3 map cleanly to one of the nine spacing tokens + seven typography tokens? If any recurring pattern (3+ occurrences) has no matching token, the spec's token list is incomplete.

- [ ] **Step 2: Append §5.4 summary**

Add:

```markdown
### 5.4 Consolidated token demand

Patterns discovered in §5.1–§5.3 and their target tokens:

| Pattern (occurrences) | Target token |
|---|---|
| `p-5` on card bodies (N) | `--space-section-pad` |
| `px-5 py-3` on card headers (N) | `--space-section-head-x` / `--space-section-head-y` |
| `gap-4` between fields in grids (N) | `--space-field` |
| _fill remaining rows_ | |

**Gaps (patterns with no matching token in spec §2):**
- _list any, with proposal. If none, write "None — spec §2 is sufficient."_

**Governance call:** no new tokens added in Plan A beyond spec §2. If Plan B/C discovers a genuinely new pattern with 3+ uses, propose it in that plan.
```

Replace placeholder counts (N) with actual numbers from the grep output.

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/specs/2026-04-14-ui-hierarchy-spacing-design.md
git commit -m "$(cat <<'EOF'
docs(spec): consolidate Audit Results §5.4 — token demand map

Phase 1 complete. Plans B and C have a concrete pattern → token
mapping to work against.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase 2 — Tokens

Goal: declare every token from spec §2 as a CSS custom property in `styles/globals.css`, wire typography tokens to custom `@utility` classes, and ensure `[data-compact]` mode overrides each token cleanly. After Phase 2 the primitives in Phase 3/4 can consume the tokens.

### Task 2.1 — Add spacing tokens to `@theme`

**Files:**
- Modify: `styles/globals.css` (extend the existing `@theme inline` block)

- [ ] **Step 1: Read the current `@theme inline` block**

Open `styles/globals.css`. The existing block is lines 27–35, currently:

```css
@theme inline {
  --color-background: var(--background);
  --color-foreground: var(--foreground);
  --color-dd-blue: var(--dd-blue);
  --color-dd-blue-light: var(--dd-blue-light);
  --color-dd-blue-dark: var(--dd-blue-dark);
  --font-sans: var(--font-geist-sans);
  --font-mono: var(--font-geist-mono);
}
```

- [ ] **Step 2: Append spacing token declarations**

Change the block to add the nine spacing tokens from spec §2. The `@theme inline` block becomes:

```css
@theme inline {
  --color-background: var(--background);
  --color-foreground: var(--foreground);
  --color-dd-blue: var(--dd-blue);
  --color-dd-blue-light: var(--dd-blue-light);
  --color-dd-blue-dark: var(--dd-blue-dark);
  --font-sans: var(--font-geist-sans);
  --font-mono: var(--font-geist-mono);

  /* ==========================================================
     DESIGN SYSTEM — SPACING
     Semantic spacing tokens (spec §2). Primitives consume via
     Tailwind arbitrary values: p-[var(--space-section-pad)].
     Values match the current "base" density; compact mode
     overrides each one in the [data-compact] block below.
     ========================================================== */
  --space-page-x: 1.5rem;        /* px-6 */
  --space-page-y: 1.5rem;        /* py-6 */
  --space-section: 1.5rem;       /* gap-6 between SectionCards */
  --space-section-pad: 1.25rem;  /* p-5 inside SectionCard body */
  --space-section-head-x: 1.25rem; /* px-5 on SectionCard header bar */
  --space-section-head-y: 0.75rem; /* py-3 on SectionCard header bar */
  --space-field: 1rem;           /* gap-4 between fields in a FieldGroup */
  --space-field-label: 0.375rem; /* mb-1.5 between label and input */
  --space-row: 0.75rem;          /* py-3 for DetailRow / settings list rows */
  --space-inline: 0.5rem;        /* gap-2 for adjacent inline controls */
}
```

Note: comments go inside `@theme` for documentation. Tailwind v4 allows this.

- [ ] **Step 3: Verify Tailwind recompiles without error**

Run:
```
npm run dev
```

Wait for "Ready" log line. Open any page in the browser. Look in the console for CSS/Tailwind errors. Expected: clean compile, no errors.

- [ ] **Step 4: Smoke-test a token in the browser**

Using the dev server from step 3, open the browser DevTools. In the Console, run:
```js
getComputedStyle(document.documentElement).getPropertyValue('--space-section-pad')
```

Expected output: `" 1.25rem"` (the trailing value you declared). If it returns empty string, the `@theme` block wasn't picked up — re-check syntax.

- [ ] **Step 5: Commit**

```bash
git add styles/globals.css
git commit -m "$(cat <<'EOF'
feat(ui): add spacing design tokens to globals.css @theme

Adds nine semantic spacing tokens (space-page-x/y, space-section,
space-section-pad, space-section-head-x/y, space-field,
space-field-label, space-row, space-inline) per spec §2.

Primitives will consume via Tailwind arbitrary values, e.g.
p-[var(--space-section-pad)]. Compact-mode overrides follow in
a later task.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2.2 — Add typography tokens + color tokens + `@utility` classes

**Files:**
- Modify: `styles/globals.css`

Typography is multi-declaration (size + weight + transform + tracking), so it needs either multiple CSS vars per token or custom utility classes. We use custom utility classes (Tailwind v4's `@utility` directive) with CSS vars driving individual declarations — keeps both compact-mode overrides and named-class ergonomics.

- [ ] **Step 1: Add color tokens to `:root` and `.dark`**

Locate the `:root` block (lines 11–17 currently):

```css
:root {
  --background: #ffffff;
  --foreground: #171717;
  --dd-blue: #2563eb;
  --dd-blue-light: #3b82f6;
  --dd-blue-dark: #1d4ed8;
}
```

Append two new variables:

```css
:root {
  --background: #ffffff;
  --foreground: #171717;
  --dd-blue: #2563eb;
  --dd-blue-light: #3b82f6;
  --dd-blue-dark: #1d4ed8;

  /* Semantic text colors — the ONLY places gray/slate pairings are declared.
     All consumers go through text-muted / text-strong utilities. */
  --color-muted: #6b7280;   /* gray-500 */
  --color-strong: #111827;  /* gray-900 */
}
```

Locate the `.dark` block (lines 22–25):

```css
.dark {
  --background: #0f172a;
  --foreground: #f1f5f9;
}
```

Append the dark counterparts:

```css
.dark {
  --background: #0f172a;
  --foreground: #f1f5f9;

  --color-muted: #94a3b8;   /* slate-400 */
  --color-strong: #f1f5f9;  /* slate-100 */
}
```

- [ ] **Step 2: Add typography tokens to the `@theme inline` block**

In the same `@theme inline` block from Task 2.1, append **below** the spacing tokens:

```css
  /* ==========================================================
     DESIGN SYSTEM — TYPOGRAPHY
     Consumed via @utility classes declared below, not by
     arbitrary values (typography tokens carry multiple
     declarations: size + weight + transform). Compact mode
     overrides size via the [data-compact] block.
     ========================================================== */
  --text-page-title-size: 1.5rem;        /* text-2xl */
  --text-page-title-weight: 700;         /* font-bold */
  --text-section-title-size: 0.875rem;   /* text-sm */
  --text-section-title-weight: 600;      /* font-semibold */
  --text-field-label-size: 0.75rem;      /* text-xs */
  --text-field-label-weight: 500;        /* font-medium */
  --text-body-size: 0.875rem;            /* text-sm */
  --text-helper-size: 0.75rem;           /* text-xs */
```

- [ ] **Step 3: Declare the `@utility` classes after `@theme`**

After the closing `}` of `@theme inline`, add a new block. The `@utility` directive is Tailwind v4's way of registering a utility class that participates in its cascade, variant system, and tree-shaking. Insert:

```css
/* ============================================================
   DESIGN SYSTEM — UTILITIES
   Typography and color tokens exposed as named utilities so
   consumers write className="text-page-title" instead of
   composing class salad. Each resolves a CSS variable; compact
   mode changes the variable, the utility picks it up.
   ============================================================ */

@utility text-page-title {
  font-size: var(--text-page-title-size);
  font-weight: var(--text-page-title-weight);
  line-height: 1.2;
}

@utility text-section-title {
  font-size: var(--text-section-title-size);
  font-weight: var(--text-section-title-weight);
  line-height: 1.4;
}

@utility text-field-label {
  font-size: var(--text-field-label-size);
  font-weight: var(--text-field-label-weight);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  line-height: 1.4;
}

@utility text-body {
  font-size: var(--text-body-size);
  line-height: 1.5;
}

@utility text-helper {
  font-size: var(--text-helper-size);
  line-height: 1.4;
}

@utility text-muted {
  color: var(--color-muted);
}

@utility text-strong {
  color: var(--color-strong);
}
```

- [ ] **Step 4: Verify utilities compile and render correctly**

Run `npm run dev` (if not already running). In the browser console on any page, create a quick test element:

```js
const el = document.createElement('div');
el.className = 'text-page-title text-strong';
el.textContent = 'Test';
document.body.appendChild(el);
console.log(getComputedStyle(el).fontSize, getComputedStyle(el).fontWeight, getComputedStyle(el).color);
```

Expected: font-size `24px`, font-weight `700`, color matching the current theme (dark or light). If any come back as default values (e.g. `16px` 400), Tailwind did not pick up the `@utility` — confirm file saved and dev server reloaded. Remove the test element afterwards:

```js
el.remove();
```

- [ ] **Step 5: Commit**

```bash
git add styles/globals.css
git commit -m "$(cat <<'EOF'
feat(ui): add typography + color tokens and @utility classes

- --color-muted / --color-strong: the ONLY place gray/slate
  pairings are declared (per dark-mode convention)
- --text-*-size / --text-*-weight vars for five type tokens
- @utility text-page-title, text-section-title, text-field-label,
  text-body, text-helper, text-muted, text-strong

Primitives reference these by class name. Compact mode overrides
size/weight vars directly in a later task.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2.3 — Add compact-mode token overrides

**Files:**
- Modify: `styles/globals.css`

- [ ] **Step 1: Locate the `[data-compact]` block**

Open `styles/globals.css`. The compact-mode rules start around line 52 with `[data-compact] { font-size: 13px; line-height: 1.4; }` and continue with legacy `!important` rules targeting raw Tailwind classes (`.px-3`, `.py-2`, etc.).

Do NOT remove any of the legacy rules. They still govern code that hasn't been migrated to primitives.

- [ ] **Step 2: Add a new CSS-var override block INSIDE the existing `[data-compact]` selector**

The existing `[data-compact] { font-size: 13px; line-height: 1.4; }` block is the right home. Expand it so it declares smaller values for every token from Task 2.1 and 2.2. Replace:

```css
/* Base font shrink */
[data-compact] {
  font-size: 13px;
  line-height: 1.4;
}
```

with:

```css
/* Base font shrink + semantic token overrides.
   Every design-system token shrinks in compact mode via CSS-var
   override. Primitives using arbitrary values (p-[var(--space-...)])
   or @utility classes (text-page-title) automatically pick these
   up, since CSS variables inherit through the cascade. */
[data-compact] {
  font-size: 13px;
  line-height: 1.4;

  /* Spacing shrink */
  --space-page-x: 1rem;
  --space-page-y: 1rem;
  --space-section: 1rem;
  --space-section-pad: 0.75rem;
  --space-section-head-x: 0.75rem;
  --space-section-head-y: 0.5rem;
  --space-field: 0.625rem;
  --space-field-label: 0.25rem;
  --space-row: 0.5rem;
  --space-inline: 0.375rem;

  /* Typography shrink — sizes only; weights/transforms don't change. */
  --text-page-title-size: 1.25rem;
  --text-section-title-size: 0.8125rem;
  --text-field-label-size: 0.6875rem;
  --text-body-size: 0.8125rem;
  --text-helper-size: 0.6875rem;
}
```

- [ ] **Step 3: Verify compact mode still tightens the app**

Run `npm run dev` if not running. Open the app. Open DevTools → Elements → find the root div. Add attribute `data-compact=""` inline. The whole app should visibly tighten up. In Console, verify:

```js
getComputedStyle(document.querySelector('[data-compact]')).getPropertyValue('--space-section-pad')
```

Expected: `" 0.75rem"` (not `" 1.25rem"`).

Remove the attribute when done.

- [ ] **Step 4: Verify legacy `!important` rules still apply too**

In DevTools, inspect any element using a raw `p-5` class while compact mode is on. Its computed padding should be `0.75rem` (the legacy `[data-compact] .p-5 { padding: 0.75rem !important }` rule). This confirms we didn't break existing behavior.

- [ ] **Step 5: Commit**

```bash
git add styles/globals.css
git commit -m "$(cat <<'EOF'
feat(ui): compact-mode overrides for design-system tokens

Adds CSS-var overrides inside the existing [data-compact] block
so primitives built on --space-* and --text-* tokens automatically
tighten up alongside legacy !important rules.

Legacy rules preserved — non-primitive code still works.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase 3 — Evolve existing primitives in place

Goal: extend `ModuleHeader` and `FormSection` with the new slots from spec §3.1 and §3.2 without breaking a single existing consumer. New name (`PageHeader` / `SectionCard`) is the default export. Old name is a re-export alias.

### Task 3.1 — Evolve `ModuleHeader` → `PageHeader`

**Files:**
- Modify: `components/ui/ModuleHeader.js`

- [ ] **Step 1: Rewrite the component adding `breadcrumb` and `status` slots**

Replace the entire contents of `components/ui/ModuleHeader.js` with:

```jsx
/**
 * PageHeader — standard page header with title, optional description,
 * breadcrumb, status badge, and right-side action slot.
 *
 * Uses design-system tokens from styles/globals.css:
 *   - Padding: space-page-x, space-page-y
 *   - Title: text-page-title + text-strong
 *   - Description: text-helper + text-muted
 *
 * Evolved from the older ModuleHeader — the prior API (title,
 * description, actions, className) is preserved. New optional slots:
 *   - breadcrumb: React node rendered above the title
 *   - status:     React node rendered inline next to the title
 *
 * A `ModuleHeader` named export is also provided as a backward-compat
 * alias. Existing imports keep working until Plan C migrates them.
 *
 * Usage:
 *   <PageHeader
 *     title="Load #ABCD-1234"
 *     description="DRAYFRT • 40' HC • Pickup 4/15"
 *     breadcrumb={<Breadcrumb items={[...]} />}
 *     status={<LoadStatusBadge status="pending" />}
 *     actions={<><Button>Edit</Button><Button>Print</Button></>}
 *   />
 */
export default function PageHeader({
  title,
  description,
  breadcrumb,
  status,
  actions,
  className = '',
}) {
  return (
    <header
      className={`px-[var(--space-page-x)] py-[var(--space-page-y)] border-b border-gray-200 dark:border-slate-800 ${className}`}
    >
      {breadcrumb && (
        <div className="mb-[var(--space-field-label)]">{breadcrumb}</div>
      )}
      <div className="flex items-start justify-between gap-[var(--space-inline)]">
        <div className="min-w-0">
          <div className="flex items-center gap-[var(--space-inline)]">
            <h1 className="text-page-title text-strong truncate">{title}</h1>
            {status && <div className="shrink-0">{status}</div>}
          </div>
          {description && (
            <p className="text-helper text-muted mt-[var(--space-field-label)]">
              {description}
            </p>
          )}
        </div>
        {actions && (
          <div className="shrink-0 flex gap-[var(--space-inline)]">{actions}</div>
        )}
      </div>
    </header>
  );
}

// Backward-compat alias. Plan C will migrate call sites to PageHeader.
export { PageHeader as ModuleHeader };
```

- [ ] **Step 2: Verify default export still works from existing import sites**

Do NOT change any consumer yet. Just run:
```
npm run dev
```

Open any page that uses `ModuleHeader` (e.g. `/organizations`, `/dispatcher`). Confirm the header renders and looks correct (title + description visible, actions on the right). Compare against git (`git show HEAD~:components/ui/ModuleHeader.js`) if you need to diff visually.

- [ ] **Step 3: Verify named alias works from a temporary test import**

In `pages/settings/profile.js` (not yet refactored), add a scratch import **temporarily** at the top:

```jsx
import { ModuleHeader, default as PageHeader } from '../../components/ui/ModuleHeader';
```

Save. The dev server should HMR without errors. This proves both exports resolve.

Then **remove** the scratch import before committing — it's only a smoke test.

- [ ] **Step 4: Verify dark mode + compact mode**

On `/organizations` or similar page with a ModuleHeader: toggle dark mode using the theme toggle. The header title/description should switch between strong/muted colors correctly (no harsh white-on-white or gray-on-gray).

Toggle compact mode via DevTools (add `data-compact=""` to root div). Header padding should shrink; title size should shrink.

- [ ] **Step 5: Commit**

```bash
git add components/ui/ModuleHeader.js
git commit -m "$(cat <<'EOF'
refactor(ui): evolve ModuleHeader into PageHeader (additive)

- Default export renamed PageHeader; ModuleHeader kept as named
  alias so existing imports still work (removed in Plan C).
- New optional slots: breadcrumb (rendered above title),
  status (rendered inline with title).
- Now consumes design-system tokens: space-page-x/y, text-page-title,
  text-strong, text-helper, text-muted — replaces hard-coded
  text-gray-* / dark:text-slate-* pairings.

Zero consumer call-site changes required. Spec §3.1.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 3.2 — Evolve `FormSection` → `SectionCard`

**Files:**
- Modify: `components/ui/FormSection.js`

`FormSection` currently wraps children in its own grid. That conflicts with the spec §3.2 pattern where `SectionCard` contains a `FieldGroup` (which owns the grid). To stay non-breaking, we keep the grid behavior when `columns > 0` (existing call sites) AND add a new path: when `columns === 0` (or `false`), render children unwrapped so a FieldGroup can own the grid.

- [ ] **Step 1: Rewrite the component**

Replace the entire contents of `components/ui/FormSection.js` with:

```jsx
/**
 * SectionCard — visual section wrapper with tinted header and padded body.
 *
 * Uses design-system tokens:
 *   - Header bar: space-section-head-x, space-section-head-y + tint
 *   - Body: space-section-pad
 *   - Title: text-section-title + text-strong
 *   - Description: text-helper + text-muted
 *
 * Evolved from FormSection. Two ways to populate the body:
 *
 * 1. Legacy grid (columns > 0, default 2): SectionCard renders its own
 *    internal grid with gap-[var(--space-field)] and columns as requested.
 *    Existing FormSection call sites keep working unchanged.
 *
 * 2. New pattern (columns === 0): SectionCard renders children directly,
 *    letting a FieldGroup (or any child) own the layout. Prefer this for
 *    new code — keeps layout concerns in one place.
 *
 * New `actions` slot renders on the right side of the header bar.
 *
 * Per spec §3.2, there is intentionally no `collapsible` prop.
 *
 * Back-compat: a named `FormSection` export aliases `SectionCard`. Plan C
 * will migrate consumers.
 */
export default function SectionCard({
  title,
  description,
  actions,
  children,
  className = '',
  columns = 2,
}) {
  const gridCols = {
    1: 'grid-cols-1',
    2: 'grid-cols-1 sm:grid-cols-2',
    3: 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3',
    4: 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-4',
  }[columns];

  return (
    <section
      className={`rounded-xl border border-gray-200 dark:border-slate-800 bg-white dark:bg-slate-900 ${className}`}
    >
      {(title || description || actions) && (
        <div
          className="flex items-start justify-between gap-[var(--space-inline)] px-[var(--space-section-head-x)] py-[var(--space-section-head-y)] bg-gray-50/70 dark:bg-slate-800/60 border-b border-gray-200 dark:border-slate-800 rounded-t-xl"
        >
          <div className="min-w-0">
            {title && (
              <h3 className="text-section-title text-strong">{title}</h3>
            )}
            {description && (
              <p className="text-helper text-muted mt-0.5">{description}</p>
            )}
          </div>
          {actions && <div className="shrink-0 flex gap-[var(--space-inline)]">{actions}</div>}
        </div>
      )}
      {gridCols ? (
        <div className={`grid ${gridCols} gap-[var(--space-field)] p-[var(--space-section-pad)]`}>
          {children}
        </div>
      ) : (
        <div className="p-[var(--space-section-pad)]">{children}</div>
      )}
    </section>
  );
}

// Backward-compat alias. Plan C will migrate call sites.
export { SectionCard as FormSection };
```

- [ ] **Step 2: Smoke-test on an existing FormSection consumer**

Open a page that uses `FormSection` — e.g. any organization modal or settings form. `grep -rn "FormSection" pages/ components/ | head -5` to find one. Open that page in the browser. Confirm:
- Section still looks visually the same as before (tinted header bar, padded body, grid layout with fields in 2 columns if that was the old default).
- Dark mode still works.
- No console errors.

- [ ] **Step 3: Smoke-test the new `columns={0}` path**

In `pages/settings/profile.js` (not yet refactored, scratch test), temporarily replace one of the existing raw `<section>` elements with:

```jsx
<SectionCard title="Scratch test" columns={0}>
  <div>Children render with no internal grid.</div>
</SectionCard>
```

(Import `SectionCard from '../../components/ui/FormSection'`.) Verify no grid wraps the children. Then **remove** this scratch code — the real refactor happens in Phase 5.

- [ ] **Step 4: Verify `actions` slot**

Still in the scratch test, add:

```jsx
<SectionCard title="With actions" actions={<button>Edit</button>} columns={0}>
  <div>Body</div>
</SectionCard>
```

Confirm the Edit button appears in the header bar, right-aligned. Remove after verifying.

- [ ] **Step 5: Commit**

```bash
git add components/ui/FormSection.js
git commit -m "$(cat <<'EOF'
refactor(ui): evolve FormSection into SectionCard (additive)

- Default export renamed SectionCard; FormSection kept as named
  alias so existing imports still work (removed in Plan C).
- New actions slot on the header bar.
- New columns={0} path renders children unwrapped, enabling
  FieldGroup (Phase 4) to own layout.
- Consumes space-section-head-x/y, space-section-pad, space-field,
  text-section-title, text-strong, text-helper, text-muted.
- No collapsible prop, per spec §3.2.

All existing FormSection call sites keep working unchanged.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase 4 — New primitives

Goal: ship `FieldGroup` + `Field` and `DetailPane` + `DetailRow`. Consumers write them by composition. Each pair sits in its own file for focused edits.

### Task 4.1 — Create `FieldGroup` and `Field`

**Files:**
- Create: `components/ui/FieldGroup.js`
- Create: `components/ui/Field.js`

- [ ] **Step 1: Write `FieldGroup.js`**

Create `components/ui/FieldGroup.js` with exactly:

```jsx
/**
 * FieldGroup — responsive grid layout for a set of Fields inside a SectionCard.
 *
 * Owns:
 *   - Grid columns (1, 2, 3, or 4 — responsive)
 *   - gap-[var(--space-field)] between fields
 *
 * Does NOT own label/input markup — that's Field's job. Compose them:
 *
 *   <SectionCard title="Container" columns={0}>
 *     <FieldGroup columns={2}>
 *       <Field label="Container Number" required>
 *         <Input ... />
 *       </Field>
 *       <Field label="Seal" helper="Optional">
 *         <Input ... />
 *       </Field>
 *     </FieldGroup>
 *   </SectionCard>
 *
 * Pass columns={1} for full-width stacked fields.
 */
export default function FieldGroup({ columns = 2, className = '', children }) {
  const gridCols = {
    1: 'grid-cols-1',
    2: 'grid-cols-1 sm:grid-cols-2',
    3: 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3',
    4: 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-4',
  }[columns] || 'grid-cols-1 sm:grid-cols-2';

  return (
    <div className={`grid ${gridCols} gap-[var(--space-field)] ${className}`}>
      {children}
    </div>
  );
}
```

- [ ] **Step 2: Write `Field.js`**

Create `components/ui/Field.js` with exactly:

```jsx
/**
 * Field — single labeled form field cell.
 *
 * Renders:
 *   - Label (uppercase, muted, tracking per text-field-label utility)
 *   - Required asterisk (red-500)
 *   - Input (passed as children)
 *   - Helper text OR error text below the input
 *
 * Consumers pass any input/select/textarea/custom control as children.
 * The label sits above with space-field-label gap; helper/error sits
 * below with a tight 2px gap.
 *
 * Usage:
 *   <Field label="Container Number" required>
 *     <Input value={...} onChange={...} />
 *   </Field>
 *   <Field label="Seal" helper="Optional — 8 digits">
 *     <Input ... />
 *   </Field>
 *   <Field label="Zip" error="Must be 5 digits">
 *     <Input ... />
 *   </Field>
 */
export default function Field({
  label,
  required = false,
  helper,
  error,
  className = '',
  children,
}) {
  return (
    <div className={className}>
      {label && (
        <label className="block text-field-label text-muted mb-[var(--space-field-label)]">
          {label}
          {required && <span className="text-red-500 ml-0.5">*</span>}
        </label>
      )}
      {children}
      {error ? (
        <p className="text-helper text-red-600 dark:text-red-400 mt-0.5">{error}</p>
      ) : helper ? (
        <p className="text-helper text-muted mt-0.5">{helper}</p>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 3: Smoke-test both together**

Open `pages/settings/profile.js` in an editor. At the top, temporarily add:

```jsx
import FieldGroup from '../../components/ui/FieldGroup';
import Field from '../../components/ui/Field';
```

Just before the existing `<section>` at line ~99, add a scratch block:

```jsx
<FieldGroup columns={2} className="mb-6">
  <Field label="Test Name" required>
    <input type="text" className="block w-full rounded border border-gray-300 px-3 py-2" />
  </Field>
  <Field label="Test Email" helper="Just a smoke test">
    <input type="email" className="block w-full rounded border border-gray-300 px-3 py-2" />
  </Field>
  <Field label="Test Error" error="This field is invalid">
    <input type="text" className="block w-full rounded border border-gray-300 px-3 py-2" />
  </Field>
</FieldGroup>
```

Run `npm run dev`, visit `/settings/profile`. Confirm:
- 2-column grid.
- Labels uppercase, muted color.
- Required asterisk red.
- Helper text below, muted.
- Error text below, red.
- Dark mode toggle: labels/helpers switch color correctly; error stays red.

Remove the scratch import + block when verified. Do not commit scratch.

- [ ] **Step 4: Commit**

```bash
git add components/ui/FieldGroup.js components/ui/Field.js
git commit -m "$(cat <<'EOF'
feat(ui): add FieldGroup and Field primitives

FieldGroup owns the responsive grid (1/2/3/4 columns, gap-[space-field]).
Field owns a single labeled cell: uppercase muted label, required
asterisk, helper or error text below.

Consumers compose them inside SectionCard{columns:0} for new code.
Existing FormSection{columns:N} call sites still work unchanged.

Spec §3.3.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 4.2 — Create `DetailPane` and `DetailRow`

**Files:**
- Create: `components/ui/DetailPane.js`
- Create: `components/ui/DetailRow.js`

- [ ] **Step 1: Write `DetailPane.js`**

Create `components/ui/DetailPane.js` with exactly:

```jsx
/**
 * DetailPane — read-only key/value list with dividers.
 *
 * Renders a vertical stack of DetailRows. Each row separated by a
 * bottom border except the last. Use inside a SectionCard or as a
 * top-level block.
 *
 * Usage:
 *   <DetailPane>
 *     <DetailRow label="Container #" value="ABCD1234567" copyable />
 *     <DetailRow label="Discharge"   value="4/15 14:30" />
 *     <DetailRow label="LFD"         value={<Badge>4/20</Badge>} />
 *     <DetailRow label="Chassis"     value="—" muted />
 *   </DetailPane>
 */
export default function DetailPane({ className = '', children }) {
  return (
    <dl className={`divide-y divide-gray-100 dark:divide-slate-800 ${className}`}>
      {children}
    </dl>
  );
}
```

- [ ] **Step 2: Write `DetailRow.js`**

Create `components/ui/DetailRow.js` with exactly:

```jsx
import { useState } from 'react';
import { Copy, Check } from 'lucide-react';

/**
 * DetailRow — single key/value row inside a DetailPane.
 *
 * Layout: label on the left (fixed-ish width, uppercase muted),
 * value on the right (body text, strong color). Padding uses
 * space-row. Supports two optional behaviors:
 *
 *   - copyable: shows a copy icon to the right of the value;
 *     click copies the value (must be string) to clipboard.
 *   - muted:    renders the value in muted color instead of strong
 *     (for empty/"—" placeholders).
 *
 * Usage:
 *   <DetailRow label="LFD" value="4/20" />
 *   <DetailRow label="Container" value="ABCD1234567" copyable />
 *   <DetailRow label="Chassis" value="—" muted />
 *   <DetailRow label="Status" value={<Badge>Pending</Badge>} />
 */
export default function DetailRow({
  label,
  value,
  copyable = false,
  muted = false,
  className = '',
}) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    if (typeof value !== 'string') return;
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard API unavailable — silent fail, no user-facing error
    }
  }

  const valueClass = muted ? 'text-muted' : 'text-strong';

  return (
    <div
      className={`flex items-baseline gap-[var(--space-inline)] py-[var(--space-row)] ${className}`}
    >
      <dt className="text-field-label text-muted shrink-0 w-40">{label}</dt>
      <dd className={`text-body ${valueClass} flex-1 min-w-0`}>{value}</dd>
      {copyable && typeof value === 'string' && (
        <button
          type="button"
          onClick={handleCopy}
          className="shrink-0 text-muted hover:text-strong transition-colors"
          aria-label={`Copy ${label}`}
        >
          {copied ? (
            <Check className="w-4 h-4" />
          ) : (
            <Copy className="w-4 h-4" />
          )}
        </button>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Smoke-test both together**

In `pages/settings/profile.js` (still pre-refactor), add a scratch block:

```jsx
import DetailPane from '../../components/ui/DetailPane';
import DetailRow from '../../components/ui/DetailRow';

// ... inside the render, before any <section>:
<DetailPane className="mb-6">
  <DetailRow label="Container" value="ABCD1234567" copyable />
  <DetailRow label="Discharge" value="4/15 14:30" />
  <DetailRow label="Chassis" value="—" muted />
</DetailPane>
```

Run `npm run dev`, visit `/settings/profile`. Confirm:
- Labels uppercase, muted, fixed width on left.
- Values right-aligned to the label, strong color.
- Rows separated by thin dividers.
- Click the copy icon on "Container" — briefly becomes a check mark, clipboard now contains `ABCD1234567` (paste anywhere to confirm).
- "Chassis" value is muted.
- Dark-mode toggle: all colors switch properly.
- Zoom at 80%/125%: layout stays readable, label column doesn't collapse.

Remove the scratch import + block when verified.

- [ ] **Step 4: Commit**

```bash
git add components/ui/DetailPane.js components/ui/DetailRow.js
git commit -m "$(cat <<'EOF'
feat(ui): add DetailPane and DetailRow primitives

DetailPane is a <dl> with divide-y between rows.
DetailRow is a labeled row: fixed-width uppercase muted label,
body/strong value, optional copy button, optional muted value
for empty placeholders.

Spec §3.4.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase 5 — End-to-end verification

Goal: rebuild `pages/settings/profile.js` using only the new primitives. If every primitive composes cleanly there and the page looks/behaves identically (or better, with better dark-mode coverage), the design system works.

### Task 5.1 — Refactor `pages/settings/profile.js` using only primitives

**Files:**
- Modify: `pages/settings/profile.js`

The current file uses raw `<section>` elements, manual h1/h3 markup, and has dark-mode gaps (lines 84, 99, 110, 139 lack `dark:` pairings). We rebuild it to:
- Use `PageHeader` for the title block.
- Use `SectionCard` for both section wrappers (identity + security).
- Use `FieldGroup` + `Field` for editable inputs.
- Use `DetailPane` + `DetailRow` for read-only metadata (email, hire date, role).

- [ ] **Step 1: Read the current file**

Open `pages/settings/profile.js`. Confirm the current structure:
- Lines 75–81: back link (keep as-is; not part of design system).
- Lines 83–88: manual title block.
- Lines 90–91: existing alerts (keep as-is).
- Lines 93–97: loading spinner (keep as-is).
- Lines 99–137: identity `<section>` with avatar + editable inputs.
- Lines 139–150: security `<section>` with Change Password button.
- Lines 152–159: footer button bar.

- [ ] **Step 2: Rewrite imports**

Replace the imports block (lines 1–9) with:

```jsx
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, KeyRound } from 'lucide-react';
import SettingsLayout from '../../components/settings/SettingsLayout';
import PageHeader from '../../components/ui/ModuleHeader';
import SectionCard from '../../components/ui/FormSection';
import FieldGroup from '../../components/ui/FieldGroup';
import Field from '../../components/ui/Field';
import DetailPane from '../../components/ui/DetailPane';
import DetailRow from '../../components/ui/DetailRow';
import Button from '../../components/ui/Button';
import Input from '../../components/ui/Input';
import Alert from '../../components/ui/Alert';
import Badge from '../../components/ui/Badge';
import { useAuth } from '../../contexts/AuthContext';
```

Note: `PageHeader` and `SectionCard` come from their existing file paths (`ModuleHeader.js`, `FormSection.js`) — the defaults were renamed in Phase 3.

- [ ] **Step 3: Rewrite the return block**

Replace the entire `return (...)` block (roughly lines 72–164) with:

```jsx
  return (
    <SettingsLayout title="My Profile">
      <div className="max-w-2xl">
        <Link
          href="/settings"
          className="inline-flex items-center gap-1 text-helper text-muted hover:text-strong mb-[var(--space-field)]"
        >
          <ArrowLeft className="w-4 h-4" strokeWidth={1.75} />
          Back to Settings
        </Link>

        <PageHeader
          title="My Profile"
          description="Update your personal information."
          className="mb-[var(--space-section)] border-b-0 px-0 py-0"
        />

        {error && <Alert type="error" message={error} className="mb-[var(--space-field)]" />}
        {success && <Alert type="success" message={success} className="mb-[var(--space-field)]" />}

        {loading || !user ? (
          <div className="py-20 text-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto" />
          </div>
        ) : (
          <form onSubmit={handleSave} className="space-y-[var(--space-section)]">
            {/* Read-only identity block — exercises DetailPane + DetailRow. */}
            <SectionCard title="Identity" description="Managed by your administrator" columns={0}>
              <div className="flex items-center gap-[var(--space-field)] mb-[var(--space-field)] pb-[var(--space-field)] border-b border-gray-100 dark:border-slate-800">
                <div className="w-16 h-16 rounded-full bg-blue-600 text-white flex items-center justify-center text-xl font-bold">
                  {(user.name || user.email)
                    .split(' ')
                    .map((n) => n[0])
                    .slice(0, 2)
                    .join('')
                    .toUpperCase()}
                </div>
                <div>
                  <div className="text-body text-strong font-semibold">{user.name}</div>
                  <div className="text-helper text-muted">{user.email}</div>
                </div>
              </div>

              <DetailPane>
                <DetailRow label="Role" value={<Badge variant="blue">{user.role.replace('_', ' ')}</Badge>} />
                <DetailRow label="Email" value={user.email} copyable />
                <DetailRow label="Hire Date" value={user.hire_date || '—'} muted={!user.hire_date} />
              </DetailPane>
            </SectionCard>

            {/* Editable fields — exercises FieldGroup + Field. */}
            <SectionCard title="Personal Info" description="Editable by you" columns={0}>
              <FieldGroup columns={2}>
                <Field label="Full Name">
                  <Input
                    value={user.name || ''}
                    onChange={(e) => updateField('name', e.target.value)}
                  />
                </Field>
                <Field label="Phone">
                  <Input
                    value={user.phone || ''}
                    onChange={(e) => updateField('phone', e.target.value)}
                  />
                </Field>
              </FieldGroup>
            </SectionCard>

            {/* Security section — exercises SectionCard actions slot. */}
            <SectionCard
              title="Security"
              description="Manage your password and account security."
              columns={0}
              actions={
                <Link href="/change-password">
                  <Button variant="secondary" type="button">
                    <KeyRound className="w-4 h-4 mr-1.5 inline -mt-0.5" strokeWidth={2} />
                    Change Password
                  </Button>
                </Link>
              }
            >
              <p className="text-helper text-muted">
                Your password was last changed on file. Click the button above to update.
              </p>
            </SectionCard>

            <div className="flex justify-end gap-[var(--space-inline)]">
              <Button variant="secondary" type="button" onClick={load}>
                Reset
              </Button>
              <Button type="submit" loading={saving}>
                Save Changes
              </Button>
            </div>
          </form>
        )}
      </div>
    </SettingsLayout>
  );
```

Key properties of this rewrite:
- Zero raw `text-gray-*` / `dark:text-slate-*` pairings — dark mode comes "for free" from the tokens.
- Zero raw `p-5` / `gap-4` on design-system surfaces — everything references `--space-*` tokens.
- Exercises all four primitives (PageHeader, SectionCard, FieldGroup+Field, DetailPane+DetailRow).
- Uses SectionCard `actions` slot on the Security section.
- Uses SectionCard `columns={0}` everywhere so FieldGroup owns layout — the new pattern.

(The `border-b-0 px-0 py-0` overrides on `PageHeader` remove its full-page chrome since it's inside a `max-w-2xl` container, not at page root. In Plan C we'll revisit whether PageHeader should have a `variant="inline"` prop to make this clean instead of className overrides.)

- [ ] **Step 4: Visual verification — light mode**

Run `npm run dev` if not already. Visit `http://localhost:3000/settings/profile`. Log in if needed. Expected:
- Back-to-Settings link visible, muted color.
- "My Profile" title bold and strong.
- Description muted below.
- Three SectionCards: Identity, Personal Info, Security — each with a tinted header bar and body.
- Identity card: avatar + name + email block on top, then a DetailPane with Role, Email (with copy button), Hire Date.
- Personal Info card: two inputs in a 2-column grid with uppercase muted labels.
- Security card: description text in body, Change Password button in the top-right of the header bar (actions slot).
- Footer with Reset + Save Changes buttons.

- [ ] **Step 5: Visual verification — dark mode**

Toggle dark mode (theme toggle, usually in sidebar / top bar). Expected:
- Background deep slate.
- Card surfaces slightly lighter slate.
- Labels muted slate-400.
- Values strong slate-100.
- Dividers faint slate-800.
- Blue Role badge remains legible.
- No harsh white-on-dark or dark-on-dark elements.

- [ ] **Step 6: Visual verification — zoom 80% / 100% / 125%**

At each zoom level (Ctrl+- / Ctrl+0 / Ctrl+=):
- Layout holds; no text clipping.
- 2-column FieldGroup collapses to 1 column on small widths (test by narrowing window). This matches FieldGroup's `sm:grid-cols-2`.
- DetailRow label column (w-40) doesn't crush the value.

- [ ] **Step 7: Visual verification — compact mode**

In DevTools → Elements, add `data-compact=""` to the root `<div>` (first child of `<body>`). Expected:
- All spacing shrinks proportionally.
- Font sizes shrink.
- Page still scannable, no overlap.
- Remove the attribute when done.

- [ ] **Step 8: Copy button smoke test**

Click the copy icon next to the Email DetailRow. The icon should briefly become a check mark for ~1.5s. Paste into any text field — the email should appear.

- [ ] **Step 9: Commit**

```bash
git add pages/settings/profile.js
git commit -m "$(cat <<'EOF'
refactor(settings): rebuild profile page on design-system primitives

End-to-end verification of Plan A. pages/settings/profile.js now
uses only PageHeader, SectionCard, FieldGroup+Field, and
DetailPane+DetailRow — zero raw spacing/typography/color classes
on design-system surfaces. Dark mode comes "for free" from tokens.

- Identity section: avatar block + DetailPane (Role badge, Email
  with copy button, Hire Date with muted placeholder).
- Personal Info section: FieldGroup(columns=2) with Full Name + Phone.
- Security section: SectionCard.actions slot holds Change Password.
- Removes the previous dark-mode gaps on <h1>, <section>, etc.

All four primitives exercised. Phase 5 / Plan A complete.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Done criteria (Plan A)

When all tasks above are complete:

- `docs/superpowers/specs/2026-04-14-ui-hierarchy-spacing-design.md` §5 is populated with audit findings from load detail, settings pages, and settings components, plus a consolidated token-demand map.
- `styles/globals.css` contains nine `--space-*` tokens and five `--text-*` tokens in `@theme inline`, plus `--color-muted` / `--color-strong` in `:root` / `.dark`, plus seven `@utility` classes (`text-page-title`, `text-section-title`, `text-field-label`, `text-body`, `text-helper`, `text-muted`, `text-strong`).
- `[data-compact]` overrides every design-system token. Legacy `!important` compact rules remain intact.
- `components/ui/ModuleHeader.js` exports `PageHeader` as default with new `breadcrumb` + `status` slots; named `ModuleHeader` alias preserved.
- `components/ui/FormSection.js` exports `SectionCard` as default with new `actions` slot + `columns={0}` unwrapped path; named `FormSection` alias preserved; no `collapsible` prop.
- `components/ui/FieldGroup.js`, `components/ui/Field.js`, `components/ui/DetailPane.js`, `components/ui/DetailRow.js` each exist as single-responsibility primitives.
- `pages/settings/profile.js` is a working end-to-end demonstration of all four primitives with correct behavior in light, dark, compact, and 80–125% zoom.
- Every task has its own commit on `main`; no consumer outside `pages/settings/profile.js` has been modified (Plans B and C own the rest).

---

## Handoff to Plan B / Plan C

Plan A ships primitives and tokens. It does not refactor any load detail tab or non-profile settings page — those are Plans B and C respectively.

Before writing Plan B or C, re-read `docs/superpowers/specs/2026-04-14-ui-hierarchy-spacing-design.md` §5 (populated by this plan's Phase 1). The pattern-to-token map there is the starting point for the refactor work.
