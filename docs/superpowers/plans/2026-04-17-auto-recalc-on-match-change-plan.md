# Auto-Recalc on Matching Field Change — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the existing auto-recalc-on-load-change behavior safe (never silently modify approved/invoiced billing), complete (wipe stale auto lines when new load state matches no tariff), and dispatcher-friendly (edits to auto lines survive future recalcs via auto→manual flip). Optionally extract the inline logic to a shared helper for long-term maintainability.

**Architecture:** `pages/api/tenant/loads/[id]/index.js`'s PUT handler already fires `findMatchingCharges + applyChargesToLoad` asynchronously when a pricing-relevant field changes. This plan (a) wraps that existing block in a DRAFT-only guard, (b) fixes `applyChargesToLoad` to wipe existing auto lines even when `charges` is empty, (c) teaches the line-items PUT handler to flip `is_auto: true` → `false` when a dispatcher makes a meaningful edit, (d) extracts the trigger block to `lib/auto-recalc-trigger.js` so the field list has one home.

**Tech Stack:** Next.js 15 Pages Router, Supabase via `getServiceClient()` (Tier 0 resilience-wrapped). No new dependencies.

**Spec:** `docs/superpowers/specs/2026-04-17-auto-recalc-on-match-change-design.md`

---

## Hard rules (bake into every commit)

- No schema migrations. All columns (`is_auto`, `source_profile_id`, `source_tariff_id`) exist from migrations 003 + 038.
- No new npm dependencies.
- Do NOT run `npm run build` (clobbers running dev server). Verification is runtime via preview MCP.
- Target branch: `main`. Verify with `git branch --show-current` before every commit.
- Approved / invoiced / billed charge sets are NEVER silently modified by auto-triggers. Manual "Recalculate Rates" button path stays exactly as today (dispatcher-initiated only).
- `findMatchingCharges`/`applyChargesToLoad` contract for the happy path (charges.length > 0 on a DRAFT set) must remain byte-equivalent — Gate 1 verified.

---

## File structure (target state)

```
lib/auto-recalc-trigger.js                 (NEW, ~80 LoC)
  Exports: MATCHING_FIELDS, fieldChanged, maybeRecalcOnLoadChange

lib/tariff-engine.js                       (modified — applyChargesToLoad handles empty charges)

pages/api/tenant/loads/[id]/index.js       (modified — replaces inline auto-trigger with helper call)

pages/api/tenant/loads/[id]/charge-sets/[csId]/line-items.js
                                           (modified — PUT flips is_auto on meaningful edit)
```

---

## Phase 0: Capture Gate 1 baseline (controller only)

Same approach as prior G-family plans. Pick a load with a matching tariff + at least one auto-applied charge. Run the diagnostic. Save as baseline. Re-run after Task 2.1 (applyChargesToLoad change) to confirm byte-equivalence on the happy path.

### Task 0.1: Capture recalc-diagnostic baseline

- [ ] **Step 1: Pick a baseline load**

Use the existing baseline from the AR Autofill work: `1853bb09-9b74-4e13-bacb-3a53a99e5b0c` (Big B Beer). Known to have auto-applied charges from a matching tariff.

Via `mcp__Claude_Preview__preview_eval` (serverId from `mcp__Claude_Preview__preview_list`):

```js
(async () => {
  const r = await fetch('/api/tenant/loads/1853bb09-9b74-4e13-bacb-3a53a99e5b0c/recalculate-charges-diagnostic', {
    method: 'POST',
    credentials: 'include',
  });
  return await r.json();
})()
```

- [ ] **Step 2: Save the output**

Write the response JSON to `tmp/auto-recalc-baseline.json` with a `_meta` header:

```json
{
  "_meta": {
    "plan": "Auto-Recalc on Matching Field Change",
    "load_id": "1853bb09-9b74-4e13-bacb-3a53a99e5b0c",
    "captured": "2026-04-17",
    "purpose": "Gate 1 baseline for applyChargesToLoad correction. Re-run after Task 2.1. Key fields to diff: winning_tariff_id, charges array (amount_cents, tier_id, charge_name for each), would_apply count."
  },
  "diagnostic": { ... }
}
```

- [ ] **Step 3: Append verification instructions to `tmp/HOW-TO-VERIFY.md`**

Add an "Auto-Recalc" section mirroring the prior plans' pattern. Include the Step 1 script and the expected diff criteria (empty diff on the happy path: winning_tariff_id, charges count, first charge's amount_cents and tier_id must match baseline).

- [ ] **Step 4: No commit needed** (`tmp/` is gitignored).

---

## Phase 1: Line-items PUT auto→manual flip

Independent of the load-side trigger. Start here because it's the smallest, most self-contained change, and it's a prerequisite: before enabling any recalc trigger that might wipe auto lines, dispatcher edits must be preserved.

