---
name: 2026-04-24-load-margin-percent-design
description: Per-load margin % computation (AR revenue − driver pay cost), tenant-configurable color thresholds in Settings → Accounting, shared MarginBadge component rendering red/yellow/green on dispatcher board + AR pipeline rows + load detail header, and AR filter-bar margin range filter (closes out the Phase C deferred dim).
type: spec
---

# Load Margin % — Design Spec

## Summary

Today DrayageDirect has no per-load margin view. Dispatchers assigning drivers, AR operators approving charge sets, and CSRs editing loads have no quick read on "is this load actually profitable?" — they have to open the AR tab and eyeball the charge set vs open the Driver Pay tab and eyeball the pay lines, then do the math in their head.

This feature adds a single per-load margin % value, computed server-side, rendered as a color-coded badge (red / yellow / green / neutral-grey) across four surfaces, with per-tenant configurable color thresholds living in a new Settings → Accounting section. It also closes out the last deferred dimension from the AR filter bar — `margin_from` / `margin_to` — shipped as a Phase C+ follow-on.

The margin formula is simple on purpose: `margin = Σ order_charge_sets.total_cents − Σ order_driver_pay_lines.amount_cents`, all grouped by `order_id`. Fuel/toll/chassis-split costs are already captured through the existing percentage-based-on-AR driver charge profiles, so "driver pay only" isn't a false simplification — it's what the AP engine already rolls up.

## Goals

- Single per-load margin value surfaced on the five most-viewed load surfaces (dispatcher board, AR Billing pipeline, AR Invoices pipeline, load detail header, load detail Billing tab summary row).
- Tenant-configurable red/yellow thresholds (defaults 15% / 30%), with green as "above yellow" derived. Set in Settings → Accounting → Margin Thresholds.
- Tenant toggle to include or exclude dry-run line items from the margin calc (default: include).
- Close out the AR filter bar Phase C deferred dim — numeric range (`margin_from` / `margin_to`) plus quick-pick preset pills (Red / Yellow+ / Green+).
- Permission-gated — margin reveals bill rates, so it only renders for users with `ACCOUNTS_RECEIVABLE` or `REPORTING`.
- Shared `<MarginBadge />` component so every surface renders margin the same way (color, sizing, dark-mode, rounding).
- Unit-tested pure helper (`lib/load-margin.js`) on the same hand-rolled `.test.mjs` pattern as dry-run + leg-distance (running test count becomes ~60+).

## Non-Goals (explicitly out of scope for v1)

1. **Configurable cost/revenue buckets.** Cost is `Σ driver_pay_lines.amount_cents`, revenue is `Σ charge_sets.total_cents`. Adding a Settings UI to pick which AR charge codes count as "cost" vs "revenue" is a v2 feature if the simple model proves insufficient — shipping it now would triple the scope for a feature nobody has used yet.
2. **Per-charge-set margin.** A load can have primary + rebilling + dry-run charge sets; v1 sums them all into one load-level number. Per-CS breakdown is a drill-down (a tooltip or load-detail sub-panel) — track as follow-up.
3. **Historic margin charting / reports dashboard.** Margin over time, margin by customer, margin by driver — all separate reporting work.
4. **Sidebar / mobile / customer portal / driver mobile.** Not in Phase 1. Dispatch/AR/load-detail cover 95% of the "is this load profitable?" moment.
5. **Colorblind-friendly palette toggle.** The red/yellow/green scheme is universal; a single tenant toggle can be added later if a customer asks.
6. **Payments received / open balance margin.** Margin computes against *billed* revenue, not *collected*. Collection / AR aging is a separate concern already served by the AR pipeline.
7. **Branch-scoped margin aggregation.** Margin is per-load only; "total branch margin this week" is reporting territory.
8. **Recompute-trigger infrastructure.** Margin is computed on read, not persisted — no triggers, no stored columns, no dirty-marker pattern. Recompute is free every request.

## Locked Decisions (Chunks 1–3 summary)

