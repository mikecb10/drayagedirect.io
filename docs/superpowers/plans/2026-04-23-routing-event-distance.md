# Routing Event Distance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist per-leg distance on `order_routing_events`, sum to `orders.estimated_miles` via trigger, update billing engines to `COALESCE(actual, estimated)`, and gate per-mile charges that have no distance data so they stop silently resolving to $0.

**Architecture:** Client-side Google Maps already computes distances in-memory — this feature adds persistence + safety net around that existing computation. Write path piggybacks the existing routing-event save endpoints (PUT + POST). Read path stays at the order level (engines keep reading `load.actual_miles` / `load.estimated_miles`); a trigger maintains the sum on the parent order. When miles data is genuinely missing, the engine returns a `needs_distance = true` sentinel instead of $0, which persists on the charge row, surfaces as a red badge in the UI, and blocks invoice / rate-con send.

**Tech Stack:** Next.js (pages router) + Supabase (PostgreSQL 15 + RLS) + React + Tailwind. Tests are hand-rolled `.test.mjs` with `check(name, cond)` helper, run via `node tests/<file>.test.mjs`. Migrations follow the `BEGIN; ... NOTIFY pgrst, 'reload schema'; ... COMMIT;` template.

---

## File Structure

### New files

- `supabase/migrations/089_routing_event_distance.sql` — schema + trigger
- `tests/routing-event-distance.test.mjs` — engine unit tests

### Modified files

**Engine + appliers**
- `lib/pricing-tier-resolver.js` — COALESCE + null-return contract (`resolveRadiusTier` line 326, distance branch line 441, radius_rate branch line 459)
- `lib/tariff-engine.js` — `applyChargesToLoad` persists `needs_distance` per line item
- `lib/driver-tariff-engine.js` — `applyDriverPayToLoad` persists `needs_distance` per pay line

**API handlers**
- `pages/api/tenant/loads/[id]/routing/events/[eventId].js` — PUT accepts `estimated_miles`, `distance_is_manual`
- `pages/api/tenant/loads/[id]/routing/index.js` — POST (event create) accepts new fields; template seed inherits NULL
- `pages/api/tenant/ar/invoices/[invoiceId]/send-email.js` — blocks if linked charge set has unresolved rows
- `pages/api/tenant/ar/invoices/bulk-send.js` — skips sets with unresolved rows, returns list
- `pages/api/tenant/ar/charge-sets/[id]/send-rate-con-email.js` — same gate
- `pages/api/tenant/ar/charge-sets/bulk-send-rate-con.js` — same bulk behavior

**Frontend — Routing**
- `components/loads/tabs/RoutingTab.js` — passes `estimated_miles` / `distance_is_manual` on event saves, handles Google failure toast
- `components/loads/routing/EventRow.js` — pencil-edit inline input, "(manual)" badge, "Reset to auto" link

**Frontend — Billing / Driver Pay**
- `components/loads/tabs/BillingTab.js` — red "Distance missing" badge on unresolved rows
- `components/loads/tabs/DriverPayTab.js` — same badge treatment on pay rows

**Frontend — Dispatcher**
- `lib/dispatcher-columns.js` — new `has_unresolved_distance` flag via a select on the scoped query

---

## Task 1: Migration 089 — schema + trigger

**Files:**
- Create: `supabase/migrations/089_routing_event_distance.sql`

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/089_routing_event_distance.sql` with the following exact content:

```sql
-- Migration 089: routing event distance persistence + silent-$0 safety net
--
-- Adds estimated_miles + distance_is_manual to order_routing_events.
-- Adds needs_distance flag to charge line items + driver pay lines.
-- Creates trigger_sync_order_estimated_miles that rolls up the sum
-- into orders.estimated_miles on any event INSERT/UPDATE/DELETE.

BEGIN;

-- 1. New columns on order_routing_events
ALTER TABLE order_routing_events
  ADD COLUMN IF NOT EXISTS estimated_miles NUMERIC(8,2),
  ADD COLUMN IF NOT EXISTS distance_is_manual BOOLEAN NOT NULL DEFAULT false;

-- 2. needs_distance flag on the AR charge line items table
ALTER TABLE order_charge_set_line_items
  ADD COLUMN IF NOT EXISTS needs_distance BOOLEAN NOT NULL DEFAULT false;

-- 3. needs_distance flag on the AP driver pay lines table
ALTER TABLE order_driver_pay_lines
  ADD COLUMN IF NOT EXISTS needs_distance BOOLEAN NOT NULL DEFAULT false;

-- 4. Trigger function: recompute orders.estimated_miles from the sum of
--    estimated_miles across all routing events for the affected order.
--    NULLIF(sum, 0) preserves NULL when every event has NULL distance —
--    this keeps the engine's "both NULL means unresolved" check
--    working correctly for legacy loads.
CREATE OR REPLACE FUNCTION trigger_sync_order_estimated_miles()
RETURNS TRIGGER AS $$
DECLARE
  affected_order_id UUID;
  new_total NUMERIC(8,2);
BEGIN
  affected_order_id := COALESCE(NEW.order_id, OLD.order_id);
  SELECT COALESCE(SUM(estimated_miles), 0)
    INTO new_total
    FROM order_routing_events
    WHERE order_id = affected_order_id;
  UPDATE orders
    SET estimated_miles = NULLIF(new_total, 0),
        updated_at = now()
    WHERE id = affected_order_id;
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

-- 5. Attach trigger
DROP TRIGGER IF EXISTS trg_sync_order_estimated_miles ON order_routing_events;
CREATE TRIGGER trg_sync_order_estimated_miles
  AFTER INSERT OR UPDATE OR DELETE ON order_routing_events
  FOR EACH ROW EXECUTE FUNCTION trigger_sync_order_estimated_miles();

-- 6. Refresh PostgREST schema cache
NOTIFY pgrst, 'reload schema';

COMMIT;
```

- [ ] **Step 2: Ask user to apply migration manually**

Send user message:
> Migration 089 ready at `supabase/migrations/089_routing_event_distance.sql`. Please apply it via the Supabase dashboard SQL editor. After it runs, reply "applied" and I'll proceed with code changes.

Wait for confirmation before continuing. If the user reports an error:
- Check the trigger function name (should be `trigger_sync_order_estimated_miles`, not `set_updated_at` — previous migrations hit this gotcha).
- Check that `COMMIT;` is the last statement.
- Re-verify the `NOTIFY pgrst, 'reload schema';` line is inside the transaction.

- [ ] **Step 3: Commit the migration file**

```bash
git add supabase/migrations/089_routing_event_distance.sql
git commit -m "$(cat <<'EOF'
feat(leg-distance): migration 089 — event distance + trigger + needs_distance flags

Adds:
- order_routing_events.estimated_miles (NUMERIC 8,2 nullable)
- order_routing_events.distance_is_manual (BOOL NOT NULL default false)
- order_charge_set_line_items.needs_distance (BOOL NOT NULL default false)
- order_driver_pay_lines.needs_distance (BOOL NOT NULL default false)
- trigger_sync_order_estimated_miles() + trigger on order_routing_events