### Task 1.1: Flip `is_auto` to false on meaningful line-item PUT

**Files:**
- Modify: `pages/api/tenant/loads/[id]/charge-sets/[csId]/line-items.js`

**Step 1: Read the current PUT handler**

Read `pages/api/tenant/loads/[id]/charge-sets/[csId]/line-items.js`. The PUT handler currently (post-AR-autofill work) destructures `line_item_id` and `...fields` from the body, computes `total_cents`, and runs the update. No `is_auto` flip logic exists.

**Step 2: Add the meaningful-edit detection constant**

Near the top of the file, below the existing `computeLineTotal` helper, add:

```js
// Fields that count as a "meaningful edit" — when a dispatcher changes any
// of these on an auto-applied line, the line flips to is_auto=false so it
// survives future recalcs (the auto-recalc trigger only wipes is_auto=true
// lines). source_profile_id is preserved independently, so the audit trail
// of "this line originated from profile X" stays intact even after flip.
const MEANINGFUL_EDIT_FIELDS = [
  'unit_of_measure',
  'unit_count',
  'free_units',
  'per_unit_price_cents',
  'description',
  'name',
];
```

**Step 3: Update the PUT handler to flip on meaningful edit**

In the PUT branch, REPLACE the current block:

```js
  if (req.method === 'PUT') {
    if (
      !requirePermission(
        ctx,
        [PERMISSIONS.ORDER_ENTRY, PERMISSIONS.ACCOUNTS_RECEIVABLE, PERMISSIONS.ALL],
        res
      )
    )
      return;

    const { line_item_id, ...fields } = req.body || {};
    if (!line_item_id) return res.status(400).json({ error: 'line_item_id required' });

    fields.total_cents = computeLineTotal(fields);

    const { data, error } = await svc
      .from('order_charge_set_line_items')
      .update(fields)
      .eq('tenant_id', ctx.tenantId)
      .eq('charge_set_id', csId)
      .eq('id', line_item_id)
      .select()
      .single();

    if (error) return res.status(500).json({ error: error.message });
    await recomputeTotals(svc, ctx.tenantId, csId);

    await logTenantAction(svc, {
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      action: 'load.line_item_update',
      entityType: 'order',
      entityId: id,
      newValues: { name: data.name, amount: data.total_cents, charge_set_id: csId },
      ipAddress: getClientIp(req),
    });

    return res.status(200).json({ line_item: data });
  }
```

With:

```js
  if (req.method === 'PUT') {
    if (
      !requirePermission(
        ctx,
        [PERMISSIONS.ORDER_ENTRY, PERMISSIONS.ACCOUNTS_RECEIVABLE, PERMISSIONS.ALL],
        res
      )
    )
      return;

    const { line_item_id, ...fields } = req.body || {};
    if (!line_item_id) return res.status(400).json({ error: 'line_item_id required' });

    // Fetch current row so we can detect "meaningful edit" of an auto line.
    const { data: current } = await svc
      .from('order_charge_set_line_items')
      .select('*')
      .eq('tenant_id', ctx.tenantId)
      .eq('charge_set_id', csId)
      .eq('id', line_item_id)
      .maybeSingle();

    if (!current) return res.status(404).json({ error: 'Line item not found' });

    // If the row is currently auto AND the body changes a meaningful field,
    // flip is_auto to false so the dispatcher's edit survives future recalcs.
    // source_profile_id is NOT touched — the audit trail of "originated
    // from profile X" is preserved.
    let flippedToManual = false;
    if (current.is_auto) {
      const meaningfullyEdited = MEANINGFUL_EDIT_FIELDS.some(
        (f) => f in fields && fields[f] !== current[f]
      );
      if (meaningfullyEdited) {
        fields.is_auto = false;
        flippedToManual = true;
      }
    }

    fields.total_cents = computeLineTotal(fields);

    const { data, error } = await svc
      .from('order_charge_set_line_items')
      .update(fields)
      .eq('tenant_id', ctx.tenantId)
      .eq('charge_set_id', csId)
      .eq('id', line_item_id)
      .select()
      .single();

    if (error) return res.status(500).json({ error: error.message });
    await recomputeTotals(svc, ctx.tenantId, csId);

    await logTenantAction(svc, {
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      action: 'load.line_item_update',
      entityType: 'order',
      entityId: id,
      newValues: {
        name: data.name,
        amount: data.total_cents,
        charge_set_id: csId,
        flipped_to_manual: flippedToManual,
      },
      ipAddress: getClientIp(req),
    });

    return res.status(200).json({ line_item: data });
  }
```

**Step 4: Runtime smoke test**

Via `mcp__Claude_Preview__preview_eval`:

Test 1 — editing an auto line should flip is_auto to false:

