# Pricing Engine Completion — Plan C: Distance/Weight UOMs + AR Diagnostic Parity

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the remaining UOM gaps in both pricing engines (`per_pounds`, `per_miles`, `radius_tiers` on `radius_rate`) by extending the shared helpers from Plan A. Add an AR-side diagnostic tracer endpoint that mirrors `recalculate-driver-pay.js` so invoice-side pricing has the same troubleshooting affordance. Clear the three silent-wrong-answer UOMs from production risk and give dispatchers a reason-trace for why a customer tariff did or didn't match.

**Architecture:** Extend `lib/pricing-uom.js` with two new families — weight-based (`per_pounds`) and distance-based (`per_miles`, `radius_rate` tier evaluation). Extend `resolveAmountCents()` in `lib/pricing-tier-resolver.js` with weight and distance branches. Distance reads from `orders.actual_miles` (already on the schema) — no server-side distance service required. Mirror the AP diagnostic endpoint into a new AR one at `pages/api/tenant/loads/[id]/recalculate-charges-diagnostic.js` (read-only — does NOT apply charges, just reports what WOULD apply and why).

**Tech Stack:** Pure JavaScript, ESM, same shape as Plans A and B. No new libraries.

**Prior art:**
- Plan A commits `8958c21..bf69dbe` built the shared resolver + time UOMs.
- Plan B commits `12396ec..64dc2a6` added location-aware tier matching.
- `orders.actual_miles NUMERIC(8,2)` was added in migration 001 — populated by `utils/getDistanceMiles.js` (client-side) when the Routing tab computes a route.
- `orders.weight_lbs` is populated on every load with declared weight.
- AP diagnostic shape documented in-line in `recalculate-driver-pay.js` and exercised by Plan A's Scenario B verification.

---

## Scope

### In scope

| Feature | Mechanism | Files touched |
|---|---|---|
| `per_pounds` UOM | Multiply rate by `load.weight_lbs / pounds_per_unit` (default 1 lb per unit) | `lib/pricing-uom.js`, `lib/pricing-tier-resolver.js` |
| `per_miles` UOM | Multiply rate by `load.actual_miles` | same |
| `radius_tiers` JSONB evaluation on `radius_rate` UOM | Walk `tier.radius_tiers` array, pick entry where `actual_miles` falls in `[start, end]`, apply `rate_type` (`fixed` / `per_unit` / `percentage`) | same |
| AR diagnostic tracer endpoint | New read-only endpoint returning tariff-by-tariff + charge-by-charge trace (same shape as AP) | `pages/api/tenant/loads/[id]/recalculate-charges-diagnostic.js` (new) |
| Cowork verification prompt | 4 new scenarios (C1 per_pounds, C2 per_miles, C3 radius_rate, C4 AR diagnostic) | `docs/superpowers/plans/2026-04-15-plan-c-cowork-verification.md` (new) |

### Out of scope (deferred)

- **`per_road_toll_miles`** — needs a toll-aware routing API integration. Separate vendor eval / data model work. Plan D candidate.
- **`oo_benchmark` percentage source** — needs a benchmark data store (expected O/O pay per route). Schema + seed-data work. Plan D.
- **`profile_group` location type** — fail-open in Plan B. Needs `profile_groups` + `profile_group_members` tables + UI. Plan D.
- **Server-side distance calc** — currently `utils/getDistanceMiles.js` is a client-side Google Distance Matrix wrapper. We use `orders.actual_miles` directly. If a load has `actual_miles = null`, per_miles resolves to 0 (fail-closed) and the diagnostic surfaces the reason. A future plan can add a server-side distance service so per_miles can auto-compute.
- **`by_move` move_events location filter** — still deferred, documented in `by_move` case comment by UI Plan B Phase 2.3 hardening.
- **Refactoring the AR `recalculate-charges.js` endpoint to USE the new diagnostic** — the existing endpoint stays as-is (apply charges, return count). The new endpoint is read-only and separate so the UI can call either independently.

---

## File Structure

**New files:**
- `pages/api/tenant/loads/[id]/recalculate-charges-diagnostic.js` — AR diagnostic tracer
- `docs/superpowers/plans/2026-04-15-plan-c-cowork-verification.md` — Cowork prompt

**Modified files:**
- `lib/pricing-uom.js` — add `per_pounds`, `per_miles`, `isWeightBased`, `isDistanceBased`, `applyWeightUom`, `applyDistanceUom`
- `lib/pricing-tier-resolver.js` — add weight + distance branches to `resolveAmountCents`, add `resolveRadiusTier` helper for `radius_rate` UOM
- `lib/tariff-engine.js` + `lib/driver-tariff-engine.js` — confirm `weight_lbs` + `actual_miles` flow through from the load object (no new hydration needed since SELECT * pulls everything)
- Both engines' scope-note JSDoc blocks — update to reflect Plan C landings

