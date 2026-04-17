# Auto-Recalc on Matching Field Change — Design Spec

**Date:** 2026-04-17
**Status:** Draft, awaiting plan
**Predecessors:** AR Charge Profile Autofill (shipped 2026-04-17, commits `49d574f..ac8f54d`). Builds on the `source_profile_id` audit trail and the auto-add engine behavior in `lib/tariff-engine.js`.

**Pre-existing behavior (discovered during plan grounding):** `pages/api/tenant/loads/[id]/index.js`'s PUT handler ALREADY contains an inline auto-trigger at lines 500-517 that fires `findMatchingCharges + applyChargesToLoad` when any of a `PRICING_FIELDS` list changes. This spec's scope is therefore: (1) add safety guards to that existing trigger (DRAFT-only, empty-charges wipe), (2) add the missing line-item auto→manual flip, (3) optionally extract the logic to a shared helper for maintainability. The field list already exists and nearly matches what this spec proposed — plan will deduplicate rather than introduce a second list.

---

## 1. Goal

Keep auto-applied billing line items fresh **automatically** when a load's matching-relevant fields change, so stale tariff data doesn't accumulate on loads whose customer / locations / equipment / flags get edited after the initial charge set was built.

Two coupled changes:

1. **Load PUT auto-trigger.** When a PUT to `/api/tenant/loads/[id]` changes a field that affects tariff matching (e.g., `customer_id`, `load_type`, pickup/delivery/return location, container/chassis fields, flags), automatically re-run the tariff engine's matching + apply pipeline — but only when the load's first charge set is DRAFT, and only touching `is_auto: true` line items. Manual lines and approved/invoiced charge sets are always preserved.
2. **Line-item PUT auto-flip.** When a dispatcher edits an `is_auto: true` line item's meaningful values (rate, qty, UoM, description, free_units, name), the backend automatically flips that line to `is_auto: false` — preserving it across future recalcs — while keeping `source_profile_id` populated so the audit trail stays intact.

Together these mean: dispatcher edits are ALWAYS preserved (via the flip); auto lines always reflect the CURRENT tariff match (via the trigger); approved billing is NEVER silently modified (via the DRAFT-only guard).

This **replaces** an earlier "stale-auto warning badge" idea. Prevention > detection — a warning UI would surface a problem that never needs to happen.

---

## 2. Hard constraints

| Aspect | Rule |
|---|---|
| No schema changes | All the columns we need (`is_auto`, `source_profile_id`, `source_tariff_id`) already exist from migrations 003 + 038. No new migration. |
| No new dependencies | No npm additions. |
| Approved/invoiced billing never silently modified | Auto-trigger skips when the first charge set's status is not `draft`. Manual "Recalculate Rates" button path is unchanged (dispatcher-initiated remains as today). |
| Reference-number edits don't trigger recalc | Reference numbers (BOL, booking, container_number, etc.) are informational and don't affect tariff matching. Listed explicitly in the NOT-included list. |
| Best-effort recalc in the load PUT | Recalc is a side effect. If it fails (DB blip, circuit-open, findMatchingCharges error), the PUT still succeeds. Error is logged server-side for diagnosis. |
| Idempotent line-item PUTs don't flip `is_auto` | Saves that don't change any meaningful value leave `is_auto` alone. |

---

## 3. Architecture

### 3.1 File structure