| # | Decision | Rationale |
|---|---|---|
| D1 | Cost = Σ `order_driver_pay_lines.amount_cents` per `order_id` | AP engine already rolls fuel/toll/chassis into driver pay via percentage-based-on-AR profiles |
| D2 | Revenue = Σ `order_charge_sets.total_cents` per `order_id` (all statuses) | Forward-looking margin — dispatchers need it on in-flight loads before invoices are cut |
| D3 | Dry runs included by default; tenant toggle to exclude | Dry runs cost real driver pay and bill real customers — they're real margin |
| D4 | Red threshold + Yellow upper threshold are tenant-configurable; defaults 15 / 30 | Drayage operators have different profit profiles; the defaults are Mike's call |
| D5 | Color scheme fixed: red / yellow / green / neutral-grey | Universal low/med/high/unknown signal |
| D6 | Zero-revenue OR zero-cost → neutral-grey + "—" | Don't scare dispatchers with red on brand-new loads; don't show margin=100% when no cost is entered yet |
| D7 | Multi-charge-set loads: sum all CS into one load-level margin | Per-CS margin is a drill-down, not the primary view |
| D8 | Compute live on read via pure helper `lib/load-margin.js`; no persisted columns | Revenue + cost are already cheap batch queries |
| D9 | Permission gate: `ACCOUNTS_RECEIVABLE` OR `REPORTING` | Margin exposes bill rates — same gate as the existing AR pipeline |
| D10 | Shared `<MarginBadge />` component in `components/shared/` | Single source of truth for color + dark-mode + rounding |

## Data Model

### New columns on `tenants` (migration 092)

```sql
ALTER TABLE tenants
  ADD COLUMN margin_red_threshold    NUMERIC(5,2) NOT NULL DEFAULT 15.00,
  ADD COLUMN margin_yellow_threshold NUMERIC(5,2) NOT NULL DEFAULT 30.00,
  ADD COLUMN margin_include_dry_runs BOOLEAN      NOT NULL DEFAULT TRUE;
```

- `margin_red_threshold` — loads at or below this percentage render red. Expressed as a whole-number percent (e.g. `15.00` = 15%). `NUMERIC(5,2)` supports `-999.99` through `999.99` which is well beyond any realistic threshold.
- `margin_yellow_threshold` — loads above red threshold and at-or-below this percentage render yellow. Loads above this render green. Must be `> margin_red_threshold` (enforced in the Settings UI + a CHECK constraint below).
- `margin_include_dry_runs` — when `FALSE`, both the revenue sum and cost sum exclude rows where `dry_run_attempt_id IS NOT NULL`.

Add a check constraint to prevent invalid threshold ordering:

```sql
ALTER TABLE tenants
  ADD CONSTRAINT chk_margin_threshold_order
  CHECK (margin_yellow_threshold > margin_red_threshold);
```

Wrapped in `BEGIN` / `COMMIT` with `NOTIFY pgrst, 'reload schema'` per `dev_migration_template.md`.

### No new columns on charge / pay tables

All data needed is already there:
- `order_charge_sets.total_cents` — already denormalized per CS; sum grouped by `order_id`
- `order_driver_pay_lines.amount_cents` — sum grouped by `order_id`
- Both tables already have `dry_run_attempt_id` (added in migration 088) — used to filter dry-runs in/out

**Gotcha reminder:** `order_driver_pay_lines` uses `order_id` not `load_id`. This bit us on the leg-distance ship (2026-04-23) — documented in `memory/session_2026_04_23_leg_distance_ship.md`.

### No persisted margin columns

The margin value is computed on read, never stored. Rationale:
- Revenue and cost can change any time (new charges added, driver pay edited, thresholds adjusted in Settings). A persisted `orders.margin_pct` column would need triggers on three tables + on `tenants` updates. Not worth it.
- The read-path cost is one batched SUM query per table, scoped to the order IDs in the current response. Sub-10ms on typical dispatcher-board page sizes (≤100 orders).

## Compute Helper (`lib/load-margin.js`)

Single pure function, fully testable, no DB access inside:

```js
/**
 * Compute load-level margin from pre-fetched sums.
 *
 * @param {object}  args
 * @param {number}  args.revenueCents    — SUM(order_charge_sets.total_cents) for this order
 * @param {number}  args.costCents       — SUM(order_driver_pay_lines.amount_cents) for this order
 * @param {number}  args.redThreshold    — tenant margin_red_threshold (percent, e.g. 15)
 * @param {number}  args.yellowThreshold — tenant margin_yellow_threshold (percent, e.g. 30)
 *
 * @returns {{
 *   revenueCents: number,
 *   costCents: number,
 *   marginCents: number,
 *   marginPct: number|null,   // null when neutral
 *   bucket: 'red'|'yellow'|'green'|'neutral',
 * }}
 */
export function computeLoadMargin({ revenueCents, costCents, redThreshold, yellowThreshold }) {
  const r = Number.isFinite(revenueCents) ? revenueCents : 0;
  const c = Number.isFinite(costCents)    ? costCents    : 0;
  const marginCents = r - c;

  // Neutral cases: no data on either side
  if (r <= 0 || c <= 0) {
    return { revenueCents: r, costCents: c, marginCents, marginPct: null, bucket: 'neutral' };
  }

  const marginPct = (marginCents / r) * 100;
  let bucket;
  if (marginPct <= redThreshold)        bucket = 'red';
  else if (marginPct <= yellowThreshold) bucket = 'yellow';
  else                                   bucket = 'green';

  return { revenueCents: r, costCents: c, marginCents, marginPct, bucket };
}
```

### Batch fetch helper

Endpoints call a separate batch-fetch function to get revenue/cost sums for a list of order IDs in two queries:

```js
/**
 * Batch-load revenue and cost sums for a set of orders.
 * Returns a Map<orderId, { revenueCents, costCents }>.
 *
 * includeDryRuns: when false, excludes rows where dry_run_attempt_id IS NOT NULL
 *                  from BOTH sums.
 */
export async function fetchLoadMarginInputs(svc, { tenantId, orderIds, includeDryRuns }) {
  if (!orderIds.length) return new Map();

  // Revenue: sum charge_set totals per order.
  const revenueQ = svc
    .from('order_charge_sets')
    .select('order_id, total_cents')
    .eq('tenant_id', tenantId)
    .in('order_id', orderIds);

  // Cost: sum driver_pay_lines per order.
  // Dry-run filter lives on the line-item tables, not charge_sets.
  let costQ = svc
    .from('order_driver_pay_lines')
    .select('order_id, amount_cents, dry_run_attempt_id')
    .eq('tenant_id', tenantId)
    .in('order_id', orderIds);
  if (!includeDryRuns) costQ = costQ.is('dry_run_attempt_id', null);

  // For revenue-side dry-run exclusion, we need the line items (since
  // order_charge_sets.total_cents includes dry-run line items by construction).
  // When includeDryRuns=false, we recompute revenue from line items minus
  // dry-run line items. When includeDryRuns=true, the charge_sets.total_cents
  // path is enough.
  // ... (full implementation in the plan)

  const [{ data: cs }, { data: pl }] = await Promise.all([revenueQ, costQ]);

  const out = new Map();
  for (const id of orderIds) out.set(id, { revenueCents: 0, costCents: 0 });
  for (const row of cs ?? []) {
    const o = out.get(row.order_id); if (o) o.revenueCents += row.total_cents ?? 0;
  }
  for (const row of pl ?? []) {
    const o = out.get(row.order_id); if (o) o.costCents += row.amount_cents ?? 0;
  }
  return out;
}
```

When `includeDryRuns = false`, revenue needs to be recomputed from `order_charge_set_line_items` with `dry_run_attempt_id IS NULL` filter, because `order_charge_sets.total_cents` is a denormalized sum that already includes dry-run line items. The plan will split the revenue path accordingly.

## Read Paths (integration points)

Every endpoint that returns load rows and displays margin follows the same pattern:

1. Fetch orders (existing query).
2. Call `fetchLoadMarginInputs(svc, { tenantId, orderIds, includeDryRuns })` with the tenant's toggle.
3. For each order, call `computeLoadMargin({ revenueCents, costCents, redThreshold, yellowThreshold })`.
4. Attach the result as `order.margin = { revenueCents, costCents, marginCents, marginPct, bucket }` on the response.

Endpoints to update in Phase 1:

| Endpoint | File | Notes |
|---|---|---|
| Dispatcher / loads list GET | `pages/api/tenant/loads/index.js` | Hottest path; enforces `ACCOUNTS_RECEIVABLE` OR `REPORTING` before attaching |
| AR pipeline Billing GET | `pages/api/tenant/ar/index.js` | Attach per-CS-row; all CS for same load share the same margin |
| AR pipeline Invoices GET | `pages/api/tenant/ar/invoices/index.js` | Same pattern as Billing |
| Load detail GET | `pages/api/tenant/loads/[id]/index.js` | Single-order variant — call the same helper with a one-item array |

**Verify during plan pass:** whether `order_charge_sets.total_cents` is maintained as `SUM(line_items.total_cents)` by application code on every write, vs. a DB trigger. The "exclude dry runs from revenue" path depends on this — if `total_cents` is always in sync with line items, we can recompute from `order_charge_set_line_items WHERE dry_run_attempt_id IS NULL` cleanly. If not, the plan must patch the write path first.

The AR filter bar extends the AR endpoints with `margin_from` / `margin_to` query params (see "AR Filter Bar" section).

## Settings UI

### New nav entry

In `lib/settings-nav.js`, add a new group `'Accounting'` containing a single item `'Margin Thresholds'`:

```js
{
  group: 'Accounting',
  items: [
    {
      key: 'margin_thresholds',
      label: 'Margin Thresholds',
      href: '/settings/accounting/margin',
      icon: Percent,  // from lucide-react
      requiredPermission: [PERMISSIONS.SETTINGS, PERMISSIONS.ALL],
    },
  ],
},
```

Placed between `'AR'` and `'Pricing'` in the sidebar order (visual grouping: General → AR → Accounting → Pricing → Operations → Equipment → Team → Communications → Coming Soon).

### Page

`pages/settings/accounting/margin.js`, wrapped in `SettingsLayout`:

- Three controls:
  1. **Red threshold** — number input, `%` suffix, step `0.01`, min `0`, max `100`
  2. **Yellow upper threshold** — number input, `%` suffix, step `0.01`, min `0`, max `100`
  3. **Include dry runs in margin calc** — toggle
- Inline validation: yellow must be `> red`. Submit disabled until valid. Error message surfaces the constraint explicitly.
- Preview: a live sample pill renders below the inputs showing what a 10% / 20% / 35% margin would look like under the current threshold settings — helps the tenant sanity-check before saving.
- Save button → `PUT /api/tenant/me/margin-thresholds` (new endpoint, one-row update on `tenants`).
- GET via `GET /api/tenant/me/margin-thresholds` on page mount.

Dark-mode mandatory per `dev_dark_mode_convention.md`.

### API endpoints

```
GET  /api/tenant/me/margin-thresholds
  → { red_threshold: 15.00, yellow_threshold: 30.00, include_dry_runs: true }

PUT  /api/tenant/me/margin-thresholds
  body: { red_threshold, yellow_threshold, include_dry_runs }
  → { ok: true } on success
  → { error: "yellow must exceed red" } on constraint violation
```

Both gated by `SETTINGS` permission (same as other tenant-wide settings).

## UI Components

### `<MarginBadge />` (new shared component)

Location: `components/shared/MarginBadge.jsx`

```jsx
/**
 * @param {object} props
 * @param {number|null} props.marginPct    — the numeric percent or null for neutral
 * @param {'red'|'yellow'|'green'|'neutral'} props.bucket
 * @param {'sm'|'md'} [props.size='sm']    — dispatcher board uses 'sm', load detail uses 'md'
 * @param {string}   [props.tooltip]       — optional hover text (e.g., "Revenue $1,250 − Cost $875 = $375")
 */
export default function MarginBadge({ marginPct, bucket, size = 'sm', tooltip }) { ... }
```

Class map (shared across all surfaces; dark-mode variants mandatory):

| Bucket | Light | Dark |
|---|---|---|
| red | `bg-red-100 text-red-700 border-red-200` | `dark:bg-red-950 dark:text-red-300 dark:border-red-900` |
| yellow | `bg-amber-100 text-amber-700 border-amber-200` | `dark:bg-amber-950 dark:text-amber-300 dark:border-amber-900` |
| green | `bg-emerald-100 text-emerald-700 border-emerald-200` | `dark:bg-emerald-950 dark:text-emerald-300 dark:border-emerald-900` |
| neutral | `bg-gray-100 text-gray-500 border-gray-200` | `dark:bg-slate-800 dark:text-slate-400 dark:border-slate-700` |