**Unchanged:**
- `lib/pricing-duration.js` — time only
- `pages/api/tenant/loads/[id]/recalculate-driver-pay.js` — AP diagnostic is the template; not modified by this plan

---

## Phase 1 — Weight + Distance UOM helpers

### Task 1.1: Extend `lib/pricing-uom.js` with weight + distance

**Files:** Modify `lib/pricing-uom.js`.

**Context:** The existing helper module only knows about time-based UOMs. Plan C adds two more families: weight-based (`per_pounds`) and distance-based (`per_miles` — `radius_rate` has its own resolver branch in the tier resolver, not here). Keep the same naming convention (`isXBased`, `applyXUom`) so the tier resolver dispatches cleanly.

- [ ] **Step 1: Read the current file**

`lib/pricing-uom.js` exports `isTimeBased`, `applyTimeUom`, `formatDuration`. Note the structure of `SECONDS_PER_UNIT`.

- [ ] **Step 2: Add weight + distance units**

After the `SECONDS_PER_UNIT` constant, add:

```javascript
// Pound-based UOMs — one unit per pound. If future plans add per_ton
// or per_kg, multiply through here (e.g. per_ton = 2000 lb per unit).
const POUNDS_PER_UNIT = {
  per_pounds: 1,
};

// Mile-based UOMs. per_road_toll_miles would go here once we have
// a toll-aware routing source (deferred to Plan D).
const MILES_PER_UNIT = {
  per_miles: 1,
};
```

- [ ] **Step 3: Add predicate helpers**

Below `isTimeBased`, add:

```javascript
/**
 * True if the UOM represents a rate that must be multiplied by load weight.
 */
export function isWeightBased(uom) {
  return Object.prototype.hasOwnProperty.call(POUNDS_PER_UNIT, uom);
}

/**
 * True if the UOM represents a rate that must be multiplied by load miles.
 * Excludes radius_rate — that one uses tiered pricing, not a flat multiplier.
 */
export function isDistanceBased(uom) {
  return Object.prototype.hasOwnProperty.call(MILES_PER_UNIT, uom);
}
```

- [ ] **Step 4: Add applier helpers**

Below `applyTimeUom`, add:

```javascript
/**
 * Apply a weight-based UOM. Rate is cents per unit (default: per pound).
 *
 * @param {number} amountCents — rate per unit (e.g. 250 = $2.50/lb)
 * @param {number} pounds — load weight in pounds
 * @param {string} uom — 'per_pounds' (extensible)
 * @param {number} freeUnits — free pounds (e.g. first 100 lbs free)
 * @returns {number} — total cents to bill; 0 if pounds is missing
 */
export function applyWeightUom(amountCents, pounds, uom, freeUnits = 0) {
  if (!isWeightBased(uom)) return amountCents;
  if (pounds == null || pounds <= 0) return 0; // fail-closed on missing weight
  const lbPerUnit = POUNDS_PER_UNIT[uom];
  const rawUnits = pounds / lbPerUnit;
  const billableUnits = Math.max(0, rawUnits - (freeUnits || 0));
  return Math.round(amountCents * billableUnits);
}

/**
 * Apply a distance-based UOM. Rate is cents per unit (default: per mile).
 *
 * @param {number} amountCents — rate per unit (e.g. 275 = $2.75/mi)
 * @param {number} miles — load distance in miles (from orders.actual_miles)
 * @param {string} uom — 'per_miles' (extensible)
 * @param {number} freeUnits — free miles (e.g. first 25 mi free)
 * @returns {number} — total cents to bill; 0 if miles is missing
 */
export function applyDistanceUom(amountCents, miles, uom, freeUnits = 0) {
  if (!isDistanceBased(uom)) return amountCents;
  if (miles == null || miles <= 0) return 0; // fail-closed on missing miles
  const miPerUnit = MILES_PER_UNIT[uom];
  const rawUnits = miles / miPerUnit;
  const billableUnits = Math.max(0, rawUnits - (freeUnits || 0));
  return Math.round(amountCents * billableUnits);
}
```

- [ ] **Step 5: Add formatters for diagnostic labels**

Below `formatDuration`, add:

```javascript
/**
 * Human-readable pounds label for diagnostics.
 * e.g. formatPounds(43500) → "43,500 lb"
 */
export function formatPounds(pounds) {
  if (pounds == null || pounds <= 0) return '0 lb';
  return `${Math.round(pounds).toLocaleString()} lb`;
}

/**
 * Human-readable distance label for diagnostics.
 * e.g. formatMiles(124.73) → "124.73 mi"
 */
export function formatMiles(miles) {
  if (miles == null || miles <= 0) return '0 mi';
  return `${Number(miles).toFixed(2)} mi`;
}
```

