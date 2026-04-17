# AR Charge Profile Autofill on Manual Add — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a dispatcher picks a charge code in the Billing tab's Add Line form on a load, prefill the form from the matching tariff's charge profile. User can still edit every field; the saved line keeps a `source_profile_id` audit link. Also handles the `auto_add = NO` profile case (previously invisible to pricing) — those profiles now serve as the manual-pick source of truth.

**Architecture:** One new server-side endpoint (`GET /api/tenant/loads/[id]/charge-profile-preview`) that reuses the existing `lib/tariff-engine.js`'s `findMatchingCharges` function with a new `{ includeAutoAddFalse: true }` option. The POST handler for line items is extended to persist `source_profile_id`. The `BillingTab.js` ChargeSetCard component gains autofill + badge behavior on charge code selection. No schema changes (columns already exist from migration 038). No new npm deps.

**Tech Stack:** Next.js 15 Pages Router, React 19, Supabase via `getServiceClient()` (Tier 0 resilience-wrapped), Tailwind v4. Lucide icons for the `Link2` badge icon.

**Spec:** `docs/superpowers/specs/2026-04-17-ar-charge-profile-autofill-design.md`

---

## Hard rules (bake into every commit)

- No new npm dependencies.
- No schema migrations. `source_profile_id` column already exists (migration 038).
- Do NOT run `npm run build` during implementation — it clobbers the running dev server's `.next/` directory. Verify via `git diff --staged` and runtime smoke tests against the dev server.
- The auto-apply flow (`findMatchingCharges(svc, load, tenantId)` with no opts) must behave byte-identically before and after Task 1.1. Gate 1 baseline captured and diffed.
- Target branch: `main`. Verify with `git branch --show-current` before every commit.
- Lowest-impact changes first. The engine signature extension (Task 1.1) lands independently of the preview endpoint, so the auto-apply flow can be verified unchanged before the new endpoint is introduced.

---

## File structure (target state)

```
lib/tariff-engine.js                    (modified — add opts arg, add 'description' to select)

pages/api/tenant/loads/[id]/
  └─ charge-profile-preview.js          (NEW, ~90 LoC)

pages/api/tenant/loads/[id]/charge-sets/[csId]/line-items.js
                                        (modified — whitelist source_profile_id in POST)

components/loads/tabs/BillingTab.js     (modified — autofill wiring, UOM_OPTIONS swap, badge)
```

---

## Phase 0: Capture baseline (controller runs, not a subagent)

Before any engine change, capture a recalc-charges-diagnostic output against a representative load that has auto-applied charges from a tariff. This is the Gate 1 baseline — we diff against it after Task 1.1 to confirm the auto-apply flow is unchanged.

### Task 0.1: Capture recalc-charges-diagnostic baseline

- [ ] **Step 1: Pick a baseline load**

Use the dev server. Find a load that has auto-applied line items from a tariff. Good candidates: any load whose customer has an attached "All Customers Import Tariff" or similar (the same one used in G-family baselines). The `li.source_tariff_id` on existing line items tells you which tariff auto-applied.

Via `mcp__Claude_Preview__preview_eval`:

```js
(async () => {
  const r = await fetch('/api/tenant/loads?limit=50', { credentials: 'include' });
  const { loads } = await r.json();
  // Find a load with auto-applied charges
  const candidates = [];
  for (const load of loads.slice(0, 10)) {
    const csRes = await fetch(`/api/tenant/loads/${load.id}/charge-sets`, { credentials: 'include' });
    if (!csRes.ok) continue;
    const { charge_sets } = await csRes.json();
    const autoLines = (charge_sets || []).flatMap((cs) =>
      (cs.line_items || []).filter((li) => li.is_auto || li.source_tariff_id)
    );
    if (autoLines.length > 0) {
      candidates.push({ id: load.id, name: load.load_number || load.id, auto_lines: autoLines.length });
    }
  }
  return candidates;
})()
```

Pick the load with the most auto-applied lines. Record its id + human name.

- [ ] **Step 2: Run recalc-diagnostic on that load**