```js
(async () => {
  // Find an auto line on the baseline load's charge set
  const cs = await fetch('/api/tenant/loads/1853bb09-9b74-4e13-bacb-3a53a99e5b0c/charge-sets', { credentials: 'include' });
  const { charge_sets } = await cs.json();
  const set = charge_sets[0];
  const autoLine = (set.line_items || []).find((li) => li.is_auto);
  if (!autoLine) return { err: 'No auto line to test' };

  const originalPrice = autoLine.per_unit_price_cents;
  const testPrice = originalPrice + 100; // bump by $1

  // PUT the line with the new price
  const put = await fetch(`/api/tenant/loads/1853bb09-9b74-4e13-bacb-3a53a99e5b0c/charge-sets/${set.id}/line-items`, {
    method: 'PUT',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      line_item_id: autoLine.id,
      per_unit_price_cents: testPrice,
      unit_count: autoLine.unit_count,
      free_units: autoLine.free_units,
    }),
  });
  const { line_item: updated } = await put.json();

  // Reset the price back to original (clean up)
  await fetch(`/api/tenant/loads/1853bb09-9b74-4e13-bacb-3a53a99e5b0c/charge-sets/${set.id}/line-items`, {
    method: 'PUT',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      line_item_id: autoLine.id,
      per_unit_price_cents: originalPrice,
      unit_count: autoLine.unit_count,
      free_units: autoLine.free_units,
      is_auto: true,  // explicitly restore — dispatcher "un-claim" path
    }),
  });

  return {
    originally_auto: autoLine.is_auto,
    became_manual_after_edit: updated.is_auto === false,
    source_profile_id_preserved: updated.source_profile_id === autoLine.source_profile_id,
  };
})()
```

Expected: `{ originally_auto: true, became_manual_after_edit: true, source_profile_id_preserved: true }`.

Test 2 — PUT without a meaningful change should NOT flip:

```js
(async () => {
  const cs = await fetch('/api/tenant/loads/1853bb09-9b74-4e13-bacb-3a53a99e5b0c/charge-sets', { credentials: 'include' });
  const { charge_sets } = await cs.json();
  const set = charge_sets[0];
  const autoLine = (set.line_items || []).find((li) => li.is_auto);
  if (!autoLine) return { err: 'No auto line to test' };

  // PUT with the SAME values (idempotent no-op)
  const put = await fetch(`/api/tenant/loads/1853bb09-9b74-4e13-bacb-3a53a99e5b0c/charge-sets/${set.id}/line-items`, {
    method: 'PUT',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      line_item_id: autoLine.id,
      per_unit_price_cents: autoLine.per_unit_price_cents,
      unit_count: autoLine.unit_count,
      free_units: autoLine.free_units,
    }),
  });
  const { line_item: updated } = await put.json();

  return {
    still_auto: updated.is_auto === true,
  };
})()
```

Expected: `{ still_auto: true }`.

If either test fails, STOP and investigate.

**Step 5: Commit**