- [ ] **Step 6: Syntax check + commit**

```bash
node --check "C:/Users/bento/app-drayagedirect/lib/pricing-uom.js"
git add lib/pricing-uom.js
git commit -m "$(cat <<'EOF'
feat(pricing): add weight + distance UOM helpers

Extends lib/pricing-uom.js with the weight + distance families:
- isWeightBased / applyWeightUom for per_pounds
- isDistanceBased / applyDistanceUom for per_miles
- formatPounds / formatMiles for diagnostic labels

Fail-closed on missing inputs (weight or miles null/0 → 0 cents).
radius_rate stays out of this file — it uses tiered pricing, not a
flat multiplier; its resolver branch lives in pricing-tier-resolver.js.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase 2 — Tier resolver branches

### Task 2.1: Add `resolveRadiusTier` helper for radius_rate UOM

**Files:** Modify `lib/pricing-tier-resolver.js`.

**Context:** `radius_rate` is the only UOM that uses tiered pricing. A tier row has a `radius_tiers` JSONB array of `{amount_cents, start_distance, end_distance, rate_type, percentage_based_on}` entries. Given the load's `actual_miles`, pick the entry where `start_distance <= miles <= end_distance`, then apply the entry's `rate_type`:
- `fixed` → return `amount_cents` as-is
- `per_unit` → return `amount_cents * miles`
- `percentage` → flag for the percentage-resolution pass (same `percentage_based_on` mechanism already in the engines)

This helper is pure. It handles the radius-rate resolution; the outer `resolveAmountCents` dispatcher decides when to call it.

- [ ] **Step 1: Add the helper above `resolveAmountCents`**

Open `lib/pricing-tier-resolver.js`. Find the existing `legFromToEvent` helper (just above `resolveAmountCents`). Below `legFromToEvent`, add:

```javascript
/**
 * Resolve a radius_rate tier: walk the tier's radius_tiers JSONB array,
 * pick the entry whose distance range covers the load's actual_miles,
 * and compute the final cents.
 *
 * Returns { amount_cents, bracket_index } where bracket_index is -1 when
 * no bracket matched (miles out of every range, or missing). The caller
 * applies the per-profile minimum_amount_cents to the returned cents.
 *
 * The bracket's rate_type field selects the pricing formula:
 *   - fixed      → amount_cents as-is (flat bracket)
 *   - per_unit   → amount_cents * miles (per-mile within the bracket)
 *   - percentage → return amount_cents unchanged; the outer resolver's
 *                  percentage-pass will convert it after base charges
 *                  are matched (same mechanism as unit_of_measure=percentage).
 *
 * Schema: radius_tiers JSONB per tier, shape:
 *   [{ amount_cents, start_distance, end_distance, rate_type, percentage_based_on }]
 */
function resolveRadiusTier(tier, load) {
  const radiusTiers = Array.isArray(tier?.radius_tiers) ? tier.radius_tiers : [];
  const miles = Number(load?.actual_miles) || 0;
  if (radiusTiers.length === 0 || miles <= 0) {
    return { amount_cents: 0, bracket_index: -1 };
  }

  const idx = radiusTiers.findIndex((entry) => {
    const start = Number(entry?.start_distance) || 0;
    const end   = Number(entry?.end_distance);
    // Null end_distance means "open-ended" — the final bracket covers
    // any distance above its start.
    const inRange = miles >= start && (end == null || Number.isNaN(end) || miles <= end);
    return inRange;
  });

  if (idx < 0) {
    return { amount_cents: 0, bracket_index: -1 };
  }

  const entry = radiusTiers[idx];
  const cents = Number(entry.amount_cents) || 0;
  const rateType = entry.rate_type || 'fixed';

  if (rateType === 'per_unit') {
    return { amount_cents: Math.round(cents * miles), bracket_index: idx };
  }

  // 'fixed' and 'percentage' both return cents as-is here.
  // Percentage resolution happens in the outer engine's second pass.
  return { amount_cents: cents, bracket_index: idx };
}
```

- [ ] **Step 2: Verify syntax**

```bash
node --check "C:/Users/bento/app-drayagedirect/lib/pricing-tier-resolver.js"
```

(No commit yet — bundle with Task 2.2.)

---

### Task 2.2: Wire weight / distance / radius branches into `resolveAmountCents`

**Files:** Modify `lib/pricing-tier-resolver.js` (same file as Task 2.1).

- [ ] **Step 1: Update imports**

Find the top of `lib/pricing-tier-resolver.js`. Current imports:

```javascript
import { isTimeBased, applyTimeUom } from './pricing-uom';
import { computeDurationSeconds } from './pricing-duration';
```

Replace with:

```javascript
import {
  isTimeBased, applyTimeUom,
  isWeightBased, applyWeightUom,
  isDistanceBased, applyDistanceUom,
} from './pricing-uom';
import { computeDurationSeconds } from './pricing-duration';
```

- [ ] **Step 2: Add branches inside `resolveAmountCents`**

Find the existing `resolveAmountCents` function. The body currently has:

```javascript
  if (calculation_mode === 'between_statuses' && isTimeBased(unit_of_measure)) {
    // ... time branch ...
  }

  return {
    amount_cents: Math.max(baseCents, minCents),
    minimum_amount_cents: minCents,
    tier_id: tier.id,
    duration_seconds: 0,
  };