Render:
- Non-neutral: `32.5%` with one decimal, right-aligned. Negative values (revenue < cost) render as `-8.3%` and use the `red` class.
- Neutral: `—` (em-dash).
- Tooltip (optional, when hovering on desktop): `Revenue $1,250 − Cost $875 = Margin $375`.

Sizes: `sm` → `text-xs px-1.5 py-0.5 rounded`, `md` → `text-sm px-2 py-1 rounded-md`.

### Surface integrations

1. **Dispatcher board** — new opt-in column `'margin_pct'` in the column set. Hidden by default. Stored in `user_dispatcher_preferences.column_order` + visibility. Column renderer uses `<MarginBadge marginPct={margin.marginPct} bucket={margin.bucket} size="sm" />`.
2. **AR Billing pipeline rows** — `components/ar/BillingPipelineTab.js`: add a `Margin` column to the row shape. Every CS row for the same load renders the same pill (load-level margin).
3. **AR Invoices pipeline rows** — `components/ar/InvoicesTab.js`: mirror Billing.
4. **Load detail header (persistent across tabs)** — `components/loads/LoadDetailLayout.js`: insert a `<MarginBadge size="md" tooltip={...} />` in the header metadata strip, after the load status chip. Visible whichever tab is active, including Billing.
5. **Load detail → Billing tab summary row** — `components/loads/tabs/BillingTab.js`: one-line summary at the very top of the tab content (above the charge-set cards) showing:

   `Revenue $1,250.00 · Cost $875.00 · Margin $375.00 [30.0% green pill]`

   Renders from `load.margin` (already attached by the load detail GET endpoint — no extra fetch). Purpose: right where the dispatcher is editing line items, approving CS, and sending rate-cons, the margin context is at eye level. Header badge stays for at-a-glance; this row gives the breakdown. Neutral-bucket loads (no revenue or no cost) render `Revenue — · Cost — · Margin —` with a grey pill. Permission-gated identically to the other surfaces (`ACCOUNTS_RECEIVABLE` OR `REPORTING`).

   **Not included:** per-charge-set margin allocation (remains out of scope per Non-Goal #2 — dry-run vs primary CS contribute non-obviously to load margin; shipping that correctly is its own design).

## AR Filter Bar Integration

Adds the last deferred dimension from Phase C (see `memory/session_2026_04_21_phase_c_ship.md`).

### Schema changes

- `lib/ar-filter-schema.js` — add two string keys: `margin_from`, `margin_to`.
- `lib/ar-filter-params.js` — extend `STRING_KEYS` (currently 8 entries) to 10. Sanitizer accepts any numeric string, rejects garbage.
- `SECTION_KEYS.billing` and `SECTION_KEYS.invoices` both include both new keys.

### Applier

In `pages/api/tenant/ar/index.js` and `pages/api/tenant/ar/invoices.js` (after existing filters run and charge-set IDs are scoped):

```js
if (filters.margin_from != null || filters.margin_to != null) {
  const orderIds = /* distinct order_ids from scoped charge sets */;
  const inputs = await fetchLoadMarginInputs(svc, {
    tenantId: ctx.tenantId,
    orderIds,
    includeDryRuns: tenant.margin_include_dry_runs,
  });

  const orderIdsPassingMargin = new Set();
  for (const orderId of orderIds) {
    const { revenueCents, costCents } = inputs.get(orderId);
    const { marginPct, bucket } = computeLoadMargin({
      revenueCents, costCents,
      redThreshold: tenant.margin_red_threshold,
      yellowThreshold: tenant.margin_yellow_threshold,
    });
    if (bucket === 'neutral') continue;  // neutral rows excluded from numeric range filters
    if (filters.margin_from != null && marginPct < Number(filters.margin_from)) continue;
    if (filters.margin_to   != null && marginPct > Number(filters.margin_to))   continue;
    orderIdsPassingMargin.add(orderId);
  }

  // Intersect with the running set of scoped charge-set IDs.
  chargeSetRows = chargeSetRows.filter((r) => orderIdsPassingMargin.has(r.order_id));
}
```

### Sidebar UI

In `components/ar/FilterSidebar.js`, add a new section `Load Margin %` between existing sections (position TBD in plan — likely after "Factor Company"):

- Two number inputs: `Min %` (binds to `margin_from`) and `Max %` (binds to `margin_to`). Both optional.
- Quick-pick pills under the inputs:
  - `Red only` — sets `margin_to = <tenant.margin_red_threshold>`, clears `margin_from`
  - `Yellow+` — sets `margin_from = <tenant.margin_red_threshold + 0.01>`, clears `margin_to`
  - `Green+` — sets `margin_from = <tenant.margin_yellow_threshold + 0.01>`, clears `margin_to`
- Clear section button like other sections.
- Tenant threshold values fetched via the same GET used by the Settings page (read-only for non-SETTINGS-permission users).

### Unit tests

Extend the existing `lib/ar-filter-schema.test.mjs` (46 tests currently) to cover:
- Both new keys appear in `STRING_KEYS` + both `SECTION_KEYS`.
- Sanitizer accepts numeric strings for both keys.
- `filtersMatch` / `filtersAreEmpty` cover both keys.

## Permissions

- **Settings page + PUT endpoint**: `SETTINGS` or `ALL`. Same as other tenant-wide settings.
- **Margin display** (dispatcher column, AR row column, load detail badge): `ACCOUNTS_RECEIVABLE` or `REPORTING`. If neither, the column / badge does not render and the endpoint does not attach the `margin` object. Endpoint-level enforcement — not just CSS hiding.
- **GET /api/tenant/me/margin-thresholds** (read): `SETTINGS` or `ACCOUNTS_RECEIVABLE` or `REPORTING` — needed by both the Settings page AND the AR filter bar's quick-pick pills (which read threshold values for read-only users).

## Edge Cases

| Case | Behavior |
|---|---|
| Load with no charge sets (new load, no AR entered) | `revenueCents = 0` → bucket `neutral`, pill shows `—` |
| Load with charge sets but no driver assigned yet | `costCents = 0` → bucket `neutral`, pill shows `—` (not 100%) |
| Load with cost > revenue (underwater) | `marginPct = -8.3%` → bucket `red` (negative ≤ red threshold) |
| Load with rebilling + primary CS | Summed together into one load-level margin |
| Dry-run-only load (all CS tied to dry runs) + tenant toggle OFF | Both sides drop to 0 → neutral |
| Threshold change while user is viewing a page | Next fetch reflects new thresholds; page cache invalidates on Settings save (standard SWR pattern) |
| Tenant with non-default thresholds migrating from default | Migration adds NOT NULL DEFAULTs, so existing tenants get `15 / 30 / true` automatically; constraint enforced at INSERT/UPDATE time only |

## Testing Strategy

Hand-rolled `.test.mjs` files run via `node tests/<file>.test.mjs`. Each assertion uses `check(name, cond)` pattern per existing convention.

### `tests/load-margin-engine.test.mjs` (new — 15 tests)

1. Revenue $100, cost $50, thresholds 15/30 → bucket `green`, margin 50%
2. Revenue $100, cost $85, thresholds 15/30 → bucket `red`, margin 15% (boundary, ≤15 = red)
3. Revenue $100, cost $80, thresholds 15/30 → bucket `yellow`, margin 20% (> red 15, ≤ yellow 30)
4. Revenue $100, cost $70, thresholds 15/30 → bucket `yellow`, margin 30% (boundary, ≤30 = yellow)
5. Revenue $100, cost $69, thresholds 15/30 → bucket `green`, margin 31%
6. Revenue $0, cost $0 → bucket `neutral`, marginPct null
7. Revenue $100, cost $0 → bucket `neutral` (no cost)
8. Revenue $0, cost $50 → bucket `neutral` (no revenue)
9. Revenue $100, cost $110 (underwater) → bucket `red`, marginPct -10
10. NaN / undefined / negative inputs → defensive defaults (treated as 0, result `neutral`)
11. Custom thresholds (5 / 10) with margin 7% → bucket `yellow`
12. Custom thresholds (5 / 10) with margin 11% → bucket `green`
13. Rounding — margin 15.50001% with threshold 15 → bucket `yellow` (> red)
14. Very large values (revenue $1,000,000,000 cents) — no overflow in marginPct
15. Bucket naming is one of the four strings; never undefined

### `tests/ar-filter-schema.test.mjs` extensions (~5 tests, pushing total to 51+)

- `margin_from` / `margin_to` present in STRING_KEYS
- Both keys in SECTION_KEYS.billing and SECTION_KEYS.invoices
- Sanitizer accepts `"15"`, `"15.5"`, `"0"`, `"-10"`; rejects non-string, preserves format for numeric downstream
- `filtersMatch` returns false when either key differs; true when both match
- `filtersAreEmpty` excludes both keys when unset

### Chrome live gates (walked in 2–3 batches via claude-in-chrome subagent)

| Batch | Gates |
|---|---|
| Batch 1 (3 gates) | Settings page loads; threshold save round-trips; constraint violation toast |
| Batch 2 (4 gates) | Dispatcher board shows margin column when ACCOUNTS_RECEIVABLE; hidden without it; badge color matches bucket; tooltip shows Revenue − Cost = Margin |
| Batch 3 (4 gates) | AR Billing/Invoices show margin column; AR filter bar margin range filters; quick-pick pills set thresholds; saved filter persists across reload |
| Batch 4 (4 gates) | Load detail header badge renders on all tabs; Billing tab summary row renders above CS cards with correct breakdown; dry-run toggle OFF excludes dry-run AR + AP from computed margin; re-enabling restores |

## Rollout

- Single PR, single migration (092), single deploy cadence.
- Migration runs first (adds columns + defaults on `tenants`). Existing tenants pick up defaults `15 / 30 / true` automatically.
- Endpoints attach `margin` object on responses as soon as they ship. Frontend gracefully handles missing `margin` (renders nothing) during the deploy window.
- No backfill needed — margin is always computed live.
- Follow-up memory: `feature_load_margin.md` documenting shipped behavior + any gotchas caught during ship.

## Open Questions (deferred to implementation plan)

These are intentionally not answered in the spec because they're implementation-detail decisions better made during the plan pass:

1. **Exact column set shape on dispatcher board** — does the margin column slot into the existing 63-column system with `margin_pct` as a key, or does it get special-cased? Likely just another entry in the column set with a custom renderer; plan will verify against `feature_dispatcher_board.md`.
2. **Where in the load detail header does the badge sit** — to the right of the status chip, or on a new line under it? Visual decision; plan will include a mockup.
3. **Does the quick-pick pill "Red only" include loads with margin EQUAL to red threshold?** Spec says inclusive ≤; UX confirmation during plan walkthrough.
4. **Caching of tenant thresholds** — per-request read from `tenants` row is cheap, but is there an existing tenant-settings cache pattern we should slot into? Plan will audit.

## File Manifest (expected)

New files:
- `supabase/migrations/092_load_margin_thresholds.sql`
- `lib/load-margin.js`
- `tests/load-margin-engine.test.mjs`
- `pages/settings/accounting/margin.js`
- `pages/api/tenant/me/margin-thresholds.js`
- `components/shared/MarginBadge.jsx`

Modified files:
- `lib/settings-nav.js` — new `Accounting` group
- `lib/ar-filter-schema.js` — two new string keys
- `lib/ar-filter-params.js` — STRING_KEYS extension
- `components/ar/FilterSidebar.js` — new section
- `components/ar/BillingPipelineTab.js` — margin column (AR pipeline, global)
- `components/ar/InvoicesTab.js` — margin column (AR pipeline, global)
- `components/loads/LoadDetailLayout.js` — margin badge in persistent header
- `components/loads/tabs/BillingTab.js` — one-line margin summary above CS cards
- `pages/api/tenant/ar/index.js` — margin filter applier + response attach
- `pages/api/tenant/ar/invoices/index.js` — same
- `pages/api/tenant/loads/index.js` — response attach on dispatcher/loads list
- `pages/api/tenant/loads/[id]/index.js` — single-load margin attach
- Dispatcher board column config + row renderer
- Load detail header component
- `tests/ar-filter-schema.test.mjs` — new test cases