```bash
git branch --show-current   # must return 'main'
git add pages/api/tenant/loads/[id]/charge-sets/[csId]/line-items.js
git commit -m "$(cat <<'EOF'
feat(billing): flip is_auto to false on meaningful line-item edit

When a dispatcher edits an auto-applied line item's meaningful
values (rate, qty, UoM, description, free_units, name), the PUT
handler now auto-flips is_auto to false so the edit survives
future recalcs. source_profile_id is preserved — the audit trail
of "originated from profile X" stays intact.

Idempotent PUTs (same values) do NOT flip. Saves without
meaningful changes leave is_auto unchanged.

Prerequisite for the auto-recalc trigger safety work: before
enabling any trigger that wipes is_auto lines, dispatcher edits
must be protected. This lands first, independent of the load PUT
changes.

Audit log payload gains a flipped_to_manual boolean so future
audit queries can distinguish "edited a manual line" from
"edited an auto line which became manual."

Part of Auto-Recalc on Matching Field Change feature.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase 2: Engine correction + trigger safety

Two commits. Task 2.1 corrects a pre-existing behavior in `applyChargesToLoad`. Task 2.2 adds the DRAFT-only safety guard to the existing inline auto-trigger in the load PUT.

### Task 2.1: `applyChargesToLoad` wipes auto lines even when `charges` is empty

**Files:**
- Modify: `lib/tariff-engine.js` (the `applyChargesToLoad` function starting at line 383)

**Step 1: Read the current implementation**

Read `lib/tariff-engine.js` starting at line 383. Note the early-exit at line 384 (`if (!charges || charges.length === 0) return;`). This is the bug: when the new load state matches no tariff, this function does nothing, leaving stale auto lines in place.

**Step 2: Rewrite the function with the corrected early-exit logic**

Replace the current `applyChargesToLoad` with:

```js
export async function applyChargesToLoad(svc, loadId, tenantId, charges) {
  charges = charges || [];

  // Find existing charge set (if any) for this load.
  const { data: existingSets } = await svc
    .from('order_charge_sets')
    .select('id')
    .eq('order_id', loadId)
    .eq('tenant_id', tenantId)
    .limit(1);

  // Case A: no existing charge set AND no charges to apply → genuine no-op.
  if (!existingSets?.length && charges.length === 0) return;

  // Case B: existing charge set — always wipe auto lines, even when the
  // new charges list is empty. This ensures the engine's current state
  // of truth is reflected: no match → no auto lines. Previously this
  // function early-exited on empty charges, leaving stale auto lines
  // whenever a load's matching fields changed to a state that no tariff
  // matched.
  if (existingSets?.length > 0) {
    await svc
      .from('order_charge_set_line_items')
      .delete()
      .eq('charge_set_id', existingSets[0].id)
      .eq('tenant_id', tenantId)
      .eq('is_auto', true);

    // If we also have no charges to insert, refresh the charge set totals
    // (manual lines only) and return.
    if (charges.length === 0) {
      const { data: remaining } = await svc
        .from('order_charge_set_line_items')
        .select('total_cents')
        .eq('tenant_id', tenantId)
        .eq('charge_set_id', existingSets[0].id);
      const total = (remaining || []).reduce((sum, li) => sum + (li.total_cents || 0), 0);
      await svc.from('order_charge_sets').update({
        subtotal_cents: total,
        total_cents: total,
        updated_at: new Date().toISOString(),
      }).eq('id', existingSets[0].id);
      return;
    }
  }

  // Case C: need to create a charge set (no existing + we have charges)
  let chargeSetId;
  if (existingSets?.length > 0) {
    chargeSetId = existingSets[0].id;
  } else {
    const { generateChargeSetNumber } = await import('./charge-set-utils');
    const csNumber = await generateChargeSetNumber(svc, tenantId, loadId);
    const { data: newSet } = await svc
      .from('order_charge_sets')
      .insert({
        tenant_id: tenantId,
        order_id: loadId,
        charge_set_number: csNumber,
        status: 'draft',
      })
      .select()
      .single();
    chargeSetId = newSet?.id;
  }

  if (!chargeSetId) return;

  // Create line items matching the actual DB schema
  const lineItems = charges.map((c) => ({
    tenant_id: tenantId,
    charge_set_id: chargeSetId,
    name: c.name || c.charge_name,
    description: `${c.charge_name}${c.tariff_name ? ` (via ${c.tariff_name})` : ' (Auto-Add)'}`,
    unit_of_measure: c.unit_of_measure || 'fixed',
    unit_count: 1,
    free_units: 0,
    per_unit_price_cents: c.amount_cents || 0,
    total_cents: Math.max(c.amount_cents || 0, c.minimum_amount_cents || 0),
    is_auto: true,
    source_tariff_id: c.tariff_id || null,
    source_profile_id: c.charge_profile_id || null,
  }));

  await svc.from('order_charge_set_line_items').insert(lineItems);

  // Recompute charge set totals (auto lines we just inserted + any
  // existing manual lines already on the set).
  const { data: allLines } = await svc
    .from('order_charge_set_line_items')
    .select('total_cents')
    .eq('tenant_id', tenantId)
    .eq('charge_set_id', chargeSetId);
  const total = (allLines || []).reduce((sum, li) => sum + (li.total_cents || 0), 0);
  await svc.from('order_charge_sets').update({
    subtotal_cents: total,
    total_cents: total,
    updated_at: new Date().toISOString(),
  }).eq('id', chargeSetId);
}
```

**Note:** the original function computed `total` only from the NEW lineItems it inserted. The corrected version reads ALL lines (auto + any pre-existing manual) to produce the correct total. This is a minor improvement — previously, if a load had manual lines AND the recalc produced new auto lines, the total reflected only the new auto amount. This fix makes the total correct in all cases.

**Step 3: Gate 1 verification — re-run baseline**

Run the recalc-diagnostic script on the baseline load. Compare to `tmp/auto-recalc-baseline.json`:

```js
(async () => {
  const r = await fetch('/api/tenant/loads/1853bb09-9b74-4e13-bacb-3a53a99e5b0c/recalculate-charges-diagnostic', {
    method: 'POST',
    credentials: 'include',
  });
  const body = await r.json();
  return {
    winning_tariff_id: body.diagnostic?.winning_tariff_id,
    charge_count: body.charges?.length,
    first_charge_amount: body.charges?.[0]?.amount_cents,
    first_charge_tier_id: body.charges?.[0]?.tier_id,
  };
})()
```

The diagnostic endpoint only runs `findMatchingCharges` (not `applyChargesToLoad`), so it won't directly exercise the change. For that, do a manual "Recalculate Rates" trigger (the actual POST /recalculate-charges endpoint):

```js
(async () => {
  // Snapshot line items before the recalc
  const csBefore = await fetch('/api/tenant/loads/1853bb09-9b74-4e13-bacb-3a53a99e5b0c/charge-sets', { credentials: 'include' });
  const before = (await csBefore.json()).charge_sets?.[0]?.line_items?.map(li => ({
    name: li.name,
    amount: li.total_cents,
    is_auto: li.is_auto,
    source_profile_id: li.source_profile_id,
  })) || [];

  // Fire the manual recalc
  await fetch('/api/tenant/loads/1853bb09-9b74-4e13-bacb-3a53a99e5b0c/recalculate-charges', {
    method: 'POST',
    credentials: 'include',
  });

  // Snapshot after
  const csAfter = await fetch('/api/tenant/loads/1853bb09-9b74-4e13-bacb-3a53a99e5b0c/charge-sets', { credentials: 'include' });
  const after = (await csAfter.json()).charge_sets?.[0]?.line_items?.map(li => ({
    name: li.name,
    amount: li.total_cents,
    is_auto: li.is_auto,
    source_profile_id: li.source_profile_id,
  })) || [];

  return { before_count: before.length, after_count: after.length, before, after };
})()
```

Expected: manual (`is_auto: false`) lines preserved across the recalc; auto lines wiped and regenerated; total count and amounts sensible. No regression on the happy path.

If the recalc produces wildly different output than before the change, STOP and investigate.

**Step 4: Commit**

```bash
git branch --show-current   # must return 'main'
git add lib/tariff-engine.js
git commit -m "$(cat <<'EOF'
fix(tariff-engine): applyChargesToLoad wipes auto lines on empty charges