```

Between the time branch and the final `return`, insert three new branches:

```javascript
  if (isWeightBased(unit_of_measure)) {
    const pounds = Number(context?.load?.weight_lbs) || 0;
    const total = applyWeightUom(baseCents, pounds, unit_of_measure, freeUnits);
    return {
      amount_cents: Math.max(total, minCents),
      minimum_amount_cents: minCents,
      tier_id: tier.id,
      duration_seconds: 0,
      pounds,
    };
  }

  if (isDistanceBased(unit_of_measure)) {
    const miles = Number(context?.load?.actual_miles) || 0;
    const total = applyDistanceUom(baseCents, miles, unit_of_measure, freeUnits);
    return {
      amount_cents: Math.max(total, minCents),
      minimum_amount_cents: minCents,
      tier_id: tier.id,
      duration_seconds: 0,
      miles,
    };
  }

  if (unit_of_measure === 'radius_rate') {
    const { amount_cents, bracket_index } = resolveRadiusTier(tier, context?.load);
    return {
      amount_cents: Math.max(amount_cents, minCents),
      minimum_amount_cents: minCents,
      tier_id: tier.id,
      duration_seconds: 0,
      miles: Number(context?.load?.actual_miles) || 0,
      radius_bracket_index: bracket_index,
    };
  }
```

- [ ] **Step 3: Syntax + smoke grep**

```bash
cd "C:/Users/bento/app-drayagedirect"
node --check lib/pricing-tier-resolver.js
grep -c "isWeightBased\|isDistanceBased\|resolveRadiusTier" lib/pricing-tier-resolver.js
```

Expected grep count: 5 (isWeightBased def import + 1 call, isDistanceBased def import + 1 call, resolveRadiusTier def + 1 call = 6… recount based on actual line distribution).

- [ ] **Step 4: Commit**

```bash
git add lib/pricing-tier-resolver.js
git commit -m "$(cat <<'EOF'
feat(pricing): weight + distance + radius_rate tier resolution

Extends resolveAmountCents with three new branches:

- isWeightBased(uom) path (per_pounds): multiplies rate by load.weight_lbs
- isDistanceBased(uom) path (per_miles): multiplies rate by load.actual_miles
- radius_rate UOM path: walks tier.radius_tiers JSONB, picks the
  bracket where actual_miles falls in [start, end], applies rate_type
  (fixed / per_unit / percentage)

Both fail-closed on missing input (weight or miles null/0 → 0 cents).
radius_rate returns bracket_index so the diagnostic can report which
bracket won.

Payload additions (pounds, miles, radius_bracket_index) are
optional — existing callers that read only the core fields are
unaffected.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase 3 — AR diagnostic tracer endpoint

### Task 3.1: Create `recalculate-charges-diagnostic.js`

**Files:** Create `pages/api/tenant/loads/[id]/recalculate-charges-diagnostic.js`.

**Context:** The existing `recalculate-charges.js` endpoint applies charges and returns `{ applied: N }`. Troubleshooting why a customer tariff didn't match is blind. Mirror the AP diagnostic pattern: a read-only endpoint that runs the matcher + condition evaluator and returns a full tariff-by-tariff trace plus the would-be charge list — without writing anything.

Use `pages/api/tenant/loads/[id]/recalculate-driver-pay.js` as a template. Adapt to AR: no driver assignment checks, no `driver_groups`, customers instead of drivers. The matcher calls `findMatchingCharges` from `lib/tariff-engine.js` which already returns `tier_id` + `duration_seconds` + now `pounds` / `miles` / `radius_bracket_index`. Surface all of those in the `charges[]` response.

- [ ] **Step 1: Read the AP diagnostic to understand the shape**

```bash
grep -n "async function\|res.status\|diagnostic:" pages/api/tenant/loads/[id]/recalculate-driver-pay.js | head -20
```

Identify the three logical sections: (a) load + context fetch, (b) tariff-match trace function `diagnoseDriverTariffMatch`, (c) response assembly with `charges:` and `diagnostic:` fields.