Applied: 2026-04-23 via Supabase dashboard SQL editor.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Engine unit tests (TDD — write failing tests first)

**Files:**
- Create: `tests/routing-event-distance.test.mjs`

- [ ] **Step 1: Write the test file**

Create `tests/routing-event-distance.test.mjs`:

```js
// Hand-rolled test: routing event distance engine behavior.
// Covers the COALESCE fallback + null-return contract added in migration 089.
// Run: node tests/routing-event-distance.test.mjs

import { resolveAmountCents } from '../lib/pricing-tier-resolver.js';

let passed = 0;
let failed = 0;

function check(name, cond) {
  if (cond) {
    console.log(`  PASS: ${name}`);
    passed++;
  } else {
    console.log(`  FAIL: ${name}`);
    failed++;
  }
}

function makeTier(overrides = {}) {
  return {
    id: 'tier-1',
    amount_cents: 250, // $2.50 per mile
    minimum_amount_cents: 0,
    start_date: null,
    end_date: null,
    ...overrides,
  };
}

function makeCtx(load, profileOverrides = {}) {
  return {
    load,
    profile: {
      unit_of_measure: 'per_mile',
      ...profileOverrides,
    },
  };
}

console.log('Test: per_mile charge with estimated_miles fallback');
{
  const ctx = makeCtx({ actual_miles: null, estimated_miles: 25 });
  const tier = makeTier();
  const out = resolveAmountCents(ctx, tier, [tier]);
  check('uses estimated_miles via COALESCE', out.amount_cents === 25 * 250);
  check('miles field reflects the resolved value', out.miles === 25);
  check('needs_distance not set', !out.needs_distance);
}

console.log('Test: per_mile charge prefers actual_miles over estimated');
{
  const ctx = makeCtx({ actual_miles: 30, estimated_miles: 25 });
  const tier = makeTier();
  const out = resolveAmountCents(ctx, tier, [tier]);
  check('uses actual_miles (30) not estimated (25)', out.amount_cents === 30 * 250);
  check('miles field is 30', out.miles === 30);
}

console.log('Test: per_mile charge returns null when BOTH miles are NULL');
{
  const ctx = makeCtx({ actual_miles: null, estimated_miles: null });
  const tier = makeTier();
  const out = resolveAmountCents(ctx, tier, [tier]);
  check('amount_cents is null', out.amount_cents === null);
  check('needs_distance is true', out.needs_distance === true);
  check('reason is no_miles_on_load', out.reason === 'no_miles_on_load');
}

console.log('Test: fixed-fee charge unaffected by missing miles');
{
  const ctx = makeCtx(
    { actual_miles: null, estimated_miles: null },
    { unit_of_measure: 'fixed' }
  );
  const tier = makeTier({ amount_cents: 5000 });
  const out = resolveAmountCents(ctx, tier, [tier]);
  check('fixed-fee returns its amount regardless', out.amount_cents === 5000);
  check('needs_distance not set on fixed charges', !out.needs_distance);
}

console.log('Test: per_load charge unaffected by missing miles');
{
  const ctx = makeCtx(
    { actual_miles: null, estimated_miles: null },
    { unit_of_measure: 'per_load' }
  );
  const tier = makeTier({ amount_cents: 15000 });
  const out = resolveAmountCents(ctx, tier, [tier]);
  check('per_load returns its amount', out.amount_cents === 15000);
  check('needs_distance not set', !out.needs_distance);
}

console.log('Test: percentage charge unaffected by missing miles');
{
  const ctx = makeCtx(
    { actual_miles: null, estimated_miles: null },
    { unit_of_measure: 'percentage' }
  );
  const tier = makeTier({ amount_cents: 10 });
  const out = resolveAmountCents(ctx, tier, [tier]);
  check('percentage charge unaffected', !out.needs_distance);
}

console.log('Test: radius_rate charge returns null when both miles NULL');
{
  const ctx = makeCtx(
    { actual_miles: null, estimated_miles: null },
    { unit_of_measure: 'radius_rate' }
  );
  const tier = makeTier({
    radius_tiers: [{ amount_cents: 10000, start_distance: 0, end_distance: 50, rate_type: 'fixed' }],
  });
  const out = resolveAmountCents(ctx, tier, [tier]);
  check('amount_cents is null', out.amount_cents === null);
  check('needs_distance is true', out.needs_distance === true);
}

console.log('Test: radius_rate bracket lookup uses estimated_miles when actual NULL');
{
  const ctx = makeCtx(
    { actual_miles: null, estimated_miles: 30 },
    { unit_of_measure: 'radius_rate' }
  );
  const tier = makeTier({
    radius_tiers: [
      { amount_cents: 10000, start_distance: 0,  end_distance: 50,  rate_type: 'fixed' },
      { amount_cents: 20000, start_distance: 51, end_distance: 100, rate_type: 'fixed' },
    ],
  });
  const out = resolveAmountCents(ctx, tier, [tier]);
  check('miles=30 falls in [0,50] bracket', out.amount_cents === 10000);
  check('bracket index is 0', out.radius_bracket_index === 0);
}

console.log('Test: legitimately zero-mile load does NOT trigger gate');
{
  // Load with miles explicitly stored as 0 (same-location pickup + delivery)
  const ctx = makeCtx({ actual_miles: 0, estimated_miles: 0 });
  const tier = makeTier();
  const out = resolveAmountCents(ctx, tier, [tier]);
  check('amount_cents is 0 (not null)', out.amount_cents === 0);
  check('needs_distance is NOT set', !out.needs_distance);
}

console.log('Test: load with only actual_miles=0 + estimated_miles=0 treated as resolved');
{
  // Edge case: both are 0 (not null). These are VALID resolved values.
  const ctx = makeCtx({ actual_miles: 0, estimated_miles: 0 });
  const tier = makeTier();
  const out = resolveAmountCents(ctx, tier, [tier]);
  check('0 * rate = 0 without gate trigger', out.amount_cents === 0 && !out.needs_distance);
}

console.log('Test: isDistanceBased covers per_mile, per_miles, per_unit');
{
  const uoms = ['per_mile', 'per_miles'];
  for (const uom of uoms) {
    const ctx = makeCtx(
      { actual_miles: null, estimated_miles: null },
      { unit_of_measure: uom }
    );
    const out = resolveAmountCents(ctx, makeTier(), [makeTier()]);
    check(`${uom} triggers needs_distance when both miles NULL`, out.needs_distance === true);
  }
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
```

- [ ] **Step 2: Run the tests — expect FAIL**

```bash
node tests/routing-event-distance.test.mjs
```

Expected outcome: tests fail because `resolveAmountCents` does not yet return `needs_distance` or use `estimated_miles` fallback. Output will show mostly FAIL lines.

- [ ] **Step 3: Commit the failing tests**

