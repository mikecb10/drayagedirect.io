# Dry Run Feature — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a leg-scoped Dry Run feature — a dispatcher-triggered slide-over that records a driver's attempted leg that didn't complete, producing linked AR charges + AP driver pay with hybrid (preset or manual) pricing.

**Architecture:** New `dry_run_attempts` parent table with nullable `event_id` + FK cascade into existing `order_charge_set_line_items` and `order_driver_pay_lines`. Popup is a right-side slide-over (matches `EmailComposeSlideOver` pattern). Leg card gets an inline list + "+ Add Dry Run" button below the status rows. Two-tier leg delete (block if invoiced/settled, else detach vs delete-all modal).

**Tech Stack:** Next.js pages-router, Supabase (Postgres + JS client), React, Tailwind with mandatory dark-mode variants, hand-rolled `.test.mjs` unit tests.

**Spec:** `docs/superpowers/specs/2026-04-22-dry-run-design.md` (commit `931a6c9`).

---

## File Structure

**Backend:**
- Create: `supabase/migrations/088_dry_runs.sql`
- Create: `lib/dry-run-engine.js` — compute + validate helpers
- Create: `pages/api/tenant/loads/[id]/dry-runs/index.js` — GET list, POST create
- Create: `pages/api/tenant/loads/[id]/dry-runs/preview.js` — POST preview compute
- Create: `pages/api/tenant/loads/[id]/dry-runs/[attemptId].js` — PATCH, DELETE
- Modify: `pages/api/tenant/charge-profiles/index.js` — accept `?is_dry_run=true` filter
- Modify: `pages/api/tenant/driver-charge-profiles/index.js` — same
- Modify: `pages/api/tenant/loads/[id]/routing/events/[eventId].js` — two-tier DELETE

**Frontend:**
- Create: `components/loads/routing/DryRunSlideOver.js` — popup
- Create: `components/loads/routing/DryRunList.js` — inline list on leg card
- Create: `components/loads/routing/LegDeleteConfirmModal.js` — detach/delete-all/cancel modal
- Modify: `components/loads/routing/EventRow.js` — render list + "+ Add Dry Run" button
- Modify: `components/loads/tabs/BillingTab.js` — open slide-over on dry-run line-item click
- Modify: `components/loads/tabs/DriverPayTab.js` — same for driver pay rows
- Modify: `components/settings/ChargeProfileEditor.js` — `is_dry_run` checkbox
- Modify: `components/settings/DriverChargeProfileEditor.js` — same

**Tests:**
- Create: `tests/dry-run-engine.test.mjs` — unit tests (~25 assertions)

---

## Conventions

1. **Dark-mode variants mandatory** on every gray/white/border class (see `memory/dev_dark_mode_convention.md`).
2. **Migration template mandatory:** `BEGIN; ... NOTIFY pgrst, 'reload schema'; COMMIT;` (see `memory/dev_migration_template.md`).
3. **Amounts in cents** (integer) throughout. Never store dollars.
4. **All queries must scope by `tenant_id`** even with service-role client (convention from `memory/session_2026_04_15_recap.md`).
5. **Soft-delete pattern:** `deleted_at IS NULL` filter on all selects; never hard-delete `dry_run_attempts` rows.
6. **Silent insert failure rule:** always handle Supabase insert errors explicitly; never trust `data?.id` without checking `error`.
7. **line_type for dry runs:** `'dry_run'` (plain TEXT value — the column has no enum/CHECK).
8. **Commit message prefix:** `feat(dry-run):` for implementation, `test(dry-run):` for tests, `docs(dry-run):` for docs.

---

## Sub-agent Dispatch Model

| Task | Role | Model |
|---|---|---|
| 1 — Migration 088 | Backend, mechanical | **haiku** |
| 2 — `dry-run-engine.js` + unit tests | Backend, mechanical with full code in prompt | **haiku** |
| 3 — API endpoints | Backend, multi-file integration | **sonnet** |
| 4 — Settings checkboxes | Frontend, mechanical | **haiku** |
| 5 — `DryRunSlideOver` | Frontend, integration | **sonnet** |
| 6 — `DryRunList` | Frontend, integration | **sonnet** |
| 7 — `EventRow` wire-up | Frontend, integration | **sonnet** |
| 8 — Billing/DriverPay row-click | Frontend, mechanical | **haiku** |
| 9 — Two-tier leg delete | Backend + frontend integration | **sonnet** |
| 10 — Chrome live gates | Verification | **sonnet** Chrome subagent |
| 11 — Final code review | Review | **superpowers:code-reviewer** |

---

## Dependency Graph

```
Task 1 (migration)
  ├─→ Task 2 (engine + tests)
  │    └─→ Task 3 (API)
  │         ├─→ Task 5 (DryRunSlideOver)
  │         │    ├─→ Task 7 (EventRow wire-up)
  │         │    │    └─→ Task 9 (leg delete)
  │         │    └─→ Task 8 (Billing/DriverPay row-click)
  │         └─→ Task 6 (DryRunList)
  │              └─→ Task 7 (EventRow wire-up)
  └─→ Task 4 (Settings) [parallel with 2+3]

After Task 9 lands:
  └─→ Task 10 (live gates)
       └─→ Task 11 (code review)
```

**Strictly sequential:** 1 → 2 → 3 → (5 + 6) → 7 → 9 → 10 → 11
**Parallelizable:** Task 4 anywhere after 1; Task 8 anywhere after 5.

---

## Task 1: Migration 088 — schema + FK additions + profile flags

**Files:**
- Create: `supabase/migrations/088_dry_runs.sql`

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/088_dry_runs.sql` with the following content verbatim:

```sql
-- ============================================================
-- Migration 088: Dry Run feature
-- ============================================================
-- Adds a first-class `dry_run_attempts` table that records a leg
-- attempt that didn't complete its operational goal. Derived line
-- items land in `order_charge_set_line_items` (AR) and
-- `order_driver_pay_lines` (AP) via FK cascade.
--
-- Also adds `is_dry_run` opt-in flags on `charge_profiles` and
-- `driver_charge_profiles` so tenants can mark existing profiles
-- as dry-run-eligible without creating duplicates.
-- ============================================================

BEGIN;

-- 1. Parent table
CREATE TABLE dry_run_attempts (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                 uuid NOT NULL REFERENCES tenants(id),
  order_id                  uuid NOT NULL REFERENCES orders(id),
  event_id                  uuid NULL REFERENCES order_routing_events(id) ON DELETE RESTRICT,
  driver_id                 uuid NOT NULL REFERENCES drivers(id),
  occurred_at               timestamptz NOT NULL DEFAULT now(),
  rate_source               text NOT NULL CHECK (rate_source IN ('preset','manual')),
  charge_profile_id         uuid NULL REFERENCES charge_profiles(id),
  driver_charge_profile_id  uuid NULL REFERENCES driver_charge_profiles(id),
  rate_method               text NOT NULL CHECK (rate_method IN ('fixed','per_mile')),
  miles                     numeric(10,2) NULL,
  ar_amount_cents           integer NOT NULL CHECK (ar_amount_cents >= 0),
  ap_amount_cents           integer NOT NULL CHECK (ap_amount_cents >= 0),
  notes                     text NULL,
  created_by                uuid NOT NULL REFERENCES users(id),
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now(),
  deleted_at                timestamptz NULL,

  -- Q2 invariant: preset requires both profile IDs, manual forbids them
  CONSTRAINT chk_preset_has_profiles CHECK (
    (rate_source = 'preset' AND charge_profile_id IS NOT NULL AND driver_charge_profile_id IS NOT NULL) OR
    (rate_source = 'manual' AND charge_profile_id IS NULL AND driver_charge_profile_id IS NULL)
  ),

  -- Q3 invariant: per_mile requires miles > 0
  CONSTRAINT chk_per_mile_requires_miles CHECK (
    rate_method = 'fixed' OR (rate_method = 'per_mile' AND miles IS NOT NULL AND miles > 0)
  )
);

-- 2. Indexes powering leg-card list, load rollups, driver reporting
CREATE INDEX idx_dry_run_attempts_tenant_event  ON dry_run_attempts (tenant_id, event_id)  WHERE deleted_at IS NULL;
CREATE INDEX idx_dry_run_attempts_tenant_order  ON dry_run_attempts (tenant_id, order_id)  WHERE deleted_at IS NULL;
CREATE INDEX idx_dry_run_attempts_tenant_driver ON dry_run_attempts (tenant_id, driver_id) WHERE deleted_at IS NULL;

-- 3. FK columns on derived line-item tables (cascade on parent hard-delete;
--    soft-delete of parent is handled by app code, not FK)
ALTER TABLE order_charge_set_line_items
  ADD COLUMN dry_run_attempt_id uuid NULL REFERENCES dry_run_attempts(id) ON DELETE CASCADE;

ALTER TABLE order_driver_pay_lines
  ADD COLUMN dry_run_attempt_id uuid NULL REFERENCES dry_run_attempts(id) ON DELETE CASCADE;

CREATE INDEX idx_charge_set_li_dry_run ON order_charge_set_line_items (dry_run_attempt_id) WHERE dry_run_attempt_id IS NOT NULL;
CREATE INDEX idx_driver_pay_li_dry_run ON order_driver_pay_lines      (dry_run_attempt_id) WHERE dry_run_attempt_id IS NOT NULL;