- [ ] **Step 2: Create the new file**

Create `pages/api/tenant/loads/[id]/recalculate-charges-diagnostic.js` with:

```javascript
/**
 * Recalculate Charges Diagnostic — AR parity for AP's recalculate-driver-pay
 *
 * Read-only. Runs the customer-tariff matcher + condition evaluator and
 * returns a tariff-by-tariff trace PLUS the would-be charges list WITHOUT
 * writing anything to order_charge_sets / order_charge_set_line_items.
 *
 * Use case: dispatcher asks "why did my customer tariff not match this
 * load?" The existing recalculate-charges endpoint applies charges and
 * returns a count — this one explains.
 *
 * Shape mirrors recalculate-driver-pay.js response so the UI can share
 * rendering components between the two diagnostics.
 */

import { getServiceClient } from '../../../../../lib/supabase-service';
import { requireTenantAuth } from '../../../../../lib/auth';
import { findMatchingCharges } from '../../../../../lib/tariff-engine';
import { formatDuration, formatPounds, formatMiles } from '../../../../../lib/pricing-uom';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'method not allowed' });
  }

  const ctx = await requireTenantAuth(req, res);
  if (!ctx) return; // requireTenantAuth already sent response

  const { id } = req.query;
  if (!id) return res.status(400).json({ error: 'missing load id' });

  const svc = getServiceClient();

  // Load the order with the same shape the engine expects.
  const { data: load, error: loadErr } = await svc
    .from('orders')
    .select(`
      *,
      customer:customers!orders_customer_id_fkey(id, name),
      pickup_org:customers!orders_pickup_location_id_fkey(id, name, city, state, zip),
      delivery_org:customers!orders_delivery_location_id_fkey(id, name, city, state, zip),
      return_org:customers!orders_return_location_id_fkey(id, name, city, state, zip)
    `)
    .eq('tenant_id', ctx.tenantId)
    .eq('id', id)
    .maybeSingle();

  if (loadErr) return res.status(500).json({ error: `load fetch failed: ${loadErr.message}` });
  if (!load)    return res.status(404).json({ error: 'load not found' });

  // Build the would-be charges list WITHOUT applying them.
  const charges = await findMatchingCharges(svc, load, ctx.tenantId);

  // Build the tariff-match diagnostic trace. Mirrors
  // diagnoseDriverTariffMatch but against the AR tariffs table.
  const diagnostic = await diagnoseTariffMatch(svc, load, ctx.tenantId);

  return res.status(200).json({
    success: true,
    applied: 0,   // we don't apply anything in the diagnostic endpoint
    would_apply: charges.length,
    charges: charges.map((c) => ({
      name: c.name,
      charge_name: c.charge_name,
      unit_of_measure: c.unit_of_measure,
      calculation_mode: c.calculation_mode,
      amount_cents: c.amount_cents,
      minimum_amount_cents: c.minimum_amount_cents,
      source: c.source,
      tier_id: c.tier_id || null,
      duration_seconds: c.duration_seconds || 0,
      duration_label: c.duration_seconds ? formatDuration(c.duration_seconds) : null,
      pounds: c.pounds || 0,
      pounds_label: c.pounds ? formatPounds(c.pounds) : null,
      miles: c.miles || 0,
      miles_label: c.miles ? formatMiles(c.miles) : null,
      radius_bracket_index: c.radius_bracket_index ?? null,
    })),
    diagnostic,
    message: charges.length > 0
      ? `${charges.length} charge${charges.length !== 1 ? 's' : ''} would be applied`
      : 'No matching charges — see diagnostic for reason',
  });
}

/**
 * Run each active customer tariff against the load; return an array with
 * { tariff_id, tariff_name, status, checks: [...], matched } for every tariff.
 *
 * Checks mirror the AR matcher in lib/tariff-engine.js:
 *   status, date_range, customer, load_type, pickup_location,
 *   delivery_location, return_location, container_type, container_size,
 *   ssl, chassis_type, chassis_size, and every flag check.
 */
async function diagnoseTariffMatch(svc, load, tenantId) {
  const today = new Date().toISOString().slice(0, 10);

  const { data: tariffs } = await svc
    .from('tariffs')
    .select('*')
    .eq('tenant_id', tenantId)
    .order('priority', { ascending: false });

  const results = [];

  for (const t of tariffs || []) {
    const checks = [];
    let matched = true;

    // Status
    if (t.status !== 'active') {
      checks.push({ check: 'status', pass: false, detail: `status="${t.status}" (must be "active")` });
      matched = false;
    } else {
      checks.push({ check: 'status', pass: true });
    }

    // Date range
    if (t.effective_start && t.effective_start > today) {
      checks.push({ check: 'date_range', pass: false, detail: `starts ${t.effective_start}, today is ${today}` });
      matched = false;
    } else if (t.effective_end && t.effective_end < today) {
      checks.push({ check: 'date_range', pass: false, detail: `ended ${t.effective_end}, today is ${today}` });
      matched = false;
    } else {
      checks.push({ check: 'date_range', pass: true });
    }

    // Customer scope
    if (t.customer_ids?.length > 0) {
      const matchCustomer = t.customer_ids.includes(load.customer_id);
      if (!matchCustomer) {
        checks.push({
          check: 'customer',
          pass: false,
          detail: `load customer = "${load.customer?.name || load.customer_id}", tariff requires one of [${t.customer_ids.length} ids]`,
        });
        matched = false;
      } else {
        checks.push({ check: 'customer', pass: true, detail: load.customer?.name || load.customer_id });
      }
    } else {
      checks.push({ check: 'customer', pass: true, detail: 'all customers' });
    }

    // Load type
    if (t.load_types?.length > 0) {
      const lt = (load.load_type || '').toLowerCase();
      const allowed = t.load_types.map((x) => x.toLowerCase());
      if (!allowed.includes(lt)) {
        checks.push({ check: 'load_type', pass: false, detail: `load="${lt}", tariff allows [${allowed.join(', ')}]` });
        matched = false;
      } else {
        checks.push({ check: 'load_type', pass: true, detail: lt });
      }
    } else {
      checks.push({ check: 'load_type', pass: true, detail: 'all load types' });
    }

    // Pickup / Delivery / Return location checks
    for (const field of ['pickup', 'delivery', 'return']) {
      const cond = t[`${field}_conditions`];
      const loadOrg = load[`${field}_org`];
      const loadId = load[`${field}_location_id`];
      if (cond && !cond.all && cond.ids?.length > 0) {
        if (!cond.ids.includes(loadId)) {
          const labels = cond.ids.map((uid) => cond.labels?.[uid] || uid).join(', ');
          checks.push({
            check: `${field}_location`,
            pass: false,
            detail: `load ${field} = "${loadOrg?.name || '—'}", tariff requires [${labels}]`,
          });
          matched = false;
        } else {
          checks.push({ check: `${field}_location`, pass: true, detail: loadOrg?.name || loadId });
        }
      } else {
        checks.push({ check: `${field}_location`, pass: true, detail: `all ${field} locations` });
      }
    }

    // Equipment
    if (t.container_type && t.container_type !== load.container_type) {
      checks.push({ check: 'container_type', pass: false, detail: `load="${load.container_type || '(empty)'}", tariff="${t.container_type}"` });
      matched = false;
    } else {
      checks.push({ check: 'container_type', pass: true });
    }
    if (t.container_size && t.container_size !== load.container_size) {
      checks.push({ check: 'container_size', pass: false, detail: `load="${load.container_size || '(empty)'}", tariff="${t.container_size}"` });
      matched = false;
    } else {
      checks.push({ check: 'container_size', pass: true });
    }
    if (t.ssl_id && t.ssl_id !== load.container_owner_id) {
      checks.push({ check: 'ssl', pass: false, detail: 'SSL mismatch' });
      matched = false;
    } else {
      checks.push({ check: 'ssl', pass: true });
    }
    if (t.chassis_type && t.chassis_type !== load.chassis_type) {
      checks.push({ check: 'chassis_type', pass: false, detail: `load="${load.chassis_type || '(empty)'}"` });
      matched = false;
    } else {
      checks.push({ check: 'chassis_type', pass: true });
    }
    if (t.chassis_size && t.chassis_size !== load.chassis_size) {
      checks.push({ check: 'chassis_size', pass: false, detail: `load="${load.chassis_size || '(empty)'}"` });
      matched = false;
    } else {
      checks.push({ check: 'chassis_size', pass: true });
    }

    // Flags
    const flagFields = [
      'is_hazmat', 'is_overweight', 'is_liquor', 'is_hot', 'is_genset',
      'is_overheight', 'is_scale', 'is_ev', 'is_street_turn',
      'is_oog', 'is_bonded', 'is_double', 'is_tanker',
    ];
    for (const flag of flagFields) {
      if (t[flag] === true && !load[flag]) {
        checks.push({ check: flag, pass: false, detail: `tariff requires ${flag}=true, load=false` });
        matched = false;
        break;
      }
    }

    results.push({
      tariff_id: t.id,
      tariff_name: t.name,
      priority: t.priority || 0,
      status: t.status,
      checks,
      matched,
    });
  }

  const winning = results.find((r) => r.matched);

  return {
    total_tariffs: results.length,
    tariffs: results,
    winning_tariff_id: winning?.tariff_id || null,
    winning_tariff_name: winning?.tariff_name || null,
  };
}
```