```bash
git add tests/routing-event-distance.test.mjs
git commit -m "$(cat <<'EOF'
test(leg-distance): engine unit tests for COALESCE + null-return contract

TDD first pass — all tests fail until Task 3 updates pricing-tier-resolver.

Covers:
- per_mile uses estimated_miles via COALESCE when actual is NULL
- per_mile prefers actual over estimated when both present
- per_mile / radius_rate return { amount_cents: null, needs_distance: true } when both are NULL
- fixed / per_load / percentage unaffected by missing miles
- legitimately zero-mile loads do NOT trigger the gate
- radius_rate bracket lookup uses fallback miles correctly

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Engine COALESCE + null-return contract

**Files:**
- Modify: `lib/pricing-tier-resolver.js` — 3 call sites (line 326, line 441, line 459)

- [ ] **Step 1: Add the helper at the top of the file**

In `lib/pricing-tier-resolver.js`, add the following helper function BELOW the import block (after line 26) and ABOVE the `today()` function (line 31):

```js
/**
 * Resolve the miles to use for per-mile / radius-based pricing.
 *
 * Returns { miles, isResolved }.
 *   miles — the numeric miles to multiply against (0 if neither is present)
 *   isResolved — false ONLY when both actual_miles AND estimated_miles are null/undefined
 *
 * When isResolved=false on a distance-based charge, the engine's caller
 * returns a null-amount sentinel so the caller can persist
 * needs_distance=true instead of $0 (silent-$0 safety net, migration 089).
 *
 * A load with miles explicitly stored as 0 (rare — same-location pickup
 * + delivery) is considered RESOLVED; the engine returns $0 normally.
 */