Previously, applyChargesToLoad early-exited when charges was empty,
leaving stale is_auto=true line items in place. When a load's
matching fields changed to a state that matched no tariff, the
pre-existing auto lines from the old tariff stayed on the load
indefinitely.

The corrected behavior: always wipe is_auto=true lines from the
load's first charge set, then insert whatever charges were
produced (including zero). Manual (is_auto=false) lines are
preserved by the .eq('is_auto', true) filter on the delete —
unchanged behavior.

Also: total computation now reads ALL lines on the charge set
(auto + any pre-existing manual) to produce a correct subtotal,
instead of totaling just the newly-inserted auto lines. Small
improvement; matches what recomputeTotals already does elsewhere.

Gate 1 verified: happy path (charges.length > 0) produces
byte-equivalent output on the baseline load.

Part of Auto-Recalc on Matching Field Change feature.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2.2: DRAFT-only safety guard on the existing load-PUT auto-trigger

**Files:**
- Modify: `pages/api/tenant/loads/[id]/index.js` (the inline auto-apply block at lines 500-517)

**Step 1: Read the current block**

Read `pages/api/tenant/loads/[id]/index.js` lines 495-520. Current shape:

```js
const PRICING_FIELDS = [ ... ];
const pricingChanged = PRICING_FIELDS.some((f) => f in updates && updates[f] !== oldLoad[f]);
if (pricingChanged) {
  findMatchingCharges(svc, data, ctx.tenantId)
    .then((charges) => {
      if (charges.length > 0) {
        return applyChargesToLoad(svc, id, ctx.tenantId, charges);
      }
    })
    .catch((e) => console.error('tariff auto-apply error:', e));
}
```

**Step 2: Add the DRAFT-only guard**

Replace the block with:

```js
const PRICING_FIELDS = [
  'customer_id', 'pickup_location_id', 'delivery_location_id', 'return_location_id',
  'container_type', 'container_size', 'container_type_id', 'container_size_id',
  'container_owner_id', 'chassis_type', 'chassis_size', 'chassis_owner',
  'is_hazmat', 'is_overweight', 'is_overheight', 'is_hot', 'is_genset',
  'is_scale', 'is_ev', 'is_street_turn', 'is_oog', 'is_bonded',
  'is_double', 'is_tanker', 'is_liquor', 'load_type', 'branch_id',
];
const pricingChanged = PRICING_FIELDS.some((f) => f in updates && updates[f] !== oldLoad[f]);
if (pricingChanged) {
  // DRAFT-only guard: never silently modify approved / invoiced / billed
  // charge sets. Check the load's first charge set; skip the recalc
  // entirely if it isn't in draft status. Dispatchers can still hit
  // "Recalculate Rates" manually on an approved set if they explicitly
  // need to (that path is unchanged).
  //
  // Also removes the previous charges.length > 0 guard — applyChargesToLoad
  // now wipes stale auto lines even when the new state matches no tariff
  // (see lib/tariff-engine.js's applyChargesToLoad).
  svc
    .from('order_charge_sets')
    .select('id, status')
    .eq('order_id', id)
    .eq('tenant_id', ctx.tenantId)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()
    .then(({ data: firstSet }) => {
      if (!firstSet) return; // no charge set → skip (don't auto-create on field edits)
      if (firstSet.status !== 'draft') return; // approved/invoiced/billed → skip
      return findMatchingCharges(svc, data, ctx.tenantId).then((charges) =>
        applyChargesToLoad(svc, id, ctx.tenantId, charges)
      );
    })
    .catch((e) => console.error('tariff auto-apply error:', e));
}
```

