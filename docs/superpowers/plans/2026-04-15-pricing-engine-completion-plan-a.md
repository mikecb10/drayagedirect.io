# Pricing Engine Completion — Plan A: Calculation Modes + Time-Based UOMs

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the flat `tiers[0].amount_cents` behavior in both AR and AP pricing engines with a true `calculation_mode` dispatcher that (a) selects the right tier row based on the mode (`between_statuses`, `by_lane`, `by_event`, `by_move`, `by_leg`) and (b) applies time-based UOM multipliers (`per_hour`, `per_day`, `per_15min`, `per_30min`, `per_45min`) using duration derived from routing events.

**Architecture:** Extract three pure helpers to `lib/pricing-*.js` — `selectTier` (mode dispatch), `computeDuration` (status→routing-event lookup), `applyTimeUom` (rate × duration). Both engines (`lib/tariff-engine.js`, `lib/driver-tariff-engine.js`) stop calling their local `getProfileAmount` and instead call the shared resolver. Callers pass through a `context` object (load + routing events) so the helpers are database-free and deterministic.

**Tech Stack:** Next.js 15, Supabase/PostgREST, JS only (no TypeScript in this project).

## Scope (what's in)

| Mode | AR | AP | Status |
|---|---|---|---|
| `between_statuses` + time UOMs | ✅ | ✅ | Phase 2+3 |
| `by_lane` (tier.pickup_location_id / delivery / return) | ✅ | n/a (AP has no by_lane) | Phase 2 |
| `by_event` (tier.event_type match) | ✅ | ✅ | Phase 2+3 |
| `by_move` (tier.move_index match) | ✅ | ✅ | Phase 2+3 |
| `by_leg` (tier.leg_from / leg_to match) | n/a | ✅ | Phase 3 |
| Fallback to `tiers[0]` when mode is null/missing data | ✅ | ✅ | Phase 1 |
| Per-tier minimum enforcement (existing, preserved) | ✅ | ✅ | Phase 2+3 |
| Percentage resolution (existing, preserved) | ✅ | ✅ | unchanged |

## Scope (deferred to later plans — spelled out so reviewers know what's missing)

**Plan B — Location-aware matching:**
- `event_location_type` (`org` / `city_state` / `zip` / `profile_group`) + `event_location_id` + `event_location_value` filtering on AP tiers (migration 067 has the columns; this plan ignores them).
- `leg_from_location_*` / `leg_to_location_*` filtering on AP by_leg tiers.
- `profile_group` resolution (no table exists yet — requires schema work).
- `radius_tiers` JSONB evaluation when `unit_of_measure = 'radius_rate'`.

**Plan C — Distance + observability:**
- `per_miles`, `per_road_toll_miles` UOMs (requires distance calc between pickup and delivery).
- `per_pounds` UOM (requires `load.weight_lbs` multiplier).
- AR diagnostic tracer endpoint parity with `pages/api/tenant/loads/[id]/recalculate-driver-pay.js`.
- `oo_benchmark` percentage source — either add a benchmark data source or remove the UI option (currently a silent wrong-answer).

---

## File Structure

**New files:**
- `lib/pricing-tier-resolver.js` — `selectTier(tiers, mode, context)` and `resolveAmountCents(profile, context)`
- `lib/pricing-duration.js` — `computeDurationSeconds(fromStatus, toStatus, routingEvents)` + `STATUS_TO_EVENT_MAP`
- `lib/pricing-uom.js` — `applyTimeUom(amountCents, durationSeconds, uom, freeUnits)` + `isTimeBased(uom)`

**Modified files:**
- `lib/tariff-engine.js` — replace `getProfileAmount(cp, load)` with shared resolver, hydrate routing_events before charge resolution
- `lib/driver-tariff-engine.js` — replace `getDriverProfileAmount(cp)` with shared resolver (routing_events already hydrated)

**Unchanged (but referenced):**
- `lib/condition-evaluator.js` — rules engine for 40+ condition types, already shared
- `lib/charge-profile-constants.js` — UOM_MODES, CALCULATION_MODES, STATUS_OPTIONS, EVENT_TYPES, MOVE_CALC_FROM/TO — single source of truth
- `lib/driver-charge-profile-constants.js` — `isTimeBased(uom)` helper already exists; we'll lift it into `pricing-uom.js` for cross-engine use

---

## Phase 1 — Shared Pricing Helpers (pure, no DB)

### Task 1.1: Create `lib/pricing-duration.js`

**Files:**
- Create: `lib/pricing-duration.js`

- [ ] **Step 1: Write the helper**