-- 4. Opt-in flags on existing profile tables
ALTER TABLE charge_profiles        ADD COLUMN is_dry_run boolean NOT NULL DEFAULT false;
ALTER TABLE driver_charge_profiles ADD COLUMN is_dry_run boolean NOT NULL DEFAULT false;

-- 5. Updated-at trigger (reuse existing tenant convention)
CREATE TRIGGER trg_dry_run_attempts_updated_at
  BEFORE UPDATE ON dry_run_attempts
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

NOTIFY pgrst, 'reload schema';

COMMIT;
```

- [ ] **Step 2: Commit**

```bash
git add supabase/migrations/088_dry_runs.sql
git commit -m "feat(dry-run): migration 088 — schema + FK + profile flags"
```

- [ ] **Step 3: User applies migration**

User runs `088_dry_runs.sql` in Supabase SQL editor. Verify no errors. User confirms `\d dry_run_attempts` shows the table.

**Stop-and-verify gate:** migration must apply cleanly before Task 2 begins.

---

## Task 2: `lib/dry-run-engine.js` + unit tests

**Files:**
- Create: `lib/dry-run-engine.js`
- Create: `tests/dry-run-engine.test.mjs`

- [ ] **Step 1: Write the failing tests**

Create `tests/dry-run-engine.test.mjs`:

```javascript
import {
  computeManualAmount,
  computePresetAmount,
  validatePayload,
  MAX_AMOUNT_CENTS,
} from '../lib/dry-run-engine.js';

let passed = 0;
let failed = 0;
function check(name, cond) {
  if (cond) { console.log(`  ✓ ${name}`); passed++; }
  else      { console.log(`  ✗ ${name}`); failed++; }
}

console.log('computeManualAmount — fixed method');
check('returns amount as-is', computeManualAmount({ rate_method: 'fixed', amount_cents: 12500 }) === 12500);
check('ignores miles when fixed', computeManualAmount({ rate_method: 'fixed', amount_cents: 500, miles: 99 }) === 500);
check('rejects negative', (() => { try { computeManualAmount({ rate_method: 'fixed', amount_cents: -1 }); return false; } catch { return true; } })());
check('rejects over-ceiling', (() => { try { computeManualAmount({ rate_method: 'fixed', amount_cents: MAX_AMOUNT_CENTS + 1 }); return false; } catch { return true; } })());

console.log('\ncomputeManualAmount — per_mile method');
check('rate × miles', computeManualAmount({ rate_method: 'per_mile', rate_cents_per_mile: 250, miles: 42 }) === 10500);
check('decimal miles rounded', computeManualAmount({ rate_method: 'per_mile', rate_cents_per_mile: 100, miles: 42.5 }) === 4250);
check('rejects zero miles', (() => { try { computeManualAmount({ rate_method: 'per_mile', rate_cents_per_mile: 100, miles: 0 }); return false; } catch { return true; } })());
check('rejects negative rate', (() => { try { computeManualAmount({ rate_method: 'per_mile', rate_cents_per_mile: -1, miles: 10 }); return false; } catch { return true; } })());

console.log('\ncomputePresetAmount');
const fakeProfile = { rate_method: 'fixed', amount_cents: 15000, name: 'Flat Dry Run' };
check('fixed profile', computePresetAmount(fakeProfile, { miles: null }) === 15000);
const pmProfile = { rate_method: 'per_mile', rate_cents_per_mile: 300, name: 'Per-mile Dry Run' };
check('per_mile profile × 20mi', computePresetAmount(pmProfile, { miles: 20 }) === 6000);
check('per_mile profile rejects null miles', (() => { try { computePresetAmount(pmProfile, { miles: null }); return false; } catch { return true; } })());

console.log('\nvalidatePayload');
const validManual = {
  event_id: 'e1', driver_id: 'd1',
  rate_source: 'manual', rate_method: 'fixed',
  ar_amount_cents: 500, ap_amount_cents: 300,
};
check('valid manual payload', validatePayload(validManual).ok === true);
check('manual rejects profile_id', validatePayload({ ...validManual, charge_profile_id: 'p1' }).ok === false);

const validPreset = {
  event_id: 'e1', driver_id: 'd1',
  rate_source: 'preset', rate_method: 'per_mile',
  charge_profile_id: 'p1', driver_charge_profile_id: 'dp1',
  miles: 42,
  ar_amount_cents: 0, ap_amount_cents: 0,
};
check('valid preset payload', validatePayload(validPreset).ok === true);
check('preset rejects missing charge_profile', validatePayload({ ...validPreset, charge_profile_id: null }).ok === false);
check('preset rejects missing driver_charge_profile', validatePayload({ ...validPreset, driver_charge_profile_id: null }).ok === false);
check('per_mile rejects null miles', validatePayload({ ...validPreset, miles: null }).ok === false);
check('per_mile rejects zero miles', validatePayload({ ...validPreset, miles: 0 }).ok === false);
check('rejects missing event_id', validatePayload({ ...validManual, event_id: null }).ok === false);
check('rejects missing driver_id', validatePayload({ ...validManual, driver_id: null }).ok === false);
check('rejects invalid rate_source', validatePayload({ ...validManual, rate_source: 'wild' }).ok === false);
check('rejects invalid rate_method', validatePayload({ ...validManual, rate_method: 'wild' }).ok === false);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node tests/dry-run-engine.test.mjs`
Expected: FAIL with "Cannot find module '../lib/dry-run-engine.js'".

- [ ] **Step 3: Write `lib/dry-run-engine.js`**

Create `lib/dry-run-engine.js`:

```javascript
/**
 * Dry Run Engine
 * --------------
 * Pure computation helpers for the Dry Run feature. These run on the server
 * (API endpoints) and are unit-tested via `tests/dry-run-engine.test.mjs`.
 *
 * Rules:
 *  - rate_source='preset' → server recomputes from the referenced profile.
 *  - rate_source='manual' → server trusts client amounts, with bounds checks.
 *  - rate_method='fixed'  → `amount_cents` is used as-is.
 *  - rate_method='per_mile' → `rate_cents_per_mile * miles`, rounded half-up.
 */

export const MAX_AMOUNT_CENTS = 10_000_000; // $100,000 sanity ceiling

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function roundHalfUp(n) {
  return Math.round(n);
}

/**
 * Compute a manually-entered amount.
 * @param {{rate_method: 'fixed'|'per_mile', amount_cents?: number, rate_cents_per_mile?: number, miles?: number}} input
 * @returns {number} amount in cents
 */
export function computeManualAmount(input) {
  const { rate_method } = input;

  if (rate_method === 'fixed') {
    const amount = input.amount_cents;
    assert(Number.isFinite(amount) && amount >= 0, 'amount_cents must be a non-negative number');
    assert(amount <= MAX_AMOUNT_CENTS, `amount_cents exceeds ceiling (${MAX_AMOUNT_CENTS})`);
    return amount;
  }

  if (rate_method === 'per_mile') {
    const rate = input.rate_cents_per_mile;
    const miles = input.miles;
    assert(Number.isFinite(rate) && rate > 0, 'rate_cents_per_mile must be > 0');
    assert(Number.isFinite(miles) && miles > 0, 'miles must be > 0');
    const result = roundHalfUp(rate * miles);
    assert(result <= MAX_AMOUNT_CENTS, `computed amount exceeds ceiling (${MAX_AMOUNT_CENTS})`);
    return result;
  }

  throw new Error(`unknown rate_method: ${rate_method}`);
}

/**
 * Compute an amount using a preset profile row.
 * @param {{rate_method: 'fixed'|'per_mile', amount_cents?: number, rate_cents_per_mile?: number, name?: string}} profile
 * @param {{miles?: number|null}} context
 */
export function computePresetAmount(profile, context) {
  const { rate_method } = profile;

  if (rate_method === 'fixed') {
    return computeManualAmount({ rate_method: 'fixed', amount_cents: profile.amount_cents });
  }

  if (rate_method === 'per_mile') {
    return computeManualAmount({
      rate_method: 'per_mile',
      rate_cents_per_mile: profile.rate_cents_per_mile,
      miles: context.miles,
    });
  }

  throw new Error(`profile has unknown rate_method: ${rate_method}`);
}

/**
 * Validate a create/edit payload shape.
 * Returns { ok: true } or { ok: false, reason: string }.
 */