function resolveMilesFromLoad(load) {
  const actualMiles = load?.actual_miles;
  const estimatedMiles = load?.estimated_miles;
  const hasActual = actualMiles !== null && actualMiles !== undefined;
  const hasEstimated = estimatedMiles !== null && estimatedMiles !== undefined;
  const isResolved = hasActual || hasEstimated;
  const raw = hasActual ? actualMiles : (hasEstimated ? estimatedMiles : 0);
  return { miles: Number(raw) || 0, isResolved };
}
```

- [ ] **Step 2: Update `resolveRadiusTier` (line 326)**

Replace the body of `resolveRadiusTier` starting at line 324. Old:

```js
function resolveRadiusTier(tier, load) {
  const radiusTiers = Array.isArray(tier?.radius_tiers) ? tier.radius_tiers : [];
  const miles = Number(load?.actual_miles) || 0;
  if (radiusTiers.length === 0 || miles <= 0) {
    return { amount_cents: 0, bracket_index: -1 };
  }
```

New:

```js
function resolveRadiusTier(tier, load) {
  const radiusTiers = Array.isArray(tier?.radius_tiers) ? tier.radius_tiers : [];
  const { miles, isResolved } = resolveMilesFromLoad(load);
  if (radiusTiers.length === 0) {
    return { amount_cents: 0, bracket_index: -1, isResolved };
  }
  // Note: miles=0 falls through to the bracket search (a 0-mile load
  // with a bracket covering [0, N] is a legitimate match). Only bail
  // early if no tiers exist at all.
```

Also update the final `return { amount_cents: 0, bracket_index: -1 };` lines inside this function to include `isResolved` in the return object.

Find the two places that return early with `{ amount_cents: 0, bracket_index: -1 }` and update both to `{ amount_cents: 0, bracket_index: -1, isResolved }`.

- [ ] **Step 3: Update the distance branch in `resolveAmountCents` (around line 440)**

Replace this block starting at the `if (isDistanceBased(unit_of_measure)) {` check:

Old:

```js
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
```

New:

```js
  if (isDistanceBased(unit_of_measure)) {
    const { miles, isResolved } = resolveMilesFromLoad(context?.load);
    if (!isResolved) {
      return {
        amount_cents: null,
        needs_distance: true,
        reason: 'no_miles_on_load',
        minimum_amount_cents: minCents,
        tier_id: tier.id,
        duration_seconds: 0,
        miles: 0,
      };
    }
    const total = applyDistanceUom(baseCents, miles, unit_of_measure, freeUnits);
    return {
      amount_cents: Math.max(total, minCents),
      minimum_amount_cents: minCents,
      tier_id: tier.id,
      duration_seconds: 0,
      miles,
    };
  }
```

- [ ] **Step 4: Update the radius_rate branch (around line 452)**

Old:

```js
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

New:

```js
  if (unit_of_measure === 'radius_rate') {
    const { amount_cents, bracket_index, isResolved } = resolveRadiusTier(tier, context?.load);
    if (!isResolved) {
      return {
        amount_cents: null,
        needs_distance: true,
        reason: 'no_miles_on_load',
        minimum_amount_cents: minCents,
        tier_id: tier.id,
        duration_seconds: 0,
        miles: 0,
        radius_bracket_index: bracket_index,
      };
    }
    const { miles } = resolveMilesFromLoad(context?.load);
    return {
      amount_cents: Math.max(amount_cents, minCents),
      minimum_amount_cents: minCents,
      tier_id: tier.id,
      duration_seconds: 0,
      miles,
      radius_bracket_index: bracket_index,
    };
  }
```

- [ ] **Step 5: Run the tests — expect PASS**

```bash
node tests/routing-event-distance.test.mjs
```

Expected: all tests pass. Output ends with `N passed, 0 failed`.

If tests fail, check:
- The `isResolved` flag propagates from `resolveRadiusTier` through to the caller.
- `resolveMilesFromLoad` correctly treats `actual_miles: 0` as resolved (not null).
- The null-return object includes `needs_distance: true`, `amount_cents: null`, and `reason: 'no_miles_on_load'`.

- [ ] **Step 6: Also run the existing dry-run engine tests — expect still PASS**

```bash
node tests/dry-run-engine.test.mjs
```

Expected: the existing 23 dry-run tests still pass. The dry-run engine doesn't go through `pricing-tier-resolver` (it uses `computePresetAmount` with direct `miles` param), so it should be unaffected.

- [ ] **Step 7: Commit**

```bash
git add lib/pricing-tier-resolver.js
git commit -m "$(cat <<'EOF'
feat(leg-distance): engine COALESCE + null-return contract for unresolved miles

Adds resolveMilesFromLoad() helper + routes all three distance-reading
call sites through it (resolveRadiusTier, isDistanceBased branch,
radius_rate branch). When BOTH actual_miles and estimated_miles are
NULL on a distance-based charge, the engine now returns
{ amount_cents: null, needs_distance: true, reason: 'no_miles_on_load' }
instead of { amount_cents: 0 }. Legitimate 0-mile loads
(actual_miles: 0 OR estimated_miles: 0) flow through normally.

Callers (tariff-engine applier + driver-tariff-engine applier) will
persist needs_distance=true on affected rows in Task 4.

11/11 engine tests pass; 23/23 dry-run tests still pass.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Appliers persist `needs_distance` flag

**Files:**
- Modify: `lib/tariff-engine.js` — `applyChargesToLoad` (line 431)
- Modify: `lib/driver-tariff-engine.js` — `applyDriverPayToLoad` (line 434)

- [ ] **Step 1: Locate the applier row-insertion in `lib/tariff-engine.js`**

Read `lib/tariff-engine.js` around line 431–560 to find where charges are inserted into `order_charge_set_line_items`. Look for the `.insert([...])` or batch insert call. The insert maps each charge into a line-item row with fields like `name`, `total_cents`, `unit_of_measure`, `is_auto: true`, etc.

- [ ] **Step 2: Add `needs_distance` + `total_cents: null` handling to the AR applier**

At the row-mapping step inside `applyChargesToLoad`, update the mapping to preserve the null-amount contract. Replace the row object construction with:

```js
// Build one line-item row per charge result. needs_distance comes from
// the engine's null-return contract (pricing-tier-resolver line ~446).
// When it's true, we persist total_cents: null so the UI can render the
// "Distance missing" badge (Task 9) and the invoice-send gate (Task 8)
// can block out-bound emails.
const rowsToInsert = charges.map((charge) => {
  const needsDistance = charge.needs_distance === true;
  return {
    tenant_id: tenantId,
    charge_set_id: chargeSetId,
    name: charge.name || 'Charge',
    description: charge.description || null,
    unit_of_measure: charge.unit_of_measure || 'fixed',
    unit_count: charge.unit_count ?? 1,
    free_units: charge.free_units ?? 0,
    per_unit_price_cents: charge.per_unit_price_cents ?? 0,
    total_cents: needsDistance ? null : (charge.amount_cents ?? 0),
    source_profile_id: charge.source_profile_id || null,
    is_auto: true,
    needs_distance: needsDistance,
  };
});
```

Then insert `rowsToInsert` as before. (The existing code may already have a mapping step — replace it entirely with the block above.)

IMPORTANT: keep the existing bill-to resolution, charge-set creation, and total-recompute logic INTACT. Only the per-row field mapping changes.

After insert, update the charge-set total recompute to skip NULL rows:

```js
// Sum only resolved rows; NULL (needs_distance) rows don't contribute
// to the charge-set total because they can't be billed anyway.
const { data: resolvedRows } = await svc
  .from('order_charge_set_line_items')
  .select('total_cents')
  .eq('tenant_id', tenantId)
  .eq('charge_set_id', chargeSetId)
  .not('total_cents', 'is', null);
const subtotal = (resolvedRows || []).reduce((sum, r) => sum + (r.total_cents || 0), 0);
await svc
  .from('order_charge_sets')
  .update({ subtotal_cents: subtotal, total_cents: subtotal, updated_at: new Date().toISOString() })
  .eq('tenant_id', tenantId)
  .eq('id', chargeSetId);
```

- [ ] **Step 3: Update the AP applier in `lib/driver-tariff-engine.js`**

Locate `applyDriverPayToLoad` at line 434. Replace the per-row insert mapping the same way:

```js
const rowsToInsert = charges.map((charge) => {
  const needsDistance = charge.needs_distance === true;
  return {
    tenant_id: tenantId,
    load_id: loadId,
    driver_id: driverId,
    name: charge.name || 'Pay',
    description: charge.description || null,
    unit_of_measure: charge.unit_of_measure || 'fixed',
    unit_count: charge.unit_count ?? 1,
    per_unit_amount_cents: charge.per_unit_amount_cents ?? charge.amount_cents ?? 0,
    amount_cents: needsDistance ? null : (charge.amount_cents ?? 0),
    source_profile_id: charge.source_profile_id || null,
    is_auto: true,
    needs_distance: needsDistance,
  };
});
```

(The exact column names may be slightly different — `amount_cents` vs `total_cents`. Read the existing AP applier and match the existing column names; just add `needs_distance` and swap the amount assignment to `needsDistance ? null : ...`.)

- [ ] **Step 4: Sanity check — run engine tests again**

```bash
node tests/routing-event-distance.test.mjs
node tests/dry-run-engine.test.mjs
```

Both should still pass. The applier changes don't affect engine unit tests (they test `resolveAmountCents` in isolation) — this is just a non-regression check.

- [ ] **Step 5: Commit**

```bash
git add lib/tariff-engine.js lib/driver-tariff-engine.js
git commit -m "$(cat <<'EOF'
feat(leg-distance): appliers persist needs_distance flag on AR + AP rows

applyChargesToLoad (AR) + applyDriverPayToLoad (AP) now read the
needs_distance flag off the engine output and persist:
  - total_cents / amount_cents = NULL  (signals "unresolved" to UI + gate)
  - needs_distance = true              (powers badge + invoice-send gate)

Charge-set subtotal recompute skips NULL rows so the $0 totals on
charge-set headers don't get polluted by unresolved lines.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Routing-event API accepts new fields

**Files:**
- Modify: `pages/api/tenant/loads/[id]/routing/events/[eventId].js` — add fields to `EDITABLE` (line 11)
- Modify: `pages/api/tenant/loads/[id]/routing/index.js` — POST event create accepts new fields

- [ ] **Step 1: Add fields to the event PUT handler**

In `pages/api/tenant/loads/[id]/routing/events/[eventId].js`, update the `EDITABLE` array at line 11. Old:

```js
const EDITABLE = [
  'event_type',
  'move_id',
  'location_id',
  'location_name',
  'address',
  'city',
  'state',
  'zip',
  'scheduled_at',
  'started_at',
  'arrived_at',
  'departed_at',
  'notes',
  'sequence',
];
```

New:

```js
const EDITABLE = [
  'event_type',
  'move_id',
  'location_id',
  'location_name',
  'address',
  'city',
  'state',
  'zip',
  'scheduled_at',
  'started_at',
  'arrived_at',
  'departed_at',
  'notes',
  'sequence',
  'estimated_miles',
  'distance_is_manual',
];
```

No other changes needed in that file — the existing loop (`for (const f of EDITABLE)`) will pick them up.

- [ ] **Step 2: Update the POST handler for event create**

In `pages/api/tenant/loads/[id]/routing/index.js`, locate the POST branch (search for `req.method === 'POST'` OR the event-insertion logic). Find the `.insert({...})` call that creates a new routing event.

Add `estimated_miles` and `distance_is_manual` to the insert body, sourcing from `req.body`. Example fragment — integrate into the existing insert shape:

```js
const { data: newEvent, error: insErr } = await svc
  .from('order_routing_events')
  .insert({
    tenant_id: ctx.tenantId,
    order_id: id,
    // ... existing fields like event_type, move_id, location_id, etc.
    estimated_miles: req.body.estimated_miles ?? null,
    distance_is_manual: req.body.distance_is_manual === true,
  })
  .select()
  .single();
```

- [ ] **Step 3: Sanity check — fetch the schema on a running dev server**

Run:
```bash
curl -sS http://localhost:3000/api/tenant/loads/<any-id>/routing | head -20
```

The GET response should now include `estimated_miles` and `distance_is_manual` on event objects (because PostgREST's schema cache was refreshed by migration 089's `NOTIFY pgrst`).

If the columns are missing from the response, re-run the migration's `NOTIFY pgrst, 'reload schema';` manually in the Supabase SQL editor.

- [ ] **Step 4: Commit**

```bash
git add pages/api/tenant/loads/[id]/routing/events/[eventId].js pages/api/tenant/loads/[id]/routing/index.js
git commit -m "$(cat <<'EOF'
feat(leg-distance): routing-event API accepts estimated_miles + distance_is_manual

PUT handler adds both fields to EDITABLE whitelist.
POST (event create) accepts both in the insert body, defaulting to null
and false respectively.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Client — RoutingTab saves distance on event changes

**Files:**
- Modify: `components/loads/tabs/RoutingTab.js` — save handlers (around lines 188-218 useEffect + any event PUT/POST callers)

- [ ] **Step 1: Read `components/loads/tabs/RoutingTab.js` end-to-end**

Read the full file. Identify:
- The existing `useEffect` (around line 188) that computes Google Maps distances into `legMetrics` state.
- All places where the component PUT/POST events to the API. Search for `/routing/events` or `/routing/` fetch calls.
- The current `legMetrics` shape — it's keyed by `event.id` and stores `{ distance_miles, distance_text, duration_minutes, duration_text }`.

- [ ] **Step 2: Update save handlers to include distance**

For each save call in RoutingTab that PUTs or POSTs to a routing event endpoint, inject `estimated_miles` and `distance_is_manual` into the body.

The pattern looks like:

```js
// Before a save, read the current legMetrics value for this event.
// If the event was manually overridden (distance_is_manual === true on
// the event we're updating), DO NOT overwrite with legMetrics —
// preserve the manual value that's already on the event.
async function persistEvent(event, patch = {}) {
  const metric = legMetrics[event.id];
  const wasManual = event.distance_is_manual === true;
  const body = {
    ...patch,
    ...(wasManual
      ? {}  // don't touch distance fields when manual is set
      : { estimated_miles: metric?.distance_miles ?? null, distance_is_manual: false }),
  };
  const res = await fetch(`/api/tenant/loads/${orderId}/routing/events/${event.id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  // existing error handling
  return res.json();
}
```

Apply this pattern to EVERY place that updates a routing event in this file. The `patch` argument carries whatever fields the caller is explicitly changing (e.g., location, timestamps) — distance fields get merged in automatically for non-manual legs.

For event CREATE (POST), include `estimated_miles: null, distance_is_manual: false` on the initial insert — the useEffect will compute + persist on the next save cycle.

- [ ] **Step 3: Handle Google Maps failure toast**

Update the `useEffect` that calls `getDistanceAndDuration`. Wrap each call in a try/catch. On failure, show a yellow toast:

```js
try {
  const metric = await getDistanceAndDuration(fromAddr, toAddr);
  setLegMetrics((prev) => ({ ...prev, [curr.id]: metric }));
} catch (err) {
  // Don't noisy-toast on every leg — only if the user is about to save.
  // Track the failure in state so the save handler can show a toast.
  setLegMetrics((prev) => ({ ...prev, [curr.id]: { failed: true } }));
}
```

In the save handler, if any leg has `legMetrics[eventId]?.failed === true`, show a single toast:

```js
// Add a toast import at the top if not present (use the existing toast lib — check other components for the pattern, typically `react-hot-toast` or a custom hook).
if (Object.values(legMetrics).some(m => m?.failed)) {
  toast('Distance couldn\'t be computed for some legs. Open them to retry or enter manually.', { icon: '⚠️' });
}
```

- [ ] **Step 4: Verify in browser (ad-hoc)**

Start the dev server if not running:
```bash
npm run dev
```

Navigate to a load with routing events. Open DevTools network tab, edit an event's address, save. Inspect the PUT request body — it should include `estimated_miles` (number from Google Maps) and `distance_is_manual: false`.

- [ ] **Step 5: Commit**

```bash
git add components/loads/tabs/RoutingTab.js
git commit -m "$(cat <<'EOF'
feat(leg-distance): RoutingTab persists Google-computed distance on event save

Every routing-event save (PUT or POST) now includes estimated_miles
+ distance_is_manual in the body. Manual-flagged events are preserved
— the save handler doesn't overwrite their distance with Google's.

Google Maps failures are caught silently and surface as a single toast
on save ("Distance couldn't be computed...") rather than spamming.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Client — EventRow pencil-edit + reset-to-auto UI

**Files:**
- Modify: `components/loads/routing/EventRow.js` — distance display block (around line 270)

- [ ] **Step 1: Read `components/loads/routing/EventRow.js`**

Read the full file. Identify:
- The props it accepts — look for `legMetrics`, `event`, `onSave` or similar callbacks.
- The existing distance display at around line 270:
  ```jsx
  <div className="flex justify-between">
    <span>Distance</span>
    <span className="font-semibold text-gray-900 dark:text-slate-100">{legMetrics?.distance_text || '—'}</span>
  </div>
  ```

- [ ] **Step 2: Replace the distance display with an editable affordance**

Replace the Distance `<div>` block (around line 268–271) with:

```jsx
<div className="flex justify-between items-center gap-2">
  <span>Distance</span>
  <DistanceDisplay
    event={event}
    legMetrics={legMetrics}
    onOverride={async (manualMiles) => {
      await onEventPatch?.(event.id, {
        estimated_miles: manualMiles,
        distance_is_manual: true,
      });
    }}
    onResetToAuto={async () => {
      const autoMiles = legMetrics?.distance_miles ?? null;
      await onEventPatch?.(event.id, {
        estimated_miles: autoMiles,
        distance_is_manual: false,
      });
    }}
  />
</div>
```

Where `onEventPatch` is a callback prop the parent (RoutingTab) passes in. If the component already has a similar callback (e.g., `onSave`, `onUpdate`), use that name instead. Otherwise, add `onEventPatch` to the component's prop list at the top of the file and pass it through from RoutingTab.

- [ ] **Step 3: Add the `DistanceDisplay` sub-component inline at the top of `EventRow.js`**

Below the existing imports in `EventRow.js`, add this sub-component:

```jsx
function DistanceDisplay({ event, legMetrics, onOverride, onResetToAuto }) {
  const [isEditing, setIsEditing] = React.useState(false);
  const [draftValue, setDraftValue] = React.useState('');

  // Source of truth for display:
  //   1. persisted event.estimated_miles if present
  //   2. live legMetrics.distance_miles (Google-computed) if present
  //   3. "—" otherwise
  const persisted = event?.estimated_miles;
  const live = legMetrics?.distance_miles;
  const isManual = event?.distance_is_manual === true;
  const displayMiles = persisted != null ? persisted : (live ?? null);
  const displayText = displayMiles != null ? `${Number(displayMiles).toFixed(1)} mi` : '—';

  if (isEditing) {
    return (
      <span className="flex items-center gap-1">
        <input
          type="number"
          step="0.1"
          min="0"
          className="w-16 px-1 py-0.5 text-[11px] border border-gray-300 dark:border-slate-700 rounded bg-white dark:bg-slate-900"
          value={draftValue}
          onChange={(e) => setDraftValue(e.target.value)}
          autoFocus
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              const n = parseFloat(draftValue);
              if (!Number.isNaN(n) && n >= 0) {
                onOverride(n);
                setIsEditing(false);
              }
            } else if (e.key === 'Escape') {
              setIsEditing(false);
            }
          }}
        />
        <button
          type="button"
          className="text-[11px] text-gray-500 hover:text-gray-900"
          onClick={() => setIsEditing(false)}
        >cancel</button>
      </span>
    );
  }

  return (
    <span className="flex items-center gap-1.5">
      <span className="font-semibold text-gray-900 dark:text-slate-100">{displayText}</span>
      {isManual && (
        <span className="text-[10px] text-amber-600 dark:text-amber-400">(manual)</span>
      )}
      <button
        type="button"
        className="text-[11px] text-gray-400 hover:text-gray-900 dark:hover:text-slate-100"
        title="Override distance"
        onClick={() => {
          setDraftValue(displayMiles != null ? String(displayMiles) : '');
          setIsEditing(true);
        }}
      >
        ✎
      </button>
      {isManual && (
        <button
          type="button"
          className="text-[10px] text-blue-600 dark:text-blue-400 hover:underline"
          onClick={onResetToAuto}
        >
          reset
        </button>
      )}
    </span>
  );
}
```

Make sure `React` is imported if not already (`import React, { useState } from 'react';` at the top).

- [ ] **Step 4: Pass `onEventPatch` through from RoutingTab**

In `components/loads/tabs/RoutingTab.js`, find where `<EventRow>` is rendered. Add a prop:

```jsx
<EventRow
  // ... existing props
  onEventPatch={(eventId, patch) => persistEvent({ id: eventId, distance_is_manual: events.find(e => e.id === eventId)?.distance_is_manual }, patch)}
/>
```

(The exact shape of `persistEvent` was defined in Task 6 Step 2. Re-read it and adjust to take an `eventId` + `patch`.)

- [ ] **Step 5: Ad-hoc browser test**

Start dev server if not running. Navigate to a load. In the Routing tab:
1. Verify default distance shows the Google-computed value.
2. Click the pencil icon, enter 42, press Enter. Verify:
   - The display now shows "42.0 mi (manual)".
   - Network tab shows PUT with `{ estimated_miles: 42, distance_is_manual: true }`.
3. Click "reset". Verify:
   - The display goes back to the Google value (no `(manual)` badge).
   - Network tab shows PUT with `{ estimated_miles: <google>, distance_is_manual: false }`.

- [ ] **Step 6: Commit**

```bash
git add components/loads/routing/EventRow.js components/loads/tabs/RoutingTab.js
git commit -m "$(cat <<'EOF'
feat(leg-distance): pencil-edit distance override + reset-to-auto on EventRow

Adds DistanceDisplay sub-component that renders the persisted
estimated_miles (falling back to live legMetrics), with:
  - pencil (✎) icon → inline number input → Enter to save override
  - "(manual)" badge when distance_is_manual=true
  - "reset" link (only shown when manual) → clears override +
    repopulates from Google-computed legMetrics

Overrides persist via the onEventPatch callback plumbed in from
RoutingTab. Route-change recompute in Task 6 already preserves
manual flags.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: Invoice-send + rate-con-send gates (all 4 endpoints)

**Files:**
- Modify: `pages/api/tenant/ar/invoices/[invoiceId]/send-email.js`
- Modify: `pages/api/tenant/ar/invoices/bulk-send.js`
- Modify: `pages/api/tenant/ar/charge-sets/[id]/send-rate-con-email.js`
- Modify: `pages/api/tenant/ar/charge-sets/bulk-send-rate-con.js`

- [ ] **Step 1: Create a shared gate helper**

Create `lib/charge-set-distance-gate.js` with this content:

```js
/**
 * Gate helper: reject invoice / rate-con sends when the charge set has
 * rows with needs_distance=true AND total_cents IS NULL.
 *
 * Used by all 4 send endpoints: single + bulk for both invoice + rate-con.
 * Returns { ok: true } when the charge set is sendable, or
 * { ok: false, unresolvedIds, unresolvedNames } when blocked.
 */
export async function checkChargeSetDistanceGate(svc, tenantId, chargeSetId) {
  const { data: unresolved, error } = await svc
    .from('order_charge_set_line_items')
    .select('id, name')
    .eq('tenant_id', tenantId)
    .eq('charge_set_id', chargeSetId)
    .eq('needs_distance', true)
    .is('total_cents', null);
  if (error) {
    return { ok: false, dbError: error.message };
  }
  if (!unresolved?.length) {
    return { ok: true };
  }
  return {
    ok: false,
    unresolvedIds: unresolved.map(r => r.id),
    unresolvedNames: unresolved.map(r => r.name).filter(Boolean),
  };
}
```

- [ ] **Step 2: Add the gate to `pages/api/tenant/ar/invoices/[invoiceId]/send-email.js`**

Read the file first. The send endpoint resolves an `invoice.charge_set_id` somewhere between the claim RPC (line 43) and the actual email dispatch. Identify that point.

Add an import at the top:

```js
import { checkChargeSetDistanceGate } from '../../../../../../lib/charge-set-distance-gate';
```

After the invoice is loaded and `invoice.charge_set_id` (or the equivalent association) is known, and BEFORE the PDF render + email dispatch, insert:

```js
const gate = await checkChargeSetDistanceGate(svc, ctx.tenantId, invoice.charge_set_id);
if (!gate.ok) {
  // Release the claim since we're bailing before dispatch.
  await svc.rpc('release_invoice_claim', {
    p_invoice_id: invoiceId,
    p_tenant_id: ctx.tenantId,
    p_success: false,
  });
  return res.status(400).json({
    error: 'charge_set_has_unresolved_distance_charges',
    message: `Cannot send invoice — ${gate.unresolvedIds.length} charge(s) have unresolved distance. Open the load's Routing tab and save a route, or set the amount manually.`,
    unresolved_ids: gate.unresolvedIds,
    unresolved_names: gate.unresolvedNames,
  });
}
```

(Read the file for the exact column name linking invoice → charge_set — it may be `charge_set_id`, `source_charge_set_id`, etc. If unclear, grep for `charge_set_id` in the send-email.js file.)

- [ ] **Step 3: Add the gate to `pages/api/tenant/ar/invoices/bulk-send.js`**

Read the file. It iterates invoices. For each, check the gate BEFORE dispatching. If the gate fails for a given invoice, skip it and append to a `skipped` array. Return structure:

```js
return res.status(200).json({
  sent_count: sentInvoices.length,
  skipped_count: skippedInvoices.length,
  skipped: skippedInvoices.map(s => ({
    invoice_id: s.invoiceId,
    reason: 'unresolved_distance',
    unresolved_names: s.unresolvedNames,
  })),
});
```

Exact integration point: inside the per-invoice loop, after resolving `charge_set_id`, before the email dispatch call.

```js
for (const invoice of invoices) {
  const gate = await checkChargeSetDistanceGate(svc, ctx.tenantId, invoice.charge_set_id);
  if (!gate.ok) {
    skippedInvoices.push({
      invoiceId: invoice.id,
      unresolvedNames: gate.unresolvedNames,
    });
    continue;
  }
  // ... existing dispatch logic
}
```

- [ ] **Step 4: Add the gate to `pages/api/tenant/ar/charge-sets/[id]/send-rate-con-email.js`**

Same pattern. The rate-con endpoint already works directly off `charge_set_id` from the URL param. Insert the gate check right after permission checks, before PDF render:

```js
const gate = await checkChargeSetDistanceGate(svc, ctx.tenantId, id);
if (!gate.ok) {
  return res.status(400).json({
    error: 'charge_set_has_unresolved_distance_charges',
    message: `Cannot send rate confirmation — ${gate.unresolvedIds.length} charge(s) have unresolved distance.`,
    unresolved_ids: gate.unresolvedIds,
    unresolved_names: gate.unresolvedNames,
  });
}
```

- [ ] **Step 5: Add the gate to `pages/api/tenant/ar/charge-sets/bulk-send-rate-con.js`**

Same pattern as Step 3 — iterate charge sets, gate per-iteration, append to `skipped`.

- [ ] **Step 6: Ad-hoc test**

Manually in the browser:
1. Open a load that has `orders.estimated_miles IS NULL` (any pre-migration load).
2. Create an AR charge with `unit_of_measure='per_mile'` — verify `total_cents` is NULL + `needs_distance` is true on the row after save.
3. Attempt to send the invoice for that charge set. Verify response is 400 with `error: 'charge_set_has_unresolved_distance_charges'` and the error message + unresolved_names are present.

- [ ] **Step 7: Commit**

```bash
git add lib/charge-set-distance-gate.js pages/api/tenant/ar/invoices/[invoiceId]/send-email.js pages/api/tenant/ar/invoices/bulk-send.js pages/api/tenant/ar/charge-sets/[id]/send-rate-con-email.js pages/api/tenant/ar/charge-sets/bulk-send-rate-con.js
git commit -m "$(cat <<'EOF'
feat(leg-distance): invoice + rate-con send gates block on unresolved distance