```javascript
/**
 * Pricing Duration Helper
 *
 * Given a (from_status, to_status) pair from a charge profile tier and a
 * load's routing events, compute the elapsed seconds between the two
 * operational milestones. Used by `between_statuses` calculation mode to
 * multiply a per_hour / per_day / per_15min rate by real duration.
 *
 * Returns 0 when either endpoint is missing (event hasn't fired yet) or
 * when both statuses resolve to the same timestamp. Callers should treat
 * 0-duration as "charge does not apply yet" and fall back to the tier's
 * minimum_amount_cents if configured.
 *
 * Status codes are the values from STATUS_OPTIONS in charge-profile-constants.js
 * (AR) and DISPATCHER_STATE_OPTIONS in driver-charge-profile-constants.js (AP).
 * This map normalizes both shapes to order_routing_events rows.
 */

// Each status maps to a (event_type, timestamp_field) pair on order_routing_events.
// `event_type` is the routing event type (pull/deliver/return/drop/stop/hook/etc.).
// `field` is either 'arrived_at' or 'departed_at'.
//
// Some statuses resolve to a dispatcher-level timestamp on the orders row
// (e.g. PICKUP_APT → load.pickup_apt_from). Those use kind:'load_field'.
export const STATUS_TO_EVENT = {
  // AR-style UPPER_SNAKE_CASE
  ENROUTE_TO_CHASSIS:          { kind: 'event', event_type: 'hook_chassis', field: 'departed_at' },
  ARRIVED_TO_CHASSIS:          { kind: 'event', event_type: 'hook_chassis', field: 'arrived_at' },
  ENROUTE_TO_PICK_CONTAINER:   { kind: 'event', event_type: 'pull',         field: 'departed_at_previous' },
  ARRIVED_AT_PICK_CONTAINER:   { kind: 'event', event_type: 'pull',         field: 'arrived_at' },
  ENROUTE_TO_DELIVER_LOAD:     { kind: 'event', event_type: 'pull',         field: 'departed_at' },
  ARRIVED_AT_DELIVER_LOAD:     { kind: 'event', event_type: 'deliver',      field: 'arrived_at' },
  ENROUTE_TO_DROP_CONTAINER:   { kind: 'event', event_type: 'drop',         field: 'departed_at_previous' },
  DROPPED:                     { kind: 'event', event_type: 'drop',         field: 'arrived_at' },
  ENROUTE_TO_STOP_OFF:         { kind: 'event', event_type: 'stop',         field: 'departed_at_previous' },
  ARRIVED_AT_STOP_OFF:         { kind: 'event', event_type: 'stop',         field: 'arrived_at' },
  ENROUTE_TO_HOOK_CONTAINER:   { kind: 'event', event_type: 'hook',         field: 'departed_at_previous' },
  ARRIVED_AT_HOOK_CONTAINER:   { kind: 'event', event_type: 'hook',         field: 'arrived_at' },
  ENROUTE_TO_RETURN_LOAD:      { kind: 'event', event_type: 'deliver',      field: 'departed_at' },
  ARRIVED_AT_RETURN_LOAD:      { kind: 'event', event_type: 'return',       field: 'arrived_at' },
  ENROUTE_TO_RETURN_CHASSIS:   { kind: 'event', event_type: 'return',       field: 'departed_at' },
  ARRIVED_TO_RETURN_CHASSIS:   { kind: 'event', event_type: 'terminate',    field: 'arrived_at' },
  COMPLETED:                   { kind: 'load_field', field: 'actual_delivery_at' },
  PICKUP_APT:                  { kind: 'load_field', field: 'pickup_apt_from' },
  DELIVERY_APT:                { kind: 'load_field', field: 'delivery_apt_from' },
  RETURN_APT:                  { kind: 'load_field', field: 'return_apt_from' },
  READY_TO_RETURN:             { kind: 'load_field', field: 'ready_to_return_date' },
  POD_IN:                      { kind: 'load_field', field: 'pod_received_at' },
  POD_OUT:                     { kind: 'load_field', field: 'pod_approved_at' },

  // AP-style lower_snake_case (DISPATCHER_STATE_OPTIONS). Map through to
  // the same resolution so a driver profile using either shape works.
  enroute_pull:       { kind: 'event', event_type: 'hook_chassis', field: 'departed_at' },
  arrived_pull:       { kind: 'event', event_type: 'hook_chassis', field: 'arrived_at' },
  enroute_pickup:     { kind: 'event', event_type: 'pull',         field: 'departed_at_previous' },
  arrived_pickup:     { kind: 'event', event_type: 'pull',         field: 'arrived_at' },
  enroute_drop:       { kind: 'event', event_type: 'drop',         field: 'departed_at_previous' },
  arrived_drop:       { kind: 'event', event_type: 'drop',         field: 'arrived_at' },
  enroute_hook:       { kind: 'event', event_type: 'hook',         field: 'departed_at_previous' },
  arrived_hook:       { kind: 'event', event_type: 'hook',         field: 'arrived_at' },
  enroute_deliver:    { kind: 'event', event_type: 'deliver',      field: 'departed_at_previous' },
  arrived_deliver:    { kind: 'event', event_type: 'deliver',      field: 'arrived_at' },
  enroute_return:     { kind: 'event', event_type: 'return',       field: 'departed_at_previous' },
  arrived_return:     { kind: 'event', event_type: 'return',       field: 'arrived_at' },
  delivered:          { kind: 'event', event_type: 'deliver',      field: 'departed_at' },
  pending_completion: { kind: 'load_field', field: 'actual_delivery_at' },
  completed:          { kind: 'load_field', field: 'actual_delivery_at' },
};

/**
 * Resolve a status code to a concrete ISO timestamp string (or null).
 *
 * - kind:'event' looks up the first matching event by event_type and reads
 *   the named timestamp field.
 * - kind:'event' with field:'departed_at_previous' walks to the event
 *   immediately BEFORE the named type in `sequence` order and reads its
 *   departed_at (models "enroute" = just left the prior stop).
 * - kind:'load_field' reads directly from the load/orders row.
 */
export function resolveStatusTimestamp(statusCode, load, routingEvents) {
  const spec = STATUS_TO_EVENT[statusCode];
  if (!spec) return null;

  if (spec.kind === 'load_field') {
    return load?.[spec.field] || null;
  }

  const events = Array.isArray(routingEvents) ? routingEvents : [];
  const sorted = [...events].sort((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0));

  if (spec.field === 'departed_at_previous') {
    const idx = sorted.findIndex((e) => e.event_type === spec.event_type);
    if (idx <= 0) return null; // no event of that type, or it's the first
    return sorted[idx - 1].departed_at || null;
  }

  const match = sorted.find((e) => e.event_type === spec.event_type);
  return match ? match[spec.field] || null : null;
}

/**
 * Compute elapsed seconds between two statuses. Returns 0 when either
 * endpoint isn't resolved, or when `to` is before `from` (clock skew
 * or out-of-order edits).
 */
export function computeDurationSeconds(fromStatus, toStatus, load, routingEvents) {
  const fromIso = resolveStatusTimestamp(fromStatus, load, routingEvents);
  const toIso   = resolveStatusTimestamp(toStatus,   load, routingEvents);
  if (!fromIso || !toIso) return 0;
  const fromMs = new Date(fromIso).getTime();
  const toMs   = new Date(toIso).getTime();
  if (!Number.isFinite(fromMs) || !Number.isFinite(toMs)) return 0;
  const delta = Math.floor((toMs - fromMs) / 1000);
  return delta > 0 ? delta : 0;
}
```

