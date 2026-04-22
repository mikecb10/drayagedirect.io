---
name: 2026-04-23-routing-event-distance-design
description: Persist per-leg distance (estimated miles) on order_routing_events, sum to orders.estimated_miles via trigger, update billing engines to COALESCE(actual, estimated), and gate per-mile charges when distance is unresolved. Fixes silent-$0 bug affecting every per-mile driver pay + AR charge in production.
type: spec
---

# Routing Event Distance — Design Spec

## Summary

Today the DrayageDirect codebase has a systemic latent bug: every per-mile billing calculation silently resolves to $0 on real loads. The root cause surfaced in a 2026-04-23 codebase audit:

- The `orders.actual_miles` column is read by the driver-pay engine (`lib/pricing-tier-resolver.js:441`) and AR radius-rate resolver (`lib/pricing-tier-resolver.js:326`), but **no endpoint anywhere in the codebase ever writes to it** — it stays NULL forever.
- Distance IS computed, but only client-side in React state via Google Maps in `components/loads/tabs/RoutingTab.js:188-218`. The value lives in a `legMetrics` ref, never persisted.
- Result: `Number(context?.load?.actual_miles) || 0` always evaluates to `0 × rate = $0` for per-mile charges on real loads. The only reason this hasn't caused a customer-visible outage is that most loads get manually-overridden AR charges and the new Dry Run feature carries its own `miles` payload.

The fix: persist the Google-computed (or manually-overridden) leg distance to a new `order_routing_events.estimated_miles` column, maintain a sum on `orders.estimated_miles` via trigger, update the engines to `COALESCE(actual_miles, estimated_miles, 0)`, and add a soft-warn safety net that prevents invoice-send when distance is unresolved.

No Pull-leg special-casing — the problem is uniform across all event types.

## Goals

- Stop the silent-$0 bleed on per-mile driver pay and AR charges for every new load going forward.
- Make distance a first-class persisted field, not a derived React state.
- Preserve the existing client-side Google Maps UX (real-time leg distances in the Routing tab) — just write the values to the DB.
- Forward-compatible with future ELD/GPS integration: engines will automatically prefer `actual_miles` over `estimated_miles` when real odometer data lands.
- Add a visible safety gate so dispatchers can't accidentally send $0 invoices.

## Non-Goals (explicitly out of scope for v1)

1. Backfilling historic loads — pre-migration loads stay NULL; dispatchers resave routing as they return to those loads in the normal workflow.
2. Recomputing charges that were already saved at $0 by the old buggy engine — dispatchers must manually re-trigger charge compute on those rows (consistent with existing auto-recalc behavior).
3. Server-side Google Maps integration (API key, billing, rate-limiting) — client-side only for v1.
4. ELD / GPS / mobile-driver actual-distance tracking — deferred until the mobile app / ELD integration project.
5. Per-leg pay differentials (pull vs delivery rates) — the schema enables this, but engine-side consumption stays at the order level for v1.
6. `orders.actual_miles` column — reserved for future real odometer data, untouched by this change.

## Locked Decisions (Q1–Q6 summary)

| # | Question | Decision |
|---|---|---|
| Q1 | Schema granularity | Single `estimated_miles` column on `order_routing_events` (defer `actual_miles` column until ELD lands) |
| Q2 | Manual override | Allowed via pencil-edit UI; `distance_is_manual` flag prevents clobber on route-change recompute |
| Q3 | Engine read path | Keep reads at order level; `COALESCE(orders.actual_miles, orders.estimated_miles, 0)`. Populate `orders.estimated_miles` via trigger. |
| Q4 | Write trigger | Piggyback on existing routing-event save endpoint; client computes Google Maps distance + sends in save payload |
| Q5 | Silent-$0 safety net | Soft warn + prevent invoice — unresolved rows show red "Distance missing" badge; invoice-send gate blocks with unresolved rows |
| Q6 | Backfill | No backfill — historic loads stay NULL, resolved via normal workflow |

Rollout: single PR, one migration, one cadence.

## Data Model

### New columns on `order_routing_events`