```
lib/auto-recalc-trigger.js                 (NEW, ~80 LoC)
  Named exports:
    MATCHING_FIELDS          — const array of load fields that affect tariff match
    fieldChanged(old, new, fields) → bool
    maybeRecalcOnLoadChange(svc, tenantId, oldLoad, newLoad) → { ran, reason?, applied? }

lib/tariff-engine.js                       (modified — one-line fix)
  applyChargesToLoad no longer early-exits when `charges` is empty.
  Always delete is_auto=true lines from the first charge set, then
  insert whatever was produced (even if nothing). Corrects a
  pre-existing no-op that would leave stale auto lines when the new
  load state has no tariff match.

pages/api/tenant/loads/[id]/index.js             (modified PUT handler)
  After the load UPDATE succeeds, call maybeRecalcOnLoadChange.
  Wrap in try/catch — recalc failures don't fail the PUT.

pages/api/tenant/loads/[id]/charge-sets/[csId]/line-items.js
  (modified PUT handler)
  Fetch the current line item row before applying the update. If
  the row is currently is_auto=true AND the body changes any of
  [unit_of_measure, unit_count, free_units, per_unit_price_cents,
  description, name], add `is_auto: false` to the update. Preserve
  source_profile_id (not touched in the update).
```

### 3.2 Matching-field detection

Hardcoded list mirrors the fields `matchesTariff` actually reads in `lib/tariff-engine.js`:

```js
export const MATCHING_FIELDS = [
  'customer_id',
  'load_type',
  'pickup_location_id',
  'delivery_location_id',
  'return_location_id',
  'container_type',
  'container_size',
  'ssl_id',
  'chassis_type',
  'chassis_size',
  'chassis_owner',
  'is_hazmat', 'is_overweight', 'is_liquor', 'is_hot', 'is_genset',
  'is_overheight', 'is_scale', 'is_ev', 'is_street_turn', 'is_oog',
  'is_bonded', 'is_double', 'is_tanker',
];

export function fieldChanged(oldLoad, newLoad, fields) {
  return fields.some((f) => oldLoad?.[f] !== newLoad?.[f]);
}
```

