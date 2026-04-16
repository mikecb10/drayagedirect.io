# Pricing Engine Completion — Plan B: Location-Aware Tier Matching

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Teach `selectTier()` in `lib/pricing-tier-resolver.js` to filter `by_event` and `by_leg` tiers by their stored location constraints (`event_location_type` + `event_location_id` / `event_location_value`, and the `leg_from_location_*` + `leg_to_location_*` trio on AP). Currently those schema columns are collected by the UI and persisted to the DB but ignored by the engine — a tier that says "Pay $50 for pickup in Dallas" pays $50 for pickup anywhere.

**Architecture:** Add one pure helper `matchesLocationFilter(tier, event, prefix)` to `lib/pricing-tier-resolver.js`. Extend the `by_event` and `by_leg` switch branches to run that filter before accepting a tier. Extend the routing-events hydration in both engines (and the AP diagnostic endpoint) to SELECT the location fields that matching needs. No new files, no new tables.

**Tech Stack:** Pure JavaScript, same ESM pattern as Plan A helpers. No external dependencies.

## Scope (what's in)

| Location type | by_event (both engines) | by_leg (AP only) | How matched |
|---|---|---|---|
| `org` | ✅ | ✅ | `tier.*_location_id === routing_event.location_id` |
| `city_state` | ✅ | ✅ | Normalize both sides to `"city, state"` lowercase, string equal |
| `zip` | ✅ | ✅ | Normalize both sides by trimming/lower, string equal |
| null fields on tier | ✅ (wildcard) | ✅ (wildcard) | Unconstrained tier matches any event |

**Also shipping:**
- Extend the routing-events hydration `.select()` in both engines + the AP diagnostic endpoint to include `location_id, city, state, zip` columns that live on `order_routing_events` already (migration 003).
- AR `by_lane` mode (existing) left untouched — it uses `tier.pickup_location_id` / `delivery_location_id` / `return_location_id` against the load's org FKs. That's already correct for by_lane.

## Scope (deferred to later plans — spelled out so reviewers know what's missing)