```sql
ALTER TABLE order_routing_events
  ADD COLUMN estimated_miles NUMERIC(8,2),
  ADD COLUMN distance_is_manual BOOLEAN NOT NULL DEFAULT false;
```

- `estimated_miles` — distance from the PREVIOUS event to THIS event. Nullable. First event on a load is NULL (no prior leg). Drop/hook at same location as prior event is naturally 0.
- `distance_is_manual` — `true` when a dispatcher has typed a manual override. Preserved across route edits so automatic recompute doesn't clobber manual values.
- Uniform treatment across all event types (`pull`, `pickup`, `deliver`, `return`, `drop`, `hook`, `wait`, `scale`) — no special-casing.

### New/updated columns on `orders`

No schema change to `orders` — the existing `estimated_miles NUMERIC(8,2)` column (already declared in `001_initial_schema.sql:466`) is now actually populated by the trigger. `actual_miles` stays defined but untouched, reserved for future ELD.

### Unresolved-distance flag on charge rows

Instead of adding a new column, use existing NULL semantics:
- `order_charges.amount_cents = NULL` means "unresolved" (today it would be stored as `0` via the silent bug).
- `order_driver_pay_lines.amount_cents = NULL` — same treatment.

Add one new column per charge table to persist the "this was unresolved because distance was missing" reason, so UI can surface the badge distinctly from "unresolved because user skipped it":

```sql
ALTER TABLE order_charges
  ADD COLUMN needs_distance BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE order_driver_pay_lines
  ADD COLUMN needs_distance BOOLEAN NOT NULL DEFAULT false;
```

The engine flips this flag to `true` when it would have returned `$0` solely because `COALESCE(actual_miles, estimated_miles)` was NULL on a per-mile / radius_rate charge.

### Trigger: sync `orders.estimated_miles`

```sql
CREATE OR REPLACE FUNCTION trigger_sync_order_estimated_miles()
RETURNS TRIGGER AS $$
DECLARE
  affected_order_id UUID;
  new_total NUMERIC(8,2);
BEGIN
  affected_order_id := COALESCE(NEW.order_id, OLD.order_id);
  SELECT
    CASE
      WHEN COUNT(*) FILTER (WHERE estimated_miles IS NOT NULL) = 0 THEN NULL
      ELSE COALESCE(SUM(estimated_miles), 0)
    END
    INTO new_total
    FROM order_routing_events
    WHERE order_id = affected_order_id;
  UPDATE orders
    SET estimated_miles = new_total,
        updated_at = now()
    WHERE id = affected_order_id;
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_sync_order_estimated_miles
  AFTER INSERT OR UPDATE OR DELETE ON order_routing_events
  FOR EACH ROW EXECUTE FUNCTION trigger_sync_order_estimated_miles();
```

The CASE distinguishes two cases so the engine's gate works correctly: if ALL events have NULL distance, store NULL (engine treats as unresolved → safety-net gate triggers). If at least one event has a distance value (even 0), store the sum (legitimately zero-mile loads return $0 per_mile without triggering the gate).

## Write Path

### Client (RoutingTab.js)

1. **Existing `useEffect`** that computes `legMetrics[event.id]` via Google Maps DistanceMatrixService stays unchanged.
2. **On routing-event save** (add / edit address / reorder), the client includes two extra fields on the request body:
   - `estimated_miles` — from `legMetrics[event.id].distance_miles` (auto case) OR from the dispatcher's manual override input (manual case).
   - `distance_is_manual` — boolean.
3. **Route-change invalidation**: when the dispatcher edits an event's address, the client recomputes Google Maps for the two affected legs (incoming + outgoing) — but only for legs where `distance_is_manual === false`. Manual overrides are preserved.
4. **Google Maps failure**: if `getDistanceAndDuration()` throws or returns no route, the client sends `{ estimated_miles: null, distance_is_manual: false }`. Event saves normally. UI shows a yellow toast: "Distance couldn't be computed — open the leg to retry or enter manually."

### API endpoint