**Not included (explicitly ruled out — don't affect matching):**

- Reference numbers (BOL, booking, container_number, pickup_number, etc.)
- Driver assignment (that's AP-engine scope)
- Notes, internal notes, dispatcher comments
- Weight (set at create time, rarely changes)
- Dates (tariff effective-date windows are tariff-level, not load-level)
- Status lifecycle fields (pending → completed, etc.)

**Routing events** (by_event / by_move / by_leg profile dependencies) are **out of scope for this pass** — they live in a separate table and are mutated via a different endpoint. When event-edit-driven staleness becomes a problem, the fix is a similar hook on the routing-events endpoint. For now, dispatchers have the manual "Recalculate Rates" button as a fallback.

**Strict `!==` equality** is sufficient — values are primitives (strings, numbers, booleans, UUIDs as strings). Flags are `null` / `true` in practice (tri-state but only two used) and `!==` works correctly.

### 3.3 `maybeRecalcOnLoadChange` implementation

```js
import { findMatchingCharges, applyChargesToLoad } from './tariff-engine';

export async function maybeRecalcOnLoadChange(svc, tenantId, oldLoad, newLoad) {
  // 1. Early-exit if nothing matching-relevant changed.
  if (!fieldChanged(oldLoad, newLoad, MATCHING_FIELDS)) {
    return { ran: false, reason: 'no_match_fields_changed' };
  }

  // 2. DRAFT-only guard: never silently modify approved/invoiced billing.
  const { data: firstSet } = await svc
    .from('order_charge_sets')
    .select('id, status')
    .eq('order_id', newLoad.id)
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();

  if (!firstSet) return { ran: false, reason: 'no_charge_sets' };
  if (firstSet.status !== 'draft') return { ran: false, reason: 'first_set_not_draft' };

  // 3. Run the recalc — same pipeline the "Recalculate Rates" button uses.
  const charges = await findMatchingCharges(svc, newLoad, tenantId);
  await applyChargesToLoad(svc, newLoad.id, tenantId, charges);
  return { ran: true, applied: charges.length };
}
```

**Design rules:**

- **DRAFT-only guard.** Approved / invoiced / billed charge sets are never silently modified. Dispatchers wanting to update an approved set explicitly click "Recalculate Rates" (unchanged path).
- **No-charge-set no-op.** If the load has zero charge sets, auto-trigger does nothing. Creating one automatically would be surprising; dispatcher still creates the initial set manually.
- **Silent on all non-run cases.** Returns a structured result; never throws on expected skip conditions.
- **Multi-charge-set ordering.** `order_charge_sets` is read in `created_at ASC` order and limited to 1. Matches the (unordered) behavior in `applyChargesToLoad` but makes it deterministic here.

### 3.4 `applyChargesToLoad` correction

Current behavior (line 383-384 of `lib/tariff-engine.js`):

```js
export async function applyChargesToLoad(svc, loadId, tenantId, charges) {
  if (!charges || charges.length === 0) return;  // EARLY-EXIT
  // ... delete existing auto lines + insert new ones ...
}
```

When the new load state matches no tariff at all, `charges` is empty. The early-exit means the PREVIOUS auto lines stay in place — stale. That's the exact class of stale data this feature exists to prevent.

**Fix:**

```js
export async function applyChargesToLoad(svc, loadId, tenantId, charges) {
  charges = charges || [];

  const { data: existingSets } = await svc
    .from('order_charge_sets')
    .select('id')
    .eq('order_id', loadId)
    .eq('tenant_id', tenantId)
    .limit(1);

  if (!existingSets?.length) {
    // No charge set AND no charges to apply → genuine no-op
    if (charges.length === 0) return;
    // else: continue to create a set and insert the charges (existing behavior)
  } else {
    // Always wipe auto lines from the first charge set, even if
    // `charges` is empty. This ensures the engine's state of truth
    // is reflected: no match → no auto lines.
    await svc
      .from('order_charge_set_line_items')
      .delete()
      .eq('charge_set_id', existingSets[0].id)
      .eq('tenant_id', tenantId)
      .eq('is_auto', true);

    if (charges.length === 0) {
      // Update the charge set totals to zero out auto-line contribution
      await recomputeChargeSetTotal(svc, tenantId, existingSets[0].id);
      return;
    }
  }

  // ... rest unchanged (create set if needed + insert lines + recompute totals) ...
}
```

`recomputeChargeSetTotal` is a small helper (or inline sum) that re-totals the charge set's subtotal/total after the delete. Currently the engine computes totals from the new line items; we just need the total to refresh to whatever's left (manual lines only) when charges is empty.

**Gate 1 verification:** the existing "Recalculate Rates" manual button on a load with a matching tariff must produce byte-identical results before and after (the path where `charges.length > 0` is unchanged). The new behavior is strictly on the empty-charges path.

### 3.5 Line-item PUT auto-flip

```js
const MEANINGFUL_EDIT_FIELDS = [
  'unit_of_measure',
  'unit_count',
  'free_units',
  'per_unit_price_cents',
  'description',
  'name',
];

// Inside the PUT handler, after auth + permission checks:
const { line_item_id, ...fields } = req.body || {};
if (!line_item_id) return res.status(400).json({ error: 'line_item_id required' });

const { data: current } = await svc
  .from('order_charge_set_line_items')
  .select('*')
  .eq('tenant_id', ctx.tenantId)
  .eq('charge_set_id', csId)
  .eq('id', line_item_id)
  .maybeSingle();

if (!current) return res.status(404).json({ error: 'Line item not found' });

if (current.is_auto) {
  const meaningfullyEdited = MEANINGFUL_EDIT_FIELDS.some(
    (f) => f in fields && fields[f] !== current[f]
  );
  if (meaningfullyEdited) {
    fields.is_auto = false;
  }
}

fields.total_cents = computeLineTotal(fields);
// ... rest of the existing update flow ...
```

**Audit enrichment:** the `logTenantAction` payload gains a `flipped_to_manual` boolean so future audit queries can distinguish "dispatcher edited a manual line" from "dispatcher edited an auto line which became manual":

```js
await logTenantAction(svc, {
  // ... existing fields ...
  newValues: {
    name: data.name,
    amount: data.total_cents,
    charge_set_id: csId,
    flipped_to_manual: current.is_auto && !data.is_auto,
  },
});
```

### 3.6 Load PUT integration

```js
// pages/api/tenant/loads/[id]/index.js — inside the PUT handler, after the load UPDATE

// Old load snapshot was already read earlier for permission checks (existing code).
// After the update returns `updated`:
try {
  const result = await maybeRecalcOnLoadChange(svc, ctx.tenantId, oldLoad, updated);
  if (result.ran) {
    console.log(`[auto-recalc] load ${id}: applied ${result.applied} charges`);
  }
} catch (err) {
  console.error(`[auto-recalc] load ${id} failed:`, err.message);
  // Don't fail the PUT — recalc is best-effort.
}
```

The existing PUT handler already fetches `oldLoad` at the top of the update flow (line ~258 of `pages/api/tenant/loads/[id]/index.js`) — the variable name matches, so we can hand it directly to `maybeRecalcOnLoadChange` without adding any new DB work.

---

## 4. Edge cases and error handling

1. **Load PUT without any matching-field change** → `fieldChanged` = false → early-exit with `no_match_fields_changed`. Zero DB calls.
2. **Load has no charge sets yet** → early-exit with `no_charge_sets`. No auto-creation of a charge set on load edits.
3. **First charge set is `approved` / `invoiced` / `billed`** → early-exit with `first_set_not_draft`. Billing integrity preserved.
4. **Multi-charge-set, first is DRAFT** → only the first set gets updated (existing engine behavior). Second set untouched. Correct.
5. **Multi-charge-set, first is APPROVED, second is DRAFT** → skip. Accepted limitation; dispatcher uses manual "Recalculate Rates" on the DRAFT set if needed.
6. **New load state matches no tariff** → `charges = []` → `applyChargesToLoad` wipes existing auto lines and totals to zero. Fixed by §3.4.
7. **`applyChargesToLoad` throws** → caught in the load PUT's try/catch; PUT still succeeds. Stale data may remain until manual recalc. Logged server-side.
8. **Race condition: two simultaneous PUTs** → both run through the same delete-then-insert pipeline. Second write wins. No data corruption.
9. **Line-item PUT where current row is missing / deleted** → 404 returned (new guard). Clean failure.
10. **Line-item PUT with empty body** → no meaningful edit detected → no flip. Existing no-op behavior preserved.
11. **Line-item PUT that only sends `is_auto: false`** → allowed. Dispatcher can explicitly claim an auto line as manual without changing its values.
12. **Circuit breaker open (Tier 0 degraded)** → `findMatchingCharges` throws → outer try/catch logs + continues. Next healthy recalc cleans up.

---

## 5. Out of scope

- **AP side (Driver Pay tab).** Same pattern needs `lib/driver-tariff-engine.js` extensions + an AP-specific trigger. Separate spec when AP autofill ships.
- **Routing-event changes as a recalc trigger.** Event-based profiles could go stale on routing edits; that's a follow-up with a hook on the routing-events endpoint.
- **Auto-update of approved / invoiced charge sets.** Locked out by DRAFT guard. Future "recalc with approval override" workflow is a separate product decision.
- **Multi-charge-set beyond first-set semantics.** Split-billing scenarios (two customers on one co-load with separate charge sets) may leave a DRAFT second set untouched when the first is APPROVED. Document and accept for now.
- **Stale-detection warning UI.** Prevented by the auto-trigger; no badge needed.
- **Tariff effective-date expiration.** A scheduled job to recalc loads when their tariff expires is a separate project.
- **Toast notification "Billing refreshed"** after a load-triggered recalc. Dispatchers see fresh line items on next Billing tab render; explicit notification is a follow-up UX polish.
- **`source_profile_id` whitelisting in the PUT body.** We don't guard against callers tampering with that field; not sensitive and out of scope for this feature. Future hardening can restrict to whitelist-only changes.
- **Transaction atomicity between the load update and recalc.** They're separate writes; a crash between leaves the load updated but the recalc not-yet-run. Self-healing on next PUT or manual recalc.

---

## 6. Success criteria

A reviewer (or the user) can:

1. Open a load whose customer has a matching tariff. Auto lines in place ($750 Line Haul per the baseline).
2. Edit the load's `customer_id` to a customer whose tariff has DIFFERENT charges. Save. Reopen Billing tab — auto lines reflect the new customer's tariff. Manual lines preserved.
3. Manually edit an auto-applied line's rate (e.g., $750 → $800). Save. Line is now `is_auto: false`, `source_profile_id` still populated. Badge from AR autofill feature shows "🔗 From <profile> · edited".
4. Trigger an unrelated load PUT (update a reference number like BOL). Verify no recalc — auto lines stay exactly as they were.
5. On a load with an INVOICED charge set, edit the customer. Invoiced set is NOT modified. Dispatcher must explicitly "Recalculate Rates" to force update.
6. Load with no charge sets: edit the customer. Verify no charge set is auto-created.
7. Trigger a load PUT where `findMatchingCharges` returns zero (load state now matches no tariff). Verify old auto lines ARE wiped (fix §3.4). Charge set totals refresh to the manual-lines-only sum.
8. Gate 1 on manual "Recalculate Rates" button: byte-equivalent before/after on a load with a matching tariff.
9. `npm run build` clean, no new lint errors.
10. Dark mode + zoom unchanged (feature is backend-only; frontend rendering not affected).

---

## 7. Verification gates

**Gate 1 — `applyChargesToLoad` byte-equivalence on the happy path.**
Capture the manual "Recalculate Rates" output on a load with a matching tariff before the `applyChargesToLoad` correction. Re-run after. The `charges.length > 0` path should be unchanged. Only the `charges.length === 0` path changes behavior.

**Gate 2 — Customer-change round trip (manual smoke).**
1. Load with customer A → Recalculate Rates → capture auto lines.
2. PUT load with customer_id = B. Verify auto lines updated to B's tariff values.
3. PUT load back to customer A. Verify auto lines restore.

**Gate 3 — Dispatcher-edit preservation.**
1. Open a load with an auto $750 line. Edit to $800. Save.
2. Verify DB row shows `is_auto: false`, `source_profile_id: <X>`, `per_unit_price_cents: 80000`.
3. Trigger a load PUT on a matching-affecting field. Verify the $800 line SURVIVES the recalc (doesn't get wiped even though `source_profile_id` points at a profile the recalc would regenerate).

**Gate 4 — DRAFT-only guard.**
1. Approve a load's charge set. Edit the load's customer_id. Verify the APPROVED set is untouched. No recalc ran.
2. Reset the charge set to DRAFT. Edit the customer. Verify recalc now runs normally.

---

## 8. Open questions

None at design time. All resolved during brainstorming:

- Q: Detect stale or prevent it? **A: Prevent. Stale-detect was an earlier idea; prevention makes the warning UI unnecessary.**
- Q: Which fields trigger recalc? **A: Hardcoded `MATCHING_FIELDS` list mirroring `matchesTariff`. Reference numbers, notes, driver, dates, status changes — explicitly NOT included.**
- Q: What happens to dispatcher edits on auto lines? **A: Auto→manual flip on meaningful edit. `source_profile_id` preserved for audit. Flipped lines survive recalcs.**
- Q: Approved/invoiced charge sets? **A: DRAFT-only guard. Auto-trigger skips; manual "Recalculate Rates" path unchanged.**
- Q: Loads with no charge sets? **A: Auto-trigger does nothing. Dispatcher creates the initial set manually.**
- Q: No-tariff-match case? **A: Wipe existing auto lines even when `charges` is empty. Fixes a pre-existing quiet-skip.**
- Q: Routing-event changes? **A: Out of scope for this pass. Follow-up hook on the routing-events endpoint when needed.**
- Q: Architecture — inline vs extracted helper? **A: Extracted to `lib/auto-recalc-trigger.js` for single-responsibility + reusability.**
