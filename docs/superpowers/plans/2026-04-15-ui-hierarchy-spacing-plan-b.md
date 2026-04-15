# UI Hierarchy & Spacing — Plan B: Load Detail Tab Refactor

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor six load detail tabs onto the design-system primitives shipped in UI Plan A. Every raw `text-gray-500 dark:text-slate-400` pair, every ad-hoc `<label>` class combo, every `mt-0.5` helper offset, and every bespoke `<section>` wrapper becomes a token / utility / primitive call. Removes the drift catalogued in spec §5.1.

**Architecture:** No new primitives, no new components. The entire plan is a pattern-level find-and-replace: hand-written markup → composed primitives. Additive token change: add `--space-field-helper` (mt-0.5) which spec §3 rule 4 already mandates but §2 never declared. One commit per tab per the spec §6 rollout.

**Tech Stack:** Next.js 15 (Pages Router), React 19, Tailwind v4 (CSS-first config), Supabase. Primitives + tokens live in `components/ui/` and `styles/globals.css` from UI Plan A.

**Spec:** `docs/superpowers/specs/2026-04-14-ui-hierarchy-spacing-design.md` — §5.1 Audit Results and §5.4 Token Demand are the source of truth for what needs changing.

---

## Scope

### In scope (6 tabs + 1 token)

| # | File | LoC | Spacing hits (§5.1) | Why it's in scope |
|---|---|---|---|---|
| 1 | `components/loads/tabs/NotesTab.js` | 308 | — | Smallest; good warm-up for patterns |
| 2 | `components/loads/tabs/TrackingTab.js` | 402 | 35 | 11 repeated muted pairs — DetailPane target |
| 3 | `components/loads/tabs/DocumentsTab.js` | 612 | 49 | Second-densest label pattern, card rhythm |
| 4 | `components/loads/tabs/AuditTab.js` | 618 | — | Timeline + filters, good FieldGroup exercise |
| 5 | `components/loads/tabs/BillingTab.js` | 853 | 78 | Highest drift density; heaviest lift |
| 6 | `components/loads/tabs/LoadInfoTab.js` | 950 | — | Most fields; biggest FieldGroup win |

Plus one tokens task that precedes the tab work:
- `styles/globals.css` — add `--space-field-helper: 0.125rem` token + compact override.

### Out of scope (deferred)