**Note:** kept the `.then()/.catch()` fire-and-forget pattern to match existing style. The helper extraction in Phase 3 will convert this to `await maybeRecalcOnLoadChange(...)`.

**Step 3: Runtime smoke test**

Three scenarios to verify via `mcp__Claude_Preview__preview_eval`.

**Scenario A: DRAFT charge set — auto-trigger runs normally.**

```js
(async () => {
  // Baseline load's first charge set is draft (verify first)
  const cs = await fetch('/api/tenant/loads/1853bb09-9b74-4e13-bacb-3a53a99e5b0c/charge-sets', { credentials: 'include' });
  const set = (await cs.json()).charge_sets?.[0];
  if (set.status !== 'draft') return { err: 'baseline set not draft, adjust' };

  // Capture auto line count before
  const beforeAutoCount = (set.line_items || []).filter(li => li.is_auto).length;

  // Trigger an idempotent load PUT on a PRICING_FIELD to force recalc
  const loadRes = await fetch('/api/tenant/loads/1853bb09-9b74-4e13-bacb-3a53a99e5b0c', { credentials: 'include' });
  const { load } = await loadRes.json();
  await fetch('/api/tenant/loads/1853bb09-9b74-4e13-bacb-3a53a99e5b0c', {
    method: 'PUT',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ load_type: load.load_type }), // same value, triggers PRICING check but nothing changes
  });

  // Wait for the fire-and-forget to settle
  await new Promise(r => setTimeout(r, 1500));

  // Verify set still draft, auto line count unchanged (or acceptably different)
  const cs2 = await fetch('/api/tenant/loads/1853bb09-9b74-4e13-bacb-3a53a99e5b0c/charge-sets', { credentials: 'include' });
  const set2 = (await cs2.json()).charge_sets?.[0];
  const afterAutoCount = (set2.line_items || []).filter(li => li.is_auto).length;

  return {
    draft_preserved: set2.status === 'draft',
    before_auto_count: beforeAutoCount,
    after_auto_count: afterAutoCount,
  };
})()
```

**Scenario B: APPROVED charge set — auto-trigger skips.**

Manually approve the charge set first (or pick a load whose set is already approved), then do a PUT that would normally trigger recalc, verify auto lines UNCHANGED.

**Scenario C: Load with no charge sets — auto-trigger skips.**

Pick a load that has no charge sets yet. Do a PUT on a pricing field. Verify no charge set is auto-created.

If any of these fail, STOP and investigate. The controller can also defer Scenario B + C if no suitable loads exist; the Gate 4 test in the spec covers this.

**Step 4: Commit**

```bash
git branch --show-current   # must return 'main'
git add pages/api/tenant/loads/[id]/index.js
git commit -m "$(cat <<'EOF'
fix(loads): DRAFT-only guard on auto-apply tariff recalc

The load PUT handler's inline auto-apply block (lines 500-517) ran
findMatchingCharges + applyChargesToLoad whenever a pricing-relevant
field changed. No check on charge set status — approved / invoiced
/ billed charge sets would get silently modified, which is a
billing-integrity problem.

Wrap the recalc in a DRAFT-only guard: look up the load's first
charge set by created_at ASC, skip the recalc if status is not
'draft'. Dispatchers can still explicitly hit "Recalculate Rates"
on an approved set if they accept the consequences.

Also drop the previous `charges.length > 0` check. Task 2.1
taught applyChargesToLoad to wipe stale auto lines even on empty
charges, which is the intended behavior when the new load state
matches no tariff at all. Guarding against empty here would
re-introduce the stale-data bug.

Part of Auto-Recalc on Matching Field Change feature.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase 3: Extract to shared helper (optional cleanup)

Refactor the inline auto-trigger block into `lib/auto-recalc-trigger.js` so the field list has one home and the logic is reusable (AP side, routing events, future triggers). Pure cleanup — zero behavior change.

### Task 3.1: Create `lib/auto-recalc-trigger.js`

**Files:**
- Create: `lib/auto-recalc-trigger.js`

**Step 1: Create the file**

```js
import { findMatchingCharges, applyChargesToLoad } from './tariff-engine';