```js
// Substitute LOAD_ID below
(async () => {
  const r = await fetch(`/api/tenant/loads/LOAD_ID/recalculate-charges-diagnostic`, {
    method: 'POST',
    credentials: 'include',
  });
  return await r.json();
})()
```

- [ ] **Step 3: Save the output**

Write the response JSON to `tmp/ar-autofill-baseline.json`. Add a `_meta` block at the top:

```json
{
  "_meta": {
    "plan": "AR Charge Profile Autofill",
    "load_id": "<LOAD_ID>",
    "load_name": "<LOAD_NAME>",
    "captured": "2026-04-17",
    "purpose": "Gate 1 baseline for findMatchingCharges signature change. Re-run after Task 1.1 to confirm no behavior change."
  },
  "diagnostic": { ...response... }
}
```

- [ ] **Step 4: Update `tmp/HOW-TO-VERIFY.md`**

Append a "AR Autofill" section with the load id, the Step 2 script, and instructions: "Re-run the script after Task 1.1. Diff against tmp/ar-autofill-baseline.json (ignoring _meta and timestamps that change between runs). Payload should be empty-diff."

- [ ] **Step 5: No commit needed**

`tmp/` is gitignored.

---

## Phase 1: Engine extension + preview endpoint

Two commits. Task 1.1 is the engine signature change (byte-equivalence required). Task 1.2 creates the new preview endpoint that consumes the new option.

### Task 1.1: Extend `findMatchingCharges` with opts + add `description` to select

**Context:** The current `findMatchingCharges(svc, load, tenantId)` filters out `auto_add === false` profiles at line 123. The preview endpoint needs those profiles INCLUDED. Add an opts argument; default behavior unchanged. Also the Supabase select omits `description` — the preview endpoint needs it, so add it to the select.

**Files:**
- Modify: `lib/tariff-engine.js` (two changes: the select on line 79 and the filter on line 123, plus the function signature)

**Step 1: Update the function signature**

Change:
```js
export async function findMatchingCharges(svc, load, tenantId) {
```

To:
```js
export async function findMatchingCharges(svc, load, tenantId, opts = {}) {
  const { includeAutoAddFalse = false } = opts;
```

**Step 2: Update the auto_add filter**

Find the line (currently line 123):
```js
if (!cp || cp.auto_add === false) continue;
```

Change to:
```js
if (!cp) continue;
if (!includeAutoAddFalse && cp.auto_add === false) continue;
```

This preserves existing behavior (auto-apply skips auto_add=false profiles) when opts argument is absent, and includes them when `includeAutoAddFalse: true`.

**Step 3: Add `description` to the charge_profiles select**

Find the select block (starts around line 78):
```js
charge_profile:charge_profiles(
  id, name, charge_name, unit_of_measure, auto_add, calculation_mode, percentage_based_on,
  tiers:charge_profile_tiers(*)
)
```

Change to:
```js
charge_profile:charge_profiles(
  id, name, description, charge_name, unit_of_measure, auto_add, calculation_mode, percentage_based_on,
  tiers:charge_profile_tiers(*)
)
```

Adds `description` so the preview endpoint can return the profile's description verbatim (rather than hardcoding English or leaving blank).

**Step 4: Gate 1 verification — re-run baseline**

Re-run the Step 2 script from Phase 0 Task 0.1 against the same baseline load id. Diff the response against `tmp/ar-autofill-baseline.json` (ignore `_meta` + any timestamps that change).

Expected: empty diff. The new `description` field is an additional select, not a behavior change — the auto-apply path doesn't read it yet. The `opts` arg default (`includeAutoAddFalse = false`) preserves the filter.

If the diff is non-empty, STOP and investigate before committing.

**Step 5: Commit**

