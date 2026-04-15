# Plan B Cowork Verification — Location-Aware Tier Matching

## Context

A pricing engine enhancement landed (Plan B). The shared tier resolver at `lib/pricing-tier-resolver.js` previously matched `by_event` tiers by `event_type` alone and `by_leg` tiers by `leg_from`→`leg_to` sequence alone, silently ignoring their location-filter columns (`event_location_type/_id/_value` on both engines; `leg_from_location_*` + `leg_to_location_*` on AP). The columns were collected by the UI and persisted to the DB, but the engine treated every tier as if it had no location constraint.

**Plan B fixes this.** Tiers with `event_location_type='org'` now match only events at that org. `city_state` and `zip` types work the same way — a tier can say "match pickup in Dallas, TX" and only tier-match when the load's `pull` event's city/state agrees.

**Your job:** run six scenarios against the dev server to confirm location filtering works AND that unconstrained tiers still match (backward compatibility).

Three of the four Plan A scenarios should also still pass unchanged (A fixed, B per_hour, C by_event unconstrained, D by_leg unconstrained). If any Plan A scenario regresses, that's a red flag.

---

## Setup

**Project:** `C:\Users\bento\app-drayagedirect` (Next.js 15, Supabase).

**Dev server:**
```bash
cd C:\Users\bento\app-drayagedirect
npm run dev
```
URL: `http://localhost:3001` (port 3000 may be held by a zombie process — ignore it). If you hit `ENOENT: .next/server/pages/_document.js`, `rm -rf .next` and restart.

**Login:** tenant test credentials from the team.

**UI locations:**
- Driver charge profiles: `/drivers` → Pay Rates → Driver Charge Profiles
- Driver tariffs: `/drivers` → Pay Rates → Driver Tariffs
- Loads: `/dispatcher`
- Routing events on a load: open the load → Routing tab (edit timestamps + locations here)
- Recalculate driver pay: open the load → Driver Pay tab → "Recalculate" button, OR POST to `/api/tenant/loads/<LOAD_ID>/recalculate-driver-pay`

**Diagnostic response shape:** the endpoint returns `{ charges: [...], diagnostic: {...} }`. Each charge has `name, charge_name, amount_cents, tier_id, duration_seconds, duration_label, source`. You're checking `amount_cents` and `tier_id` primarily.

---

## Scenarios

Each scenario creates (or reuses) one test profile + one test load configuration, runs Recalculate, and compares against the expected result. Re-use existing profiles from Plan A when possible (`Test A — Fixed Linehaul`, `Test C — Per-Event Bonus`, etc.) to save setup time.

### Scenario B1 — Regression (unconstrained `by_event` still matches)

**What it tests:** A tier with no location filter set (plain `by_event` + `unit_of_measure=fixed`) must still match any event of its type. Breaks backward compatibility if this fails.

**Setup:** Reuse `Test C — Per-Event Bonus` from Plan A.
- Calculation mode: `By Event`
- UOM: `Fixed`
- Two tiers: `event_type=pull` @ $100; `event_type=deliver` @ $50 (if UI still limits to one, the test still works — just the first tier matters).
- **Important:** leave `event_location_type` blank / null on BOTH tiers. This is the unconstrained state.

**Load:** any load with a `pull` event fired and `deliver` NOT fired.

**Expected:**
- `amount_cents: 10000`
- `tier_id`: the `pull` tier's UUID

**Pass:** $100.00 ✅. Confirms null-location tiers still behave as before.

---

### Scenario B2 — Org filter (positive)

**What it tests:** `event_location_type='org'` matches when the tier's `event_location_id` equals the routing event's `location_id`.

**Setup:**
1. Pick a test load in `/dispatcher`. Note the **pickup org UUID** — this is `load.pickup_location_id`. Open the Routing tab and confirm the `pull` event's location matches the load's pickup org. Note the `pull` event's `location_id` (should be the same UUID; if not, edit so they agree).

2. Create a new driver charge profile:
   - Name: `Test B2 — Org Filter Positive`
   - Charge code: `BONUS`
   - UOM: `Fixed`
   - Calculation mode: `By Event`
   - Tier:
     - `event_type = 'pull'`
     - `event_location_type = 'org'`
     - `event_location_id = <pickup org UUID from step 1>`
     - `amount_cents = 25000` ($250.00)
   - Add to a driver tariff that matches the load (or use existing test tariff).

3. Assign a driver, Recalculate.

**Expected:**
- `amount_cents: 25000`
- `tier_id`: the new tier's UUID
- `duration_seconds: 0` (fixed UOM, no duration)