- [ ] **Step 2: Commit**

```bash
git add lib/pricing-duration.js
git commit -m "$(cat <<'EOF'
feat(pricing): add status-to-timestamp resolver + duration helper

New pure helper for computing elapsed time between two dispatcher
statuses using a load's routing events. Backs the upcoming
between_statuses calculation mode in both AR and AP engines.

STATUS_TO_EVENT maps AR-style (UPPER_SNAKE) and AP-style (lower_snake)
status codes to (event_type, timestamp_field) pairs so either engine
can call the same helper.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 1.2: Create `lib/pricing-uom.js`

**Files:**
- Create: `lib/pricing-uom.js`

- [ ] **Step 1: Write the helper**

```javascript
/**
 * Pricing UOM Helper
 *
 * Multiplies a per-unit rate by a measured quantity (currently time;
 * Plan C adds distance/weight). Rate is stored in cents per unit.
 *
 * The free_units concept lets tariffs say "first 2 hours free, then
 * $75/hr" — we subtract free_units from the measured quantity before
 * multiplying. When the remaining quantity is negative, the result is 0.
 */

const SECONDS_PER_UNIT = {
  per_hour:  3600,
  per_day:   86400,
  per_15min: 900,
  per_30min: 1800,
  per_45min: 2700,
};

/**
 * True if the UOM represents a rate that must be multiplied by elapsed time.
 * `fixed` and `percentage` are flat and return their stored amount directly.
 */
export function isTimeBased(uom) {
  return Object.prototype.hasOwnProperty.call(SECONDS_PER_UNIT, uom);
}

/**
 * Apply a time-based UOM to a rate and a measured duration.
 *
 * @param {number} amountCents — rate per unit (e.g. 7500 = $75/hr)
 * @param {number} durationSeconds — measured elapsed time
 * @param {string} uom — 'per_hour' | 'per_day' | 'per_15min' | 'per_30min' | 'per_45min'
 * @param {number} freeUnits — number of units to subtract before billing
 * @returns {number} — total cents to bill
 */
export function applyTimeUom(amountCents, durationSeconds, uom, freeUnits = 0) {
  if (!isTimeBased(uom)) return amountCents; // caller shouldn't hit this, but safe
  const secondsPerUnit = SECONDS_PER_UNIT[uom];
  const rawUnits = durationSeconds / secondsPerUnit;
  const billableUnits = Math.max(0, rawUnits - (freeUnits || 0));
  return Math.round(amountCents * billableUnits);
}

/**
 * Produce a human-readable duration label for diagnostics / debugging.
 * Used by the AP recalculate-driver-pay diagnostic to explain why a
 * detention charge resolved to a particular amount.
 */
export function formatDuration(durationSeconds) {
  if (!durationSeconds || durationSeconds < 0) return '0s';
  const h = Math.floor(durationSeconds / 3600);
  const m = Math.floor((durationSeconds % 3600) / 60);
  if (h > 0 && m > 0) return `${h}h ${m}m`;
  if (h > 0) return `${h}h`;
  return `${m}m`;
}
```

- [ ] **Step 2: Commit**

```bash
git add lib/pricing-uom.js
git commit -m "$(cat <<'EOF'
feat(pricing): add time-based UOM multiplier helper

isTimeBased / applyTimeUom / formatDuration — used by both AR and AP
engines to convert a per_hour/per_day/per_Nmin rate into total cents
given elapsed seconds. Honours free_units (N hours free before billing).

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 1.3: Create `lib/pricing-tier-resolver.js`

**Files:**
- Create: `lib/pricing-tier-resolver.js`

- [ ] **Step 1: Write the helper**