```bash
git branch --show-current   # must return 'main'
git add lib/tariff-engine.js
git commit -m "$(cat <<'EOF'
feat(tariff-engine): add includeAutoAddFalse opt + select description

Two small additions to findMatchingCharges in preparation for the
AR charge-profile-autofill feature:

1. New opts argument { includeAutoAddFalse: false } (default preserves
   existing behavior). When true, the inner profile loop no longer
   skips profiles where auto_add === false. The auto-apply flow still
   calls findMatchingCharges(svc, load, tenantId) with no opts, so
   auto_add=false profiles remain excluded from auto-firing.

2. charge_profiles SELECT now also returns description. Auto-apply
   doesn't read it yet, but the upcoming preview endpoint surfaces
   the profile's own description on prefill (avoiding a hardcoded
   English string that would overwrite a user's typed description).

Gate 1 verified: recalc-charges-diagnostic output on the baseline
load is byte-equivalent before and after (modulo the extra unused
description field in the select, which auto-apply discards).

Part of AR Charge Profile Autofill feature.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 1.2: Create `pages/api/tenant/loads/[id]/charge-profile-preview.js`

**Context:** New GET endpoint that looks up the winning profile for a given (load, charge_name) and returns hydrated prefill values. Reuses the just-extended `findMatchingCharges` with `{ includeAutoAddFalse: true }`, filters by charge_name, picks the first match, and shapes the response.

**Files:**
- Create: `pages/api/tenant/loads/[id]/charge-profile-preview.js` (~90 LoC)

**Step 1: Create the file**

```js
import {
  requireTenantUser,
  requirePermission,
  getServiceClient,
} from '../../../../../lib/tenant-api';
import { PERMISSIONS } from '../../../../../lib/permissions';
import { findMatchingCharges } from '../../../../../lib/tariff-engine';

/**
 * AR charge-profile preview endpoint.
 *
 * Given a load and a charge_name code (e.g. DRY_RUN, LINE_HAUL), return
 * the hydrated prefill values for the winning charge profile on the
 * load's tariff(s). The Billing tab calls this when a dispatcher picks
 * a charge code from the Add Line dropdown.
 *
 * Returns 200 with the shaped profile payload if a matching profile
 * exists, 404 if no profile on any matching tariff has that charge_name.
 *
 * Reuses lib/tariff-engine.js's findMatchingCharges({ includeAutoAddFalse: true })
 * so we share one source of truth for "which profile wins" (tariff
 * specificity, condition evaluation, tier selection, version resolution).
 */
