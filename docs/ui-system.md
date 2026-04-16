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