- [ ] **Step 2: Verify + commit**

```bash
cd "C:/Users/bento/app-drayagedirect"
node --check "pages/api/tenant/loads/[id]/recalculate-charges-diagnostic.js"
git add "pages/api/tenant/loads/[id]/recalculate-charges-diagnostic.js"
git commit -m "$(cat <<'EOF'
feat(pricing): AR diagnostic tracer endpoint

New read-only POST /api/tenant/loads/[id]/recalculate-charges-diagnostic
that mirrors the AP recalculate-driver-pay shape. Runs findMatchingCharges
+ an AR tariff-by-tariff condition trace, returns the would-be charges
list AND the full match/no-match reasoning per tariff. Does NOT write
to order_charge_sets — explicitly read-only.

Surfaces the new Plan C payload fields (pounds, miles,
radius_bracket_index + human-readable labels) alongside the Plan A
fields (tier_id, duration_seconds, duration_label).

Dispatcher workflow: answers "why didn't my customer tariff match?"
without needing to bounce through the DB. Same shape as AP so the UI
viewer modal can render either diagnostic with shared components.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase 4 — AP diagnostic also surfaces new payload fields

### Task 4.1: Extend AP diagnostic to include pounds / miles / radius_bracket_index

**Files:** Modify `pages/api/tenant/loads/[id]/recalculate-driver-pay.js`.

**Context:** The AP diagnostic was extended in Plan A to surface `tier_id` + `duration_seconds` + `duration_label`. Plan C's resolver now emits additional payload fields (`pounds`, `miles`, `radius_bracket_index`) on matching charges — need to surface those too so driver-pay diagnostics can explain "$247.50 = $2.75/mi × 90 mi" the same way they explain "3h 30m × $75/hr".

- [ ] **Step 1: Update the import**

Find the existing import for `formatDuration` from `lib/pricing-uom`. Extend to:

```javascript
import { formatDuration, formatPounds, formatMiles } from '../../../../../lib/pricing-uom';
```

- [ ] **Step 2: Extend the charges mapper**

Find the `charges: charges.map((c) => ({ ... }))` block. Current fields: name, charge_name, unit_of_measure, amount_cents, minimum_amount_cents, source, tier_id, duration_seconds, duration_label. Add:

```javascript
      pounds: c.pounds || 0,
      pounds_label: c.pounds ? formatPounds(c.pounds) : null,
      miles: c.miles || 0,
      miles_label: c.miles ? formatMiles(c.miles) : null,
      radius_bracket_index: c.radius_bracket_index ?? null,
