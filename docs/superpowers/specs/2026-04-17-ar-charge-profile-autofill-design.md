# AR Charge Profile Autofill on Manual Add — Design Spec

**Date:** 2026-04-17
**Status:** Draft, awaiting plan
**Predecessors:** `feature_charge_profile_autofill.md` memory note (rule definition), Plan G1 (AR tariff detail structure), Plan G2 (AR charge profile detail structure).

---

## 1. Goal

When a dispatcher manually adds a charge line to a load's Billing tab and picks a charge code, the form should auto-populate from the load's tariff's matching charge profile — if one exists. The dispatcher can still edit every field; a persistent `source_profile_id` keeps an audit trail.

This rethinks the `auto_add` flag semantics:

- **`auto_add = YES`** → the profile fires automatically when tariff + profile conditions match (unchanged — current behavior).
- **`auto_add = NO`** → the profile does NOT auto-fire, BUT when a user manually picks that charge code on the load's Billing tab, the line pre-fills from the profile (rate, UoM, calculation method, percentage-of-base linkage, etc.).

No lockdown: if the tariff has no matching profile for the picked code, the form stays blank and the dispatcher types freely. Ad-hoc charges are still allowed.

**AR-only this pass.** AP (Driver Pay tab) autofill is a separate follow-up plan — its input form is per-driver and structurally different.

---

## 2. Hard constraints

| Aspect | Rule |
|---|---|
| No schema changes | Migration 038 already added `source_profile_id` + `source_tariff_id` + `charge_name` columns to `tariff_line_items`. This plan only ensures the API handler persists them. No new migration. |
| No new dependencies | No npm additions. |
| Auto-apply flow unchanged | The existing `auto_add = true` flow in `lib/tariff-engine.js` must behave identically before and after. We only ADD an option to `findMatchingCharges`; we do not refactor or extract its core. |
| Freeform entry still allowed | Dispatcher can type any charge code, any rate. If a matching profile exists, it pre-fills; if not, no prefill happens and no error is shown. |
| Client-side prefill is a convenience, not a lock | Every prefilled field stays editable. Audit trail via `source_profile_id` persisted on the line item, plus a "· edited" badge modifier when the line was touched after prefill. |

---

## 3. Architecture

### 3.1 File structure after the change

```
lib/tariff-engine.js                    (modified — small addition)
  - findMatchingCharges(svc, load, tenantId, opts = {})
      Accepts a new options argument with `includeAutoAddFalse: bool`.
      When true, the inner profile loop skips ONLY profiles that are
      disabled (status / date / RLS exclusions), NOT the auto_add=false
      filter. Default (opts={}) preserves existing behavior.
  - No core logic extracted. No new resolver module created.

pages/api/tenant/loads/[id]/
  └─ charge-profile-preview.js          (NEW, ~90 LoC)
      GET handler. Takes charge_name query param. Calls
      findMatchingCharges(..., { includeAutoAddFalse: true }), filters
      the returned array by charge_name === requested, picks the first
      result (or uses profile-level match_resolution if multiple — see
      §3.5), and shapes a hydration payload for the client.
      Returns 404 if no profile matches.

pages/api/tenant/loads/[id]/charge-sets/[chargeSetId]/line-items.js
  (modified POST handler)
      Extend the body whitelist to persist `source_profile_id` and
      `charge_name` (currently dropped). Default `is_auto = false` for
      manually-added lines (unchanged behavior — just explicit).

components/loads/tabs/BillingTab.js     (modified)
  - Switch local UOM_OPTIONS to import UNITS_OF_MEASURE from
    lib/charge-profile-constants (11 values vs current 4). The dropdown
    must handle every UOM the preview might return (per_hour, radius_rate,
    per_15min, etc.).
  - Extend newLine state with newLineSource ({ profileId, profileName })
    and newLineEdited (bool).
  - Rewire the charge_name onChange to fire the preview endpoint and
    prefill on 200. Use AbortController to cancel stale fetches.
  - Small badge above the Add Line form showing prefill source. Flips to
    "· edited" on any field edit after prefill.
  - Extend addLineItem POST body with source_profile_id.
```

### 3.2 Preview endpoint contract