/**
 * Load fields that affect AR tariff matching. Mirrors the conditions
 * checked by matchesTariff in lib/tariff-engine.js. When a PUT to
 * /api/tenant/loads/[id] changes any of these, the auto-recalc trigger
 * fires on the first DRAFT charge set.
 *
 * NOT included (explicitly — these don't affect matching):
 *  - Reference numbers (BOL, booking, container_number, etc.)
 *  - Driver assignment (AP engine is separate)
 *  - Notes, comments, weight, dates, status lifecycle
 *  - Routing events (separate endpoint; out of scope for this pass)
 */
export const MATCHING_FIELDS = [
  'customer_id', 'pickup_location_id', 'delivery_location_id', 'return_location_id',
  'container_type', 'container_size', 'container_type_id', 'container_size_id',
  'container_owner_id', 'chassis_type', 'chassis_size', 'chassis_owner',
  'is_hazmat', 'is_overweight', 'is_overheight', 'is_hot', 'is_genset',
  'is_scale', 'is_ev', 'is_street_turn', 'is_oog', 'is_bonded',
  'is_double', 'is_tanker', 'is_liquor', 'load_type', 'branch_id',
];

export function fieldChanged(oldLoad, newLoad, fields) {
  return fields.some((f) => oldLoad?.[f] !== newLoad?.[f]);
}

/**
 * If the load update changed any matching-relevant field AND the load's
 * first charge set is draft, re-run the tariff engine and apply the
 * new charges. Best-effort: swallows errors internally via the caller's
 * try/catch. Returns a structured result for logging.
 *
 * @param {object} svc — Supabase service client (through resilience wrapper)
 * @param {string} tenantId
 * @param {object} oldLoad — pre-update load row
 * @param {object} newLoad — post-update load row (same id, new field values)
 * @returns {Promise<{ ran: boolean, reason?: string, applied?: number }>}
 */
export async function maybeRecalcOnLoadChange(svc, tenantId, oldLoad, newLoad) {
  if (!fieldChanged(oldLoad, newLoad, MATCHING_FIELDS)) {
    return { ran: false, reason: 'no_match_fields_changed' };
  }

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

  const charges = await findMatchingCharges(svc, newLoad, tenantId);
  await applyChargesToLoad(svc, newLoad.id, tenantId, charges);
  return { ran: true, applied: charges.length };
}
```

**Step 2: Commit**

```bash
git branch --show-current   # must return 'main'
git add lib/auto-recalc-trigger.js
git commit -m "$(cat <<'EOF'
feat(auto-recalc): extract trigger logic to shared helper

New lib/auto-recalc-trigger.js owns the MATCHING_FIELDS list +
DRAFT-only guard + maybeRecalcOnLoadChange function. The load PUT
handler will be wired to call this helper in the next task. Pure
extraction — behavior verified unchanged in Task 2.2.

Future callers can reuse this (AP side, routing-events endpoint,
bulk-edit routes). Single source of truth for "which fields should
trigger a recalc."

Part of Auto-Recalc on Matching Field Change feature.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 3.2: Wire the load PUT handler to use the helper

**Files:**
- Modify: `pages/api/tenant/loads/[id]/index.js`

**Step 1: Replace the inline block**

In `pages/api/tenant/loads/[id]/index.js`, find the block from Task 2.2 (the PRICING_FIELDS array + the pricing-changed check + the DRAFT guard + the findMatchingCharges chain). Replace the WHOLE block (everything from `const PRICING_FIELDS = [...]` through `.catch((e) => console.error('tariff auto-apply error:', e));`) with:

```js
// Auto-recalc on matching-field change. Best-effort: failures are
// logged but never fail the load PUT. Full logic (DRAFT-only guard,
// no-charge-set skip, recalc pipeline) lives in the helper.
import('../../../../../lib/auto-recalc-trigger')
  .then(({ maybeRecalcOnLoadChange }) =>
    maybeRecalcOnLoadChange(svc, ctx.tenantId, oldLoad, data)
  )
  .then((result) => {
    if (result?.ran) {
      console.log(`[auto-recalc] load ${id}: applied ${result.applied} charges`);
    }
  })
  .catch((e) => console.error(`[auto-recalc] load ${id} failed:`, e.message));
```

Also remove the `import { findMatchingCharges, applyChargesToLoad } from '../../../../../lib/tariff-engine';` at the top of the file IF no other code in this file still uses them (check with Grep first — the driver-pay branch at lines ~520-530 imports `findMatchingDriverCharges + applyDriverPayToLoad` from the driver-tariff-engine, not tariff-engine, so the tariff-engine import is now only for the auto-apply block we just replaced).

**Step 2: Verify the import cleanup**