export default async function handler(req, res) {
  const ctx = await requireTenantUser(req, res);
  if (!ctx) return;

  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (
    !requirePermission(
      ctx,
      [PERMISSIONS.ORDER_ENTRY, PERMISSIONS.ACCOUNTS_RECEIVABLE, PERMISSIONS.ALL],
      res
    )
  )
    return;

  const { id } = req.query;
  const charge_name = req.query.charge_name;

  if (!charge_name) {
    return res.status(400).json({ error: 'charge_name query param required' });
  }

  const svc = getServiceClient();

  // Load the order so findMatchingCharges can evaluate tariff conditions.
  const { data: load, error: loadErr } = await svc
    .from('orders')
    .select('*')
    .eq('tenant_id', ctx.tenantId)
    .eq('id', id)
    .maybeSingle();

  if (loadErr) return res.status(500).json({ error: loadErr.message });
  if (!load) return res.status(404).json({ error: 'Load not found' });

  // Reuse the tariff engine. includeAutoAddFalse: true so profiles with
  // auto_add=false are still considered for manual pick.
  const matched = await findMatchingCharges(svc, load, ctx.tenantId, {
    includeAutoAddFalse: true,
  });

  // Filter by charge_name and pick the first winning profile.
  // Future enhancement: honor profile-level match_resolution for
  // multi-profile same-charge_name scenarios. First-match-wins is the
  // 99% case today.
  const winner = (matched || []).find(
    (m) => m.charge_name === charge_name && m.charge_profile_id
  );

  if (!winner) {
    return res
      .status(404)
      .json({ error: 'No matching charge profile on any tariff for this load' });
  }

  // Re-fetch the profile row directly to pull description + tier data.
  // findMatchingCharges returns denormalized fields; we want the profile's
  // own description and free_units from the first tier row.
  const { data: profile } = await svc
    .from('charge_profiles')
    .select(`
      id, name, description, charge_name, unit_of_measure, percentage_based_on,
      tiers:charge_profile_tiers(id, free_units)
    `)
    .eq('tenant_id', ctx.tenantId)
    .eq('id', winner.charge_profile_id)
    .maybeSingle();

  const isPct = winner.unit_of_measure === 'percentage';
  // Read free_units from the first tier row. Future enhancement: honor
  // tier-selection logic (by_lane / by_event / by_move) for multi-tier
  // profiles. First-tier default covers the common case and defaults to 0
  // when a profile has no tiers.
  const freeUnits = profile?.tiers?.[0]?.free_units ?? 0;

  return res.status(200).json({
    source_profile_id: winner.charge_profile_id,
    source_tariff_id: winner.tariff_id || null,
    profile_name: profile?.name || winner.name,
    charge_name: winner.charge_name,
    name: profile?.name || winner.name,
    description: profile?.description || '',
    unit_of_measure: winner.unit_of_measure,
    unit_count: 1,
    free_units: freeUnits,
    // For percentage profiles, amount_cents from the engine holds the
    // percentage value (e.g. 1500 = 15.00%). Surface it as percentage_value
    // (string, to match the form input) and leave per_unit_price_cents null;
    // the client's computePercentageAmount helper computes the real cents
    // based on the live load's base charge line.
    per_unit_price_cents: isPct ? null : (winner.amount_cents ?? null),
    percentage_value: isPct ? ((winner.amount_cents || 0) / 100).toFixed(2) : null,
    percentage_based_on: isPct ? winner.percentage_based_on || null : null,
    calculation_mode: winner.calculation_mode || null,
  });
}
```

**Step 2: Runtime smoke test**

The dev server is running. Hit the endpoint via `mcp__Claude_Preview__preview_eval`:

```js
(async () => {
  // Substitute LOAD_ID and a charge_name that exists on the load's tariff
  const r = await fetch('/api/tenant/loads/LOAD_ID/charge-profile-preview?charge_name=LINE_HAUL', {
    credentials: 'include',
  });
  return { status: r.status, body: r.status === 200 ? await r.json() : await r.text() };
})()
```

Expected: 200 with `{ source_profile_id, profile_name, unit_of_measure, per_unit_price_cents, ... }`.

Also verify 404 for a charge_name NOT on the tariff:
```js
// charge_name=NONEXISTENT_CHARGE
// Expected: 404 { "error": "No matching charge profile on any tariff for this load" }
```

And 400 for missing charge_name:
```js
// ?charge_name=  (empty)
// Expected: 400 { "error": "charge_name query param required" }
```

If any of the three smoke tests fail, STOP and investigate.

**Step 3: Commit**

```bash
git branch --show-current   # must return 'main'
git add pages/api/tenant/loads/[id]/charge-profile-preview.js
git commit -m "$(cat <<'EOF'
feat(api): add /loads/[id]/charge-profile-preview endpoint

GET endpoint that returns hydrated prefill values for a given
(load, charge_name). Reuses findMatchingCharges with
{ includeAutoAddFalse: true } so the same tariff matching + profile
selection logic that drives auto-apply also drives manual prefill —
no duplicate code path.

Permission: ORDER_ENTRY | ACCOUNTS_RECEIVABLE | ALL (mirrors the
line-items POST handler).

Response shape matches the newLine state in BillingTab's Add Line
form. For percentage profiles, surfaces percentage_value + based_on
and leaves per_unit_price_cents null so the client's
computePercentageAmount helper can compute live cents against the
load's base charge.

404 when no matching profile exists (client falls through to manual
entry; no error shown to the user).

Part of AR Charge Profile Autofill feature.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase 2: Line-items POST handler update

### Task 2.1: Whitelist `source_profile_id` in the POST handler

**Context:** The POST handler at `pages/api/tenant/loads/[id]/charge-sets/[csId]/line-items.js` currently destructures `{ name, description, unit_of_measure, unit_count, free_units, per_unit_price_cents }` and inserts those. The client will start sending `source_profile_id` on autofilled manual adds; it must be whitelisted and persisted.

**Files:**
- Modify: `pages/api/tenant/loads/[id]/charge-sets/[csId]/line-items.js`

**Step 1: Update the POST body destructure**

Find:
```js
const {
  name,
  description,
  unit_of_measure,
  unit_count,
  free_units,
  per_unit_price_cents,
} = req.body || {};
```

