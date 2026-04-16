# Plan C Cowork Verification — Weight + Distance UOMs + AR Diagnostic Tracer

## Context

Four new pricing features landed (Plan C):

1. **`per_pounds` UOM** — rate per pound, multiplied by `load.weight_lbs`.
2. **`per_miles` UOM** — rate per mile, multiplied by `load.actual_miles` (populated by the Routing tab's Google Distance Matrix call).
3. **`radius_rate` UOM** — tiered bracketed pricing. `tier.radius_tiers` is a JSONB array of `{amount_cents, start_distance, end_distance, rate_type}` entries. The engine picks the bracket where `actual_miles` falls within `[start_distance, end_distance]` and applies the bracket's `rate_type` (`fixed` / `per_unit` / `percentage`).
4. **AR diagnostic tracer endpoint** — `POST /api/tenant/loads/[id]/recalculate-charges-diagnostic` mirrors the AP driver-pay diagnostic but for customer tariffs. Read-only. Returns a tariff-by-tariff trace + the would-be charges list without applying anything.

**Your job:** run four scenarios against the dev server to confirm all four features work. Plus a quick regression sweep of Plan A and Plan B scenarios to catch any regressions.

---

## Setup

**Project:** `C:\Users\bento\app-drayagedirect` — Next.js 15, Supabase.

**Dev server:** `npm run dev`. URL: `http://localhost:3001`.

**Login:** tenant test credentials.

**Diagnostic response shape (for both AP + AR):**
```
{
  success: true,
  applied: <N>,           // AP: lines written; AR diagnostic: always 0
  would_apply: <N>,       // AR only
  charges: [{
    name, charge_name, unit_of_measure, calculation_mode,
    amount_cents, minimum_amount_cents, source,
    tier_id, duration_seconds, duration_label,
    pounds, pounds_label,                 // NEW (Plan C)
    miles, miles_label,                   // NEW (Plan C)
    radius_bracket_index                  // NEW (Plan C)
  }],
  diagnostic: { total_tariffs, tariffs: [...], winning_tariff_id, ... }
}
```

---

## Scenarios

### Scenario C1 — `per_pounds`

**What it tests:** Rate-per-pound multiplies by `load.weight_lbs`.

**Setup:**
1. Pick a load in `/dispatcher`. Confirm its `weight_lbs` is set (Load Info tab). Edit to **`40000`** if needed.
2. Create a driver charge profile:
   - Name: `Test C1 — Per Pound`
   - Charge code: `LINE_HAUL`
   - Unit of measure: `Per Pounds`
   - Calculation mode: any (fixed / by_event) — UOM drives the dispatch
   - Tier: `amount_cents = 50` ($0.50/lb), `free_units = 0`, `minimum_amount_cents = 0`
   - Link to a driver tariff that matches the load
3. Assign a driver, click Recalculate on the Driver Pay tab.

**Expected:**
- `amount_cents: 2000000` ($20,000.00 = 40,000 lbs × $0.50)
- `pounds: 40000`
- `pounds_label: "40,000 lb"`

**Fail-closed variant:** set the load's `weight_lbs` to `null` or `0`. Recalculate. Expect `amount_cents: 0`, `pounds: 0`.

**Pass:** $20,000.00 on the primary case; $0 on the null-weight variant.

---

### Scenario C2 — `per_miles`

**What it tests:** Rate-per-mile multiplies by `load.actual_miles`.

**Setup:**
1. Pick a load. Open the Routing tab — if the `actual_miles` field isn't populated on the load, you'll need one where a route was computed (Routing tab triggers the Google Distance Matrix call when events are added). Look for a load with `actual_miles` set (any value > 0 will do for this test). If none exists, manually set `orders.actual_miles = 90` via the API or directly in the DB for your test load.
2. Create a driver charge profile:
   - Name: `Test C2 — Per Mile`
   - Charge code: `LINE_HAUL`
   - UOM: `Per Miles`
   - Tier: `amount_cents = 275` ($2.75/mi), `free_units = 0`
3. Link + recalculate.

**Expected (load with `actual_miles = 90`):**
- `amount_cents: 24750` ($247.50 = 90 × $2.75)
- `miles: 90`
- `miles_label: "90.00 mi"`

**Fail-closed variant:** set `actual_miles = null`. Recalculate. Expect `amount_cents: 0`, `miles: 0`.

**Pass:** $247.50 on the primary; $0 on the null-miles variant.

---

### Scenario C3 — `radius_rate`

**What it tests:** Bracketed distance pricing. The engine picks the bracket where `actual_miles` falls in `[start_distance, end_distance]`, applies the bracket's `rate_type`.

**Setup:**

1. Create a driver charge profile:
   - Name: `Test C3 — Radius Brackets`
   - Charge code: `LINE_HAUL`
   - UOM: `Radius Rate`
   - Tier: configure its `radius_tiers` JSONB to this exact array (three brackets):
     ```json
     [
       { "start_distance": 0,   "end_distance": 50,    "amount_cents": 10000, "rate_type": "fixed" },
       { "start_distance": 50,  "end_distance": 150,   "amount_cents": 200,   "rate_type": "per_unit" },
       { "start_distance": 150, "end_distance": null,  "amount_cents": 30000, "rate_type": "fixed" }
     ]
     ```
     (Bracket 0: flat $100 for 0–50 mi. Bracket 1: $2/mi for 50–150 mi. Bracket 2: flat $300 for 150+ mi, open-ended.)

2. Link to a driver tariff that matches three test loads with different `actual_miles` values: **30**, **75**, **200**.

**Expected:**

| Load `actual_miles` | Bracket hit | `amount_cents` | `radius_bracket_index` |
|---|---|---|---|
| 30 | 0 (fixed $100) | `10000` | `0` |
| 75 | 1 (per_unit $2/mi × 75) | `15000` | `1` |
| 200 | 2 (fixed $300, open-ended) | `30000` | `2` |

**Pass:** all three loads return the correct bracketed amount + `radius_bracket_index`.

**Fail-closed variant:** a load with `actual_miles = null` → `amount_cents: 0`, `radius_bracket_index: -1`.

---

### Scenario C4 — AR diagnostic tracer endpoint

**What it tests:** The new `POST /api/tenant/loads/[id]/recalculate-charges-diagnostic` endpoint returns a full tariff-by-tariff trace + would-be charges without applying anything.

**Setup:**
1. Pick any load that has an active customer tariff (either already configured, or create one: a customer charge profile with some AR charge code, added to an active tariff matching the load's customer).
2. Note the load's current `order_charge_sets` state (count of charge sets + line items).
3. POST to the diagnostic endpoint:

```bash
curl -X POST "http://localhost:3001/api/tenant/loads/<LOAD_ID>/recalculate-charges-diagnostic" \
  -H "Cookie: <session cookies>" \
  -H "Content-Type: application/json" | jq .
```

**Expected response shape:**
- `success: true`
- `applied: 0` (always — read-only endpoint)
- `would_apply: <N>` — number of charges that WOULD be applied
- `charges: [...]` — each charge with full Plan A/B/C payload fields (tier_id, duration_*, pounds, miles, radius_bracket_index, etc.)
- `diagnostic.total_tariffs: <N>` — total active tariffs considered
- `diagnostic.tariffs: [...]` — per-tariff array with `tariff_id, tariff_name, priority, status, checks[], matched` — same shape as AP's driver-pay diagnostic
- `diagnostic.winning_tariff_id` / `winning_tariff_name` — the first matching tariff's ID and name

**Side-effect check:** AFTER the POST, query `order_charge_sets` for the load and confirm the count + line-item count is **identical** to the before snapshot. The endpoint must NOT have written anything.

**Pass:** (a) response has the expected shape with non-null diagnostic trace, (b) no new charge sets or line items were created, (c) `applied: 0` always.

---

## Regression check — Plan A + Plan B scenarios

Re-run each of the previously verified scenarios (Plan A: A/B/C/D; Plan B: B1/B2/B4/B5/B6). Expected: all still pass.

**Note on Plan B negative cases (B3 / B4-Houston / B5-wrong-zip / B6-wrong-leg-to):** Commit `42aa0d2` changed the fallback behavior. A tier with an explicit location filter that doesn't match the load now returns `amount_cents: 0` instead of falling back to the tier's stored amount. Re-run those negatives if you have time — they should now return `$0` instead of the tier's amount. That's the intended new behavior (user's filter intent is honored).

---

## Report back

```
Plan C Verification Report — 2026-04-15

Scenario C1 (per_pounds):              <PASS/FAIL> — $<amount>, pounds=<N>
  Null-weight variant:                  <result>

Scenario C2 (per_miles):               <PASS/FAIL> — $<amount>, miles=<N>
  Null-miles variant:                   <result>

Scenario C3 (radius_rate):
  30 mi (bracket 0):                    <PASS/FAIL> — $<amount>, bracket=<i>
  75 mi (bracket 1):                    <PASS/FAIL> — $<amount>, bracket=<i>
  200 mi (bracket 2):                   <PASS/FAIL> — $<amount>, bracket=<i>
  null-miles variant:                   <result>

Scenario C4 (AR diagnostic tracer):    <PASS/FAIL>
  Response shape matches expected:     <YES/NO>
  applied: 0 in response:              <YES/NO>
  No new charge_sets / line_items:     <YES/NO>
  total_tariffs returned:              <N>
  winning_tariff_name:                 <name or null>

Regression (Plan A scenarios):
  A fixed:           <PASS/FAIL>
  B per_hour:        <PASS/FAIL>
  C by_event:        <PASS/FAIL>
  D by_leg:          <PASS/FAIL>

Regression (Plan B scenarios):
  B1 unconstrained:  <PASS/FAIL>
  B2 org positive:   <PASS/FAIL>
  B4 city_state:     <PASS/FAIL>
  B5 zip:            <PASS/FAIL>
  B6 by_leg:         <PASS/FAIL>

Plan B negative re-check (optional, after commit 42aa0d2):
  B3 org negative (expect $0):          <result>
  B4 Houston variant (expect $0):       <result>
  B5 wrong-zip variant (expect $0):     <result>
  B6 wrong leg_to variant (expect $0):  <result>

Browser console errors: <list any>
Dev server terminal errors: <list any>
Any 400 / 500 responses from /api/tenant/ap/charge-profiles or /api/tenant/loads/*/recalculate-*? <list any>
```

---

## Troubleshooting hints

- **per_pounds returns 0 when weight_lbs IS set on the load** — double-check the load has `weight_lbs` populated via the Load Info tab. If the column is 0 or null, fail-closed is correct behavior.
- **per_miles returns 0 when a route exists on the load** — the engine reads `orders.actual_miles`. If the Routing tab never triggered a Distance Matrix call (e.g., route was added programmatically without the map step), `actual_miles` may be null. Populate it manually for the test.
- **radius_rate always returns 0** — check that `radius_tiers` JSONB array is actually populated on the tier. The UI form may or may not expose radius-bracket editing — if it doesn't, you may need to set the JSONB directly via SQL or the API. If the tier has `radius_tiers: []`, engine correctly returns 0.
- **AR diagnostic endpoint 404s** — the endpoint is at `/api/tenant/loads/[id]/recalculate-charges-diagnostic`, NOT `recalculate-charges`. The latter applies; the former only diagnoses.
- **Got 401 / 403 on the AR diagnostic** — it requires `ACCOUNTS_RECEIVABLE` or `ALL` permission. Your tenant test credentials should have one of those.
- **Bracket not matching what you expected** — the engine's bracket-selection rule is `miles >= start_distance && (end_distance == null || miles <= end_distance)`. So bracket boundaries are inclusive on both ends. A load at exactly `50` miles would match bracket 0 (0–50 inclusive), not bracket 1.

---

## Direct API fallback

If the UI path is frustrating, you can create/update the charge profile directly via API:

```bash
# Create a profile with a radius_rate tier
curl -X POST "http://localhost:3001/api/tenant/ap/charge-profiles" \
  -H "Cookie: <cookies>" -H "Content-Type: application/json" \
  -d '{
    "name": "Test C3 — Radius Brackets",
    "charge_name": "LINE_HAUL",
    "unit_of_measure": "radius_rate",
    "calculation_mode": "fixed",
    "auto_add": true,
    "versions": [{
      "label": "Version 1",
      "rows": [{
        "amount_cents": 0,
        "minimum_amount_cents": 0,
        "radius_tiers": [
          { "start_distance": 0,   "end_distance": 50,   "amount_cents": 10000, "rate_type": "fixed" },
          { "start_distance": 50,  "end_distance": 150,  "amount_cents": 200,   "rate_type": "per_unit" },
          { "start_distance": 150, "end_distance": null, "amount_cents": 30000, "rate_type": "fixed" }
        ]
      }]
    }]
  }'
```

Then query the tier back to confirm `radius_tiers` persisted:

```bash
curl "http://localhost:3001/api/tenant/ap/charge-profiles/<PROFILE_ID>" \
  -H "Cookie: <cookies>" | jq '.versions[].tiers[] | {id, unit_of_measure, radius_tiers}'
```

Expected: `radius_tiers` echoed back exactly as sent.

---

Good luck. When the report comes back, we can close Plan C (or itemize specific regressions for follow-up).