**Pass:** $250.00 ✅

---

### Scenario B3 — Org filter (negative / no match)

**What it tests:** When the tier's `event_location_id` does NOT match the routing event's `location_id`, the tier should be rejected. If no other tier matches, the engine falls through to `active[0]` (the first active tier) — which is the tier itself if there's only one. That's a quirk of the current backward-compat fallback.

**Clarification on the fallback behavior:** `selectTier` uses `return hit || active[0]`. If only one tier exists and its location filter fails, `hit` is undefined and we fall through to `active[0]` — which IS that same tier. The tier is still returned, and `amount_cents` still resolves to its stored value. This is a conservative design choice (never crash; always return something). Diagnostic-level "tier matched but location didn't" reporting is a Plan C item.

**Setup:** same as B2, but change the tier's `event_location_id` to a RANDOM UUID that doesn't match any location on any test load (you can use `00000000-0000-0000-0000-000000000000`).

**Expected (current semantics):**
- `amount_cents: 25000` (fallback to active[0])
- `tier_id`: same tier UUID as before

**Expected (stricter semantics — future Plan C work):**
- `amount_cents: 0` with diagnostic flag "no location-matching tier found"

Report BOTH results:
- **Actual `amount_cents` returned.**
- Whether you agree the fallback to `active[0]` is acceptable for now given this is a known scope decision.

**The scenario "passes" if the test data flows through without crashing and the returned `amount_cents` + `tier_id` are deterministic.** We're documenting current behavior, not necessarily calling it correct.

---

### Scenario B4 — `city_state` filter

**What it tests:** `event_location_type='city_state'` compares the tier's free-text `event_location_value` against the routing event's `city` + `state` columns, after normalization (case-insensitive, punctuation-tolerant).

**Setup:**
1. Pick a load. Open the Routing tab, confirm the `pull` event has `city='Dallas'` and `state='TX'`. (Edit these fields if they aren't set; most loads have them populated from the pickup org's city/state.)

2. Create a profile:
   - Name: `Test B4 — Dallas City-State Filter`
   - Charge code: `BONUS`
   - UOM: `Fixed`
   - Calculation mode: `By Event`
   - Tier:
     - `event_type = 'pull'`
     - `event_location_type = 'city_state'`
     - `event_location_value = 'Dallas, TX'` (with comma + space — canonical form)
     - `amount_cents = 30000` ($300.00)
   - Link to driver tariff matching the load.

3. Recalculate.

**Expected:**
- `amount_cents: 30000`
- `tier_id`: the new tier's UUID

**Normalization variants to try** (if time permits — all should match the same load):
- `event_location_value = 'dallas, TX'` (lowercase) → should still match.
- `event_location_value = 'Dallas,TX'` (no space) → should still match.
- `event_location_value = 'Dallas TX'` (no comma) → should still match.
- `event_location_value = 'Houston, TX'` → should NOT match (city mismatch).

**Pass:** $300.00 on the canonical value. Bonus credit for the normalization variants all behaving correctly.

---

### Scenario B5 — `zip` filter (with zip+4 normalization)

**What it tests:** `event_location_type='zip'` compares the 5-digit prefix of both sides (ignoring zip+4 suffixes).

**Setup:**
1. Pick a load. Open the Routing tab, ensure the `pull` event has `zip='75201'` (or another plausible Dallas zip).

2. Create a profile:
   - Name: `Test B5 — Zip Filter`
   - UOM: `Fixed`
   - Calculation mode: `By Event`
   - Tier:
     - `event_type = 'pull'`
     - `event_location_type = 'zip'`
     - `event_location_value = '75201-1234'` (with zip+4 — should normalize to 75201)
     - `amount_cents = 15000` ($150.00)
   - Link to tariff.

3. Recalculate.

**Expected:**
- `amount_cents: 15000`
- `tier_id`: the new tier's UUID

**Additional cases to try:**
- `event_location_value = '75201'` (bare 5-digit) → should match.
- `event_location_value = ' 75201 '` (with whitespace) → should match.
- `event_location_value = '75202'` → should NOT match (different zip).
- Non-numeric zip on event (e.g. Canadian `'K1A 0B1'`) → should NOT match (fail-closed on both sides being null/non-numeric).

**Pass:** $150.00 on the primary case.

---

### Scenario B6 — `by_leg` with BOTH endpoint filters

**What it tests:** `by_leg` tiers honor `leg_from_location_*` on the from-event AND `leg_to_location_*` on the to-event. Both filters must match.