Change to:
```js
const {
  name,
  description,
  unit_of_measure,
  unit_count,
  free_units,
  per_unit_price_cents,
  source_profile_id,
} = req.body || {};
```

**Step 2: Update the insert call**

Find:
```js
const { data, error } = await svc
  .from('order_charge_set_line_items')
  .insert({
    tenant_id: ctx.tenantId,
    charge_set_id: csId,
    name,
    description: description || null,
    unit_of_measure: unit_of_measure || 'fixed',
    unit_count: unit_count ?? 1,
    free_units: free_units ?? 0,
    per_unit_price_cents: per_unit_price_cents ?? 0,
    total_cents: totalCents,
  })
  .select()
  .single();
```

Change to:
```js
const { data, error } = await svc
  .from('order_charge_set_line_items')
  .insert({
    tenant_id: ctx.tenantId,
    charge_set_id: csId,
    name,
    description: description || null,
    unit_of_measure: unit_of_measure || 'fixed',
    unit_count: unit_count ?? 1,
    free_units: free_units ?? 0,
    per_unit_price_cents: per_unit_price_cents ?? 0,
    total_cents: totalCents,
    source_profile_id: source_profile_id || null,
    is_auto: false,
  })
  .select()
  .single();
```

The explicit `is_auto: false` makes the manual-add intent visible (the column defaults to `false` via the migration, so this is a no-op in behavior but improves readability).

**Step 3: Runtime smoke test**

Hit the existing POST endpoint from the dev server with a hand-crafted body that includes `source_profile_id`:

```js
(async () => {
  // Substitute LOAD_ID and CHARGE_SET_ID and a real profile id
  const r = await fetch(`/api/tenant/loads/LOAD_ID/charge-sets/CHARGE_SET_ID/line-items`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'Test smoke line',
      description: 'testing source_profile_id persistence',
      unit_of_measure: 'fixed',
      unit_count: 1,
      free_units: 0,
      per_unit_price_cents: 10000,
      source_profile_id: 'PROFILE_UUID',
    }),
  });
  return { status: r.status, body: await r.json() };
})()
```

Expected: 201 with the line_item payload. Verify `source_profile_id` is on the returned row.

Delete the test line via the DELETE endpoint after verifying.

**Step 4: Commit**