- **`components/loads/tabs/DriverPayTab.js` (663 LoC)** — Cowork's Plan B (pricing) verification currently depends on the "Recalculate" button + the table reading `amount_cents`, `tier_id`, `duration_label`. Refactoring this tab now risks breaking an in-flight QA. Park for a follow-up plan (UI Plan B.2 or fold into UI Plan C).
- **`components/loads/tabs/RoutingTab.js` (1131 LoC) + all of `components/loads/routing/**`** — Cowork uses this tab to set up event timestamps + locations for pricing scenarios. Too volatile to touch until verification ships. Parked identically.
- **`components/loads/tabs/PlaceholderTab.js`** (17 LoC) — empty placeholder; nothing to refactor.
- **`components/loads/DriverChargeProfileViewer.js`** and any modals opened from the tabs — modal ergonomics belong to a separate pass (UI Plan D candidate).
- **`components/loads/LoadSidebar.js`, `LoadDetail.js`, `LoadDetailLayout.js`** — the shell around the tabs. Refactoring shell changes tab chrome; defer to Plan D after the tabs settle.
- **Spec §5.4 gap items beyond `space-field-helper`** — eyebrow/badge sub-text-xs sizes (Plan C target), half-step drift audit (rolled into each tab's pattern swap).
- **Pages outside `components/loads/`** — `pages/settings/**` refactor is UI Plan C.

---

## File Structure

**Modified files (all already exist):**
- `styles/globals.css` — one new token (Phase 1)
- `components/loads/tabs/NotesTab.js` — Phase 2.1
- `components/loads/tabs/TrackingTab.js` — Phase 2.2
- `components/loads/tabs/DocumentsTab.js` — Phase 2.3
- `components/loads/tabs/AuditTab.js` — Phase 2.4
- `components/loads/tabs/BillingTab.js` — Phase 2.5
- `components/loads/tabs/LoadInfoTab.js` — Phase 2.6

**New files:** none.

**Imports added to each tab:** some combination of:
```jsx
import SectionCard from '../../ui/FormSection';      // exports SectionCard as default
import FieldGroup from '../../ui/FieldGroup';
import Field from '../../ui/Field';
import DetailPane from '../../ui/DetailPane';
import DetailRow from '../../ui/DetailRow';
```

---

## Pattern Library (universal swaps)

Every tab task runs these swaps. The Phase 2 tasks just specify per-tab particulars on top of these.

### 1. Section wrapper

**Before** (~every tab has variations):
```jsx
<section className="rounded-xl border border-gray-200 dark:border-slate-800 bg-white dark:bg-slate-900">
  <div className="px-5 py-3 border-b border-gray-200 dark:border-slate-800">
    <h3 className="text-sm font-semibold text-gray-900 dark:text-slate-100">Title</h3>
    <p className="text-xs text-gray-500 dark:text-slate-400">Description</p>
  </div>
  <div className="p-5">{/* body */}</div>
</section>
```

**After:**
```jsx
<SectionCard title="Title" description="Description" columns={0}>
  {/* body */}
</SectionCard>
```

When the section has a right-aligned action (button / link), use SectionCard's `actions` slot:
```jsx
<SectionCard
  title="Title"
  description="Description"
  columns={0}
  actions={<Button onClick={onEdit}>Edit</Button>}
>
  {/* body */}
</SectionCard>
```

### 2. Field grid

**Before:**
```jsx
<div className="grid grid-cols-1 sm:grid-cols-2 gap-4 p-5">
  <div>
    <label className="block text-xs font-medium text-gray-600 dark:text-slate-300 mb-1">
      Container
    </label>
    <input ... />
  </div>
  <div>
    <label className="block text-xs font-medium text-gray-600 dark:text-slate-300 mb-1">
      Seal
    </label>
    <input ... />
    <p className="text-xs text-gray-500 dark:text-slate-400 mt-0.5">Optional</p>
  </div>
</div>
```

**After** (inside `SectionCard columns={0}`):
```jsx
<FieldGroup columns={2}>
  <Field label="Container">
    <input ... />
  </Field>
  <Field label="Seal" helper="Optional">
    <input ... />
  </Field>
</FieldGroup>
```

`Field` absorbs all three: the label classes, the `mb-1` spacing, the `mt-0.5` helper offset. Use `required`, `helper`, `error` props for the common decorations.

### 3. Read-only key/value list

**Before:**
```jsx
<div className="divide-y divide-gray-100 dark:divide-slate-800">
  <div className="flex items-baseline gap-2 py-3">
    <div className="text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-slate-400 w-40">Container</div>
    <div className="text-sm text-gray-900 dark:text-slate-100">ABCD1234567</div>
  </div>
  <div className="flex items-baseline gap-2 py-3">
    <div className="text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-slate-400 w-40">Chassis</div>
    <div className="text-sm text-gray-500 dark:text-slate-400">—</div>
  </div>
</div>
```

**After:**
```jsx
<DetailPane>
  <DetailRow label="Container" value="ABCD1234567" copyable />
  <DetailRow label="Chassis" value="—" muted />
</DetailPane>
```

Use `copyable` for IDs / container numbers / reference fields the user commonly copies. Use `muted` for "—" / empty placeholders so they render in muted color automatically.

### 4. Leftover utility swaps (anywhere inline markup remains)

| Before | After |
|---|---|
| `text-gray-500 dark:text-slate-400` | `text-muted` |
| `text-gray-900 dark:text-slate-100` | `text-strong` |
| `text-gray-600 dark:text-slate-300` on labels | `text-field-label text-muted` |
| `text-xs font-medium` on standalone labels | `text-field-label text-muted` |
| `text-sm font-semibold` on section headings | `text-section-title text-strong` |
| `text-xs` on helper text | `text-helper text-muted` |
| `text-sm` on body text | `text-body` |
| `mt-0.5` helper-text offset | `mt-[var(--space-field-helper)]` |
| `gap-2` inline | `gap-[var(--space-inline)]` |
| `gap-4` between fields | `gap-[var(--space-field)]` (or let FieldGroup own it) |
| `mb-1.5` label→input | inside Field — no manual class |
| `p-5` card body | inside SectionCard — no manual class |
| `px-5 py-3` card header | inside SectionCard — no manual class |

### 5. What NOT to change

- **Buttons** (`<Button>`) — they own their own padding, don't rewrap.
- **Inputs** (`<Input>`) — same, inside Field as children.
- **Badges** / pills — own their own sizing (sub-text-xs sizes are deferred to Plan C).
- **Data-driven styling** (status-color backgrounds like `bg-emerald-500`, load-type badges) — keep as-is.
- **Iconography** from `lucide-react` — keep sizes, keep pairings (e.g. `w-4 h-4`).
- **Behavior / logic** — zero non-UI changes. No API calls get modified.

---

## Conventions

- **Commits:** `refactor(loads): rebuild <Tab> on design-system primitives` (per spec §6 — one PR / commit per tab). Every commit ends with `Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>`.
- **Verification after each tab:** syntax check + eyeball load detail in light mode. Full dark / compact / zoom QA happens in Phase 3 aggregate rather than per-tab to save turnaround time (tabs share patterns; once one renders correctly the rest follow).
- **When in doubt on a pattern:** leave it alone. Plan B is additive; any untransformed markup keeps working. A consistent tab is better than a half-migrated tab that loses fidelity. Plan D / future pass cleans up remnants.
- **No behavior changes.** Zero new API calls. Zero new state. Zero new features. If a refactor tempts you to fix a bug, resist — file it as a todo and keep moving.

---

## Phase 1 — Token addition

### Task 1.1: Add `--space-field-helper` token

**Files:** Modify `styles/globals.css`.

**Context:** Spec §3 rule 4 mandates `mt-0.5` for helper text under its owner. §5.4 confirms ≈95 occurrences across tabs + settings pages. §2's original token table never declared it. Adding the token is a prerequisite for the tab refactors — every `Field` with a helper ultimately consumes it via `mt-[var(--space-field-helper)]`.

- [ ] **Step 1: Locate the `@theme inline` block and the `[data-compact]` override block**

`styles/globals.css`. The spacing tokens live inside `@theme inline { ... }` around lines 349–359 (per UI Plan A Phase 2.1). The compact overrides live inside `[data-compact] { ... }` around lines 614–624.

- [ ] **Step 2: Append the token to `@theme inline`**

Find the spacing tokens block (the one labeled `DESIGN SYSTEM — SPACING`). Add at the END of the spacing tokens, just before the typography tokens begin (or before the closing `}` if typography is in a separate block):

```css
  --space-field-helper: 0.125rem; /* mt-0.5 — Field helper text offset */
```

- [ ] **Step 3: Append the compact override**

Inside the `[data-compact] { ... }` block, find the "Spacing shrink" comment. Add at the end of the spacing overrides:

```css
  --space-field-helper: 0.0625rem; /* tighter in compact */
```

- [ ] **Step 4: Smoke-test the token resolves**

Run `npm run dev` (or confirm already running — the user prefers port 3001 right now). In any page's DevTools console:

```js
getComputedStyle(document.documentElement).getPropertyValue('--space-field-helper')
```

Expected: `" 0.125rem"`. If empty, the `@theme` block didn't recompile — save + HMR.

- [ ] **Step 5: Commit**

```bash
git add styles/globals.css
git commit -m "$(cat <<'EOF'
feat(ui): add --space-field-helper token (mt-0.5)

Spec §3 rule 4 mandates mt-0.5 for helper text under its owner and
§5.4 confirms ≈95 occurrences across the codebase, but §2 never
declared the token. Adding it now so UI Plan B's tab refactors can
reference it consistently via mt-[var(--space-field-helper)].

Compact mode tightens it to 0.0625rem. Legacy mt-0.5 classes keep
working — the token is additive.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase 2 — Per-tab refactors

Each task follows the same shape: read the tab, swap patterns from the Pattern Library above, preserve behavior, commit. Tabs are ordered smallest → largest so the first commits build confidence with the pattern swaps before hitting the 950-LoC monster.

### Task 2.1: NotesTab refactor (308 LoC)

**File:** `components/loads/tabs/NotesTab.js`

**Context:** Smallest tab. Notes is a list + add-note form — should become one `SectionCard` wrapping the list, with an `actions`-slot button for "Add Note" (or similar) and `DetailPane`/custom list rows inside. The add-note form inputs use `Field`.

- [ ] **Step 1: Read the current file**

Open `components/loads/tabs/NotesTab.js`. Catalog sections: is there a header? A list? A form? Identify every `<section>` / `<div className="rounded-...">` / `<label>` / `text-gray-*` usage.

- [ ] **Step 2: Add the primitive imports**

At the top of the file, insert (adjust relative path to match file location):

```jsx
import SectionCard from '../../ui/FormSection';
import FieldGroup from '../../ui/FieldGroup';
import Field from '../../ui/Field';
```

Include `DetailPane` / `DetailRow` only if the tab renders read-only key/value pairs. NotesTab likely doesn't — notes are timeline entries, not key/value.

- [ ] **Step 3: Wrap the content in SectionCard**

Find the outermost wrapper `<section>` or `<div className="rounded-...">`. Replace with `<SectionCard columns={0}>`. Move the title and description into the `title` / `description` props. Move any right-aligned header action into the `actions` prop.

- [ ] **Step 4: Replace any label + input pairs with Field**

For every `<label>` block followed by an input, wrap in `<Field label="...">` and let the component own the label markup + helper/error styling.

- [ ] **Step 5: Sweep remaining inline utilities**

Using Grep, find remaining occurrences of:
- `text-gray-500 dark:text-slate-400` → `text-muted`
- `text-gray-900 dark:text-slate-100` → `text-strong`
- `text-sm font-semibold` on headings → `text-section-title text-strong`
- `text-xs` helpers → `text-helper text-muted`
- `mt-0.5` → `mt-[var(--space-field-helper)]`
- `gap-2` → `gap-[var(--space-inline)]`

Do the swaps via Edit. Leave anything that doesn't fit the Pattern Library alone.

- [ ] **Step 6: Verify**

```bash
node --check "C:/Users/bento/app-drayagedirect/components/loads/tabs/NotesTab.js"
```

Then hit the Notes tab on a load in the dev server. Check:
- Light mode: sections visible, labels uppercase muted, content legible
- Dark mode: no harsh white-on-white, no invisible gray-on-gray
- Adding a note still works (behavior unchanged)

- [ ] **Step 7: Commit**

```bash
git add components/loads/tabs/NotesTab.js
git commit -m "$(cat <<'EOF'
refactor(loads): rebuild NotesTab on design-system primitives

Swaps raw <section> wrappers for SectionCard(columns=0), raw <label>s
for Field, and inline text-gray-*/dark:text-slate-* pairs for the
text-muted / text-strong utilities. Spec §5.1 drift targets addressed
for this file. Behavior unchanged.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2.2: TrackingTab refactor (402 LoC)

**File:** `components/loads/tabs/TrackingTab.js`

**Context:** §5.1 highlighted 11 repeated `text-gray-500 dark:text-slate-400` pairs in this tab — the densest muted-pair target after BillingTab. The tab displays live driver location + arrival ETAs + a map. No `<label>` elements (card-style detail rows per §5.1). DetailPane is a strong candidate here.

- [ ] **Step 1: Read the current file**

Identify the key sections: "Driver Info" panel, "Last Position" panel, "Route" panel (if present). Locate the card-style detail rows that §5.1 called out.

- [ ] **Step 2: Add primitive imports**

```jsx
import SectionCard from '../../ui/FormSection';
import DetailPane from '../../ui/DetailPane';
import DetailRow from '../../ui/DetailRow';
```

Likely no FieldGroup / Field since there's no form.

- [ ] **Step 3: Convert each panel to SectionCard + DetailPane**

Each "driver info" / "last ping" / "route stats" panel becomes:

```jsx
<SectionCard title="Driver Info" columns={0}>
  <DetailPane>
    <DetailRow label="Driver" value={driver.full_name || '—'} muted={!driver.full_name} />
    <DetailRow label="Phone" value={driver.phone} copyable />
    {/* ... */}
  </DetailPane>
</SectionCard>
```

Use `muted` for `—` placeholders, `copyable` for phone / driver ID / load number.

- [ ] **Step 4: Sweep remaining utilities**

Run the standard Pattern Library §4 swaps.

- [ ] **Step 5: Verify + commit**

```bash
node --check "C:/Users/bento/app-drayagedirect/components/loads/tabs/TrackingTab.js"
git add components/loads/tabs/TrackingTab.js
git commit -m "$(cat <<'EOF'
refactor(loads): rebuild TrackingTab on design-system primitives

Collapses the 11 repeated text-gray-500/dark:text-slate-400 pairs
(spec §5.1) into DetailPane/DetailRow. Card-style detail rows become
a proper DetailPane per spec §3.4. Read-only data uses copyable/muted
as appropriate. Map + live ping components left alone (non-primitive
surfaces).

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2.3: DocumentsTab refactor (612 LoC)

**File:** `components/loads/tabs/DocumentsTab.js`

**Context:** 49 spacing hits, diverges from BillingTab's label pattern (`text-xs font-semibold` vs `text-xs font-medium`). The tab lists uploaded docs + upload form. Each doc row is a list item with metadata; the upload form has inputs.

- [ ] **Step 1: Read + inventory**

Identify: header, document list, upload form, any modals invoked from the tab. Modals are out of scope — leave them for a separate pass.

- [ ] **Step 2: Imports + outer SectionCard**

```jsx
import SectionCard from '../../ui/FormSection';
import FieldGroup from '../../ui/FieldGroup';
import Field from '../../ui/Field';
```

Wrap the tab's main content area in one or two SectionCards (one for the list, one for the upload form if separated).

- [ ] **Step 3: Upload-form inputs → Field**

Every `<label>` + input block in the upload form → `<Field label="..." helper="...">`. The type selector, description input, etc.

- [ ] **Step 4: Document list rows**

Each document row is a row with filename + metadata + action buttons. Do NOT force it into DetailPane — a doc row has an action column (download / delete) that DetailPane doesn't handle. Leave the list rows as-is but sweep their inline utilities onto the text-muted / text-strong utilities.

- [ ] **Step 5: Utility sweep + verify + commit**

```bash
node --check "C:/Users/bento/app-drayagedirect/components/loads/tabs/DocumentsTab.js"
git add components/loads/tabs/DocumentsTab.js
git commit -m "$(cat <<'EOF'
refactor(loads): rebuild DocumentsTab on design-system primitives

Upload form rebuilt on Field + FieldGroup; outer wrappers become
SectionCard. Document list rows (which carry action buttons not
suited for DetailPane) retain their bespoke row markup but switch to
text-muted / text-strong utilities. Modal chrome out of scope.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2.4: AuditTab refactor (618 LoC)

**File:** `components/loads/tabs/AuditTab.js`

**Context:** Timeline of audit log entries + filters at the top. Filters = `FieldGroup`. Timeline entries = bespoke row markup (like DocumentsTab's list rows — don't force into DetailPane). Likely has a "show more / load earlier" button and pagination — leave those alone.

- [ ] **Step 1: Read + inventory**

- [ ] **Step 2: Imports + outer SectionCards**

Two SectionCards: one for filters, one for the timeline.

- [ ] **Step 3: Filters → FieldGroup + Field**

Date range inputs, user filter, event-type selector become Fields inside a FieldGroup (`columns={3}` or `{4}` depending on layout).

- [ ] **Step 4: Timeline entries**

Timeline entries have custom iconography + left-border treatment. Keep that markup intact — sweep utilities only.

- [ ] **Step 5: Sweep + verify + commit**

```bash
node --check "C:/Users/bento/app-drayagedirect/components/loads/tabs/AuditTab.js"
git add components/loads/tabs/AuditTab.js
git commit -m "$(cat <<'EOF'
refactor(loads): rebuild AuditTab on design-system primitives

Filters rebuilt on FieldGroup + Field. Outer wrappers → SectionCard.
Timeline entries keep their bespoke icon + border-L treatment; only
their inline text-gray-*/dark:text-slate-* pairs swap for the new
utilities.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2.5: BillingTab refactor (853 LoC)

**File:** `components/loads/tabs/BillingTab.js`

**Context:** §5.1's highest-drift file at 78 spacing hits. Inline label pattern `block text-xs font-medium text-gray-600 dark:text-slate-300 mb-1` repeats 5x. This is the heaviest lift of the six tabs.

- [ ] **Step 1: Read + inventory**

Identify: charge-set list, line-item rows, totals card, status controls, invoice actions. Likely multiple SectionCards per charge set.

- [ ] **Step 2: Imports**

```jsx
import SectionCard from '../../ui/FormSection';
import FieldGroup from '../../ui/FieldGroup';
import Field from '../../ui/Field';
import DetailPane from '../../ui/DetailPane';
import DetailRow from '../../ui/DetailRow';
```

All four primitive families used here.

- [ ] **Step 3: Charge-set wrapper → SectionCard**

Each charge-set gets its own `SectionCard` with `title` = charge-set number, `description` = status, `actions` = right-aligned action buttons (edit, invoice, etc.).

- [ ] **Step 4: Line-item rows**

Line items are a table/grid — each row has line description + cents + unit-of-measure badge + delete button. Keep bespoke row markup; sweep utilities.

- [ ] **Step 5: Totals panel → DetailPane**

The "Subtotal / Tax / Total" panel at the bottom of each charge set is a textbook DetailPane: read-only key/value with the total bolded. Convert.

- [ ] **Step 6: Any edit-line-item inputs → Field**

If the tab has inline-edit for line items (e.g. amount_cents, name), those inputs get wrapped in Field.

- [ ] **Step 7: Sweep + verify + commit**

```bash
node --check "C:/Users/bento/app-drayagedirect/components/loads/tabs/BillingTab.js"
git add components/loads/tabs/BillingTab.js
git commit -m "$(cat <<'EOF'
refactor(loads): rebuild BillingTab on design-system primitives

Spec §5.1's highest-drift file. The 5 repeated
block/text-xs/font-medium/text-gray-600/mb-1 label pattern collapses
into Field; charge-set wrappers become SectionCard with actions slot;
totals panel becomes DetailPane. Line-item rows keep bespoke table
markup but sweep inline utilities onto text-muted / text-strong.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2.6: LoadInfoTab refactor (950 LoC)

**File:** `components/loads/tabs/LoadInfoTab.js`

**Context:** Largest tab. Dense fields — container #, seal, sizes, SSL, chassis, references, dates, locations. The most FieldGroup-heavy tab in the entire app. Also contains the OrgPicker components that were modified in earlier work (routing locks) — preserve the `disabled` / `helpText` wiring on those.

- [ ] **Step 1: Read + inventory**

Identify: top status banner (leave alone — pre-existing primitive), customer section, location triplet (pickup / delivery / return — OrgPickers), container info, chassis info, reference numbers, dates/appointments. Each is likely its own `<section>`.

- [ ] **Step 2: Imports**

```jsx
import SectionCard from '../../ui/FormSection';
import FieldGroup from '../../ui/FieldGroup';
import Field from '../../ui/Field';
```

DetailPane is optional — most of the tab is editable.

- [ ] **Step 3: Per-section conversion**

Each logical section (Customer, Locations, Container, Chassis, References, Dates, …) becomes a `SectionCard columns={0}` wrapping a `FieldGroup columns={2|3}` depending on field count.

- [ ] **Step 4: Preserve OrgPicker wiring**

Location-triplet OrgPickers already accept `disabled` + `helpText` props. When wrapping them in `Field`, pass the label through `Field`'s `label` prop; don't double-label. If `helpText` is set from `routing_locks` (the reverse-cascade logic from an earlier session), preserve that wiring by passing `helper` through to `Field`.

Example:
```jsx
<Field
  label="Pickup Location"
  helper={pickupLock.locked ? lockHelpText(pickupLock) : undefined}
>
  <OrgPicker
    value={load.pickup_location_id}
    onChange={...}
    disabled={pickupLock.locked}
  />
</Field>
```

- [ ] **Step 5: References / dates / appointments fields**

All text inputs and date pickers wrap in Field. Required fields get `required`. Optional get `helper="Optional"`.

- [ ] **Step 6: Sweep + verify + commit**

```bash
node --check "C:/Users/bento/app-drayagedirect/components/loads/tabs/LoadInfoTab.js"
git add components/loads/tabs/LoadInfoTab.js
git commit -m "$(cat <<'EOF'
refactor(loads): rebuild LoadInfoTab on design-system primitives

Largest tab in the app; every section becomes SectionCard wrapping
FieldGroup with Field cells. OrgPicker wiring (disabled + helpText
from routing_locks, reverse-cascade behavior) preserved through
Field's helper prop. No behavior changes — locks, saves, prenote,
everything unchanged.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase 3 — Verification

### Task 3.1: Build + smoke

**Files:** none (verification only).

- [ ] **Step 1: Syntax check every touched file**

```bash
cd "C:/Users/bento/app-drayagedirect"
node --check styles/globals.css 2>/dev/null || true  # CSS, won't parse — skip
for f in components/loads/tabs/{NotesTab,TrackingTab,DocumentsTab,AuditTab,BillingTab,LoadInfoTab}.js; do
  echo "Checking $f"
  node --check "$f" && echo "  OK"
done
```

Expected: six OKs.

- [ ] **Step 2: Smoke each tab in the dev server**

Open any load in the dispatcher. Click through each of the six refactored tabs. For each:
- Content visible, no blank sections, no console errors
- Dark mode: no white-on-white or dark-on-dark
- Compact mode: `data-compact=""` on root, spacing tightens

- [ ] **Step 3: Write Cowork visual QA prompt**

Create `docs/superpowers/plans/2026-04-15-ui-plan-b-cowork-verification.md` describing the six tabs and asking Cowork to: visit each, compare against prior screenshots (if any), report any visual regressions, confirm dark-mode + zoom 80/100/125% + compact-mode, and spot-check behavior on key interactions (add note, upload doc, edit billing line, filter audit, edit load info).

- [ ] **Step 4: Commit the Cowork prompt**

```bash
git add docs/superpowers/plans/2026-04-15-ui-plan-b-cowork-verification.md
git commit -m "$(cat <<'EOF'
docs(ui): Cowork visual QA prompt for UI Plan B tab refactor

Six tabs refactored onto design-system primitives. Prompt covers
visual + behavior + dark-mode + zoom + compact verification.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Verification Summary

After every task:

1. 8 commits present on main — `git log --oneline | head -10` shows the Phase 1 token commit + 6 tab commits + 1 Cowork-prompt commit.
2. All six tab files pass `node --check`.
3. No behavior regressions — every tab's interactive controls still work as before.
4. No dark-mode regressions — every refactored tab looks correct in dark mode; no lingering gray-on-dark or white-on-dark elements.
5. Cowork's visual QA report comes back green (or itemizes specific regressions).

## Integration Notes

- **Plan C (settings refactor)** follows immediately after Plan B. Same primitives, same patterns — spec §5.2 has the audit.
- **Plan D (deferred)** sweeps up: DriverPayTab, RoutingTab, routing/ subcomponents, modals, LoadSidebar, LoadDetailLayout chrome, the eyebrow/badge sub-text-xs size token, and the half-step drift cleanup from §5.4.
- **Customer-visible effect of Plan B:** every load detail tab gets tighter, more consistent spacing; dark-mode quality levels up across the six tabs; helper-text offset becomes uniform via the new token.