```

- [ ] **Step 3: Verify + commit**

```bash
node --check "pages/api/tenant/loads/[id]/recalculate-driver-pay.js"
git add "pages/api/tenant/loads/[id]/recalculate-driver-pay.js"
git commit -m "$(cat <<'EOF'
feat(pricing): surface pounds / miles / radius bracket in AP diagnostic

The resolver now emits pounds / miles / radius_bracket_index on
charges whose unit_of_measure is per_pounds, per_miles, or radius_rate.
Pass-through in the AP diagnostic response so the driver-pay viewer
modal can explain per-pound/per-mile resolved amounts the same way
it explains per-hour durations.

Shape parity with the new AR diagnostic (Task 3.1).

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase 5 — Documentation + Cowork prompt

### Task 5.1: Update engine scope notes

**Files:** Modify `lib/tariff-engine.js`, `lib/driver-tariff-engine.js`.

- [ ] **Step 1: AR scope block**

Find the JSDoc scope block `Scope notes (last updated 2026-04-15, Plan B)`. Replace:

```javascript
/**
 * Scope notes (last updated 2026-04-15, Plan C):
 *
 *   Implemented calculation modes:  between_statuses (with per_hour / per_day /
 *                                   per_Nmin UOMs), by_lane, by_event (with
 *                                   location filter: org / city_state / zip),
 *                                   by_move.
 *   Implemented UOMs:               fixed, percentage, per_hour, per_day,
 *                                   per_15/30/45min, per_pounds, per_miles,
 *                                   radius_rate (with tiered brackets).
 *   Implemented endpoints:          POST .../recalculate-charges (applies),
 *                                   POST .../recalculate-charges-diagnostic
 *                                   (read-only tariff trace + would-be charges).
 *   Deferred (Plan D):              per_road_toll_miles (toll-aware routing),
 *                                   profile_group location type (schema work),
 *                                   server-side distance calc (orders.actual_miles
 *                                   read directly for now).
 */
```

- [ ] **Step 2: AP scope block**

Same pattern. Replace with:

```javascript
/**
 * Scope notes (last updated 2026-04-15, Plan C):
 *
 *   Implemented calculation modes:  between_statuses, by_event (with location
 *                                   filter), by_move, by_leg (with from + to
 *                                   location filters).
 *   Implemented UOMs:               fixed, percentage (incl. ar_invoice +
 *                                   driver_pay), per_hour, per_day, per_15/30/45min,
 *                                   per_pounds, per_miles, radius_rate.
 *   Deferred (Plan D):              oo_benchmark data source, profile_group
 *                                   location type, by_move move_events location
 *                                   filter, per_road_toll_miles.
 */
```

- [ ] **Step 3: Commit**

```bash
git add lib/tariff-engine.js lib/driver-tariff-engine.js
git commit -m "$(cat <<'EOF'
docs(pricing): update engine scope notes after Plan C

Weight + distance + radius_rate UOMs shipped for both engines in
Phase 2. AR gained a diagnostic tracer endpoint. Both scope blocks
now call out which calc modes + UOMs + endpoints are implemented vs.
deferred to Plan D.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 5.2: Write Cowork verification prompt

**Files:** Create `docs/superpowers/plans/2026-04-15-plan-c-cowork-verification.md`.

- [ ] **Step 1: Write the verification prompt**

Write the file with four scenarios:

**C1 — per_pounds:** Create a profile with `unit_of_measure=per_pounds`, tier `amount_cents=50` ($0.50/lb). Load with `weight_lbs=40000`. Expect `amount_cents: 2000000` ($20,000), `pounds: 40000`, `pounds_label: "40,000 lb"`.

**C2 — per_miles:** Create a profile with `unit_of_measure=per_miles`, tier `amount_cents=275` ($2.75/mi). Load with `actual_miles=90`. Expect `amount_cents: 24750` ($247.50), `miles: 90`, `miles_label: "90.00 mi"`. Also: a load with `actual_miles=null` should return `amount_cents: 0` (fail-closed).

**C3 — radius_rate:** Create a profile with `unit_of_measure=radius_rate`, tier's `radius_tiers` JSONB = `[{start_distance: 0, end_distance: 50, amount_cents: 10000, rate_type: 'fixed'}, {start_distance: 50, end_distance: 150, amount_cents: 200, rate_type: 'per_unit'}, {start_distance: 150, end_distance: null, amount_cents: 30000, rate_type: 'fixed'}]`. Three test loads with `actual_miles` = 30, 75, 200 respectively. Expect:
- 30 mi → bracket 0 (fixed $100) → `amount_cents: 10000`, `radius_bracket_index: 0`
- 75 mi → bracket 1 (per_unit $2/mi × 75) → `amount_cents: 15000`, `radius_bracket_index: 1`
- 200 mi → bracket 2 (fixed $300, open-ended) → `amount_cents: 30000`, `radius_bracket_index: 2`

**C4 — AR diagnostic tracer:** POST to `/api/tenant/loads/[id]/recalculate-charges-diagnostic` on a load. Response must include `diagnostic.tariffs` array (every tariff with `checks[]` + `matched` bool), `diagnostic.winning_tariff_id`, and `charges[]` with `tier_id` + `pounds/miles/duration` payload. `applied: 0` confirms nothing was written.

- [ ] **Step 2: Commit the prompt**

```bash
git add docs/superpowers/plans/2026-04-15-plan-c-cowork-verification.md
git commit -m "$(cat <<'EOF'
docs(pricing): Cowork verification prompt for Plan C

Four scenarios: per_pounds (C1), per_miles with null fallback (C2),
radius_rate tiered brackets (C3), AR diagnostic tracer parity (C4).
Plus a regression sweep of Plan A and Plan B scenarios.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Verification Summary

After every task:

1. 8 commits on main — `git log --oneline <last-plan-b>..HEAD` shows them.
2. `node --check` clean on all touched files.
3. Cowork runs the four scenarios and reports back.
4. No regression on Plan A or Plan B scenarios (backward compatibility).

## Integration Notes

- **Plan D** (deferred): `oo_benchmark` data source, `profile_group` schema + UI, `per_road_toll_miles` with toll-aware routing service, server-side distance calc (so `per_miles` can compute on demand instead of depending on client-populated `actual_miles`).
- **Customer-visible effect of Plan C:**
  - Per-pound freight rates actually multiply by weight. Pre-Plan-C they returned the stored rate flat (a silent wrong answer).
  - Per-mile rates actually multiply by distance (when distance has been computed and cached).
  - Radius-bracketed pricing actually picks the right bracket. A "0-50 mi flat $100, 50-150 mi $2/mi, 150+ mi flat $300" configuration finally produces three distinct amounts.
  - AR-side tariff troubleshooting no longer requires DB access — dispatchers get the same kind of "why didn't it match?" trace that AP has had since Plan A.