export function validatePayload(payload) {
  if (!payload || typeof payload !== 'object') return { ok: false, reason: 'payload required' };
  if (!payload.event_id)  return { ok: false, reason: 'event_id required' };
  if (!payload.driver_id) return { ok: false, reason: 'driver_id required' };

  if (!['preset', 'manual'].includes(payload.rate_source)) return { ok: false, reason: 'rate_source must be preset|manual' };
  if (!['fixed',  'per_mile'].includes(payload.rate_method)) return { ok: false, reason: 'rate_method must be fixed|per_mile' };

  if (payload.rate_source === 'preset') {
    if (!payload.charge_profile_id)        return { ok: false, reason: 'preset requires charge_profile_id' };
    if (!payload.driver_charge_profile_id) return { ok: false, reason: 'preset requires driver_charge_profile_id' };
  } else {
    if (payload.charge_profile_id || payload.driver_charge_profile_id) {
      return { ok: false, reason: 'manual must not include profile IDs' };
    }
  }

  if (payload.rate_method === 'per_mile') {
    if (!Number.isFinite(payload.miles) || payload.miles <= 0) {
      return { ok: false, reason: 'per_mile requires miles > 0' };
    }
  }

  return { ok: true };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node tests/dry-run-engine.test.mjs`
Expected: `21 passed, 0 failed` (or similar). All checks green.

- [ ] **Step 5: Commit**

```bash
git add lib/dry-run-engine.js tests/dry-run-engine.test.mjs
git commit -m "feat(dry-run): engine — computeManualAmount, computePresetAmount, validatePayload"
```

---

## Task 3: API endpoints

**Files:**
- Create: `pages/api/tenant/loads/[id]/dry-runs/index.js`
- Create: `pages/api/tenant/loads/[id]/dry-runs/preview.js`
- Create: `pages/api/tenant/loads/[id]/dry-runs/[attemptId].js`
- Modify: `pages/api/tenant/charge-profiles/index.js`
- Modify: `pages/api/tenant/driver-charge-profiles/index.js`

- [ ] **Step 1: Add `?is_dry_run=true` filter to `charge-profiles` list endpoint**

In `pages/api/tenant/charge-profiles/index.js`, find the GET handler. After the existing filters, add:

```javascript
if (req.query.is_dry_run === 'true') {
  query = query.eq('is_dry_run', true);
}
```

Place this BEFORE the `.order()` call so filters stack correctly. Exact location: just after the last `if (...) query = query.eq/like(...)` in the GET branch.

- [ ] **Step 2: Add same filter to `driver-charge-profiles` endpoint**

In `pages/api/tenant/driver-charge-profiles/index.js`, GET handler. Same insertion:

```javascript
if (req.query.is_dry_run === 'true') {
  query = query.eq('is_dry_run', true);
}
```

- [ ] **Step 3: Create preview endpoint**

Create `pages/api/tenant/loads/[id]/dry-runs/preview.js`:

```javascript
import {
  requireTenantUser,
  requirePermission,
  getServiceClient,
} from '../../../../../../lib/tenant-api';
import { PERMISSIONS } from '../../../../../../lib/permissions';
import { computeManualAmount, computePresetAmount, validatePayload } from '../../../../../../lib/dry-run-engine';

/**
 * POST /api/tenant/loads/[id]/dry-runs/preview
 *
 * Stateless compute — returns { ar_amount_cents, ap_amount_cents } for a
 * proposed dry run without writing anything. Used by DryRunSlideOver to
 * live-preview amounts as the user changes fields.
 */
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const ctx = await requireTenantUser(req, res);
  if (!ctx) return;
  if (!requirePermission(ctx, [PERMISSIONS.ACCOUNTS_RECEIVABLE, PERMISSIONS.DRIVER_PAY, PERMISSIONS.ALL], res)) return;

  const svc = getServiceClient();
  const { id: orderId } = req.query;
  const body = req.body || {};

  // Validate shape (loose — preview can be called with partial data mid-edit)
  const { rate_source, rate_method } = body;
  if (!['preset', 'manual'].includes(rate_source)) {
    return res.status(200).json({ ar_amount_cents: 0, ap_amount_cents: 0 });
  }
  if (!['fixed', 'per_mile'].includes(rate_method)) {
    return res.status(200).json({ ar_amount_cents: 0, ap_amount_cents: 0 });
  }

  try {
    if (rate_source === 'preset') {
      // Load both profiles, verify tenant ownership
      const [{ data: arProfile }, { data: apProfile }] = await Promise.all([
        svc.from('charge_profiles')
           .select('id, name, rate_method, amount_cents, rate_cents_per_mile, is_dry_run, tenant_id')
           .eq('id', body.charge_profile_id)
           .eq('tenant_id', ctx.tenantId)
           .maybeSingle(),
        svc.from('driver_charge_profiles')
           .select('id, name, rate_method, amount_cents, rate_cents_per_mile, is_dry_run, tenant_id')
           .eq('id', body.driver_charge_profile_id)
           .eq('tenant_id', ctx.tenantId)
           .maybeSingle(),
      ]);

      if (!arProfile || !arProfile.is_dry_run) return res.status(400).json({ error: 'AR profile not found or not dry-run eligible' });
      if (!apProfile || !apProfile.is_dry_run) return res.status(400).json({ error: 'AP profile not found or not dry-run eligible' });

      return res.status(200).json({
        ar_amount_cents: computePresetAmount(arProfile, { miles: body.miles }),
        ap_amount_cents: computePresetAmount(apProfile, { miles: body.miles }),
        ar_profile_name: arProfile.name,
        ap_profile_name: apProfile.name,
      });
    }

    // manual
    const ar = computeManualAmount({
      rate_method,
      amount_cents: body.ar_amount_cents,
      rate_cents_per_mile: body.ar_rate_cents_per_mile,
      miles: body.miles,
    });
    const ap = computeManualAmount({
      rate_method,
      amount_cents: body.ap_amount_cents,
      rate_cents_per_mile: body.ap_rate_cents_per_mile,
      miles: body.miles,
    });
    return res.status(200).json({ ar_amount_cents: ar, ap_amount_cents: ap });
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
}
```

- [ ] **Step 4: Create list + create endpoint**

Create `pages/api/tenant/loads/[id]/dry-runs/index.js`:

```javascript
import {
  requireTenantUser,
  requirePermission,
  getServiceClient,
} from '../../../../../../lib/tenant-api';
import { logTenantAction, getClientIp } from '../../../../../../lib/tenant-audit';
import { PERMISSIONS } from '../../../../../../lib/permissions';
import { computeManualAmount, computePresetAmount, validatePayload } from '../../../../../../lib/dry-run-engine';

export default async function handler(req, res) {
  const ctx = await requireTenantUser(req, res);
  if (!ctx) return;

  const svc = getServiceClient();
  const { id: orderId } = req.query;

  if (req.method === 'GET') {
    if (!requirePermission(ctx, [PERMISSIONS.ACCOUNTS_RECEIVABLE, PERMISSIONS.DRIVER_PAY, PERMISSIONS.ALL], res)) return;

    let query = svc
      .from('dry_run_attempts')
      .select(`
        id, event_id, driver_id, occurred_at, rate_source, rate_method, miles,
        ar_amount_cents, ap_amount_cents, notes, created_at, updated_at,
        charge_profile:charge_profiles!charge_profile_id(id, name),
        driver_charge_profile:driver_charge_profiles!driver_charge_profile_id(id, name),
        driver:drivers!driver_id(id, name)
      `)
      .eq('tenant_id', ctx.tenantId)
      .eq('order_id', orderId)
      .is('deleted_at', null)
      .order('occurred_at', { ascending: false });

    if (req.query.event_id) query = query.eq('event_id', req.query.event_id);

    const { data, error } = await query;
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ dry_runs: data || [] });
  }

  if (req.method === 'POST') {
    if (!requirePermission(ctx, [PERMISSIONS.ACCOUNTS_RECEIVABLE, PERMISSIONS.DRIVER_PAY, PERMISSIONS.ALL], res)) return;

    const body = req.body || {};

    // 1. Validate shape
    const v = validatePayload(body);
    if (!v.ok) return res.status(400).json({ error: v.reason });

    // 2. Verify event belongs to this load
    const { data: event, error: eventError } = await svc
      .from('order_routing_events')
      .select('id, event_type, location_id, move_id')
      .eq('id', body.event_id)
      .eq('tenant_id', ctx.tenantId)
      .maybeSingle();
    if (eventError || !event) return res.status(400).json({ error: 'Event not found' });

    // 3. Compute amounts (preset path recomputes, manual path validates)
    let arAmount, apAmount;
    try {
      if (body.rate_source === 'preset') {
        const [{ data: arProfile }, { data: apProfile }] = await Promise.all([
          svc.from('charge_profiles')
             .select('id, name, rate_method, amount_cents, rate_cents_per_mile, is_dry_run')
             .eq('id', body.charge_profile_id).eq('tenant_id', ctx.tenantId).eq('is_dry_run', true).maybeSingle(),
          svc.from('driver_charge_profiles')
             .select('id, name, rate_method, amount_cents, rate_cents_per_mile, is_dry_run')
             .eq('id', body.driver_charge_profile_id).eq('tenant_id', ctx.tenantId).eq('is_dry_run', true).maybeSingle(),
        ]);
        if (!arProfile) return res.status(400).json({ error: 'AR profile not found or not dry-run eligible' });
        if (!apProfile) return res.status(400).json({ error: 'AP profile not found or not dry-run eligible' });
        arAmount = computePresetAmount(arProfile, { miles: body.miles });
        apAmount = computePresetAmount(apProfile, { miles: body.miles });
      } else {
        arAmount = computeManualAmount({
          rate_method: body.rate_method,
          amount_cents: body.ar_amount_cents,
          rate_cents_per_mile: body.ar_rate_cents_per_mile,
          miles: body.miles,
        });
        apAmount = computeManualAmount({
          rate_method: body.rate_method,
          amount_cents: body.ap_amount_cents,
          rate_cents_per_mile: body.ap_rate_cents_per_mile,
          miles: body.miles,
        });
      }
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }

    // 4. Insert parent attempt
    const { data: attempt, error: attemptError } = await svc
      .from('dry_run_attempts')
      .insert({
        tenant_id: ctx.tenantId,
        order_id: orderId,
        event_id: body.event_id,
        driver_id: body.driver_id,
        occurred_at: body.occurred_at || new Date().toISOString(),
        rate_source: body.rate_source,
        charge_profile_id: body.charge_profile_id || null,
        driver_charge_profile_id: body.driver_charge_profile_id || null,
        rate_method: body.rate_method,
        miles: body.rate_method === 'per_mile' ? body.miles : null,
        ar_amount_cents: arAmount,
        ap_amount_cents: apAmount,
        notes: body.notes || null,
        created_by: ctx.userId,
      })
      .select()
      .single();
    if (attemptError) return res.status(500).json({ error: attemptError.message });

    // 5. Find-or-create open charge set for the load's bill-to customer
    const { data: load } = await svc.from('orders').select('bill_to_id, customer_id').eq('id', orderId).maybeSingle();
    const billToId = load?.bill_to_id || load?.customer_id;
    if (!billToId) {
      // Rollback attempt row on failure (no transaction wrapper in Supabase JS — soft-delete)
      await svc.from('dry_run_attempts').update({ deleted_at: new Date().toISOString() }).eq('id', attempt.id);
      return res.status(400).json({ error: 'Load has no bill-to customer' });
    }

    let { data: chargeSet } = await svc
      .from('order_charge_sets')
      .select('id, status')
      .eq('order_id', orderId)
      .eq('customer_id', billToId)
      .eq('status', 'open')
      .is('deleted_at', null)
      .maybeSingle();

    if (!chargeSet) {
      const { data: created, error: csErr } = await svc
        .from('order_charge_sets')
        .insert({ tenant_id: ctx.tenantId, order_id: orderId, customer_id: billToId, status: 'open' })
        .select('id, status')
        .single();
      if (csErr) {
        await svc.from('dry_run_attempts').update({ deleted_at: new Date().toISOString() }).eq('id', attempt.id);
        return res.status(500).json({ error: 'Failed to create charge set: ' + csErr.message });
      }
      chargeSet = created;
    }

    // 6. Insert AR line item
    const eventLabel = event.event_type.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
    const { error: arError } = await svc.from('order_charge_set_line_items').insert({
      tenant_id: ctx.tenantId,
      charge_set_id: chargeSet.id,
      name: `Dry Run — ${eventLabel}`,
      description: `Driver · ${body.miles || 0} mi · ${new Date(body.occurred_at || Date.now()).toLocaleString()}`,
      unit_count: 1,
      per_unit_price_cents: arAmount,
      total_cents: arAmount,
      is_auto: false,
      dry_run_attempt_id: attempt.id,
    });
    if (arError) {
      await svc.from('dry_run_attempts').update({ deleted_at: new Date().toISOString() }).eq('id', attempt.id);
      return res.status(500).json({ error: 'Failed to create AR line: ' + arError.message });
    }

    // 7. Insert AP line item
    const { error: apError } = await svc.from('order_driver_pay_lines').insert({
      tenant_id: ctx.tenantId,
      order_id: orderId,
      driver_id: body.driver_id,
      line_type: 'dry_run',
      amount_cents: apAmount,
      miles: body.rate_method === 'per_mile' ? body.miles : null,
      worked_at: body.occurred_at || new Date().toISOString(),
      description: `Dry Run — ${eventLabel}`,
      dry_run_attempt_id: attempt.id,
    });
    if (apError) {
      await svc.from('dry_run_attempts').update({ deleted_at: new Date().toISOString() }).eq('id', attempt.id);
      return res.status(500).json({ error: 'Failed to create AP line: ' + apError.message });
    }

    // 8. Audit
    await logTenantAction(svc, {
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      action: 'dry_run.create',
      entityType: 'dry_run',
      entityId: attempt.id,
      newValues: { event_id: body.event_id, ar_amount_cents: arAmount, ap_amount_cents: apAmount, rate_source: body.rate_source },
      ipAddress: getClientIp(req),
    });

    return res.status(201).json({ dry_run: attempt });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
```

- [ ] **Step 5: Create PATCH / DELETE endpoint**

Create `pages/api/tenant/loads/[id]/dry-runs/[attemptId].js`:

```javascript
import {
  requireTenantUser,
  requirePermission,
  getServiceClient,
} from '../../../../../../lib/tenant-api';
import { logTenantAction, getClientIp } from '../../../../../../lib/tenant-audit';
import { PERMISSIONS } from '../../../../../../lib/permissions';
import { validatePayload, computeManualAmount, computePresetAmount } from '../../../../../../lib/dry-run-engine';

export default async function handler(req, res) {
  const ctx = await requireTenantUser(req, res);
  if (!ctx) return;
  if (!requirePermission(ctx, [PERMISSIONS.ACCOUNTS_RECEIVABLE, PERMISSIONS.DRIVER_PAY, PERMISSIONS.ALL], res)) return;

  const svc = getServiceClient();
  const { id: orderId, attemptId } = req.query;

  // Load attempt + check it belongs to this order + tenant
  const { data: attempt } = await svc
    .from('dry_run_attempts')
    .select('*')
    .eq('id', attemptId)
    .eq('tenant_id', ctx.tenantId)
    .eq('order_id', orderId)
    .is('deleted_at', null)
    .maybeSingle();
  if (!attempt) return res.status(404).json({ error: 'Dry run not found' });

  // Check read-only gates: invoiced AR line or settled AP line
  async function assertEditable() {
    const [{ data: arLine }, { data: apLine }] = await Promise.all([
      svc.from('order_charge_set_line_items')
         .select('id, charge_set_id, charge_sets:order_charge_sets!charge_set_id(status)')
         .eq('dry_run_attempt_id', attemptId).maybeSingle(),
      svc.from('order_driver_pay_lines')
         .select('id, settlement_id, status')
         .eq('dry_run_attempt_id', attemptId).maybeSingle(),
    ]);
    const invoicedStatuses = ['approved', 'invoiced', 'locked'];
    if (arLine?.charge_sets && invoicedStatuses.includes(arLine.charge_sets.status)) {
      return { ok: false, reason: 'This dry run has been invoiced. Create a credit memo to reverse.' };
    }
    if (apLine?.settlement_id) {
      return { ok: false, reason: 'This dry run is in a closed settlement. Create a pay adjustment to reverse.' };
    }
    return { ok: true };
  }

  if (req.method === 'PATCH') {
    const guard = await assertEditable();
    if (!guard.ok) return res.status(409).json({ error: guard.reason });

    const body = req.body || {};
    const merged = { ...attempt, ...body };
    const v = validatePayload(merged);
    if (!v.ok) return res.status(400).json({ error: v.reason });

    // Recompute amounts if pricing-related fields changed
    let ar = attempt.ar_amount_cents;
    let ap = attempt.ap_amount_cents;
    try {
      if (merged.rate_source === 'preset') {
        const [{ data: arProfile }, { data: apProfile }] = await Promise.all([
          svc.from('charge_profiles').select('*').eq('id', merged.charge_profile_id).eq('tenant_id', ctx.tenantId).eq('is_dry_run', true).maybeSingle(),
          svc.from('driver_charge_profiles').select('*').eq('id', merged.driver_charge_profile_id).eq('tenant_id', ctx.tenantId).eq('is_dry_run', true).maybeSingle(),
        ]);
        if (!arProfile || !apProfile) return res.status(400).json({ error: 'Profile not found' });
        ar = computePresetAmount(arProfile, { miles: merged.miles });
        ap = computePresetAmount(apProfile, { miles: merged.miles });
      } else if (body.ar_amount_cents !== undefined || body.rate_method !== undefined || body.miles !== undefined) {
        ar = computeManualAmount({
          rate_method: merged.rate_method,
          amount_cents: merged.ar_amount_cents,
          rate_cents_per_mile: body.ar_rate_cents_per_mile,
          miles: merged.miles,
        });
        ap = computeManualAmount({
          rate_method: merged.rate_method,
          amount_cents: merged.ap_amount_cents,
          rate_cents_per_mile: body.ap_rate_cents_per_mile,
          miles: merged.miles,
        });
      }
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }

    const patch = {
      driver_id: merged.driver_id,
      occurred_at: merged.occurred_at,
      rate_source: merged.rate_source,
      charge_profile_id: merged.charge_profile_id || null,
      driver_charge_profile_id: merged.driver_charge_profile_id || null,
      rate_method: merged.rate_method,
      miles: merged.rate_method === 'per_mile' ? merged.miles : null,
      ar_amount_cents: ar,
      ap_amount_cents: ap,
      notes: merged.notes || null,
      updated_at: new Date().toISOString(),
    };

    const { data: updated, error } = await svc.from('dry_run_attempts').update(patch).eq('id', attemptId).select().single();
    if (error) return res.status(500).json({ error: error.message });

    // Update derived line items' amounts to match
    await svc.from('order_charge_set_line_items')
      .update({ per_unit_price_cents: ar, total_cents: ar, description: `Driver · ${merged.miles || 0} mi` })
      .eq('dry_run_attempt_id', attemptId);
    await svc.from('order_driver_pay_lines')
      .update({ amount_cents: ap, miles: merged.rate_method === 'per_mile' ? merged.miles : null })
      .eq('dry_run_attempt_id', attemptId);

    await logTenantAction(svc, {
      tenantId: ctx.tenantId, userId: ctx.userId, action: 'dry_run.update',
      entityType: 'dry_run', entityId: attemptId,
      newValues: patch, ipAddress: getClientIp(req),
    });
    return res.status(200).json({ dry_run: updated });
  }

  if (req.method === 'DELETE') {
    const guard = await assertEditable();
    if (!guard.ok) return res.status(409).json({ error: guard.reason });

    const now = new Date().toISOString();
    await svc.from('dry_run_attempts').update({ deleted_at: now }).eq('id', attemptId);
    // Soft-delete derived line items so invoices/settlements regenerate correctly
    await svc.from('order_charge_set_line_items').update({ deleted_at: now }).eq('dry_run_attempt_id', attemptId);
    await svc.from('order_driver_pay_lines').update({ deleted_at: now }).eq('dry_run_attempt_id', attemptId);

    await logTenantAction(svc, {
      tenantId: ctx.tenantId, userId: ctx.userId, action: 'dry_run.delete',
      entityType: 'dry_run', entityId: attemptId,
      newValues: null, ipAddress: getClientIp(req),
    });
    return res.status(204).end();
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
```

- [ ] **Step 6: Commit**

```bash
git add pages/api/tenant/charge-profiles/index.js pages/api/tenant/driver-charge-profiles/index.js pages/api/tenant/loads/[id]/dry-runs/
git commit -m "feat(dry-run): API endpoints — preview, list, create, patch, delete + profile filter"
```

---

## Task 4: Settings — `is_dry_run` checkboxes

**Files:**
- Modify: `components/settings/ChargeProfileEditor.js`
- Modify: `components/settings/DriverChargeProfileEditor.js`

- [ ] **Step 1: Add checkbox to `ChargeProfileEditor.js`**

Find the main form fields block (look for where `name` / `description` inputs live). Add a new checkbox field AFTER the `name` input:

```jsx
<label className="flex items-center gap-2 text-sm text-gray-700 dark:text-slate-300 mt-2">
  <input
    type="checkbox"
    checked={!!profile.is_dry_run}
    onChange={(e) => setProfile({ ...profile, is_dry_run: e.target.checked })}
    className="rounded border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-blue-600 focus:ring-blue-500"
  />
  <span>Available for dry runs</span>
  <span className="text-xs text-gray-500 dark:text-slate-400">(popup picker in Routing tab will include this profile)</span>
</label>
```

Ensure the submit payload includes `is_dry_run` (check the PATCH/POST body construction — the `...profile` spread should cover it).

- [ ] **Step 2: Same for `DriverChargeProfileEditor.js`**

Identical checkbox, identical placement. Change only the payload target field name if the driver-side editor uses a different state-variable name (e.g. `driverProfile`).

- [ ] **Step 3: Commit**

```bash
git add components/settings/ChargeProfileEditor.js components/settings/DriverChargeProfileEditor.js
git commit -m "feat(dry-run): is_dry_run opt-in checkbox on charge profile editors"
```

---

## Task 5: `DryRunSlideOver` component

**Files:**
- Create: `components/loads/routing/DryRunSlideOver.js`

- [ ] **Step 1: Write the component**

Create `components/loads/routing/DryRunSlideOver.js`:

```jsx
import { useEffect, useState, useCallback, useRef } from 'react';
import { X, AlertTriangle } from 'lucide-react';

function formatCents(n) {
  if (!Number.isFinite(n)) return '$0.00';
  return '$' + (n / 100).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

function Field({ label, children, hint }) {
  return (
    <label className="block mb-3">
      <span className="block text-[11px] uppercase tracking-wide font-semibold text-gray-500 dark:text-slate-400 mb-1">{label}</span>
      {children}
      {hint && <span className="block text-[11px] text-gray-400 dark:text-slate-500 mt-1">{hint}</span>}
    </label>
  );
}

export default function DryRunSlideOver({
  open,
  onClose,
  onSaved,
  orderId,
  event,        // { id, event_type, location_label, distance_miles }
  drivers,      // [{ id, name }]
  existing,     // full dry_run_attempts row OR null for "create" mode
}) {
  const isEdit = !!existing;

  const [driverId, setDriverId] = useState(existing?.driver_id || '');
  const [occurredAt, setOccurredAt] = useState(
    existing?.occurred_at?.slice(0, 16) || new Date().toISOString().slice(0, 16)
  );
  const [rateSource, setRateSource] = useState(existing?.rate_source || 'manual');
  const [chargeProfileId, setChargeProfileId] = useState(existing?.charge_profile_id || '');
  const [driverChargeProfileId, setDriverChargeProfileId] = useState(existing?.driver_charge_profile_id || '');
  const [rateMethod, setRateMethod] = useState(existing?.rate_method || 'per_mile');
  const [miles, setMiles] = useState(existing?.miles ?? event?.distance_miles ?? '');
  const [arAmount, setArAmount] = useState(existing ? existing.ar_amount_cents / 100 : '');
  const [apAmount, setApAmount] = useState(existing ? existing.ap_amount_cents / 100 : '');
  const [arRate, setArRate] = useState('');
  const [apRate, setApRate] = useState('');
  const [notes, setNotes] = useState(existing?.notes || '');

  const [arProfiles, setArProfiles] = useState([]);
  const [apProfiles, setApProfiles] = useState([]);
  const [previewAr, setPreviewAr] = useState(existing?.ar_amount_cents || 0);
  const [previewAp, setPreviewAp] = useState(existing?.ap_amount_cents || 0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  // Fetch preset profiles on open
  useEffect(() => {
    if (!open) return;
    (async () => {
      try {
        const [arRes, apRes] = await Promise.all([
          fetch('/api/tenant/charge-profiles?is_dry_run=true').then((r) => r.json()),
          fetch('/api/tenant/driver-charge-profiles?is_dry_run=true').then((r) => r.json()),
        ]);
        setArProfiles(arRes?.profiles || arRes?.data || []);
        setApProfiles(apRes?.profiles || apRes?.data || []);
      } catch {
        // Non-fatal — user can still use Manual
      }
    })();
  }, [open]);

  // Live preview (debounced)
  const previewTimer = useRef(null);
  const refreshPreview = useCallback(() => {
    clearTimeout(previewTimer.current);
    previewTimer.current = setTimeout(async () => {
      try {
        const body = {
          rate_source: rateSource,
          rate_method: rateMethod,
          miles: rateMethod === 'per_mile' ? Number(miles) || null : null,
          charge_profile_id: chargeProfileId || null,
          driver_charge_profile_id: driverChargeProfileId || null,
          ar_amount_cents: rateMethod === 'fixed' ? Math.round(Number(arAmount || 0) * 100) : 0,
          ap_amount_cents: rateMethod === 'fixed' ? Math.round(Number(apAmount || 0) * 100) : 0,
          ar_rate_cents_per_mile: rateMethod === 'per_mile' ? Math.round(Number(arRate || 0) * 100) : 0,
          ap_rate_cents_per_mile: rateMethod === 'per_mile' ? Math.round(Number(apRate || 0) * 100) : 0,
        };
        const res = await fetch(`/api/tenant/loads/${orderId}/dry-runs/preview`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        const data = await res.json();
        if (res.ok) {
          setPreviewAr(data.ar_amount_cents || 0);
          setPreviewAp(data.ap_amount_cents || 0);
        }
      } catch {}
    }, 250);
  }, [orderId, rateSource, rateMethod, miles, chargeProfileId, driverChargeProfileId, arAmount, apAmount, arRate, apRate]);

  useEffect(() => { if (open) refreshPreview(); }, [open, refreshPreview]);

  async function save() {
    setError(null);
    setSaving(true);
    try {
      const payload = {
        event_id: event.id,
        driver_id: driverId,
        occurred_at: new Date(occurredAt).toISOString(),
        rate_source: rateSource,
        charge_profile_id: rateSource === 'preset' ? chargeProfileId : null,
        driver_charge_profile_id: rateSource === 'preset' ? driverChargeProfileId : null,
        rate_method: rateMethod,
        miles: rateMethod === 'per_mile' ? Number(miles) : null,
        ar_amount_cents: rateMethod === 'fixed' ? Math.round(Number(arAmount) * 100) : 0,
        ap_amount_cents: rateMethod === 'fixed' ? Math.round(Number(apAmount) * 100) : 0,
        ar_rate_cents_per_mile: rateMethod === 'per_mile' ? Math.round(Number(arRate) * 100) : 0,
        ap_rate_cents_per_mile: rateMethod === 'per_mile' ? Math.round(Number(apRate) * 100) : 0,
        notes: notes || null,
      };
      const url = isEdit
        ? `/api/tenant/loads/${orderId}/dry-runs/${existing.id}`
        : `/api/tenant/loads/${orderId}/dry-runs`;
      const res = await fetch(url, {
        method: isEdit ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || 'Save failed');
      }
      const data = await res.json();
      onSaved?.(data.dry_run);
      onClose?.();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  if (!open) return null;

  return (
    <>
      <div className="fixed inset-0 bg-black/40 z-40" onClick={onClose} />
      <div
        className="fixed top-0 right-0 bottom-0 z-50 bg-white dark:bg-slate-900 border-l border-gray-200 dark:border-slate-800 shadow-xl overflow-y-auto"
        style={{ width: 'min(520px, 100%)' }}
      >
        <div className="flex items-start justify-between px-5 py-4 border-b border-gray-200 dark:border-slate-800">
          <div>
            <div className="flex items-center gap-2 text-amber-600 dark:text-amber-400 font-semibold">
              <AlertTriangle className="w-4 h-4" />
              {isEdit ? 'Edit Dry Run' : 'Add Dry Run'}
            </div>
            <div className="text-xs text-gray-500 dark:text-slate-400 mt-0.5">
              {event?.event_type?.replace(/_/g, ' ')} · {event?.location_label || 'no location'}
            </div>
          </div>
          <button onClick={onClose} className="text-gray-400 dark:text-slate-500 hover:text-gray-600 dark:hover:text-slate-300">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5">
          {error && (
            <div className="mb-3 p-3 rounded-lg bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900 text-red-700 dark:text-red-300 text-sm">
              {error}
            </div>
          )}

          <div className="text-[10px] font-semibold uppercase tracking-wide text-amber-600 dark:text-amber-400 mb-2">
            What happened
          </div>

          <Field label="Driver">
            <select
              value={driverId}
              onChange={(e) => setDriverId(e.target.value)}
              className="w-full rounded border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-gray-900 dark:text-slate-100 px-3 py-2 text-sm"
            >
              <option value="">Select driver...</option>
              {drivers.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </Field>

          <Field label="Occurred at">
            <input
              type="datetime-local"
              value={occurredAt}
              onChange={(e) => setOccurredAt(e.target.value)}
              className="w-full rounded border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-gray-900 dark:text-slate-100 px-3 py-2 text-sm"
            />
          </Field>

          <div className="text-[10px] font-semibold uppercase tracking-wide text-amber-600 dark:text-amber-400 mt-4 mb-2">
            Rate
          </div>

          <Field label="Source">
            <select
              value={rateSource}
              onChange={(e) => setRateSource(e.target.value)}
              className="w-full rounded border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-gray-900 dark:text-slate-100 px-3 py-2 text-sm"
            >
              <option value="manual">Manual</option>
              <option value="preset" disabled={arProfiles.length === 0 || apProfiles.length === 0}>
                Preset profile {(arProfiles.length === 0 || apProfiles.length === 0) ? '(none configured)' : ''}
              </option>
            </select>
          </Field>

          {rateSource === 'preset' && (
            <>
              <Field label="AR Profile">
                <select
                  value={chargeProfileId}
                  onChange={(e) => setChargeProfileId(e.target.value)}
                  className="w-full rounded border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-gray-900 dark:text-slate-100 px-3 py-2 text-sm"
                >
                  <option value="">Select AR profile...</option>
                  {arProfiles.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </Field>
              <Field label="AP Profile (driver pay)">
                <select
                  value={driverChargeProfileId}
                  onChange={(e) => setDriverChargeProfileId(e.target.value)}
                  className="w-full rounded border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-gray-900 dark:text-slate-100 px-3 py-2 text-sm"
                >
                  <option value="">Select AP profile...</option>
                  {apProfiles.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </Field>
            </>
          )}

          <Field label="Method">
            <div className="flex gap-2">
              {['per_mile', 'fixed'].map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setRateMethod(m)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium border ${
                    rateMethod === m
                      ? 'bg-blue-600 dark:bg-blue-500 text-white border-blue-600 dark:border-blue-500'
                      : 'bg-white dark:bg-slate-900 text-gray-700 dark:text-slate-300 border-gray-300 dark:border-slate-600'
                  }`}
                >
                  {m === 'per_mile' ? 'Per Mile' : 'Fixed'}
                </button>
              ))}
            </div>
          </Field>

          {rateMethod === 'per_mile' && (
            <Field label="Miles" hint={event?.distance_miles ? `Pre-filled from leg distance (${event.distance_miles} mi)` : 'Enter miles driven'}>
              <input
                type="number"
                step="0.1"
                value={miles}
                onChange={(e) => setMiles(e.target.value)}
                className="w-full rounded border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-gray-900 dark:text-slate-100 px-3 py-2 text-sm"
              />
            </Field>
          )}

          {rateSource === 'manual' && rateMethod === 'per_mile' && (
            <>
              <Field label="AR rate (per mile)">
                <input type="number" step="0.01" value={arRate} onChange={(e) => setArRate(e.target.value)} placeholder="e.g. 2.50" className="w-full rounded border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-gray-900 dark:text-slate-100 px-3 py-2 text-sm" />
              </Field>
              <Field label="AP rate (per mile)">
                <input type="number" step="0.01" value={apRate} onChange={(e) => setApRate(e.target.value)} placeholder="e.g. 1.50" className="w-full rounded border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-gray-900 dark:text-slate-100 px-3 py-2 text-sm" />
              </Field>
            </>
          )}

          {rateSource === 'manual' && rateMethod === 'fixed' && (
            <>
              <Field label="AR amount ($)">
                <input type="number" step="0.01" value={arAmount} onChange={(e) => setArAmount(e.target.value)} className="w-full rounded border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-gray-900 dark:text-slate-100 px-3 py-2 text-sm" />
              </Field>
              <Field label="AP amount ($)">
                <input type="number" step="0.01" value={apAmount} onChange={(e) => setApAmount(e.target.value)} className="w-full rounded border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-gray-900 dark:text-slate-100 px-3 py-2 text-sm" />
              </Field>
            </>
          )}

          <Field label="Notes (optional)">
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              placeholder="Container not released, yard closed, etc."
              className="w-full rounded border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-gray-900 dark:text-slate-100 px-3 py-2 text-sm"
            />
          </Field>

          <div className="mt-4 p-3 rounded-lg bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-900 flex items-center justify-between">
            <span className="text-xs uppercase tracking-wide font-semibold text-emerald-700 dark:text-emerald-400">Preview</span>
            <span className="text-sm font-bold text-emerald-700 dark:text-emerald-300">
              {formatCents(previewAr)} AR · {formatCents(previewAp)} AP
            </span>
          </div>

          <div className="flex justify-end gap-2 mt-5">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-lg text-sm text-gray-700 dark:text-slate-300 border border-gray-300 dark:border-slate-600 hover:bg-gray-50 dark:hover:bg-slate-800"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={save}
              disabled={saving || !driverId}
              className="px-4 py-2 rounded-lg text-sm font-semibold bg-amber-500 hover:bg-amber-600 text-white disabled:opacity-50"
            >
              {saving ? 'Saving...' : isEdit ? 'Save Changes' : 'Save Dry Run'}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add components/loads/routing/DryRunSlideOver.js
git commit -m "feat(dry-run): DryRunSlideOver component with live preview"
```

---

## Task 6: `DryRunList` component

**Files:**
- Create: `components/loads/routing/DryRunList.js`

- [ ] **Step 1: Write the component**

Create `components/loads/routing/DryRunList.js`:

```jsx
import { useState } from 'react';
import { AlertTriangle, ChevronDown, ChevronRight, Plus } from 'lucide-react';

function formatCents(n) {
  if (!Number.isFinite(n)) return '$0.00';
  return '$' + (n / 100).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

export default function DryRunList({ runs = [], onAdd, onEdit }) {
  const [expanded, setExpanded] = useState(false);
  const totalAr = runs.reduce((s, r) => s + (r.ar_amount_cents || 0), 0);
  const totalAp = runs.reduce((s, r) => s + (r.ap_amount_cents || 0), 0);

  return (
    <div className="mt-2">
      {runs.length > 0 && (
        <>
          <button
            type="button"
            onClick={() => setExpanded((x) => !x)}
            className="w-full flex items-center justify-between px-3 py-1.5 rounded-lg border border-dashed border-amber-400/60 dark:border-amber-600/40 bg-amber-50 dark:bg-amber-950/20 text-[11px] font-medium text-amber-700 dark:text-amber-300 hover:bg-amber-100 dark:hover:bg-amber-950/40"
          >
            <span className="flex items-center gap-1.5">
              <AlertTriangle className="w-3.5 h-3.5" />
              {runs.length} dry run{runs.length !== 1 ? 's' : ''} · {formatCents(totalAr)} AR · {formatCents(totalAp)} AP
            </span>
            {expanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
          </button>

          {expanded && (
            <ul className="mt-1 space-y-1 pl-2 border-l-2 border-amber-200 dark:border-amber-900/60">
              {runs.map((r) => (
                <li key={r.id}>
                  <button
                    type="button"
                    onClick={() => onEdit?.(r)}
                    className="w-full text-left px-3 py-1.5 rounded hover:bg-amber-50 dark:hover:bg-amber-950/30 text-[11px] text-gray-700 dark:text-slate-300 flex items-center justify-between"
                  >
                    <span className="truncate">
                      {r.driver?.name || 'Driver'} · {new Date(r.occurred_at).toLocaleDateString()} · {r.miles ? `${r.miles} mi` : 'fixed'}
                    </span>
                    <span className="text-[10px] text-gray-500 dark:text-slate-400 whitespace-nowrap ml-2">
                      {formatCents(r.ar_amount_cents)} / {formatCents(r.ap_amount_cents)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      <button
        type="button"
        onClick={onAdd}
        className="mt-2 w-full flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg border border-dashed border-amber-400/60 dark:border-amber-600/40 text-[11px] font-medium text-amber-600 dark:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-950/20"
      >
        <Plus className="w-3.5 h-3.5" />
        Add Dry Run
      </button>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add components/loads/routing/DryRunList.js
git commit -m "feat(dry-run): DryRunList — inline leg-card summary + expand + add"
```

---

## Task 7: Wire `DryRunList` + `DryRunSlideOver` into `EventRow`

**Files:**
- Modify: `components/loads/routing/EventRow.js`

- [ ] **Step 1: Add imports at top**

Find the existing import block (currently imports from 'react', 'lucide-react', etc.). Add:

```jsx
import DryRunList from './DryRunList';
import DryRunSlideOver from './DryRunSlideOver';
```

- [ ] **Step 2: Accept new props + add state**

Find the `function EventRow({ ... })` signature. Add two new props: `dryRuns = []` and `drivers = []` and `orderId`. Inside the component body (near existing state declarations), add:

```jsx
const [dryRunSlideOpen, setDryRunSlideOpen] = useState(false);
const [editingRun, setEditingRun] = useState(null);
const [localDryRuns, setLocalDryRuns] = useState(dryRuns);
useEffect(() => { setLocalDryRuns(dryRuns); }, [dryRuns]);
```

- [ ] **Step 3: Determine if event is "eligible" for dry runs**

Events with a physical location qualify. Add near the top of the component:

```jsx
const DRY_RUN_ELIGIBLE_EVENTS = new Set([
  'PICK_UP_CONTAINER','DELIVER_CONTAINER','RETURN_CONTAINER',
  'DROP_CONTAINER','HOOK_CHASSIS','TERMINATE_CHASSIS','STOP_OFF',
]);
const isDryRunEligible = DRY_RUN_ELIGIBLE_EVENTS.has(event.event_type);
```

- [ ] **Step 4: Render `DryRunList` at the end of the card body**

Find the closing tag of the event row's metrics/status section. BEFORE the event-card wrapper's closing `</div>`, add:

```jsx
{isDryRunEligible && (
  <DryRunList
    runs={localDryRuns}
    onAdd={() => { setEditingRun(null); setDryRunSlideOpen(true); }}
    onEdit={(r) => { setEditingRun(r); setDryRunSlideOpen(true); }}
  />
)}

{isDryRunEligible && dryRunSlideOpen && (
  <DryRunSlideOver
    open={dryRunSlideOpen}
    onClose={() => setDryRunSlideOpen(false)}
    onSaved={async () => {
      // Re-fetch dry runs for this event
      try {
        const res = await fetch(`/api/tenant/loads/${orderId}/dry-runs?event_id=${event.id}`);
        const data = await res.json();
        setLocalDryRuns(data.dry_runs || []);
      } catch {}
    }}
    orderId={orderId}
    event={{
      id: event.id,
      event_type: event.event_type,
      location_label: event.location?.name || event.location_name,
      distance_miles: event.distance_miles ?? event.metrics?.distance_miles,
    }}
    drivers={drivers}
    existing={editingRun}
  />
)}
```

- [ ] **Step 5: Thread props from parent (`ContainerMoveCard`)**

In `components/loads/routing/ContainerMoveCard.js`, find where it renders `<EventRow ...>`. Add two new props to the pass-through:

```jsx
<EventRow
  /* ...existing props... */
  orderId={orderId}
  dryRuns={allDryRuns?.filter((r) => r.event_id === event.id) || []}
  drivers={drivers}
/>
```

Then in `components/loads/tabs/RoutingTab.js` (the parent that mounts `ContainerMoveCard`), fetch dry runs once per tab-mount and pass them down:

```jsx
const [allDryRuns, setAllDryRuns] = useState([]);
useEffect(() => {
  (async () => {
    try {
      const res = await fetch(`/api/tenant/loads/${orderId}/dry-runs`);
      const data = await res.json();
      setAllDryRuns(data.dry_runs || []);
    } catch {}
  })();
}, [orderId]);
```

Pass `allDryRuns={allDryRuns}` and `drivers={drivers}` (drivers list is already in context) down to each `<ContainerMoveCard>`.

- [ ] **Step 6: Commit**

```bash
git add components/loads/routing/EventRow.js components/loads/routing/ContainerMoveCard.js components/loads/tabs/RoutingTab.js
git commit -m "feat(dry-run): wire DryRunList + DryRunSlideOver into EventRow"
```

---

## Task 8: Billing + Driver Pay row-click opens slide-over

**Files:**
- Modify: `components/loads/tabs/BillingTab.js`
- Modify: `components/loads/tabs/DriverPayTab.js`

- [ ] **Step 1: Add slide-over state + handler to `BillingTab.js`**

At the top of the component, add state + import:

```jsx
import DryRunSlideOver from '../routing/DryRunSlideOver';
// ...
const [dryRunEdit, setDryRunEdit] = useState(null); // holds dry_run_attempts row
```

In the list rendering, for each line item, when `lineItem.dry_run_attempt_id` exists, make the row clickable to fetch + open:

```jsx
async function openDryRun(lineItem) {
  try {
    const res = await fetch(`/api/tenant/loads/${orderId}/dry-runs`);
    const data = await res.json();
    const match = (data.dry_runs || []).find((r) => r.id === lineItem.dry_run_attempt_id);
    if (match) setDryRunEdit(match);
  } catch {}
}
```

Wire `onClick={() => lineItem.dry_run_attempt_id && openDryRun(lineItem)}` on the line-item row. Render `<DryRunSlideOver>` conditionally:

```jsx
{dryRunEdit && (
  <DryRunSlideOver
    open={!!dryRunEdit}
    onClose={() => setDryRunEdit(null)}
    onSaved={() => { setDryRunEdit(null); loadChargeSets?.(); }}
    orderId={orderId}
    event={{ id: dryRunEdit.event_id, event_type: 'DRY_RUN', location_label: '', distance_miles: dryRunEdit.miles }}
    drivers={drivers}
    existing={dryRunEdit}
  />
)}
```

- [ ] **Step 2: Same pattern in `DriverPayTab.js`**

Identical wire-up: import `DryRunSlideOver`, add `dryRunEdit` state, filter pay rows with `line_type === 'dry_run'`, render slide-over on click. `onSaved` should call whatever data-refetch function the tab already uses after inline edits (e.g. `loadPayLines()` or `reloadDriverPay()`). If neither exists, use `setRefreshKey((k) => k + 1)` + key it on the list container.

- [ ] **Step 3: Commit**

```bash
git add components/loads/tabs/BillingTab.js components/loads/tabs/DriverPayTab.js
git commit -m "feat(dry-run): Billing + Driver Pay rows open slide-over in edit mode"
```

---

## Task 9: Two-tier leg delete behavior

**Files:**
- Create: `components/loads/routing/LegDeleteConfirmModal.js`
- Modify: `pages/api/tenant/loads/[id]/routing/events/[eventId].js`
- Modify: `components/loads/routing/EventRow.js` (delete handler)

- [ ] **Step 1: Create the confirmation modal**

Create `components/loads/routing/LegDeleteConfirmModal.js`:

```jsx
import { AlertTriangle, X } from 'lucide-react';

function formatCents(n) {
  return '$' + ((n || 0) / 100).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

export default function LegDeleteConfirmModal({ open, onClose, onDetach, onDeleteAll, runs = [] }) {
  if (!open) return null;
  const totalAr = runs.reduce((s, r) => s + (r.ar_amount_cents || 0), 0);
  const totalAp = runs.reduce((s, r) => s + (r.ap_amount_cents || 0), 0);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="fixed inset-0 bg-black/50" onClick={onClose} />
      <div className="relative bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-xl shadow-xl p-6 w-[460px] max-w-[92vw]">
        <button onClick={onClose} className="absolute top-3 right-3 text-gray-400 dark:text-slate-500 hover:text-gray-600 dark:hover:text-slate-300">
          <X className="w-4 h-4" />
        </button>
        <div className="flex items-center gap-2 text-amber-600 dark:text-amber-400 font-semibold mb-2">
          <AlertTriangle className="w-5 h-5" />
          Delete leg with dry runs?
        </div>
        <p className="text-sm text-gray-700 dark:text-slate-300 mb-4">
          This leg has <strong>{runs.length} dry run{runs.length !== 1 ? 's' : ''}</strong> ({formatCents(totalAr)} AR pending, {formatCents(totalAp)} AP pending). What should happen to them?
        </p>
        <div className="flex flex-col gap-2">
          <button
            onClick={onDetach}
            className="w-full px-4 py-2 rounded-lg text-sm font-semibold bg-blue-600 hover:bg-blue-700 text-white"
          >
            Detach — keep as load-level charges
          </button>
          <button
            onClick={onDeleteAll}
            className="w-full px-4 py-2 rounded-lg text-sm font-semibold bg-red-600 hover:bg-red-700 text-white"
          >
            Delete leg + all {runs.length} dry run{runs.length !== 1 ? 's' : ''}
          </button>
          <button
            onClick={onClose}
            className="w-full px-4 py-2 rounded-lg text-sm text-gray-700 dark:text-slate-300 border border-gray-300 dark:border-slate-600 hover:bg-gray-50 dark:hover:bg-slate-800"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Extend event DELETE endpoint**

In `pages/api/tenant/loads/[id]/routing/events/[eventId].js`, find the DELETE handler. Replace the delete logic with this two-tier flow:

```javascript
if (req.method === 'DELETE') {
  if (!requirePermission(ctx, [PERMISSIONS.LOAD_EDIT, PERMISSIONS.ALL], res)) return;

  const mode = req.query.mode; // 'block' (default/check), 'detach', 'delete_all'

  // Fetch dry runs on this event
  const { data: runs } = await svc
    .from('dry_run_attempts')
    .select('id, ar_amount_cents, ap_amount_cents')
    .eq('tenant_id', ctx.tenantId)
    .eq('event_id', eventId)
    .is('deleted_at', null);

  const dryRuns = runs || [];

  if (dryRuns.length > 0) {
    // Check if any are invoiced/settled
    const attemptIds = dryRuns.map((r) => r.id);
    const [{ data: arLines }, { data: apLines }] = await Promise.all([
      svc.from('order_charge_set_line_items')
         .select('id, charge_set:order_charge_sets!charge_set_id(status)')
         .in('dry_run_attempt_id', attemptIds),
      svc.from('order_driver_pay_lines')
         .select('id, settlement_id')
         .in('dry_run_attempt_id', attemptIds),
    ]);
    const blockedStatuses = ['approved', 'invoiced', 'locked'];
    const hasInvoiced = (arLines || []).some((l) => l.charge_set && blockedStatuses.includes(l.charge_set.status));
    const hasSettled  = (apLines || []).some((l) => l.settlement_id);

    if (hasInvoiced || hasSettled) {
      return res.status(409).json({
        error: `Leg has ${dryRuns.length} invoiced/settled dry run(s). Create a credit memo or pay adjustment first.`,
        blocked: true,
        dry_run_count: dryRuns.length,
      });
    }

    if (!mode) {
      // Pre-flight check: tell client there are runs that need a choice
      return res.status(409).json({
        needs_confirmation: true,
        dry_runs: dryRuns,
      });
    }

    if (mode === 'detach') {
      await svc.from('dry_run_attempts')
        .update({ event_id: null, updated_at: new Date().toISOString() })
        .in('id', attemptIds);
    } else if (mode === 'delete_all') {
      const now = new Date().toISOString();
      await svc.from('dry_run_attempts').update({ deleted_at: now }).in('id', attemptIds);
      await svc.from('order_charge_set_line_items').update({ deleted_at: now }).in('dry_run_attempt_id', attemptIds);
      await svc.from('order_driver_pay_lines').update({ deleted_at: now }).in('dry_run_attempt_id', attemptIds);
    } else {
      return res.status(400).json({ error: `unknown mode: ${mode}` });
    }
  }

  // Finally delete the event row (ON DELETE RESTRICT is satisfied now)
  const { error: delError } = await svc
    .from('order_routing_events')
    .delete()
    .eq('id', eventId)
    .eq('tenant_id', ctx.tenantId);
  if (delError) return res.status(500).json({ error: delError.message });

  return res.status(204).end();
}
```

- [ ] **Step 3: Wire client-side confirm modal into `EventRow.js`**

Import the modal:

```jsx
import LegDeleteConfirmModal from './LegDeleteConfirmModal';
```

Add state:

```jsx
const [deleteConfirm, setDeleteConfirm] = useState(null); // holds { runs: [...] }
```

Replace the existing trash-icon onClick handler with:

```jsx
async function handleDelete() {
  const res = await fetch(`/api/tenant/loads/${orderId}/routing/events/${event.id}`, { method: 'DELETE' });
  if (res.status === 204) { onDeleted?.(event.id); return; }
  const body = await res.json();
  if (body.blocked) {
    alert(body.error); // V1 uses alert() — swap for inline-toast when a site-wide toast helper lands (not blocking).
    return;
  }
  if (body.needs_confirmation) {
    setDeleteConfirm({ runs: body.dry_runs });
    return;
  }
  alert(body.error || 'Delete failed');
}

async function confirmDelete(mode) {
  const res = await fetch(`/api/tenant/loads/${orderId}/routing/events/${event.id}?mode=${mode}`, { method: 'DELETE' });
  if (res.status === 204) { onDeleted?.(event.id); setDeleteConfirm(null); return; }
  const body = await res.json();
  alert(body.error || 'Delete failed');
}
```

Render the modal:

```jsx
{deleteConfirm && (
  <LegDeleteConfirmModal
    open
    onClose={() => setDeleteConfirm(null)}
    onDetach={() => confirmDelete('detach')}
    onDeleteAll={() => confirmDelete('delete_all')}
    runs={deleteConfirm.runs}
  />
)}
```

- [ ] **Step 4: Commit**

```bash
git add components/loads/routing/LegDeleteConfirmModal.js components/loads/routing/EventRow.js pages/api/tenant/loads/[id]/routing/events/[eventId].js
git commit -m "feat(dry-run): two-tier leg delete — block invoiced, detach or delete-all otherwise"
```

---

## Task 10: Chrome live gates

**Approach:** dispatch 3 Chrome subagent batches (gates 1-4, 5-8, 9-12). Each batch follows the proven pattern: ZERO screenshots, soft-nav via `window.next?.router?.push()`, no hard-reload.

- [ ] **Batch 1 — gates 1-4 (Routing tab + slide-over open)**

Spawn a Chrome subagent with the following objectives:

1. Navigate to `/loads/[a-test-load-id]` → Routing tab
2. **Gate 1:** On a Pull/Deliver/Return leg card, verify `+ Add Dry Run` button appears; verify no dry-run summary row (no existing runs yet)
3. **Gate 2:** Click `+ Add Dry Run` → slide-over opens from right edge; verify "Miles" field pre-fills with the leg's distance value
4. **Gate 3:** With Rate source = "Preset": pick AR + AP profiles (requires at least one `is_dry_run=true` profile to exist — subagent should check settings first and opt-in one profile if needed); live preview in the emerald box updates as miles change; click Save
5. **Gate 4:** With Rate source = "Manual" + method = "Fixed": enter AR $125, AP $80, save; slide-over closes

Report gate-by-gate PASS/FAIL with DOM evidence. Under 400 words.

- [ ] **Batch 2 — gates 5-8 (manual per-mile, leg-card list, tab integration)**

Spawn another Chrome subagent:

5. **Gate 5:** Rate source = Manual, method = Per Mile: enter AR rate $2.50, AP rate $1.50, miles 42.5 → preview = $106.25 AR / $63.75 AP → Save
6. **Gate 6:** Leg card now shows `⚠ 3 dry runs · $X AR · $Y AP` badge; click to expand; verify 3 rows listed with driver/date/miles/amounts
7. **Gate 7:** Switch to Billing tab; verify a line item named "Dry Run — Pull from Terminal" exists with the correct total
8. **Gate 8:** Switch to Driver Pay tab; verify a pay line with `line_type='dry_run'` and the correct amount

Under 400 words.

- [ ] **Batch 3 — gates 9-12 (edit, leg-delete detach, invoiced-lock, settings)**

Final Chrome subagent:

9. **Gate 9:** Click an existing dry run row in the leg-card list → slide-over opens in edit mode with all fields populated; change miles, verify preview updates, save; verify amounts updated in Billing + Driver Pay
10. **Gate 10:** Trash-icon on the leg → confirmation modal appears with "Detach / Delete all / Cancel" → click Detach → leg disappears; switch to Billing tab — line items still visible (detached)
11. **Gate 11:** Manually approve/invoice the charge set containing a dry run (via Billing UI) → reopen that dry run via Billing row-click → try to save → expect 409 error "Create a credit memo"
12. **Gate 12:** Navigate to `/settings/charge-profiles/[id]` → toggle "Available for dry runs" on → back to Routing tab → open slide-over → preset dropdown now includes that profile

Under 400 words.

- [ ] **Gates 10–12 commit if any remediation needed**

```bash
git add <fixes>
git commit -m "fix(dry-run): <describe>"
```

---

## Task 11: Final code review

Dispatch `superpowers:code-reviewer` agent against the full feature diff from migration 088 through the last commit. Prompt focus areas:

- Transaction atomicity (the fake-transaction rollback in Task 3 create endpoint — do we correctly soft-delete the parent on downstream insert failure?)
- Invariant enforcement (DB CHECK + API validate both present, no redundancy or divergence)
- Rate-source / preset-lookup correctness (both profiles must be tenant-owned + `is_dry_run=true`)
- Cascade semantics: detach path sets `event_id = NULL` but leaves line items untouched; delete_all soft-deletes the whole chain
- Dark-mode variants present on every gray/white/border class
- No hard-coded `deleted_at IS NULL` omissions in list queries

Address reviewer feedback as follow-up commits before declaring ship.

---

## Spec Coverage Check

| Spec requirement | Task |
|---|---|
| New `dry_run_attempts` table + invariants | Task 1 |
| FK additions on line-item tables | Task 1 |
| `is_dry_run` flag on profile tables | Task 1 |
| `line_type='dry_run'` on AP pay lines | Task 3 (uses plain TEXT — no enum alter) |
| 5 API endpoints | Task 3 |
| Preset profile lookup via filter | Task 3 |
| Server-side amount recompute (preset) | Task 3 |
| Transaction semantics (soft-delete on partial fail) | Task 3 |
| Audit logging | Task 3 |
| Settings `is_dry_run` checkbox | Task 4 |
| DryRunSlideOver popup | Task 5 |
| DryRunList inline leg-card summary | Task 6 |
| EventRow integration | Task 7 |
| Billing/DriverPay row-click edit | Task 8 |
| Two-tier leg delete behavior | Task 9 |
| 12 live gates | Task 10 |
| Code review | Task 11 |

No gaps.

---

End of plan.