**Plan C — Distance + weight UOMs:**
- `per_miles` + `per_road_toll_miles` UOMs (need to either read `orders.actual_miles` or integrate a server-side distance service; client-side `utils/getDistanceMiles.js` can't be called from the engine).
- `per_pounds` UOM (uses `load.weight_lbs`, easy but grouped with the distance work for coherence).
- `radius_rate` UOM (distance-tiered pricing, depends on server-side distance).

**Plan D — Remaining polish:**
- `profile_group` location type — currently listed as a valid `event_location_type` value but no `profile_groups` / `profile_group_members` tables exist yet. Requires schema migration + UI before the engine can match.
- `oo_benchmark` percentage source — still a silent-fallback UI option until we add a benchmark data source.
- AR diagnostic tracer endpoint parity with `recalculate-driver-pay.js`.

## File Structure

**Modified files:**
- `lib/pricing-tier-resolver.js` — new `matchesLocationFilter()` helper + wired into `by_event` and `by_leg` branches in `selectTier()`
- `lib/tariff-engine.js` — extend hydration select to include location fields
- `lib/driver-tariff-engine.js` — same hydration extension
- `pages/api/tenant/loads/[id]/recalculate-driver-pay.js` — same hydration extension (this endpoint hydrates events locally for its diagnostic trace)

**New files:** none.

---

## Phase 1 — Expand Routing Events Hydration

### Task 1.1: Widen the engine hydration selects

**Files:**
- Modify: `lib/tariff-engine.js`
- Modify: `lib/driver-tariff-engine.js`

**Context:** Both engines currently hydrate routing events with only the columns needed for timestamp lookup. Location matching needs `location_id` (for `org` type) and `city`, `state`, `zip` (for `city_state` / `zip` types), all of which are already stored on `order_routing_events` (see migration 003).

- [ ] **Step 1: Update `lib/tariff-engine.js` hydration select**

Find the hydration block (landed in Task 2.1 of Plan A, commit `ad8dde9`). The current select looks like:

```javascript
    const { data: events } = await svc
      .from('order_routing_events')
      .select('id, event_type, arrived_at, departed_at, sequence')
      .eq('tenant_id', tenantId)
      .eq('order_id', load.id)
      .order('sequence', { ascending: true });
```

Replace the `.select(...)` line with:

```javascript
      .select('id, event_type, arrived_at, departed_at, sequence, location_id, city, state, zip')
```

- [ ] **Step 2: Update `lib/driver-tariff-engine.js` hydration select**

Same change — find the hydration block at the top of `findMatchingDriverCharges` and replace the select. The surrounding code is identical to AR's.

- [ ] **Step 3: Syntax-check and commit**

```bash
cd "C:/Users/bento/app-drayagedirect"
node --check lib/tariff-engine.js
node --check lib/driver-tariff-engine.js
git add lib/tariff-engine.js lib/driver-tariff-engine.js
git commit -m "$(cat <<'EOF'
fix(pricing): hydrate event location fields in both engines

Widens the .select() on the routing_events hydration in both engines
to include location_id + city + state + zip. These columns live on
order_routing_events already (migration 003) — they're needed by the
upcoming location-aware tier matcher in selectTier() so a tier can
say "match pickup in Dallas, TX" and the engine can compare against
the actual pull event's city/state.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 1.2: Widen the AP diagnostic's local hydration

**Files:**
- Modify: `pages/api/tenant/loads/[id]/recalculate-driver-pay.js`

**Context:** The diagnostic endpoint pulls routing events separately (so the diagnostic trace can evaluate profile conditions the same way the engine will). Its `.select()` needs the same widening.

- [ ] **Step 1: Read the file** to find the routing-events fetch. Grep for `order_routing_events` to locate.

- [ ] **Step 2: Update the select**

Find the hydration block (described in the file comment: "live_orders is a view so we can't rely on PostgREST FK embedding — do a separate query instead"). Replace the select with:

```javascript
    .select('id, event_type, arrived_at, departed_at, sequence, location_id, city, state, zip')
```

- [ ] **Step 3: Syntax-check and commit**

```bash
cd "C:/Users/bento/app-drayagedirect"
node --check "pages/api/tenant/loads/[id]/recalculate-driver-pay.js"
git add "pages/api/tenant/loads/[id]/recalculate-driver-pay.js"
git commit -m "$(cat <<'EOF'
fix(pricing): hydrate event location fields in AP diagnostic endpoint

Matches the engine hydration change in the previous commit so the
diagnostic's view of events is the same as the engine's. Prevents
"engine matched but diagnostic says no" confusion when a location-
scoped tier is in play.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase 2 — Location Filter Helper + Wire Into Mode Branches

### Task 2.1: Add `matchesLocationFilter()` to the tier resolver

**Files:**
- Modify: `lib/pricing-tier-resolver.js`

**Context:** Both `by_event` (tiers carry `event_location_type` / `event_location_id` / `event_location_value`) and `by_leg` (AP tiers carry `leg_from_location_*` + `leg_to_location_*` trios) need the same filter logic. Extract it once so both branches use the same rules.

- [ ] **Step 1: Add the helper**

Open `lib/pricing-tier-resolver.js`. Find the `legFromToEvent` helper (around line 126). Add the new helper `matchesLocationFilter` immediately ABOVE `legFromToEvent`:

```javascript
/**
 * Check if a tier's location filter matches a routing event.
 *
 * Tiers can scope a rate to a specific location using three columns
 * (or trios on by_leg tiers):
 *   - <prefix>_type:  'org' | 'city_state' | 'zip' | 'profile_group'
 *   - <prefix>_id:    UUID (when type = 'org')
 *   - <prefix>_value: free text (when type = 'city_state' or 'zip')
 *
 * When the type is null/empty, the tier is unconstrained → match.
 * When the type is 'profile_group', we fall through to match (deferred
 * to Plan D — the profile_groups table doesn't exist yet).
 *
 * @param {object} tier — a tier row
 * @param {object} event — a routing event with location_id, city, state, zip
 * @param {string} prefix — field prefix: 'event_location', 'leg_from_location', or 'leg_to_location'
 * @returns {boolean}
 */
function matchesLocationFilter(tier, event, prefix) {
  const type = tier?.[`${prefix}_type`];

  // No type set → tier doesn't care about location. Match.
  if (!type) return true;

  // profile_group is a declared UI value but has no data source yet.
  // Fail-open so the UI doesn't appear broken while the feature is
  // stubbed; Plan D adds real filtering once the tables land.
  if (type === 'profile_group' || type === 'profile') return true;

  if (!event) return false;

  if (type === 'org') {
    const tid = tier?.[`${prefix}_id`];
    if (!tid) return false;
    return event.location_id === tid;
  }

  if (type === 'city_state') {
    const raw = tier?.[`${prefix}_value`];
    if (!raw) return false;
    return normalizeCityState(raw) === normalizeCityState(`${event.city || ''}, ${event.state || ''}`);
  }

  if (type === 'zip') {
    const raw = tier?.[`${prefix}_value`];
    if (!raw) return false;
    return normalizeZip(raw) === normalizeZip(event.zip || '');
  }

  // Unknown type → fail-closed. Better to miss a match than to bill wrong.
  return false;
}

/**
 * Normalize a "City, ST" style string for comparison:
 * lowercase, collapse whitespace, strip trailing commas, tolerate
 * missing or extra commas ("Dallas TX" / "Dallas,TX" / "Dallas, TX"
 * all compare equal).
 */
function normalizeCityState(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/,/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Normalize a zip for comparison. Accepts "75201", "75201-1234", " 75201 "
 * and compares on the 5-digit prefix only (zip+4 suffix is routing noise
 * for pricing purposes; the 5-digit base defines the market).
 */
function normalizeZip(s) {
  const digits = String(s || '').replace(/[^0-9]/g, '');
  return digits.slice(0, 5);
}

```

- [ ] **Step 2: Syntax-check**

```bash
node --check "C:/Users/bento/app-drayagedirect/lib/pricing-tier-resolver.js"
```

(No commit yet — bundles with Task 2.2.)

---

### Task 2.2: Wire location filter into `by_event`

**Files:**
- Modify: `lib/pricing-tier-resolver.js`

**Context:** The current `by_event` branch finds the first tier whose `event_type` appears on the load. We need to additionally require that the MATCHING event passes the tier's location filter. When a tier has no location constraints, behavior is unchanged.

- [ ] **Step 1: Update the `by_event` case**

Find the `case 'by_event':` block in `selectTier()` (around line 71). The current body is:

```javascript
    case 'by_event': {
      // Match the first tier whose event_type appears on the load.
      // Location matching (event_location_id / type / value) deferred to Plan B.
      // Lowercase both sides to tolerate any mixed-case imported event_types.
      const eventTypes = new Set(
        (context?.routingEvents || [])
          .map((e) => (e.event_type || '').toLowerCase())
          .filter(Boolean)
      );
      const hit = active.find((t) => t.event_type && eventTypes.has(t.event_type.toLowerCase()));
      return hit || active[0];
    }
```

Replace with:

```javascript
    case 'by_event': {
      // Match the first tier whose event_type appears on the load AND
      // whose location filter (if any) matches that specific event.
      // Lowercase event_type comparison to tolerate mixed-case data.
      const events = context?.routingEvents || [];
      const hit = active.find((t) => {
        if (!t.event_type) return false;
        const want = t.event_type.toLowerCase();
        // Find the first event on the load whose type matches the tier AND
        // whose location satisfies the tier's location filter. If the tier
        // has no location filter, any event of that type matches.
        const event = events.find((e) =>
          (e.event_type || '').toLowerCase() === want &&
          matchesLocationFilter(t, e, 'event_location')
        );
        return Boolean(event);
      });
      return hit || active[0];
    }
```

- [ ] **Step 2: Syntax-check**

```bash
node --check "C:/Users/bento/app-drayagedirect/lib/pricing-tier-resolver.js"
```

(Bundle with Task 2.3.)

---

### Task 2.3: Wire location filter into `by_leg`

**Files:**
- Modify: `lib/pricing-tier-resolver.js`

**Context:** By-leg tiers (AP only) already match a `from → to` pair in the event sequence. Now they should also pass through location filters on both ends.

- [ ] **Step 1: Update the `by_leg` case**

Find the `case 'by_leg':` block. The current body is:

```javascript
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
      // Note: legs like 'lift_on' exist in LEG_OPTIONS (UI) but don't
      // correspond to a stored order_routing_events.event_type today.
      // Those tiers will never match here and fall through to active[0].
      // Mapping is unblocked in Plan B when lift events land on routing.
      return hit || active[0];
    }
```

Replace with:

```javascript
    case 'by_leg': {
      // AP only. Match leg_from + leg_to against the routing event sequence,
      // AND require both endpoints' location filters (if set) to match.
      const events = context?.routingEvents || [];
      const hit = active.find((t) => {
        if (!t.leg_from || !t.leg_to) return false;
        const wantFrom = legFromToEvent(t.leg_from);
        const wantTo   = legFromToEvent(t.leg_to);
        // Find the first from-event that satisfies leg_from_location_*.
        // Then find the first to-event AFTER it that satisfies leg_to_location_*.
        // Scanning the sequence this way lets a tier say "pickup in Dallas →
        // deliver in Oklahoma City" and only match when BOTH endpoints line up.
        const fromIdx = events.findIndex((e) =>
          e.event_type === wantFrom && matchesLocationFilter(t, e, 'leg_from_location')
        );
        if (fromIdx < 0) return false;
        const toIdx = events.findIndex((e, i) =>
          i > fromIdx && e.event_type === wantTo && matchesLocationFilter(t, e, 'leg_to_location')
        );
        return toIdx >= 0;
      });
      // Note: legs like 'lift_on' exist in LEG_OPTIONS (UI) but don't
      // correspond to a stored order_routing_events.event_type yet. Those
      // tiers fall through to active[0]. Tracked for a future routing update.
      return hit || active[0];
    }
```

- [ ] **Step 2: Syntax-check**

```bash
node --check "C:/Users/bento/app-drayagedirect/lib/pricing-tier-resolver.js"
```

- [ ] **Step 3: Commit Phase 2 (Tasks 2.1 + 2.2 + 2.3 together)**

```bash
cd "C:/Users/bento/app-drayagedirect"
git add lib/pricing-tier-resolver.js
git commit -m "$(cat <<'EOF'
feat(pricing): location-aware by_event and by_leg tier selection

Adds matchesLocationFilter() — a pure helper that compares a tier's
{event,leg_from,leg_to}_location_{type,id,value} against a routing
event's location_id / city / state / zip. Handles the three active
location types:

  org         → tier.*_location_id === event.location_id
  city_state  → normalized "City, ST" compare (tolerates variations)
  zip         → normalized 5-digit zip compare

Null tier location fields mean "unconstrained" (match anything). The
'profile_group' type is fail-open until the schema lands (Plan D).

Wires the filter into selectTier()'s by_event and by_leg branches.
Pre-refactor behavior: these modes matched on event_type alone, so
a tier saying "$50 for pickup in Dallas" paid $50 for pickup anywhere.
Post-refactor: location filters are honored. Unconstrained tiers
continue to behave as before (backward-compatible).

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase 3 — Documentation + Scope Update

### Task 3.1: Update engine scope notes

**Files:**
- Modify: `lib/tariff-engine.js`
- Modify: `lib/driver-tariff-engine.js`

**Context:** The JSDoc scope blocks at the top of each engine (added in Plan A Task 4.3) list `event_location_*` filtering as deferred to Plan B. Update them to reflect current reality.

- [ ] **Step 1: Update `lib/tariff-engine.js` scope block**

Find the scope block at the top of the file (the JSDoc comment starting with `Scope notes (2026-04-15)`). Replace the entire block with:

```javascript
/**
 * Scope notes (last updated 2026-04-15, Plan B):
 *
 *   Implemented calculation modes:  between_statuses (with per_hour / per_day /
 *                                   per_Nmin UOMs), by_lane, by_event (with
 *                                   location filter: org / city_state / zip),
 *                                   by_move.
 *   Implemented UOMs:               fixed, percentage, per_hour, per_day,
 *                                   per_15min, per_30min, per_45min.
 *   Deferred (Plan C):              per_miles, per_road_toll_miles, per_pounds,
 *                                   radius_tiers, AR-side diagnostic tracer.
 *   Deferred (Plan D):              profile_group location type (fail-open
 *                                   until profile_groups schema lands).
 */
```

- [ ] **Step 2: Update `lib/driver-tariff-engine.js` scope block**

Same pattern. Replace the existing scope block with:

```javascript
/**
 * Scope notes (last updated 2026-04-15, Plan B):
 *
 *   Implemented calculation modes:  between_statuses, by_event (with location
 *                                   filter), by_move, by_leg (with from AND to
 *                                   location filters: org / city_state / zip).
 *   Implemented UOMs:               fixed, percentage (incl. ar_invoice + driver_pay),
 *                                   per_hour, per_day, per_15/30/45min.
 *   Deferred (Plan C):              per_miles, per_pounds, radius_tiers.
 *   Deferred (Plan D):              oo_benchmark data source, profile_group
 *                                   location type (fail-open until schema lands).
 */
```

- [ ] **Step 3: Commit**

```bash
cd "C:/Users/bento/app-drayagedirect"
git add lib/tariff-engine.js lib/driver-tariff-engine.js
git commit -m "$(cat <<'EOF'
docs(pricing): update engine scope notes after Plan B

Location-aware matching for by_event (both engines) and by_leg (AP)
shipped in the previous commits. Scope blocks now reflect current
reality: org / city_state / zip filters implemented, profile_group
fail-open, distance + weight UOMs still deferred (Plan C).

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase 4 — Verification

### Task 4.1: Build check + smoke grep

**Files:** none (verification only)

- [ ] **Step 1: Syntax check every touched file**

```bash
cd "C:/Users/bento/app-drayagedirect"
node --check lib/pricing-tier-resolver.js
node --check lib/tariff-engine.js
node --check lib/driver-tariff-engine.js
node --check "pages/api/tenant/loads/[id]/recalculate-driver-pay.js"
```

Expected: all four clean (no output or explicit OK).

- [ ] **Step 2: Confirm no accidental regressions in the switch**

```bash
grep -n "case 'by_event'\|case 'by_leg'" lib/pricing-tier-resolver.js
```

Expected: exactly one match per case. If two matches, the Edit tool duplicated a block — unwind the bad change.

- [ ] **Step 3: Confirm the helper is exported at module scope but NOT as a public export**

```bash
grep -n "matchesLocationFilter\|normalizeCityState\|normalizeZip" lib/pricing-tier-resolver.js
```

Expected: `matchesLocationFilter` referenced 3 times (definition + 2 call sites inside `selectTier`), `normalizeCityState` referenced twice (definition + 2 calls = 3? Actually 2 — definition + 1 call at the `city_state` branch which uses it twice), `normalizeZip` 3 times. None should be in an `export` statement.

---

### Task 4.2: Manual scenarios for Cowork

**Files:** none (handed to QA)

**Context:** This is where Cowork runs new scenarios against the live dev server to verify location filtering actually works. These scenarios must cover: (a) unconstrained tiers still work, (b) `org` filter positive + negative, (c) `city_state` filter, (d) `zip` filter, (e) by_leg with both endpoint filters.

The same `recalculate-driver-pay` diagnostic endpoint used in Plan A verification is reused here. The response now reflects location-scoped tier selection.

- [ ] **Step 1: Write a fresh Cowork prompt file**

Create `docs/superpowers/plans/2026-04-15-plan-b-cowork-verification.md` with scenario specs:

- **Scenario B1 (regression):** An existing unconstrained by_event tier (no location set) must still match any event of its type. Confirms backward compatibility.
- **Scenario B2 (org positive):** Tier `event_location_type='org'`, `event_location_id=<UUID of pickup org>`. Load has a `pull` event at that org. Expect match.
- **Scenario B3 (org negative):** Same profile; load's pickup is at a DIFFERENT org. Expect `active[0]` fallback (current semantics) or 0 if no unconstrained tier exists.
- **Scenario B4 (city_state):** Tier `event_location_type='city_state'`, `event_location_value='Dallas, TX'`. Load's pull event has `city='Dallas', state='TX'`. Expect match.
- **Scenario B5 (zip):** Tier `event_location_type='zip'`, `event_location_value='75201-1234'`. Load's pull event has `zip='75201'`. Expect match (zip+4 suffix ignored).
- **Scenario B6 (by_leg both filters):** Tier `leg_from='pick_up_container'`, `leg_from_location_type='city_state'`, `leg_from_location_value='Dallas, TX'`, `leg_to='deliver_container'`, `leg_to_location_type='city_state'`, `leg_to_location_value='Oklahoma City, OK'`. Load has pull in Dallas and deliver in OKC. Expect match.

For each scenario, provide expected diagnostic-response values (`amount_cents`, `tier_id`) and a troubleshooting section.

- [ ] **Step 2: Commit the Cowork prompt**

```bash
git add "docs/superpowers/plans/2026-04-15-plan-b-cowork-verification.md"
git commit -m "$(cat <<'EOF'
docs(pricing): Cowork verification prompt for Plan B

Six scenarios covering backward-compat (unconstrained), org filter
(positive + negative), city_state filter, zip normalization, and
by_leg with both endpoint filters. Handed to QA for live validation.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Verification Summary

After every task is complete:

1. All commits present — `git log --oneline 7d02c19..HEAD` should show ~5 fresh commits.
2. `node --check` clean on all four touched files.
3. `grep` smoke tests pass (one hit per case in the switch, helper referenced at expected sites).
4. Cowork runs the 6 manual scenarios and reports back pass/fail per the verification prompt.
5. No regression on the 4 Plan A scenarios — tiers without location filters still behave exactly as before.

## Integration Notes

- **Follow-up plan C** extends the same resolver with distance/weight UOMs (`per_miles`, `per_pounds`, `radius_tiers`). Those require either a server-side distance service or a populated `orders.actual_miles` column — they're genuinely deferred, not just scheduled.
- **Follow-up plan D** adds `profile_group` support (new `profile_groups` + `profile_group_members` tables + UI) and `oo_benchmark` (needs a benchmark data source). Both require schema work before engine work.
- **Customer-visible effect of Plan B:** drayage companies using location-scoped rates — "$50 detention only at Long Beach terminals", "$500 bonus for deliveries in Southern California zip codes", etc. — will see those rates apply correctly for the first time. Pre-Plan-B, the location constraint was stored but ignored; every load matched regardless.