The existing routing-event save handler (likely `pages/api/tenant/loads/[id]/routing-events/[eventId].js` or equivalent PUT/POST — implementation plan confirms the exact file) gains two new fields in its accepted body schema:

```js
const bodySchema = z.object({
  // ... existing fields
  estimated_miles: z.number().nullable().optional(),
  distance_is_manual: z.boolean().optional().default(false),
});
```

Tenant scope (`.eq('tenant_id', ctx.tenantId)`) and service-role discipline unchanged.

### UI — manual override affordance

In `components/loads/routing/EventRow.js` next to each leg's distance display:
- Default display shows `{distance} mi` (from either DB value or live `legMetrics`).
- Small pencil-edit icon opens an inline numeric input. Submitting sets `distance_is_manual = true` and includes it in the next event save.
- Once manual, the value displays with a small "(manual)" badge.
- "Reset to auto" link next to the manual value clears the override: sets `distance_is_manual = false`, triggers Google recompute on next render.

### Debounce / async ordering

While Google Maps is in flight during a save, show a small spinner on the leg. If the save submit fires before Google resolves, the event saves with `estimated_miles: null`. When Google resolves later, a follow-up save persists the distance. Manual overrides bypass this flow entirely (no Google call).

## Read Path / Engine Changes

### Engines to update

1. `lib/pricing-tier-resolver.js` line 326 (radius_rate bracket lookup) and line 441 (per_mile multiplier):
   - Old: `const miles = Number(context?.load?.actual_miles) || 0;`
   - New: `const miles = Number(context?.load?.actual_miles ?? context?.load?.estimated_miles) || 0;`
2. `lib/driver-tariff-engine.js`:
   - Delegates to `pricing-tier-resolver` — change ripples automatically. Spot-check for any direct reads of `actual_miles`.
3. `lib/dry-run-engine.js`:
   - No change. Dry Run carries its own `miles` value in the payload — it never touches `load.actual_miles`.

### Load-fetch helpers

Any `.select()` call that pulls load fields for engine context must include `estimated_miles` (alongside the existing `actual_miles`). The code-reviewer pass will catch missed ones.

### Engine null-return contract (new)

Pseudocode for the resolve path:

```js
const actualMiles = context?.load?.actual_miles;
const estimatedMiles = context?.load?.estimated_miles;
const hasNoDistanceData = actualMiles == null && estimatedMiles == null;

const unit = charge.unit_of_measure;
const isMileBased = ['per_mile', 'per_miles', 'radius_rate'].includes(unit);

if (isMileBased && hasNoDistanceData) {
  return { amount_cents: null, needs_distance: true, reason: 'no_miles_on_load' };
}

const miles = Number(actualMiles ?? estimatedMiles) || 0;
// ... existing compute logic continues with real miles (or legitimate 0 for zero-mile loads)
```

Key distinction: the gate triggers only when BOTH `actual_miles` and `estimated_miles` are NULL. A load that is legitimately 0 miles (e.g., pickup + deliver at same dock) flows through the normal compute path and correctly returns `$0` — it's not flagged as unresolved.

Calling API handler persists the charge with `amount_cents = NULL` and `needs_distance = true` when the engine returns the null-return sentinel.

Fixed-fee, per-load, and percentage charges are **unaffected** — they don't read miles, so they keep returning normal values.

## Safety Net (Silent-$0 Gate)

### Compute-time behavior

Covered above in the engine-null-return contract: charge rows that needed miles but couldn't get them save with `amount_cents = NULL, needs_distance = true`.

### Invoice-send gate

Endpoints: `/api/tenant/ar/charge-sets/[id]/send-invoice`, `/api/tenant/ar/charge-sets/[id]/send-rate-con`, and the bulk send variants (`/bulk-send-invoices`, `/bulk-send-rate-cons`).

Before enqueueing any send, each endpoint runs:

```js
const unresolved = await supabase
  .from('order_charges')
  .select('id, description')
  .eq('charge_set_id', chargeSetId)
  .eq('needs_distance', true)
  .is('amount_cents', null);

if (unresolved.data?.length) {
  return res.status(400).json({
    error: 'charge_set_has_unresolved_distance_charges',
    unresolved_ids: unresolved.data.map(r => r.id),
  });
}
```