```bash
git branch --show-current   # must return 'main'
git add pages/api/tenant/loads/[id]/charge-sets/[csId]/line-items.js
git commit -m "$(cat <<'EOF'
feat(api): persist source_profile_id on manual line-item adds

The POST handler now whitelists source_profile_id and writes it on
insert. Column already exists (migration 038). The client will send
this field when a line was autofilled from a charge profile; other
manual-add callers continue to work because source_profile_id is
optional (null when not provided).

Also makes is_auto: false explicit on insert — behavior unchanged
(the column defaults to false) but the intent of "manual line, not
auto-applied" is now visible in the code.

charge_name is intentionally NOT persisted — the column doesn't
exist on order_charge_set_line_items (verified migrations 003 + 038).
Audit trail uses source_profile_id → profile.charge_name via JOIN.

Part of AR Charge Profile Autofill feature.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase 3: BillingTab autofill wiring (atomic)

### Task 3.1: Wire autofill, badge, and UOM_OPTIONS swap in BillingTab

**Context:** This is the client-side change that glues everything together. Single atomic commit — the state shape changes, the input handlers change, the POST body extends, and the UOM dropdown source switches ALL together. Splitting them creates intermediate broken states.

**Files:**
- Modify: `components/loads/tabs/BillingTab.js` (the ChargeSetCard component)

**Step 1: Read the current state of `components/loads/tabs/BillingTab.js`**

Specifically note:
- The local `UOM_OPTIONS` array (currently 4 values around lines 24-29). Find all usages of `UOM_OPTIONS` — one in the Add Line form's UOM select, possibly others in `EditableLineRow`.
- The `newLine` state shape (around the ChargeSetCard function's `useState` block).
- The Add Line form's charge-code dropdown `onChange` handler (around lines 490-494).
- The `addLineItem` function (around lines 310-343).
- The lucide-react imports at the top of the file.

**Step 2: Switch local UOM_OPTIONS to import from constants**

Near the top of the file, find and DELETE the local declaration:
```js
const UOM_OPTIONS = [
  { value: 'fixed', label: 'Fixed' },
  { value: 'per_day', label: 'Per Day' },
  { value: 'per_mile', label: 'Per Mile' },
  { value: 'percentage', label: 'Percentage' },
];
```

(Exact wording may differ — look for the array with 4 UOM entries.)

In the existing imports from `charge-profile-constants`, add `UNITS_OF_MEASURE`:
```js
import { CHARGE_NAMES, UNITS_OF_MEASURE /* ... other existing imports ... */ } from '@/lib/charge-profile-constants';
```

(If the file uses a relative import style like `'../../../lib/charge-profile-constants'`, match that style. Match whatever the file currently uses for `CHARGE_NAMES`.)

Find every reference to `UOM_OPTIONS` in the file and replace with `UNITS_OF_MEASURE`. There should be one in the Add Line form's `<select>` and possibly one in `EditableLineRow`.

**Step 3: Add `Link2` to the lucide-react imports**

Find the existing lucide-react import line (something like `import { Plus, Trash2 } from 'lucide-react';`) and add `Link2` to the list. The new badge uses this icon.

**Step 4: Add new state inside the ChargeSetCard component**

Find the component's `useState` block for `newLine` (around line 290-ish). Immediately below, add:
```js
const [newLineSource, setNewLineSource] = useState(null);
const [newLineEdited, setNewLineEdited] = useState(false);
const abortRef = useRef(null);
```

If `useRef` isn't already imported from React at the top of the file, add it to the existing React import.

**Step 5: Add `updateNewLine` helper inside ChargeSetCard**

Place it near the other helpers in the component (above `addLineItem` is a natural spot):
```js
function updateNewLine(patch) {
  setNewLine((prev) => ({ ...prev, ...patch }));
  if (newLineSource && !newLineEdited) setNewLineEdited(true);
}
```

**Step 6: Rewrite the charge-code dropdown onChange**

Find the Add Line form's charge-code `<select>` (around lines 486-502). Replace the current `onChange`:
```jsx
onChange={(e) => {
  const code = e.target.value;
  const label = CHARGE_NAMES.find((c) => c.value === code)?.label || code;
  setNewLine({ ...newLine, charge_name: code, name: label });
}}
```

With:
```jsx
onChange={async (e) => {
  const code = e.target.value;
  const label = CHARGE_NAMES.find((c) => c.value === code)?.label || code;

  // Picking a code is a full reset: any fields typed before the pick
  // may be overwritten by prefill, and the badge clears optimistically.
  abortRef.current?.abort();
  setNewLineSource(null);
  setNewLineEdited(false);
  setNewLine((prev) => ({ ...prev, charge_name: code, name: label }));

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
      setNewLineSource({
        profileId: p.source_profile_id,
        profileName: p.profile_name,
      });
    }
    // On 404 or other non-200, leave newLine at the code+label only.
  } catch (err) {
    if (err.name !== 'AbortError') {
      console.warn('[billing] charge-profile-preview fetch failed:', err.message);
    }
  }
}}
```

**Step 7: Wrap all other Add Line form field onChange handlers with `updateNewLine`**

Find every `setNewLine({ ...newLine, <field>: <value> })` in the Add Line form (UOM select, Qty input, Rate input, Percentage fields, Description input if present). Replace each with `updateNewLine({ <field>: <value> })`.

Do NOT touch the charge-code onChange — that one intentionally uses the full `setNewLine` to handle the reset case.

This is important for the edit-tracking to work. Any field edit after a prefill flips `newLineEdited = true`.

**Step 8: Add the badge above the Add Line form**

Find the start of the Add Line form JSX (something like `<div className="px-4 py-3 bg-gray-50 ...">`). As the FIRST child inside that wrapper div, add:

```jsx
{newLineSource && (
  <div className="flex items-center gap-1.5 text-[11px] text-blue-700 dark:text-blue-300 bg-blue-50 dark:bg-blue-950/40 rounded px-2 py-1 mb-2 border border-blue-200 dark:border-blue-900/60 w-fit">
    <Link2 className="w-3 h-3" />
    From <span className="font-semibold">{newLineSource.profileName}</span>
    {newLineEdited && <span className="text-amber-600 dark:text-amber-400">· edited</span>}
  </div>
)}
```

**Step 9: Extend the POST body in `addLineItem` + reset state on save**

Find:
```js
async function addLineItem() {
  if (!newLine.name.trim()) {
    onError('Line item name is required');
    return;
  }
  setAdding(true);
  try {
    const res = await fetch(
      `/api/tenant/loads/${loadId}/charge-sets/${chargeSet.id}/line-items`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newLine),
      }
    );
    if (!res.ok) throw new Error('Failed to add line item');
    setNewLine({
      name: '',
      charge_name: '',
      description: '',
      unit_of_measure: 'fixed',
      unit_count: 1,
      free_units: 0,
      per_unit_price_cents: null,
      percentage_value: '',
      percentage_based_on: '',
    });
    await onChanged();
  } catch (e) {
    onError(e.message);
  } finally {
    setAdding(false);
  }
}
```

Change the body to include `source_profile_id`, and the reset block to clear the new state:

```js
async function addLineItem() {
  if (!newLine.name.trim()) {
    onError('Line item name is required');
    return;
  }
  setAdding(true);
  try {
    const res = await fetch(
      `/api/tenant/loads/${loadId}/charge-sets/${chargeSet.id}/line-items`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...newLine,
          source_profile_id: newLineSource?.profileId || null,
        }),
      }
    );
    if (!res.ok) throw new Error('Failed to add line item');
    setNewLine({
      name: '',
      charge_name: '',
      description: '',
      unit_of_measure: 'fixed',
      unit_count: 1,
      free_units: 0,
      per_unit_price_cents: null,
      percentage_value: '',
      percentage_based_on: '',
    });
    setNewLineSource(null);
    setNewLineEdited(false);
    await onChanged();
  } catch (e) {
    onError(e.message);
  } finally {
    setAdding(false);
  }
}
```

**Step 10: Runtime smoke test (manual)**

Open the dev server in the browser. Navigate to a load whose tariff includes at least one charge profile. On the Billing tab:

1. Create or open a charge set if the load doesn't have one yet.
2. In the Add Line form, pick a charge code that exists on the tariff. Verify the form auto-fills (name, UoM, rate). Verify the "🔗 From <profile name>" badge appears above the form.
3. Edit the rate field. Verify the badge changes to "🔗 From <profile name> · edited".
4. Click the "+" button to add the line. Verify the line appears in the table and the Add Line form resets (charge_name blank, badge gone).
5. Pick a charge code that is NOT on the tariff (or use a load with no customer/tariff). Verify no badge appears, fields stay at their defaults, you can type a rate manually and save.
6. Rapidly click through 3 different charge codes. Verify only the LAST pick's prefill lands; no flicker or stale badge.

If any of these fail, STOP and investigate.

**Step 11: Commit**

```bash
git branch --show-current   # must return 'main'
git add components/loads/tabs/BillingTab.js
git commit -m "$(cat <<'EOF'
feat(billing): autofill Add Line form from charge-profile-preview