**Setup:**
1. Pick a load with both `pull` (sequence 0) and `deliver` events. Confirm their city/state:
   - `pull.city = 'Dallas'`, `pull.state = 'TX'`
   - `deliver.city = 'Oklahoma City'`, `deliver.state = 'OK'`
   
   Edit if needed.

2. Create a profile:
   - Name: `Test B6 — Leg-Based with Location Filters`
   - Charge code: `LINE_HAUL`
   - UOM: `Fixed`
   - Calculation mode: `By Leg`
   - Tier:
     - `leg_from = 'pick_up_container'`
     - `leg_from_location_type = 'city_state'`
     - `leg_from_location_value = 'Dallas, TX'`
     - `leg_to = 'deliver_container'`
     - `leg_to_location_type = 'city_state'`
     - `leg_to_location_value = 'Oklahoma City, OK'`
     - `amount_cents = 75000` ($750.00)
   - Link to tariff.

3. Recalculate.

**Expected:**
- `amount_cents: 75000`
- `tier_id`: the new tier's UUID

**Negative case (if time):** change `leg_to_location_value` to `'Houston, TX'` (city the load doesn't go to). Tier should not match → `amount_cents: 0` (if no other tier exists) or fallback to active[0].

**Pass:** $750.00 when both endpoints match.

---

## Report back

```
Plan B Verification Report — 2026-04-15

Scenario B1 (regression, unconstrained): <PASS/FAIL> — $<amount>, tier_id <uuid>
Scenario B2 (org positive):               <PASS/FAIL> — $<amount>, tier_id <uuid>
Scenario B3 (org negative fallback):      <amount returned>, fallback behavior <acceptable/not>
Scenario B4 (city_state):                 <PASS/FAIL> — $<amount>, tier_id <uuid>
  Variants tried: <list which ones and results>
Scenario B5 (zip with zip+4):             <PASS/FAIL> — $<amount>, tier_id <uuid>
  Variants tried: <list>
Scenario B6 (by_leg with both filters):   <PASS/FAIL> — $<amount>, tier_id <uuid>
  Negative case: <result>

Regression check (Plan A scenarios re-run briefly):
  A fixed:    <PASS/FAIL>
  B per_hour: <PASS/FAIL>
  C by_event: <PASS/FAIL>
  D by_leg:   <PASS/FAIL>

Browser console errors: <list any>
Dev server terminal errors: <list any>
```

For any FAIL, include the full diagnostic charge entry (`charges[i]`) and dump the relevant tier + load routing events:

```bash
# Tier dump
curl "http://localhost:3001/api/tenant/ap/charge-profiles/<PROFILE_ID>" \
  -H "Cookie: <session cookies>" | jq '.versions[].tiers[] | {id, event_type, event_location_type, event_location_id, event_location_value, leg_from, leg_from_location_type, leg_from_location_value, leg_to, leg_to_location_type, leg_to_location_value, amount_cents}'

# Routing events dump
curl "http://localhost:3001/api/tenant/loads/<LOAD_ID>/routing/graph" \
  -H "Cookie: <session cookies>" | jq '.events[] | {event_type, sequence, arrived_at, departed_at, location_id, city, state, zip}'
```

---

## Troubleshooting hints

- **Tier selected but amount is `active[0]`'s default** — location filter failed. Dump the tier + event fields and check which one doesn't agree. If `event_location_type='org'` but `event_location_id` doesn't appear on any routing event's `location_id`, that's the issue.
- **city_state match failing for what looks like identical strings** — check for extra whitespace or unicode characters. The normalize function lowercases + collapses whitespace + replaces commas, but doesn't normalize unicode (NFKC). If the data has smart-quotes or non-breaking spaces, both sides would need the same.
- **zip match failing when zips look the same** — `normalizeZip` returns the first 5 digits. `'75201-1234'` → `'75201'`; `''` → `null`. Both sides returning `null` is explicitly a non-match (fail-closed) to prevent false positives.
- **by_leg tier never matches** — verify the leg_to event is AFTER leg_from in sequence order. The scanner requires `toIdx > fromIdx`. A load with `deliver` at sequence 0 and `pull` at sequence 1 (weird ordering) would never match a pull→deliver tier.

---

## Plan A sanity check

If any of the original four Plan A scenarios regresses, stop and report immediately — the refactor should be fully backward compatible for tiers without location constraints. An unconstrained by_event or by_leg tier in Plan A's test profiles should behave identically after Plan B.

Good luck.