For bulk sends, the gate runs per-charge-set and surfaces a list of "N charge sets skipped because they have unresolved distance — resolve and retry."

### Driver-pay approval gate

Same treatment on the AP side: any endpoint that transitions `charge_set.status → 'approved'` (AR) or settles driver pay (AP, if such an endpoint exists) blocks if the set has `needs_distance = true` rows with NULL amounts.

### UI surfacing

- **AR ChargeSet detail modal + Billing tab**: rows with `needs_distance = true AND amount_cents IS NULL` render with a red "Distance missing" badge in the amount column. Tooltip on hover: "Load needs a saved route. Open the Routing tab and save to compute."
- **Driver Pay tab**: same badge treatment for AP rows.
- **Dispatcher Board**: a load with any `needs_distance` charge shows an orange indicator in a status column (decide column placement during implementation — likely repurpose an existing warning-dot slot).
- **Invoice modal / bulk send drawer**: if the user tries to send with unresolved rows, the UI shows a blocking modal: "Can't send — {N} charges have unresolved distance. Open the affected loads' Routing tabs and save a route, or set the amount manually."

### Recompute after fix

When a dispatcher saves routing and distance populates, existing unresolved charge rows do NOT auto-recalc. They stay at `amount_cents = NULL, needs_distance = true`. To resolve:
- Dispatcher clicks "Recalculate" on the row (if it exists) OR resaves the charge set. Engine runs again → now returns a real amount → row updates → badge clears.
- This matches the existing auto-recalc-on-match-change behavior shipped 2026-04-17.

## Testing

### Unit tests (new file)

`tests/routing-event-distance.test.mjs` — hand-rolled `.test.mjs` with `check(name, cond)` pattern. Scenarios:

| # | Test |
|---|---|
| 1 | Trigger: INSERT event with `estimated_miles = 15` → `orders.estimated_miles = 15` |
| 2 | Trigger: UPDATE event from 15 → 20 → `orders.estimated_miles` re-sums to 20 |
| 3 | Trigger: DELETE event subtracts its distance from the sum |
| 4 | Trigger: all events NULL → `orders.estimated_miles` stays NULL (NULLIF guard works) |
| 5 | Trigger: multi-event load, sum is correct (3 events × varied miles) |
| 6 | Engine: `{ actual_miles: null, estimated_miles: 25 }` → COALESCE uses 25 |
| 7 | Engine: `{ actual_miles: 30, estimated_miles: 25 }` → prefers 30 (actual wins) |
| 8 | Engine: both NULL + per_mile charge → returns `{ amount_cents: null, requires_distance: true }` (NOT 0) |
| 9 | Engine: both NULL + fixed-fee charge → returns normal amount (gate doesn't trigger on non-mile charges) |
| 10 | Engine: both NULL + radius_rate charge → returns `{ amount_cents: null, requires_distance: true }` |
| 11 | Engine: estimated present + radius_rate → bracket lookup uses estimated correctly |

Existing tests must still pass: `tests/dry-run-engine.test.mjs` (23 tests) + any AR/AP engine tests.

### Live Chrome gates

Batched 3–4 per subagent, ~25–30 tool calls each. ZERO screenshots directive.

**Batch 1 — Happy path (4 gates)**
- G1: Open a load with routing events → Routing tab displays Google-computed distances (existing behavior unchanged).
- G2: Save a route edit → inspect network payload → confirm `estimated_miles` + `distance_is_manual: false` included.
- G3: Reload page → distance persists on event row + dispatcher board "Est Miles" column reflects the sum.
- G4: Create a per-mile driver pay line on that load → `amount_cents` computes correctly (rate × miles).

**Batch 2 — Manual override (3 gates)**
- G5: Pencil-edit a leg, enter 30 (Google said 24.5), save → `distance_is_manual: true` persists.
- G6: Edit event pickup address + save → manual 30 NOT clobbered (`estimated_miles` still 30, flag still true).
- G7: Click "Reset to auto" → flag → false, distance recomputes from Google.

**Batch 3 — Safety net (3 gates)**
- G8: Open pre-migration load (NULL distances) → create per-mile charge → row shows "Distance missing" red badge + `amount_cents: NULL`.
- G9: Attempt invoice send on that charge set → 400 with `charge_set_has_unresolved_distance_charges` error + blocking modal.
- G10: Open Routing on same load → save a route → return to Billing → resave charge → badge clears + amount populates.

**Batch 4 — Google Maps failure (1 gate)**
- G11: Disable Google Maps API (block domain in devtools) → save routing event → yellow toast appears + event saves with `estimated_miles: null`. Downstream per-mile charge hits the safety net correctly.

### Final code-reviewer pass

Invoke `superpowers:requesting-code-review` after all gates green — catches semantic bugs live gates miss (yesterday's Dry Run ship had 5 critical + 2 important caught this way).

## Migration File

File: `supabase/migrations/089_routing_event_distance.sql`

Structure per `dev_migration_template.md`:
```sql
BEGIN;

-- 1. Add columns to order_routing_events
ALTER TABLE order_routing_events
  ADD COLUMN estimated_miles NUMERIC(8,2),
  ADD COLUMN distance_is_manual BOOLEAN NOT NULL DEFAULT false;

-- 2. Add needs_distance flag to charge tables
ALTER TABLE order_charges ADD COLUMN needs_distance BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE order_driver_pay_lines ADD COLUMN needs_distance BOOLEAN NOT NULL DEFAULT false;

-- 3. Create trigger function
CREATE OR REPLACE FUNCTION trigger_sync_order_estimated_miles()
RETURNS TRIGGER AS $$
-- ... (body as specified above)
$$ LANGUAGE plpgsql;

-- 4. Attach trigger
CREATE TRIGGER trg_sync_order_estimated_miles
  AFTER INSERT OR UPDATE OR DELETE ON order_routing_events
  FOR EACH ROW EXECUTE FUNCTION trigger_sync_order_estimated_miles();

-- 5. Refresh PostgREST schema cache
NOTIFY pgrst, 'reload schema';

COMMIT;
```

## Rollout Plan

1. Apply migration 089 (user runs manually in Supabase dashboard per convention).
2. Deploy code changes (schema validator, engine COALESCE, write path, UI, gate).
3. No feature flag, no phased rollout — the gate provides its own safety net for pre-migration loads.
4. Dispatcher-observable changes on day-of-ship:
   - New "pencil-edit" affordance on Routing tab leg distances.
   - Red "Distance missing" badges on charges that were previously silently $0.
   - Possible invoice-send rejections for charge sets that were about to go out with NULL amounts.

## Risks & Mitigations

| Risk | Mitigation |
|---|---|
| Trigger fires 5× on a 5-event bulk save (perf) | Accept for v1; convert to statement-level trigger if dispatcher-observable latency emerges |
| Google Maps API quota exceeded during bulk route edits | Client-side debounce on `getDistanceAndDuration`; toast on failure; safety net catches any billing downstream |
| Existing invoiced loads with per-mile charges at $0 | Out-of-scope for v1 (those charges already went out as invoices; fixing them is a remediation project, not a bug fix) |
| Manual override lost if user edits event twice quickly | `distance_is_manual` flag persists through UPDATE; only explicit "Reset to auto" clears it |
| Dispatcher confused by "Distance missing" badge | Tooltip explains + "Click to open Routing" hint; one-time training via release notes |

## Open Follow-Ups (Not in Scope)

Tracked for future sessions but not this PR:
1. Retroactive charge-recalc endpoint (re-runs the engine against all loads that now have populated distance) — if Mike decides the historic $0-charge inventory is big enough to warrant it.
2. Per-leg pay differentials — engine change to read from `order_routing_events` directly instead of summed order total.
3. ELD / GPS integration that populates `orders.actual_miles` (or a future per-event `actual_miles` column).
4. Dispatcher board indicator column for "loads with unresolved distance" — decide column placement during implementation phase.