When a dispatcher picks a charge code in the Billing tab's Add Line
form, fire /api/tenant/loads/[id]/charge-profile-preview and
pre-populate name, description, UOM, qty, rate (or percentage
value + based_on) from the winning profile on the load's tariff.
Every field stays editable. A subtle "🔗 From <profile name>" badge
shows above the form when the line was prefilled; flips to "· edited"
on first field change after prefill.

The saved line gets source_profile_id = <profile id> so the audit
trail survives field overrides.

Four coupled changes in one atomic commit (splitting them would
create intermediate broken states):
- Swap local UOM_OPTIONS for UNITS_OF_MEASURE from
  charge-profile-constants so the UOM select handles all 11 UOMs
  a profile might return (per_hour, radius_rate, per_15min, etc.)
  not just the local 4.
- New state: newLineSource + newLineEdited + abortRef.
- Rewire the charge-code onChange to async fetch + prefill +
  AbortController race-protection.
- All other field onChanges route through updateNewLine to flip
  the edited flag; POST body extends with source_profile_id.

Picking a code is a full reset: the badge clears optimistically,
prefilled fields overwrite any values the user typed before picking.

On 404 / 503 / network error, the client silently falls through to
manual entry — autofill is convenience, not a blocker.

Part of AR Charge Profile Autofill feature.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase 4: Final QA + push