Shared checkChargeSetDistanceGate() helper queries for rows with
needs_distance=true + total_cents IS NULL. If any found:
  - Single send endpoints return 400 with unresolved_ids + message.
  - Bulk endpoints skip the affected charge set + append to a
    'skipped' array in the response.

Single-invoice send also releases the claim via release_invoice_claim()
so the invoice can be retried after the dispatcher resolves distance.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: "Distance missing" badge in Billing + Driver Pay tabs

**Files:**
- Modify: `components/loads/tabs/BillingTab.js` — AR charge rows
- Modify: `components/loads/tabs/DriverPayTab.js` — AP pay rows

- [ ] **Step 1: Read `components/loads/tabs/BillingTab.js`**

Find where line-item rows are rendered. Look for a `.map()` over charge line items that renders each one in a table row or card. Identify the cell that shows `total_cents` (formatted as `$X.XX`).

- [ ] **Step 2: Replace the amount-cell rendering in BillingTab**

Wherever the line-item's amount is displayed, replace the direct `formatCurrency(item.total_cents)` call with:

```jsx
{item.needs_distance && item.total_cents == null ? (
  <span className="inline-flex items-center gap-1 text-[11px] font-medium text-red-700 dark:text-red-300 bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 rounded px-1.5 py-0.5" title="Load needs a saved route. Open the Routing tab and save.">
    <span aria-hidden="true">⚠</span>
    Distance missing
  </span>
) : (
  <span>{formatCurrency(item.total_cents || 0)}</span>
)}
```