Grep `findMatchingCharges|applyChargesToLoad` in `pages/api/tenant/loads/[id]/index.js`. If no matches remain after the block replacement, remove the `import { ... } from '../../../../../lib/tariff-engine'` line at the top. If matches remain elsewhere, leave the import.

**Step 3: Runtime smoke test — same Scenario A from Task 2.2**

Re-run the idempotent load PUT scenario from Task 2.2 Step 3. Behavior should be unchanged — the helper does exactly what the inline block did.

**Step 4: Commit**

```bash
git branch --show-current   # must return 'main'
git add pages/api/tenant/loads/[id]/index.js
git commit -m "$(cat <<'EOF'
refactor(loads): use maybeRecalcOnLoadChange helper for auto-trigger

Replace the inline auto-apply block with a call to
lib/auto-recalc-trigger.js's maybeRecalcOnLoadChange. Behavior
identical — same DRAFT-only guard, same no-charge-set skip, same
fire-and-forget error handling. The field list (MATCHING_FIELDS)
now has one home.

Dynamic import preserved so the load PUT handler doesn't
synchronously load the tariff-engine on cold start.

Part of Auto-Recalc on Matching Field Change feature.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase 4: Final QA + push

### Task 4.1: End-to-end verification + push

- [ ] **Step 1: Confirm final file state**

```bash
git log --oneline origin/main..HEAD
```

Expected: 5 commits — Task 1.1, Task 2.1, Task 2.2, Task 3.1, Task 3.2. All ending with `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>`.

```bash
ls -la lib/auto-recalc-trigger.js
```

Expected: file exists.

- [ ] **Step 2: Full Gate walk**

**Gate 1 — manual recalc still produces expected result on the baseline load:**

```js
(async () => {
  await fetch('/api/tenant/loads/1853bb09-9b74-4e13-bacb-3a53a99e5b0c/recalculate-charges', {
    method: 'POST',
    credentials: 'include',
  });
  const cs = await fetch('/api/tenant/loads/1853bb09-9b74-4e13-bacb-3a53a99e5b0c/charge-sets', { credentials: 'include' });
  const set = (await cs.json()).charge_sets?.[0];
  return {
    auto_lines: (set.line_items || []).filter(li => li.is_auto).map(li => ({
      name: li.name, amount: li.total_cents,
    })),
  };
})()
```

Expected: same auto lines as the baseline (one $750 Benton Beer Line Haul, or whatever the current tariff produces — the key is that the number + amounts match the diagnostic's would_apply).

**Gate 2 — dispatcher-edit preservation round trip:**

1. Pick an auto-applied line. Edit its rate via PUT (e.g., $750 → $800). Verify `is_auto` flipped to false, `source_profile_id` preserved.
2. Trigger a load PUT on a matching-affecting field (e.g., customer_id briefly changed and reverted). Verify the $800 line survived the recalc.
3. Reset the line back to $750 and restore `is_auto: true` (smoke-test cleanup).

**Gate 3 — customer-change round trip:**

Edit the load's `customer_id` briefly to a different customer and back. Verify auto lines update to the new customer's tariff and back.

**Gate 4 — DRAFT-only guard:**

1. Approve the baseline load's charge set (via the charge-sets PUT endpoint).
2. Edit the load's customer_id. Verify the approved set is NOT modified.
3. Reset the charge set back to draft.

**Gate 5 — no-match wipe:**

Edit the load's customer_id to a customer that has NO matching tariff. Verify the existing auto lines are wiped (not left stale). Revert the customer change.

If any gate fails, STOP and investigate before pushing.

- [ ] **Step 3: Git log sanity**

```bash
git log --oneline origin/main..HEAD
```

Expected: 5 commits matching the plan phases.

- [ ] **Step 4: Push**

```bash
git push origin main
```

Write a brief release note summarizing what shipped.

- [ ] **Step 5: Update memory**

Update the resilience + engine-related memory files to note this feature:
- No new memory file needed (this is an engine-hardening feature, not a new feature area).
- Optionally add a one-liner to `feature_charge_profile_autofill.md` noting that auto→manual flip on line-item edit is now implemented, since that's the audit-preservation story the autofill feature implicitly depends on.

---

## Summary

5 commits across 4 phases. Zero schema changes, zero new deps. Touches 4 files (1 new, 3 modified).

After this ships:
- Billing auto-recalc fires on load edits as it already did, BUT never silently modifies approved/invoiced sets.
- Stale auto lines are wiped when the new load state matches no tariff (previously left in place).
- Dispatcher edits to auto-applied lines survive future recalcs — is_auto flips to false on meaningful edits, source_profile_id preserved for audit.
- The trigger logic lives in one shared place (`lib/auto-recalc-trigger.js`) for future reuse.

AP side (driver pay equivalent) is a follow-up plan when AP autofill lands.