```
GET /api/tenant/loads/:id/charge-profile-preview?charge_name=LINE_HAUL

Auth: requireTenantUser + requirePermission(ACCOUNTS_RECEIVABLE | ORDER_ENTRY | ALL, res)
      — mirrors the POST line-items handler's permission set.

200 OK (profile found):
{
  source_profile_id: 'uuid',
  source_tariff_id: 'uuid',
  profile_name: 'Standard Dry Run',
  charge_name: 'DRY_RUN',
  name: 'Standard Dry Run',           // line-item name defaults to profile name
  description: '',                     // the profile's own description, or ''
  unit_of_measure: 'fixed',
  unit_count: 1,                       // sensible default; profile may override
  free_units: 0,                       // pulled from the active tier row (see §3.6)
  per_unit_price_cents: 25000,         // from the active tier's amount_cents
  percentage_value: null,              // only set when UoM === 'percentage'
  percentage_based_on: null,           // only set when UoM === 'percentage'
  calculation_mode: 'by_lane'          // informational; client doesn't render it
}

404 Not Found (no profile matches):
{ error: 'No matching charge profile on any tariff for this load' }

400 Bad Request:
{ error: 'charge_name query param required' }

403 Forbidden / 401 Unauthorized:
(Standard tenant-scoped error shapes)
```

Response fields marked "from the active tier row" come from the first active tier in the profile's matching version (same version-selection the auto-apply flow uses via `resolveAmountCents`). If the profile has no tiers (rare), the endpoint returns 404 (we can't pre-fill what isn't priced).

### 3.3 Extending `findMatchingCharges`

```js
// lib/tariff-engine.js
export async function findMatchingCharges(svc, load, tenantId, opts = {}) {
  const { includeAutoAddFalse = false } = opts;
  // ... existing tariff-matching pipeline unchanged ...

  for (const cs of winningTariff.charge_sets) {
    for (const p of cs.profiles || []) {
      const cp = p.charge_profile;
      if (!cp) continue;
      // CHANGED: only skip auto_add=false profiles when NOT in preview mode.
      if (!includeAutoAddFalse && cp.auto_add === false) continue;
      // ... rest unchanged: evaluateConditions, resolveAmountCents, etc. ...
    }
  }
}
```

The Supabase query inside `findMatchingCharges` must also be audited: it currently `select`s `id, name, charge_name, unit_of_measure, auto_add, calculation_mode, percentage_based_on, tiers:charge_profile_tiers(*)`. The preview endpoint needs `description` too — extend the select to `... description, tiers:...`. This is a non-breaking addition.

**Zero-behavior-change test for the auto-apply flow:** `findMatchingCharges(svc, load, tenantId)` with no opts argument must return byte-equivalent results to before. Gate 1 baseline: capture the recalc-charges-diagnostic output for a representative load, run after the change, diff must be empty.

### 3.4 Line-items POST handler update

Current POST handler destructures something like `{ name, description, unit_of_measure, unit_count, free_units, per_unit_price_cents }` and inserts those. Extend to:

```js
const { name, description, unit_of_measure, unit_count, free_units,
        per_unit_price_cents, charge_name, source_profile_id } = req.body;

// insert call gains:
  charge_name: charge_name || null,
  source_profile_id: source_profile_id || null,
  is_auto: false,  // explicit
  // source_tariff_id is intentionally NOT set from the client body —
  // if we trust source_profile_id, we should derive source_tariff_id
  // server-side from the profile lookup, OR leave null and backfill
  // later. Keep null for now; tariff attribution on manual lines can
  // be added in a follow-up.
```

Do NOT accept arbitrary fields. Explicit whitelist only.

### 3.5 Client-side: BillingTab.js

**State additions** (inside the ChargeSetCard component, alongside `newLine`):

```js
const [newLineSource, setNewLineSource] = useState(null);
const [newLineEdited, setNewLineEdited] = useState(false);
const abortRef = useRef(null);
```

**UOM_OPTIONS source.** Replace the local 4-item array with:
```js
import { UNITS_OF_MEASURE } from '@/lib/charge-profile-constants';
// Use UNITS_OF_MEASURE wherever UOM_OPTIONS is currently referenced.
```

Audit BillingTab for other places that reference the local UOM_OPTIONS (row rendering, possibly EditableLineRow).

**Charge-code onChange rewrite:**