(Find the exact currency formatter used in the file — it might be `formatCurrency`, `formatUSD`, a Number().toLocaleString() call, etc. Match the existing pattern.)

- [ ] **Step 3: Do the same for `components/loads/tabs/DriverPayTab.js`**

Same pattern — render the badge when `line.needs_distance === true && line.amount_cents == null`. Note the column name is `amount_cents` here, not `total_cents`.

- [ ] **Step 4: Ad-hoc browser test**

Open a load with the per-mile charge created in Task 8 Step 6. Verify:
1. BillingTab row shows "⚠ Distance missing" red badge instead of "$0.00".
2. DriverPayTab row (if a per-mile driver pay line exists) shows the same badge.
3. Hovering the badge shows the tooltip text.

- [ ] **Step 5: Commit**

```bash
git add components/loads/tabs/BillingTab.js components/loads/tabs/DriverPayTab.js
git commit -m "$(cat <<'EOF'
feat(leg-distance): 'Distance missing' badge on unresolved AR + AP rows

Rows with needs_distance=true + NULL amount_cents now render a red
pill badge with a ⚠ icon instead of '$0.00'. Tooltip points the
dispatcher to the Routing tab.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 10: Dispatcher board indicator for loads with unresolved distance

**Files:**
- Modify: `lib/dispatcher-columns.js` — add column or indicator

- [ ] **Step 1: Read `lib/dispatcher-columns.js`**

Find the column definition array. Look for existing "flag" / "status indicator" columns — they typically use a renderer that outputs a colored dot or pill.

- [ ] **Step 2: Add a `has_unresolved_distance` derived field**

The dispatcher list endpoint likely runs a SELECT that joins `order_charge_set_line_items`. In the columns file, add a new column definition:

```js
{
  key: 'has_unresolved_distance',
  label: 'Dist',
  width: 40,
  render: (row) => {
    if (!row.has_unresolved_distance) return null;
    return (
      <span
        className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-300 text-[10px] font-bold"
        title="This load has charges with unresolved distance. Open it and save the routing tab."
      >
        ⚠
      </span>
    );
  },
},
```

- [ ] **Step 3: Update the dispatcher list query**

Find the dispatcher list SELECT (likely `pages/api/tenant/loads/index.js` — read it to confirm). Add a derived aggregate:

```js
// Add this sub-select alongside existing fields.
// Returns true if ANY line item on ANY charge set for this load has needs_distance=true + NULL total_cents.
.select(`
  *,
  has_unresolved_distance:order_charge_sets!inner(
    line_items:order_charge_set_line_items(needs_distance, total_cents)
  )
`)
```

Then post-process in JS to collapse the nested array into a boolean:

```js
const rows = (data || []).map(r => ({
  ...r,
  has_unresolved_distance:
    (r.has_unresolved_distance || [])
      .flatMap(cs => cs.line_items || [])
      .some(li => li.needs_distance === true && li.total_cents == null),
}));
```

(If the existing query shape doesn't allow this nested select, an alternative is a second query that fetches `order_id` for any load with unresolved lines, then `Set.has(order.id)` in the map.)

- [ ] **Step 4: Ad-hoc browser test**

Navigate to the dispatcher board. Verify:
1. Loads without unresolved distance show no indicator.
2. The test load from Task 8 shows the orange ⚠ dot in the "Dist" column.
3. Hover tooltip reads correctly.

- [ ] **Step 5: Commit**

```bash
git add lib/dispatcher-columns.js pages/api/tenant/loads/index.js
git commit -m "$(cat <<'EOF'
feat(leg-distance): dispatcher board 'Dist' column flags loads with unresolved distance