### Task 4.1: End-to-end verification + push

- [ ] **Step 1: Confirm file state**

```bash
git log --oneline origin/main..HEAD
```
Expected: 4 commits — Task 1.1, Task 1.2, Task 2.1, Task 3.1. All ending with `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>`.

```bash
ls -la pages/api/tenant/loads/[id]/charge-profile-preview.js
```
Expected: file exists.

- [ ] **Step 2: Run Gate 1 baseline comparison one more time**

Re-run the recalc-charges-diagnostic script from Phase 0 Task 0.1 Step 2 against the baseline load. Diff against `tmp/ar-autofill-baseline.json`. Expected: empty diff (modulo timestamps and `_meta` — the auto-apply flow is unchanged by the whole plan).

- [ ] **Step 3: End-to-end happy-path walkthrough**

Open the baseline load in the browser. On the Billing tab:

1. Charge set exists, OR create a new one.
2. In the Add Line form, pick a charge code that matches a profile on the load's tariff (e.g. the same charge_name the engine auto-applies). Verify prefill + badge.
3. Save the line. In the browser DevTools network tab, confirm the POST body contained `source_profile_id`. In the response, confirm the line_item row has `source_profile_id` populated.
4. Pick a charge code that's NOT in any profile. Form stays at code+label only. No badge. Type a manual rate, save. Line saves as a pure manual entry (no source_profile_id in the DB).
5. Pick a percentage profile (e.g. "Fuel Surcharge" as 15% of LINE_HAUL). If the load has a LINE_HAUL line already, the computed amount renders correctly. If not, shows $0 (expected — pre-existing behavior).
6. Rapid-click test: 3 charge codes in fast succession. Only the last one's prefill sticks.

- [ ] **Step 4: Dark mode + zoom spot check**

Toggle dark mode. Verify the badge, the Add Line form, and the rest of the Billing tab render cleanly. Check at zoom 80%, 100%, 125% — no clipping, no horizontal scrollbars.

- [ ] **Step 5: Engine canary**

Trigger a full recalculate on the baseline load (via the existing "Recalculate" button or `POST /api/tenant/loads/<id>/recalculate-charges`). Verify:
- Auto-applied lines fire exactly as before (same profiles, same cents amounts).
- Any manually-added lines with `source_profile_id` are NOT affected by the recalc (the engine's "Replace auto, keep manual" rule applies — manual lines have `is_auto=false`, so they survive).

- [ ] **Step 6: Push**

```bash
git branch --show-current   # must return 'main'
git push origin main
```

Write a brief release note summarizing what shipped.

- [ ] **Step 7: Update memory**

The memory file `feature_charge_profile_autofill.md` described a stricter rule ("user shouldn't be able to add non-tariff charge codes at all") than what actually shipped (autofill when matching, free entry otherwise). Update the memory file to match the shipped behavior so future conversations default to the right mental model. Also mark the feature as SHIPPED with commit SHA and link to the spec.

---

## Summary

4 implementation commits + 1 docs correction (already shipped). Total new code: ~200 LoC (~90 for the preview endpoint + ~100 for the BillingTab changes + ~15 for the handler updates). No schema changes, no new dependencies.

After this ships:
- Dispatchers get autofill for any charge code with a matching profile on the load's tariff, while still being free to type ad-hoc charges for codes without profiles.
- `auto_add = NO` profiles finally do something meaningful — they pre-fill on manual pick. `auto_add = YES` still fires automatically on matching loads (unchanged).
- The audit trail via `source_profile_id` survives arbitrary field overrides — future dispute resolution can trace any manual line back to its profile-of-origin.
- AP (Driver Pay tab) autofill is the next plan, using the same architectural pattern.