```js
onChange={async (e) => {
  const code = e.target.value;
  const label = CHARGE_NAMES.find((c) => c.value === code)?.label || code;

  // Picking a code is a full reset of the Add-Line form (explicit design rule).
  // Any fields the dispatcher typed before picking a code will be overwritten
  // if the code's profile prefills them. Document this in the committed code.
  abortRef.current?.abort();
  setNewLineSource(null);         // optimistic — clear old badge immediately
  setNewLineEdited(false);
  setNewLine({ ...newLine, charge_name: code, name: label });

  if (!code) return;

  const ac = new AbortController();
  abortRef.current = ac;
  try {
    const res = await fetch(
      `/api/tenant/loads/${load.id}/charge-profile-preview?charge_name=${encodeURIComponent(code)}`,
      { signal: ac.signal }
    );
    if (res.ok) {
      const p = await res.json();
      setNewLine({
        charge_name: p.charge_name,
        name: p.name,
        description: p.description || '',
        unit_of_measure: p.unit_of_measure,
        unit_count: p.unit_count ?? 1,
        free_units: p.free_units ?? 0,
        per_unit_price_cents: p.per_unit_price_cents ?? null,
        percentage_value: p.percentage_value ?? '',
        percentage_based_on: p.percentage_based_on ?? '',
      });
      setNewLineSource({ profileId: p.source_profile_id, profileName: p.profile_name });
    }
    // On 404 or other non-200, leave newLine at code+label only. User types freely.
  } catch (err) {
    if (err.name !== 'AbortError') {
      // Silent fallback: log to console, let user type manually
      console.warn('[billing] preview fetch failed:', err.message);
    }
  }
}}
```

**Tracking edits after prefill:**

```js
function updateNewLine(patch) {
  setNewLine((prev) => ({ ...prev, ...patch }));
  if (newLineSource && !newLineEdited) setNewLineEdited(true);
}
```

Every input in the Add Line form uses `updateNewLine({ ... })` instead of raw `setNewLine({ ...newLine, ... })`.

**Badge rendering:**

```jsx
{newLineSource && (
  <div className="flex items-center gap-1.5 text-[11px] text-blue-700 dark:text-blue-300 bg-blue-50 dark:bg-blue-950/40 rounded px-2 py-1 mb-2 border border-blue-200 dark:border-blue-900/60">
    <Link2 className="w-3 h-3" />
    From <span className="font-semibold">{newLineSource.profileName}</span>
    {newLineEdited && <span className="text-amber-600 dark:text-amber-400">· edited</span>}
  </div>
)}
```

Add `Link2` to the existing lucide-react import list at the top of the file.

**POST body on submit:**

```js
body: JSON.stringify({
  ...newLine,
  source_profile_id: newLineSource?.profileId || null,
}),
```

Reset source + edited state alongside `setNewLine(...)` on successful save.

### 3.6 `free_units` sourcing

`free_units` lives on `charge_profile_tiers` rows, not on `charge_profiles`. The auto-apply flow picks the active tier via `resolveAmountCents` and reads `free_units` from there (or defaults to 0). The preview endpoint does the same: after `findMatchingCharges` returns, the winning profile contains its full `tiers` array; pick the active tier (first active for simple by_lane; use tier selection logic for other modes) and read `free_units` from that tier row. Default to 0 if unset.

---

## 4. Edge cases