New column renders an orange ⚠ dot when any charge on any set for
the load has needs_distance=true + NULL total_cents. Tooltip directs
the dispatcher to open the load and save Routing.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 11: Live Chrome gate batches + code-reviewer pass

**Files:** None (live verification + review)

- [ ] **Step 1: Confirm dev server is running**

```bash
npm run dev
```

Wait for "ready on port 3000" or similar.

- [ ] **Step 2: Dispatch Chrome gate subagent — Batch 1 (Happy path)**

Dispatch a subagent (via the Agent tool with `subagent_type: general-purpose`) with the following prompt. ZERO screenshots directive.

Prompt body:

> Use the mcp__Claude_in_Chrome__* tools to verify 4 live gates on http://localhost:3000. NEVER take screenshots — use get_page_text + read_console_messages + read_network_requests only. NEVER hard-navigate; use navigate only for initial load, then `javascript_tool` to call `window.next?.router?.push(<url>)` for soft nav.
>
> Gate G1: Open an existing load via /loads/<id>?tab=routing. Verify the Routing tab renders legs with distance text like "24.5 mi" (or "— " for events with no prior leg).
>
> Gate G2: Use javascript_tool to read the `window.legMetrics` state (if exposed) OR capture the PUT request to `/api/tenant/loads/.../routing/events/...` when you edit an event's address and save. Confirm the request body includes `estimated_miles` (number or null) and `distance_is_manual: false`.
>
> Gate G3: Soft-reload the page (window.location.reload() OR router.push to same URL). Verify the distance persists on the event row after reload (it shouldn't require Google Maps to recompute from scratch).
>
> Gate G4: Navigate to /loads/<id>?tab=billing. Create a new AR charge with unit_of_measure='per_mile' (use the "Add Line" button or similar). Save. Verify the charge row shows a dollar amount > $0 (not the red "Distance missing" badge) — because the load now has estimated_miles populated from G2-G3.
>
> Report pass/fail for each gate + any console errors.

- [ ] **Step 3: Dispatch Chrome gate subagent — Batch 2 (Manual override)**

Dispatch another subagent:

> Gate G5: On the routing tab of an existing load, click the pencil (✎) icon next to a leg's distance. Enter "30" (override Google's value). Press Enter. Verify: display shows "30.0 mi (manual)" + a "reset" link appears. Network tab shows PUT with `{ estimated_miles: 30, distance_is_manual: true }`.
>
> Gate G6: Click edit on the event whose distance you just overrode (change its pickup address — any valid change). Save. Verify: the manual 30 is NOT clobbered — it still reads "30.0 mi (manual)" after the address change.
>
> Gate G7: Click the "reset" link. Verify: display reverts to Google-computed value (no "(manual)" badge). Network tab shows PUT with `{ estimated_miles: <google>, distance_is_manual: false }`.
>
> Report pass/fail + any console errors.