```javascript
/**
 * Pricing Tier Resolver
 *
 * Given a list of tier rows + the profile's calculation_mode + load
 * context, pick the right tier row and compute the final amount in
 * cents. Shared by both the AR tariff engine and the AP driver tariff
 * engine because the tier shapes overlap heavily (same columns for
 * between_statuses / by_event / by_move; AR has by_lane only, AP has
 * by_leg only — handled via mode dispatch).
 *
 * A tier's `amount_cents` is the per-unit rate for time-based UOMs and
 * the flat total for fixed. percentage is resolved in a second pass
 * (see resolvePercentageCharges / resolveDriverPercentageCharges in
 * the two engine files — this resolver does NOT compute percentages).
 *
 * When no tier matches the mode-specific filters, we fall back to the
 * first tier (preserves the pre-refactor behavior so legacy profiles
 * that were built without mode awareness still return a non-zero amount).
 */

import { isTimeBased, applyTimeUom } from './pricing-uom';
import { computeDurationSeconds } from './pricing-duration';

/**
 * Today's date as YYYY-MM-DD, used for tier effective-range filtering.
 */
function today() {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Filter a tier list to only those whose effective date range covers today.
 * Tiers without a date range are always considered active.
 */
function filterActiveByDate(tiers) {
  const t = today();
  const active = tiers.filter((tier) =>
    (!tier.start_date || tier.start_date <= t) &&
    (!tier.end_date   || tier.end_date   >= t)
  );
  return active.length > 0 ? active : tiers;
}

/**
 * Select the tier row that matches a calculation_mode + load context.
 * Returns null when `tiers` is empty; returns tiers[0] when no mode
 * filter applies or matches (safety fallback).
 */
export function selectTier(tiers, mode, context) {
  if (!Array.isArray(tiers) || tiers.length === 0) return null;

  const active = filterActiveByDate(tiers);
  const load = context?.load || {};

  switch (mode) {
    case 'by_lane': {
      // AR only. Match a tier whose pickup/delivery/return_location_id
      // triple matches the load. A null on the tier side means "any".
      const hit = active.find((t) =>
        (!t.pickup_location_id   || t.pickup_location_id   === load.pickup_location_id) &&
        (!t.delivery_location_id || t.delivery_location_id === load.delivery_location_id) &&
        (!t.return_location_id   || t.return_location_id   === load.return_location_id)
      );
      return hit || active[0];
    }

    case 'by_event': {
      // Match the first tier whose event_type appears on the load.
      // Location matching (event_location_id / type / value) deferred to Plan B.
      const eventTypes = new Set((context?.routingEvents || []).map((e) => e.event_type));
      const hit = active.find((t) => t.event_type && eventTypes.has(t.event_type.toLowerCase()));
      return hit || active[0];
    }

    case 'by_move': {
      // Tiers are keyed by move_index (0-based). Pick the one matching the
      // load's first/selected move. For Plan A we target move_index 0;
      // multi-move pricing (per-move detention) lands in Plan B.
      const hit = active.find((t) => t.move_index === 0 || t.move_index == null);
      return hit || active[0];
    }

    case 'by_leg': {
      // AP only. Match leg_from + leg_to against the routing event sequence.
      // Location matching (leg_*_location_*) deferred to Plan B.
      const events = context?.routingEvents || [];
      const legTypes = events.map((e) => e.event_type);
      const hit = active.find((t) => {
        if (!t.leg_from || !t.leg_to) return false;
        const fromIdx = legTypes.indexOf(legFromToEvent(t.leg_from));
        const toIdx   = legTypes.indexOf(legFromToEvent(t.leg_to));
        return fromIdx >= 0 && toIdx > fromIdx;
      });
      return hit || active[0];
    }

    case 'between_statuses':
    case null:
    case undefined:
    default: {
      // between_statuses tiers carry from_status + to_status on the tier
      // row; multi-tier between_statuses (e.g. "0-2h @ $50, 2h+ @ $75")
      // is a future enhancement. For Plan A we pick the first active tier.
      return active[0];
    }
  }
}

/**
 * Map a LEG_OPTIONS code (pick_up_container, deliver_container, etc.) to
 * the routing event type stored in order_routing_events.event_type.
 */
function legFromToEvent(leg) {
  const map = {
    pick_up_container:       'pull',
    deliver_container:       'deliver',
    return_container:        'return',
    drop_container:          'drop',
    stop_off:                'stop',
    terminate_chassis:       'terminate',
    completed:               'complete',
    hook_container:          'hook',
    hook_chassis:            'hook_chassis',
    lift_off:                'lift_off',
    lift_on:                 'lift_on',
    deliver_load_drop_hook:  'deliver',
    drop_chassis:            'drop_chassis',
  };
  return map[leg] || leg;
}

/**
 * Resolve the final cents amount for a charge profile given a load +
 * routing events. This is the single entrypoint both engines call in
 * place of their legacy getProfileAmount / getDriverProfileAmount.
 *
 * Returns { amount_cents, minimum_amount_cents, tier_id, duration_seconds }
 * so the caller can (a) apply a per-profile minimum and (b) include
 * duration in the diagnostic trace when requested.
 *
 * `tiers` is the flat array of tier rows (AR: profile.tiers; AP: selected
 * version's tiers — caller unnests the version layer before passing).
 */
export function resolveAmountCents({ tiers, calculation_mode, unit_of_measure }, context) {
  const tier = selectTier(tiers || [], calculation_mode, context);
  if (!tier) {
    return { amount_cents: 0, minimum_amount_cents: 0, tier_id: null, duration_seconds: 0 };
  }

  const baseCents = tier.amount_cents || 0;
  const minCents  = tier.minimum_amount_cents || 0;
  const freeUnits = tier.free_units || 0;

  // between_statuses with a time-based UOM is the only case that needs
  // a duration multiplier. Everything else returns the stored amount
  // (fixed tiers, percentage placeholder, by_event/move/leg tier picks).
  if (calculation_mode === 'between_statuses' && isTimeBased(unit_of_measure)) {
    const seconds = computeDurationSeconds(
      tier.from_status,
      tier.to_status,
      context?.load,
      context?.routingEvents
    );
    const total = applyTimeUom(baseCents, seconds, unit_of_measure, freeUnits);
    return {
      amount_cents: Math.max(total, minCents),
      minimum_amount_cents: minCents,
      tier_id: tier.id,
      duration_seconds: seconds,
    };
  }

  return {
    amount_cents: baseCents,
    minimum_amount_cents: minCents,
    tier_id: tier.id,
    duration_seconds: 0,
  };
}
```

- [ ] **Step 2: Commit**