1. **Race condition on fast dropdown changes.** `AbortController` per pick; stale responses are ignored.
2. **User clears charge code (blank option).** `setNewLineSource(null)`, no fetch fired.
3. **Percentage-based charge where base charge isn't on the load yet.** Prefill fills `percentage_value` + `percentage_based_on`; `per_unit_price_cents` starts at 0. The existing `computePercentageAmount` helper will compute the correct cents once the base charge line exists. Same behavior as current manual-entry percentage lines. Expected, not a bug.
4. **Load has no customer / no matching tariff.** Preview returns 404. Client falls through to manual entry. No error.
5. **Multiple tariffs match, multiple profiles for the same charge_name.** Preview uses the profile-level `match_resolution` to pick one winner (first_match_wins / highest / lowest). For `stack`, preview picks the first active profile (stacking isn't meaningful for single-line prefill).
6. **Server error (500, timeout, Tier 0 circuit-open 503).** Client silently falls back to manual entry. No user-facing red alert — autofill is convenience, not a blocker.
7. **`source_profile_id` points at a deleted profile later.** Line still saves; audit queries tolerate orphaned IDs via `LEFT JOIN`.
8. **User overrides every field then saves.** Line gets `source_profile_id = X` plus their typed values. Audit shows "line originated from profile X, every field edited."
9. **User had typed fields BEFORE picking a code.** Picking a code resets the form (explicit design choice in §3.5). Any previously-typed fields that the profile prefills are overwritten. Other `newLine` fields (if any) are preserved via the spread.
10. **Profile has no tiers.** Preview returns 404 — we can't prefill a priceless profile.

---

## 5. Out of scope

- **AP (Driver Pay tab) autofill.** Separate follow-up plan.
- **Strict lockdown mode** (blocking non-tariff charge codes). We're shipping the convenience version per the user's framing ("make their lives easy"). The memory note `feature_charge_profile_autofill.md` described a stricter rule; I'll update that memory file after this ships to match the actual shipped behavior.
- **Override-with-reason workflow.** The "· edited" badge + `source_profile_id` are the audit primitive. A formal reason-capture UI is future work.
- **Showing the source badge on already-saved lines (the Billing table rows).** `source_profile_id` is persisted but the table row UI doesn't render a chain-link icon in this pass. Future enhancement for a full audit view.
- **Percentage re-hydration after save.** If a dispatcher saves a percentage line, then LATER adds the base charge, the percentage amount isn't re-computed automatically. This is a pre-existing limitation.
- **Server-side filling of `source_tariff_id` on manual lines.** The POST body only accepts `source_profile_id` (client-known). The backend could derive the tariff by joining profile→tariff at insert time; deferred to a later audit-completeness pass.
- **Refactoring `lib/tariff-engine.js` beyond adding the `includeAutoAddFalse` option.** No extraction of a separate resolver module. Keeps this change minimal and Gate-1-verifiable.

---

## 6. Success criteria

A reviewer (or the user) can:

1. On a load assigned to a customer tariff that includes a Dry Run profile (auto_add = NO, Fixed $250, unit_count 1), pick "Dry Run" in the Add Line dropdown. Form prefills name, UoM=Fixed, rate=$250, qty=1. Badge shows "🔗 From Dry Run".
2. Edit the rate to $300. Badge updates to "🔗 From Dry Run · edited". Save the line. Confirm via DB (or future audit UI) that the line row has `source_profile_id = <dry_run_profile_id>`, `charge_name = 'DRY_RUN'`, and `per_unit_price_cents = 30000`.
3. Pick a charge code that has NO matching profile on any tariff for the load. Form shows code + label only, no badge, fields empty. User types the rate and saves. No error.
4. Pick a percentage-based profile (e.g., Fuel Surcharge, 15% of LINE_HAUL). Prefill sets `unit_of_measure = 'percentage'`, `percentage_value = '15'`, `percentage_based_on = 'LINE_HAUL'`. If LINE_HAUL already exists on the load, the computed amount renders correctly. If it doesn't, the displayed amount is $0 until the base charge is added — same as today.
5. Rapidly click through charge codes (Dry Run → Detention → Line Haul). Only the final pick's prefill lands. No flicker, no stale state.
6. Run the auto-apply engine on a baseline load (recalc-charges-diagnostic). Output is byte-equivalent before and after the `findMatchingCharges` signature change. Gate 1 pass.
7. `npm run build` clean, no new lint errors.
8. Dark mode + zoom 80/100/125 clean on the Billing tab's Add Line form including the new badge.

---

## 7. Verification gates

**Gate 1 — `findMatchingCharges` byte-equivalence.**
Before the change, capture the output of `POST /api/tenant/loads/<id>/recalculate-charges-diagnostic` for a representative load. After the change, run the same diagnostic. Results must be byte-identical (modulo any ordering guaranteed by the code path).

**Gate 2 — Manual smoke.** Walk the success-criteria steps 1-5 in the dev server against a seeded tariff + profile. Confirm all prefill, override, 404, percentage, and race-condition behaviors.

**Gate 3 — Engine integrity.** Trigger a real recalc on a load that was previously using auto-apply. Confirm the same charge profiles still fire with the same cents amounts. (This is the same canary pattern from Plans G1/G2/G3.)

---

## 8. Open questions

None at design time. All resolved during brainstorming + fresh-eyes design review:

- Q: Lockdown non-tariff codes, or allow ad-hoc? **A: Allow ad-hoc freely (approach c). User framing: "make their lives easy."**
- Q: Server-side lookup or client-side? **A: Server (approach A). Endpoint reuses existing engine logic via a new options arg.**
- Q: Extract a new `lib/tariff-profile-resolver.js`? **A: No — the design reviewer found the logic is not cleanly extractable. Just add `{ includeAutoAddFalse: true }` to `findMatchingCharges` and let the preview endpoint filter by charge_name.**
- Q: Prefill + lock, prefill + overwritable + audit, or prefill + overwrite silently? **A: Overwritable with subtle "· edited" badge + `source_profile_id` on the line.**
- Q: What if user had typed fields before picking a code? **A: Picking a code resets the form (explicit rule). Prefilled fields overwrite typed values.**
- Q: UOM dropdown values? **A: Switch BillingTab's local UOM_OPTIONS to import `UNITS_OF_MEASURE` from `lib/charge-profile-constants` so all 11 UOMs render correctly.**
- Q: POST handler persisting `source_profile_id` / `charge_name`? **A: Whitelist both explicitly in the handler. Columns already exist from migration 038.**