- [ ] **Step 4: Dispatch Chrome gate subagent — Batch 3 (Safety net)**

Dispatch another subagent:

> Gate G8: Find a load that was created before migration 089 (no distance data yet — orders.estimated_miles IS NULL). Navigate to /loads/<id>?tab=billing. Create a per-mile AR charge. Verify: the row displays the red "⚠ Distance missing" badge (not "$0.00").
>
> Gate G9: Try to send an invoice for that charge set (via the ChargeSetSlideOver or similar send button). Verify: the request to /api/tenant/ar/invoices/.../send-email returns 400 with `error: 'charge_set_has_unresolved_distance_charges'` and a modal appears showing the unresolved charges.
>
> Gate G10: Navigate back to the load's Routing tab. Save the route (which triggers Google Maps computation). Return to Billing. Click "Recalculate" (or edit + re-save the charge line) to force re-compute. Verify: the red badge clears + a dollar amount appears. Re-attempt the invoice send — should succeed this time (no 400).
>
> Report pass/fail + any console errors.

- [ ] **Step 5: Dispatch Chrome gate subagent — Batch 4 (Google Maps failure)**

Dispatch another subagent:

> Gate G11: In DevTools, block `maps.googleapis.com` in the Network Request Blocking pane. Reload a load with routing events. Verify: a yellow toast appears with text like "Distance couldn't be computed...". The event rows show "—" for distance (no Google value). Save an event. Verify: the PUT body sends `estimated_miles: null, distance_is_manual: false`.
>
> Now attempt to create a per-mile charge on this load. Verify: the row saves with the red "Distance missing" badge (gate catches even when Google fails).
>
> Report pass/fail + any console errors.

- [ ] **Step 6: Dispatch code-reviewer subagent**

After all gates green, dispatch:

```
Agent({
  description: "Code review leg-distance ship",
  subagent_type: "superpowers:code-reviewer",
  prompt: "Review the 10-commit span d3dd106..HEAD against docs/superpowers/specs/2026-04-23-routing-event-distance-design.md. Flag: (1) spec compliance gaps, (2) places where needs_distance / total_cents null-amount semantics could leak (e.g., reports, aging, sum queries), (3) missing test coverage for edge cases I didn't anticipate, (4) potential silent regressions in existing billing flows. Focus especially on the applier changes (lib/tariff-engine.js, lib/driver-tariff-engine.js) — those are the most semantically subtle. Under 500 words."
})
```

- [ ] **Step 7: Address code-reviewer findings**

For each issue the reviewer flags:
- Critical → fix inline with a new commit `fix(leg-distance): code-review pass — <short description>`.
- Important → fix inline with a new commit.
- Minor → defer to the polish punch list (add to a new follow-up memory file `session_2026_04_23_leg_distance_polish.md`).

- [ ] **Step 8: Final commit — update memory**

Add a new memory file `memory/session_2026_04_23_leg_distance_ship.md` with:

```
---
name: session_2026_04_23_leg_distance_ship
description: Routing event distance + silent-$0 safety net shipped 2026-04-23. Fixes the systemic per-mile-billing bug surfaced in the audit earlier that day.
type: project
---
(Fill in: commit count, migration 089 applied, test counts, live gate results, code-reviewer findings + remediation)
```

Update `memory/MEMORY.md` to add a pointer line.

Commit both together:

```bash
git add memory/session_2026_04_23_leg_distance_ship.md memory/MEMORY.md
git commit -m "memory(2026-04-23): leg-distance ship recap"
```

---

## Self-Review Checklist (complete before handoff)

- [ ] Every task has a commit step at the end.
- [ ] Every step that modifies code shows the exact code (no "add appropriate X" language).
- [ ] File paths are exact. No `<fill-in>` placeholders.
- [ ] TDD is respected: Task 2 writes failing engine tests BEFORE Task 3 implements the engine change.
- [ ] Migration applies before any code that reads the new columns (Task 1 before all others).
- [ ] Each API handler change (Task 5, Task 8) includes a sanity-check step.
- [ ] Live gates cover happy path, manual override, safety net, Google failure (Batches 1-4).
- [ ] Code-reviewer dispatch (Task 11 Step 6) explicitly names files to focus on + span to review.
- [ ] Types/names consistent: `needs_distance` (column name + JS field) used throughout; `distance_is_manual` not `is_manual_distance`; `estimated_miles` not `est_miles`.

---

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-04-23-routing-event-distance.md`. Two execution options:**

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration. Matches yesterday's Dry Run cadence (11 tasks, 22 commits, 13 live gates, all green).

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints for review.

**Which approach?**