```bash
git add lib/pricing-tier-resolver.js
git commit -m "$(cat <<'EOF'
feat(pricing): add shared tier resolver for calculation_mode dispatch

selectTier() picks the right tier row based on calculation_mode
(between_statuses, by_lane, by_event, by_move, by_leg). resolveAmountCents()
is the single entrypoint both pricing engines will call to replace their
flat getProfileAmount helpers.

Handles time-based UOMs (per_hour, per_day, per_Nmin) by multiplying the
tier's rate by elapsed seconds between from_status and to_status.

Location-aware matching (event_location_type/id, leg_*_location_*) and
radius_tiers are deferred to Plan B — selectTier falls back to
first-match-on-type for now.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase 2 — Wire Resolver Into AR Engine

### Task 2.1: Hydrate routing events in `tariff-engine.js`

**Files:**
- Modify: `lib/tariff-engine.js` (top of `findMatchingCharges`, after the load parameter is received)

**Context:** The AP engine hydrates routing events at lines 40–48. The AR engine never does — it receives a `load` object from the caller and assumes `load.routing_events` is absent. For between_statuses / by_event / by_leg to work we need the events.

- [ ] **Step 1: Add hydration block at the top of `findMatchingCharges`**

Open `lib/tariff-engine.js`. Find the opening of `findMatchingCharges` (line 29):

```javascript
export async function findMatchingCharges(svc, load, tenantId) {
  const today = new Date().toISOString().slice(0, 10);
```

Insert this immediately after the `const today = ...` line:

```javascript
  // Ensure routing_events are hydrated. The condition evaluator's
  // before_delivery / after_delivery rules need them, and the shared
  // pricing resolver needs them for between_statuses duration +
  // by_event / by_move / by_leg tier selection. Callers on the
  // PUT /loads/[id] path pass the raw update response, which doesn't
  // include routing_events — hydrate once here so every downstream
  // consumer sees the same shape.
  if (!Array.isArray(load.routing_events)) {
    const { data: events } = await svc
      .from('order_routing_events')
      .select('id, event_type, arrived_at, departed_at, sequence')
      .eq('tenant_id', tenantId)
      .eq('order_id', load.id)
      .order('sequence', { ascending: true });
    load.routing_events = events || [];
  }
```

- [ ] **Step 2: Commit**

```bash
git add lib/tariff-engine.js
git commit -m "$(cat <<'EOF'
fix(pricing): hydrate routing_events in AR tariff engine

Matches AP engine behavior (driver-tariff-engine.js:40-48). Needed so
the upcoming shared tier resolver can compute durations and pick by_event
tiers against the load's routing events. Also lets the condition
evaluator's dropped / before_delivery / after_delivery rules work when
the load hasn't been re-fetched after an event change.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2.2: Replace `getProfileAmount` in AR engine with shared resolver

**Files:**
- Modify: `lib/tariff-engine.js`

- [ ] **Step 1: Add import at the top**

Find the existing import at line 19:

```javascript
import { evaluateConditions } from './condition-evaluator';
```

Add a line below it:

```javascript
import { evaluateConditions } from './condition-evaluator';
import { resolveAmountCents } from './pricing-tier-resolver';
```

- [ ] **Step 2: Update the tariff-winning branch to call the resolver**

Find the block around line 93–108 inside the `for (const cs of tariff.charge_sets || [])` loop:

```javascript
        matchedCharges.push({
          tariff_id: tariff.id,
          tariff_name: tariff.name,
          charge_set_id: cs.id,
          bill_to_mode: cs.bill_to_mode,
          bill_to_customer_id: cs.bill_to_customer_id,
          charge_profile_id: cp.id,
          charge_name: cp.charge_name,
          name: cp.name,
          unit_of_measure: cp.unit_of_measure,
          calculation_mode: cp.calculation_mode,
          amount_cents: getProfileAmount(cp, load),
          minimum_amount_cents: getProfileMinimum(cp),
          percentage_based_on: cp.percentage_based_on || null,
          source: 'tariff',
        });
```

Replace it with:

```javascript
        const resolved = resolveAmountCents(cp, {
          load,
          routingEvents: load.routing_events || [],
        });
        matchedCharges.push({
          tariff_id: tariff.id,
          tariff_name: tariff.name,
          charge_set_id: cs.id,
          bill_to_mode: cs.bill_to_mode,
          bill_to_customer_id: cs.bill_to_customer_id,
          charge_profile_id: cp.id,
          charge_name: cp.charge_name,
          name: cp.name,
          unit_of_measure: cp.unit_of_measure,
          calculation_mode: cp.calculation_mode,
          amount_cents: resolved.amount_cents,
          minimum_amount_cents: resolved.minimum_amount_cents,
          tier_id: resolved.tier_id,
          duration_seconds: resolved.duration_seconds,
          percentage_based_on: cp.percentage_based_on || null,
          source: 'tariff',
        });
```

- [ ] **Step 3: Update the auto-add fallback branch the same way**

Find the similar block around line 151–166 inside `if (!winningTariff)`:

```javascript
        matchedCharges.push({
          tariff_id: null,
          tariff_name: null,
          charge_set_id: null,
          bill_to_mode: 'load_customer',
          bill_to_customer_id: null,
          charge_profile_id: cp.id,
          charge_name: cp.charge_name,
          name: cp.name,
          unit_of_measure: cp.unit_of_measure,
          calculation_mode: cp.calculation_mode,
          amount_cents: getProfileAmount(cp, load),
          minimum_amount_cents: getProfileMinimum(cp),
          percentage_based_on: cp.percentage_based_on || null,
          source: 'auto_add',
        });
```

Replace with:

```javascript
        const resolved = resolveAmountCents(cp, {
          load,
          routingEvents: load.routing_events || [],
        });
        matchedCharges.push({
          tariff_id: null,
          tariff_name: null,
          charge_set_id: null,
          bill_to_mode: 'load_customer',
          bill_to_customer_id: null,
          charge_profile_id: cp.id,
          charge_name: cp.charge_name,
          name: cp.name,
          unit_of_measure: cp.unit_of_measure,
          calculation_mode: cp.calculation_mode,
          amount_cents: resolved.amount_cents,
          minimum_amount_cents: resolved.minimum_amount_cents,
          tier_id: resolved.tier_id,
          duration_seconds: resolved.duration_seconds,
          percentage_based_on: cp.percentage_based_on || null,
          source: 'auto_add',
        });
```

- [ ] **Step 4: Delete the now-unused legacy helpers**

Find `getProfileAmount` (around line 319) and `getProfileMinimum` (around line 337). Delete both functions AND the JSDoc header comments above them. Leave only the `applyChargesToLoad` export below.

- [ ] **Step 5: Syntax check**

```bash
node --check "C:/Users/bento/app-drayagedirect/lib/tariff-engine.js"
```

Expected output: no output (clean) or explicit "SYNTAX OK" if echoed.

- [ ] **Step 6: Commit**

```bash
git add lib/tariff-engine.js
git commit -m "$(cat <<'EOF'
refactor(pricing): AR engine uses shared tier resolver

Replaces local getProfileAmount / getProfileMinimum (flat tiers[0] reads)
with resolveAmountCents() from lib/pricing-tier-resolver.js. Output now
honors calculation_mode (between_statuses / by_lane / by_event / by_move)
and time-based UOMs (per_hour / per_day / per_Nmin).

matchedCharges now carries tier_id + duration_seconds so downstream
diagnostics can trace which tier row resolved and why.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase 3 — Wire Resolver Into AP Engine

### Task 3.1: Replace `getDriverProfileAmount` in AP engine with shared resolver

**Files:**
- Modify: `lib/driver-tariff-engine.js`

**Context:** AP wraps tiers under a `versions` array (see migration 067: `driver_charge_profile_versions` joins `driver_charge_profile_tiers`). We select the active version first, then pass its flat tiers to the shared resolver.

- [ ] **Step 1: Add import at the top**

Find line 17:

```javascript
import { evaluateConditions } from './condition-evaluator';
```

Add below:

```javascript
import { evaluateConditions } from './condition-evaluator';
import { resolveAmountCents } from './pricing-tier-resolver';
```

- [ ] **Step 2: Add a helper to unwrap versions → tiers**

Add this helper immediately above the existing `getDriverProfileAmount` function (currently around line 254):

```javascript
/**
 * AP profiles store tiers under versions (effective_from / effective_to
 * grouping). Pick the currently-active version and return its flat tier
 * list so the shared resolver can operate on it uniformly with AR.
 */
function activeTiersForDriverProfile(profile) {
  const versions = profile.versions || [];
  if (versions.length === 0) return [];
  const today = new Date().toISOString().slice(0, 10);
  const active = versions.find((v) =>
    (!v.effective_from || v.effective_from <= today) &&
    (!v.effective_to   || v.effective_to   >= today)
  ) || versions[0];
  return active.tiers || [];
}
```

- [ ] **Step 3: Update the tariff-winning branch**

Find the block around line 112–126:

```javascript
        const amount = getDriverProfileAmount(cp);

        matchedCharges.push({
          tariff_id: winningTariff.id,
          tariff_name: winningTariff.name,
          charge_profile_id: cp.id,
          charge_name: cp.charge_name,
          name: cp.name,
          unit_of_measure: cp.unit_of_measure,
          calculation_mode: cp.calculation_mode,
          amount_cents: amount,
          percentage_based_on: cp.percentage_based_on || null,
          percentage_charge_code: cp.percentage_charge_code || null,
          source: 'driver_tariff',
        });
```

Replace with:

```javascript
        const tiers = activeTiersForDriverProfile(cp);
        const resolved = resolveAmountCents(
          { tiers, calculation_mode: cp.calculation_mode, unit_of_measure: cp.unit_of_measure },
          { load, routingEvents: load.routing_events || [] }
        );

        matchedCharges.push({
          tariff_id: winningTariff.id,
          tariff_name: winningTariff.name,
          charge_profile_id: cp.id,
          charge_name: cp.charge_name,
          name: cp.name,
          unit_of_measure: cp.unit_of_measure,
          calculation_mode: cp.calculation_mode,
          amount_cents: resolved.amount_cents,
          minimum_amount_cents: resolved.minimum_amount_cents,
          tier_id: resolved.tier_id,
          duration_seconds: resolved.duration_seconds,
          percentage_based_on: cp.percentage_based_on || null,
          percentage_charge_code: cp.percentage_charge_code || null,
          source: 'driver_tariff',
        });
```

- [ ] **Step 4: Update the auto-add fallback branch**

Find the similar block around line 159–171:

```javascript
        matchedCharges.push({
          tariff_id: null,
          tariff_name: null,
          charge_profile_id: cp.id,
          charge_name: cp.charge_name,
          name: cp.name,
          unit_of_measure: cp.unit_of_measure,
          calculation_mode: cp.calculation_mode,
          amount_cents: getDriverProfileAmount(cp),
          percentage_based_on: cp.percentage_based_on || null,
          percentage_charge_code: cp.percentage_charge_code || null,
          source: 'auto_add',
        });
```

Replace with:

```javascript
        const tiers = activeTiersForDriverProfile(cp);
        const resolved = resolveAmountCents(
          { tiers, calculation_mode: cp.calculation_mode, unit_of_measure: cp.unit_of_measure },
          { load, routingEvents: load.routing_events || [] }
        );
        matchedCharges.push({
          tariff_id: null,
          tariff_name: null,
          charge_profile_id: cp.id,
          charge_name: cp.charge_name,
          name: cp.name,
          unit_of_measure: cp.unit_of_measure,
          calculation_mode: cp.calculation_mode,
          amount_cents: resolved.amount_cents,
          minimum_amount_cents: resolved.minimum_amount_cents,
          tier_id: resolved.tier_id,
          duration_seconds: resolved.duration_seconds,
          percentage_based_on: cp.percentage_based_on || null,
          percentage_charge_code: cp.percentage_charge_code || null,
          source: 'auto_add',
        });
```

- [ ] **Step 5: Delete the legacy `getDriverProfileAmount` function**

Find `getDriverProfileAmount` around line 254 and delete the entire function + its JSDoc header.

- [ ] **Step 6: Syntax check**

```bash
node --check "C:/Users/bento/app-drayagedirect/lib/driver-tariff-engine.js"
```

Expected: clean (no output) or "SYNTAX OK".

- [ ] **Step 7: Commit**

```bash
git add lib/driver-tariff-engine.js
git commit -m "$(cat <<'EOF'
refactor(pricing): AP engine uses shared tier resolver

Replaces local getDriverProfileAmount (tiers[0] of active version) with
the shared resolveAmountCents() helper. activeTiersForDriverProfile()
unwraps AP's version → tier nesting so the shared resolver sees a flat
tier list (AR doesn't version tiers).

Output now honors calculation_mode (between_statuses / by_event /
by_move / by_leg) and time-based UOMs (per_hour / per_day / per_Nmin).
matchedCharges carries tier_id + duration_seconds for diagnostic tracing.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase 4 — Diagnostic + Verification

### Task 4.1: Extend AP diagnostic to surface selected tier + duration

**Files:**
- Modify: `pages/api/tenant/loads/[id]/recalculate-driver-pay.js`

**Context:** The AP diagnostic endpoint returns a per-charge trace. Our refactor adds `tier_id` and `duration_seconds` to every matched charge. Surface them so the UI viewer modal (per `feature_driver_charge_profiles.md`) can explain *why* a detention charge resolved to $225 (for example, "3h 0m × $75/hr").

- [ ] **Step 1: Read current diagnostic shape**

Run:

```bash
grep -n "matchedCharges\|diagnostic\|tier_id\|duration" "C:/Users/bento/app-drayagedirect/pages/api/tenant/loads/[id]/recalculate-driver-pay.js" | head -40
```

- [ ] **Step 2: Include tier_id and duration_seconds in the diagnostic response**

In the diagnostic response object — wherever the per-charge trace is assembled (grep for `matched: true` or `auto_add` inside that file) — add `tier_id` and `duration_seconds` pass-through. If the handler currently does:

```javascript
autoAddResults.push({
  profile_id: cp.id,
  name: cp.name,
  matched: true,
  amount_cents: charge.amount_cents,
});
```

Change to:

```javascript
autoAddResults.push({
  profile_id: cp.id,
  name: cp.name,
  matched: true,
  amount_cents: charge.amount_cents,
  tier_id: charge.tier_id || null,
  duration_seconds: charge.duration_seconds || 0,
});
```

Do the same for the main tariff-match branch if it has an equivalent trace object. (The existing memory note says the shape already exposes `auto_add_results` — grep for that name specifically.)

- [ ] **Step 3: Commit**

```bash
git add "pages/api/tenant/loads/[id]/recalculate-driver-pay.js"
git commit -m "$(cat <<'EOF'
feat(pricing): surface tier_id + duration_seconds in AP diagnostic

Lets the viewer modal explain resolved amounts (e.g. 'Detention: 3h 0m
\u00d7 \$75/hr = \$225') instead of showing a bare dollar figure with no
trace back to the tier.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 4.2: Manual verification — four scenarios

**Files:** none (verification only)

**Context:** No test framework exists. Verification is seed-and-check against the live diagnostic endpoint.

- [ ] **Step 1: Build check first**

```bash
cd "C:/Users/bento/app-drayagedirect" && npm run build
```

Expected: build passes. If a lint or type error blocks the build, fix in place and re-run before moving on.

- [ ] **Step 2: Scenario A — fixed flat amount (regression check)**

In the app (dev server), create or pick any driver charge profile with:
- `unit_of_measure = fixed`
- `calculation_mode = null` (or any — fixed ignores it)
- Single tier with `amount_cents = 50000` ($500.00)

Assign it to a load via a driver tariff. Call `POST /api/tenant/loads/[id]/recalculate-driver-pay` (exists; used by the existing "Recalculate" button on the Driver Pay tab).

**Expected:** diagnostic returns `amount_cents: 50000`. Pre-refactor behavior preserved.

- [ ] **Step 3: Scenario B — between_statuses per_hour (the headline fix)**

Create a driver charge profile with:
- `unit_of_measure = per_hour`
- `calculation_mode = between_statuses`
- Tier: `from_status = arrived_pickup`, `to_status = delivered`, `amount_cents = 7500` ($75/hr), `free_units = 0`

Create a load whose routing events have:
- `pull` event with `arrived_at = 2026-04-15T10:00:00Z`
- `deliver` event with `departed_at = 2026-04-15T13:30:00Z`

Recalculate driver pay.

**Expected:** `amount_cents = 26250` ($262.50 = 3.5 hours × $75), `duration_seconds = 12600`. This is the silent-wrong-answer case the audit flagged — before the refactor it would have returned $75 flat.

- [ ] **Step 4: Scenario C — by_event tier selection**

Create a driver charge profile with:
- `unit_of_measure = fixed`
- `calculation_mode = by_event`
- Two tiers: `event_type = 'pull'` at $100; `event_type = 'deliver'` at $50.

Assign to a load that has a `pull` event but no `deliver` event yet.

**Expected:** `amount_cents = 10000` ($100 — the `pull` tier wins because it's the first matching tier on an event that exists).

- [ ] **Step 5: Scenario D — by_leg tier selection (AP-specific)**

Create a driver charge profile with:
- `unit_of_measure = fixed`
- `calculation_mode = by_leg`
- Tier: `leg_from = 'pick_up_container'`, `leg_to = 'deliver_container'`, `amount_cents = 50000` ($500)

Assign to a load with both a `pull` event (sequence 0) and a `deliver` event (sequence 1).

**Expected:** `amount_cents = 50000`. The tier matches because `pull` appears before `deliver` in the sequence order. Location filtering is deferred to Plan B — ignore tier's `leg_from_location_*` fields for now.

- [ ] **Step 6: If any scenario fails, debug and fix before moving on**

The most likely failure modes:
- STATUS_TO_EVENT map missing a key the profile used — add it in `pricing-duration.js`.
- Routing events not hydrated — double-check Task 2.1 landed and the AP hydration block at line 40 is intact.
- Version wrapper issue on AP — `activeTiersForDriverProfile` returned empty; add a log line and investigate.

- [ ] **Step 7: After all four scenarios pass, dark-mode QA on the Driver Pay tab**

Per `qa_zoom_responsive.md`, verify:
- Light mode + dark mode: line items render correctly, amounts match diagnostic.
- Zoom 80–125%: no overflow or truncation on the Driver Pay table.

---

### Task 4.3: Document deferred scope in the engine files

**Files:**
- Modify: `lib/tariff-engine.js` (top-of-file JSDoc)
- Modify: `lib/driver-tariff-engine.js` (top-of-file JSDoc)

**Context:** Future readers need to know what's *not* implemented so they don't assume location matching or radius rates work.

- [ ] **Step 1: Append a "Scope" section to AR engine header comment**

At the top of `lib/tariff-engine.js`, the existing block-comment documentation ends around line 17. Append (before the `import`):

```javascript
/**
 * Scope notes (2026-04-15):
 *
 *   Implemented calculation modes:  between_statuses (with per_hour / per_day /
 *                                   per_Nmin UOMs), by_lane, by_event, by_move.
 *   Implemented UOMs:               fixed, percentage, per_hour, per_day,
 *                                   per_15min, per_30min, per_45min.
 *   Deferred (Plan B):              event_location_type / id / value filtering,
 *                                   profile_group resolution, radius_tiers,
 *                                   per_miles, per_road_toll_miles, per_pounds.
 *   Deferred (Plan C):              AR-side diagnostic tracer (parity with
 *                                   recalculate-driver-pay).
 */
```

- [ ] **Step 2: Append the same-shaped block to AP engine**

At the top of `lib/driver-tariff-engine.js` before the `import`:

```javascript
/**
 * Scope notes (2026-04-15):
 *
 *   Implemented calculation modes:  between_statuses, by_event, by_move, by_leg.
 *   Implemented UOMs:               fixed, percentage (incl. ar_invoice + driver_pay),
 *                                   per_hour, per_day, per_15/30/45min.
 *   Deferred (Plan B):              event_location_* + leg_*_location_* filtering,
 *                                   radius_tiers, per_miles, per_pounds.
 *   Deferred (Plan C):              oo_benchmark data source — currently falls
 *                                   through to first non-percentage charge
 *                                   (silent approximation). Either add a
 *                                   benchmark table or remove the UI option.
 */
```

- [ ] **Step 3: Commit**

```bash
git add lib/tariff-engine.js lib/driver-tariff-engine.js
git commit -m "$(cat <<'EOF'
docs(pricing): document scope + deferred items in both engines

Makes it explicit which calculation modes + UOMs the engines actually
compute vs. which are stored-but-ignored (pending Plan B / Plan C).
Prevents future readers from assuming location matching or radius tiers
work when they don't yet.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Verification Summary

After every task is complete:

1. All commits present — `git log --oneline | head -15` should show ~10 fresh commits.
2. `npm run build` succeeds.
3. Four manual scenarios (A fixed, B per_hour, C by_event, D by_leg) all produce the expected amounts via the recalculate-driver-pay diagnostic.
4. Existing "fixed" AR/AP flows (the only mode that worked before) still return the same dollar amounts.
5. Dark mode + zoom QA on Driver Pay tab.
6. Diagnostic viewer modal shows `duration_seconds` (if wired on the UI — optional for this plan; Plan C polishes it).

## Integration Notes

- **Prompts for follow-up plans:** Once Plan A lands, the remaining blockers are location-aware matching (Plan B) and diagnostic/UX parity (Plan C). Each is independent — Plan B can ship without Plan C.
- **Critical files for Plan B reference:** `migrations/067_driver_pay_rates.sql` lines 103–121 (event_location_* + leg_*_location_* columns already exist in schema). Plan B extends `selectTier()` in `lib/pricing-tier-resolver.js` — no new helpers needed, just new filter branches.
- **Customer-visible effect of Plan A:** Drayage companies using per_hour detention, per_day layover, or by_leg driver pay will see *correct* amounts for the first time. Pre-refactor they were getting a silent wrong answer (flat rate where a multiplier was expected).
