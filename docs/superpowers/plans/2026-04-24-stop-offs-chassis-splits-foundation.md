# Stop-Offs + Chassis Splits Foundation Implementation Plan (Stream B.1e)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship migration 100 + `lib/constants/load-types.js` (resolves FU-059) + `chassis_reposition` load type + `lib/routing/chassis-split.js` + `lib/validation/load-payload.js` + `lib/routing/event-status-transition.js` + stop-off types CRUD API + rules-engine primitives. Unblocks follow-up feature specs B.1f (stop-offs) and B.1g (chassis splits).

**Architecture:** 5 PRs, each independently reviewable. PR 1 is the migration (schema + backfill + seed). PR 2-5 are additive library modules + API endpoints + consumer refactors. All new state-change writes thread `actor_type` per B.1d convention; the history table CHECK constraint enforces it at the DB level. Chassis splits use existing migration 065 columns; no new chassis schema.

**Tech Stack:** Supabase PostgreSQL migration (wrapped `BEGIN/COMMIT` + `NOTIFY pgrst`). Node.js ESM. Hand-rolled `.test.mjs` pattern. No new libraries.

**Spec:** [docs/superpowers/specs/2026-04-24-stop-offs-chassis-splits-foundation-design.md](docs/superpowers/specs/2026-04-24-stop-offs-chassis-splits-foundation-design.md)

**Commit baseline:** HEAD = `dc1d161` (spec). Each PR commits separately; tasks within a PR can commit incrementally or at the PR boundary depending on size.

**FU outcome:** closes FU-059 (load-type consolidation, `VALID_LOAD_TYPES` + `LOAD_TYPE_LETTER` halves — `VALID_STATUSES` remains open as a separate consolidation).

**Letter-collision resolution:** spec said "pick next free letter if `'R'` taken". During plan-write, confirmed `road: 'R'` is taken at `pages/api/tenant/loads/index.js:24`. **Chassis reposition uses letter `'C'`** (mnemonic: Chassis).

**Files touched:**

| Type | File |
|---|---|
| Create | `supabase/migrations/100_stop_offs_foundation.sql` |
| Create | `lib/constants/load-types.js` |
| Create | `lib/routing/chassis-split.js` |
| Create | `lib/validation/load-payload.js` |
| Create | `lib/routing/event-status-transition.js` |
| Create | `pages/api/tenant/load-types.js` |
| Create | `pages/api/tenant/stop-off-types/index.js` |
| Create | `pages/api/tenant/stop-off-types/[id].js` |
| Create | `tests/load-types-constants.test.mjs` |
| Create | `tests/load-payload-validation.test.mjs` |
| Create | `tests/chassis-split-detection.test.mjs` |
| Create | `tests/event-status-transition.test.mjs` |
| Create | `tests/stop-off-types-api.test.mjs` |
| Modify | `pages/api/tenant/loads/index.js` (remove hardcoded constants, import from new module, wire validation) |
| Modify | `pages/api/tenant/loads/[id]/index.js` (wire validation) |
| Modify | `pages/api/tenant/loads/[id]/routing/events/[eventId].js` (wire transition helper) |
| Modify | `components/loads/NewLoadModal.js` (import LOAD_TYPES) |
| Modify | `pages/settings/tariffs/[id].js` (import LOAD_TYPES) |
| Modify | `pages/settings/driver-tariffs/[id].js` (import LOAD_TYPES) |
| Modify | `components/settings/tariff-detail/TariffMatchingPanel.js` (import list) |
| Modify | `components/settings/driver-tariff-detail/DriverTariffMatchingPanel.js` (import list) |
| Modify | `lib/tariff-engine.js` (import + context enrichment for chassisSplit) |
| Modify | `lib/driver-tariff-engine.js` (import + context enrichment for chassisSplit) |
| Modify | `lib/routing/moves/transition.js` (cascade pending events on move completion) |
| Modify | `components/ar/FilterSidebar.js` (import LOAD_TYPES if currently hardcoded) |
| Modify | `lib/routing-rules.js` or rules-engine operator registry (add 2 new primitives) |
| Modify | `C:\Users\bento\.claude\projects\C--Users-bento-app-drayagedirect\memory\followups.md` (close FU-059) |

---

## Phase structure (5 PRs)

| PR | Phase | What |
|---|---|---|
| PR 1 | Phase 1 | Migration 100 (schema + backfill + seed) |
| PR 2 | Phase 2 | FU-059 load-type consolidation + `chassis_reposition` |
| PR 3 | Phase 3 | Chassis-split helper + reposition validation + engine context enrichment |
| PR 4 | Phase 4 | Event-status transition helper + API + cascade |
| PR 5 | Phase 5 | Stop-off types CRUD API + rules-engine primitives |

---

## Phase 1 — Migration 100

### Task 1: Write migration 100

**Files:**
- Create: `supabase/migrations/100_stop_offs_foundation.sql`

- [ ] **Step 1: Verify migration number 100 is still free**

Run: `ls C:/Users/bento/app-drayagedirect/supabase/migrations/ | grep "^100"`

Expected: no match. If another branch grabbed 100, bump to next available.

- [ ] **Step 2: Write the migration file**

```sql
-- ============================================================
-- Migration 100: Stop-Offs + Chassis Splits Foundation
-- ============================================================
-- Foundation for B.1f (stop-offs feature) and B.1g (chassis splits
-- feature). Adds:
--   1. stop_off_types catalog (tenant-scoped CRUD target)
--   2. routing_event_status enum (applies to ALL routing events)
--   3. stop_off_type_id + event_status columns on order_routing_events
--   4. Backfill event_status from existing timestamps
--   5. order_routing_event_status_history audit table
--   6. Seeded defaults (Fuel Stop, Driver Break, Scale, Chassis Exchange)
--      for every existing tenant
-- ============================================================

BEGIN;

-- 1. Stop-off types catalog
CREATE TABLE IF NOT EXISTS stop_off_types (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  has_cargo_transfer BOOLEAN NOT NULL DEFAULT false,
  is_paid_to_driver BOOLEAN NOT NULL DEFAULT false,
  is_billable_to_customer BOOLEAN NOT NULL DEFAULT false,
  counts_toward_detention BOOLEAN NOT NULL DEFAULT false,
  requires_location_pick BOOLEAN NOT NULL DEFAULT true,
  is_active BOOLEAN NOT NULL DEFAULT true,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID REFERENCES users(id),
  UNIQUE (tenant_id, name)
);

CREATE INDEX IF NOT EXISTS idx_stop_off_types_tenant_active
  ON stop_off_types(tenant_id, sort_order) WHERE is_active = true;

-- 2. Routing-event status enum
DO $$ BEGIN
  CREATE TYPE routing_event_status AS ENUM ('pending', 'arrived', 'departed', 'skipped');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 3. Extend order_routing_events
ALTER TABLE order_routing_events
  ADD COLUMN IF NOT EXISTS stop_off_type_id UUID REFERENCES stop_off_types(id),
  ADD COLUMN IF NOT EXISTS event_status routing_event_status NOT NULL DEFAULT 'pending';

CREATE INDEX IF NOT EXISTS idx_routing_events_stop_off_type
  ON order_routing_events(stop_off_type_id) WHERE stop_off_type_id IS NOT NULL;

-- 4. Backfill event_status from existing timestamps (idempotent)
UPDATE order_routing_events
SET event_status =
  CASE
    WHEN departed_at IS NOT NULL THEN 'departed'::routing_event_status
    WHEN arrived_at  IS NOT NULL THEN 'arrived'::routing_event_status
    ELSE 'pending'::routing_event_status
  END
WHERE event_status = 'pending';

-- 5. Routing-event status history (audit trail per B.1a pattern)
CREATE TABLE IF NOT EXISTS order_routing_event_status_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  event_id UUID NOT NULL REFERENCES order_routing_events(id) ON DELETE CASCADE,
  from_status routing_event_status,
  to_status   routing_event_status NOT NULL,
  transitioned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  actor_id   UUID REFERENCES users(id),
  actor_type TEXT NOT NULL CHECK (actor_type IN ('human', 'system', 'agent')),
  actor_context JSONB,
  note TEXT
);

CREATE INDEX IF NOT EXISTS idx_event_status_history_event
  ON order_routing_event_status_history(event_id, transitioned_at DESC);

-- 6. Seed defaults for every existing tenant
INSERT INTO stop_off_types (
  tenant_id, name, description,
  has_cargo_transfer, is_paid_to_driver, is_billable_to_customer,
  counts_toward_detention, requires_location_pick, sort_order
)
SELECT
  t.id, v.name, v.description,
  v.has_cargo_transfer, v.is_paid_to_driver, v.is_billable_to_customer,
  v.counts_toward_detention, v.requires_location_pick, v.sort_order
FROM tenants t
CROSS JOIN (VALUES
  ('Fuel Stop',        'Driver refuels en route',                                false, false, false, false, true,  10),
  ('Driver Break',     'Mandated rest or meal break',                            false, false, false, false, false, 20),
  ('Scale',            'Weigh station / scale verification',                     false, false, true,  false, true,  30),
  ('Chassis Exchange', 'Swap chassis mid-route (e.g., different size or owner)', false, true,  false, false, true,  40)
) AS v(name, description, has_cargo_transfer, is_paid_to_driver, is_billable_to_customer, counts_toward_detention, requires_location_pick, sort_order)
ON CONFLICT (tenant_id, name) DO NOTHING;

NOTIFY pgrst, 'reload schema';

COMMIT;
```

- [ ] **Step 3: Apply migration to local/dev Supabase**

Run the migration against the dev database. Use the tenant's existing Supabase CLI flow or direct `psql` connection (per `feedback_supabase_keys.md` — use legacy JWT keys `eyJ...`, NOT `sb_publishable`).

Example (adjust for local workflow):
```bash
supabase db push
# OR
psql "$SUPABASE_DB_URL" -f supabase/migrations/100_stop_offs_foundation.sql
```

Expected: no errors. Migration wraps in BEGIN/COMMIT so partial failure is safe.

- [ ] **Step 4: Verify schema changes**

Run these psql queries to confirm:

```sql
-- Table exists with expected columns
\d stop_off_types

-- Enum exists
SELECT enum_range(NULL::routing_event_status);
-- Expected: {pending,arrived,departed,skipped}

-- order_routing_events has new columns
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'order_routing_events'
  AND column_name IN ('stop_off_type_id', 'event_status');

-- History table exists
\d order_routing_event_status_history

-- Backfill sanity check (should return 0 rows with event_status=NULL)
SELECT COUNT(*) FROM order_routing_events WHERE event_status IS NULL;
-- Expected: 0 (NOT NULL default kicks in; backfill UPDATE ran)

-- Seeded types exist for at least one tenant
SELECT t.name AS tenant, s.name AS stop_off_type
FROM tenants t
JOIN stop_off_types s ON s.tenant_id = t.id
ORDER BY t.name, s.sort_order
LIMIT 12;
-- Expected: 4 rows per tenant (Fuel Stop, Driver Break, Scale, Chassis Exchange)
```

- [ ] **Step 5: Commit migration**

```bash
git add supabase/migrations/100_stop_offs_foundation.sql
git commit -m "feat(foundation): migration 100 — stop-off types + event status tracking

Adds:
  - stop_off_types table (tenant-scoped catalog with behavior flags)
  - routing_event_status enum (pending/arrived/departed/skipped)
  - stop_off_type_id + event_status columns on order_routing_events
  - Backfill of event_status from existing arrived_at/departed_at timestamps
  - order_routing_event_status_history audit table (actor_type required)
  - Seeded defaults: Fuel Stop, Driver Break, Scale, Chassis Exchange
    for every existing tenant

Foundation for B.1f (stop-offs feature) + B.1g (chassis splits feature).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

**End of PR 1.**

---

## Phase 2 — FU-059 Load-Type Consolidation + chassis_reposition

### Task 2: Create `lib/constants/load-types.js`

**Files:**
- Create: `lib/constants/load-types.js`
- Create: `tests/load-types-constants.test.mjs`

- [ ] **Step 1: Write failing test for shape + helpers**

Create `tests/load-types-constants.test.mjs`:

```javascript
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import {
  LOAD_TYPES,
  VALID_LOAD_TYPES,
  LOAD_TYPE_LETTER,
  LOAD_TYPE_LABELS,
  TARIFF_MATCHING_LOAD_TYPES,
  DRIVER_TARIFF_MATCHING_LOAD_TYPES,
  DISPATCHER_BOARD_LOAD_TYPES,
  getLoadType,
  isValidLoadType,
} from '../lib/constants/load-types.js';

test('LOAD_TYPES contains all 7 types', () => {
  const values = LOAD_TYPES.map((t) => t.value);
  assert.deepEqual(values.sort(), [
    'bill_only', 'chassis_reposition', 'export', 'import',
    'inbound', 'outbound', 'road',
  ]);
});

test('every LOAD_TYPES entry has required fields', () => {
  for (const t of LOAD_TYPES) {
    assert.equal(typeof t.value, 'string', `missing value: ${JSON.stringify(t)}`);
    assert.equal(typeof t.label, 'string', `missing label: ${t.value}`);
    assert.equal(typeof t.letter, 'string', `missing letter: ${t.value}`);
    assert.equal(t.letter.length, 1, `letter must be single char: ${t.value}=${t.letter}`);
    assert.equal(typeof t.allowsNullContainer, 'boolean', `allowsNullContainer: ${t.value}`);
    assert.equal(typeof t.matchesTariffs, 'boolean', `matchesTariffs: ${t.value}`);
    assert.equal(typeof t.matchesDriverTariffs, 'boolean', `matchesDriverTariffs: ${t.value}`);
    assert.equal(typeof t.showsOnDispatcherBoard, 'boolean', `showsOnDispatcherBoard: ${t.value}`);
    assert.equal(typeof t.description, 'string', `description: ${t.value}`);
  }
});

test('LOAD_TYPE_LETTER has no duplicates', () => {
  const letters = LOAD_TYPES.map((t) => t.letter);
  const unique = new Set(letters);
  assert.equal(unique.size, letters.length, `duplicate letters: ${letters.join(',')}`);
});

test('existing letters preserved from pages/api/tenant/loads/index.js', () => {
  assert.equal(LOAD_TYPE_LETTER.import, 'M');
  assert.equal(LOAD_TYPE_LETTER.inbound, 'N');
  assert.equal(LOAD_TYPE_LETTER.export, 'E');
  assert.equal(LOAD_TYPE_LETTER.outbound, 'O');
  assert.equal(LOAD_TYPE_LETTER.road, 'R');
  assert.equal(LOAD_TYPE_LETTER.bill_only, 'B');
});

test('chassis_reposition uses letter C (collision resolution)', () => {
  assert.equal(LOAD_TYPE_LETTER.chassis_reposition, 'C');
});

test('VALID_LOAD_TYPES equals values list', () => {
  assert.deepEqual(VALID_LOAD_TYPES.sort(), LOAD_TYPES.map((t) => t.value).sort());
});

test('TARIFF_MATCHING_LOAD_TYPES excludes bill_only, includes chassis_reposition', () => {
  const values = TARIFF_MATCHING_LOAD_TYPES.map((t) => t.value);
  assert.ok(!values.includes('bill_only'), 'bill_only should NOT match tariffs');
  assert.ok(values.includes('chassis_reposition'), 'chassis_reposition SHOULD match tariffs');
});

test('chassis_reposition has reposition-specific flags', () => {
  const c = getLoadType('chassis_reposition');
  assert.equal(c.allowsNullContainer, true);
  assert.equal(c.requiresHookChassisLocation, true);
  assert.equal(c.requiresTerminateChassisLocation, true);
});

test('bill_only allows null container', () => {
  const b = getLoadType('bill_only');
  assert.equal(b.allowsNullContainer, true);
});

test('getLoadType returns null for unknown', () => {
  assert.equal(getLoadType('nonexistent'), null);
});

test('isValidLoadType', () => {
  assert.equal(isValidLoadType('import'), true);
  assert.equal(isValidLoadType('chassis_reposition'), true);
  assert.equal(isValidLoadType('nonexistent'), false);
});

test('LOAD_TYPE_LABELS is a value→label map', () => {
  assert.equal(LOAD_TYPE_LABELS.chassis_reposition, 'Chassis Reposition');
  assert.equal(LOAD_TYPE_LABELS.bill_only, 'Bill Only');
});

test('DISPATCHER_BOARD_LOAD_TYPES excludes bill_only', () => {
  const values = DISPATCHER_BOARD_LOAD_TYPES.map((t) => t.value);
  assert.ok(!values.includes('bill_only'));
  assert.ok(values.includes('chassis_reposition'));
});
```

- [ ] **Step 2: Run test — expect all fail (module does not exist)**

Run: `node --test tests/load-types-constants.test.mjs`

Expected: FAIL — "Cannot find module '../lib/constants/load-types.js'"

- [ ] **Step 3: Create `lib/constants/load-types.js`**

```javascript
/**
 * Single source of truth for load types. Resolves FU-059.
 *
 * Every consumer imports from here. Adding a new load type:
 *   1. Add entry below; letter must be unique
 *   2. Set behavior flags to match intent
 *   3. If the type has validation requirements (e.g., chassis_reposition),
 *      add requires* flags — consumed by lib/validation/load-payload.js
 *
 * Letter preservation note: existing letters (M/N/E/O/R/B) match the
 * hardcoded map at pages/api/tenant/loads/index.js LOAD_TYPE_LETTER
 * (pre-consolidation). Do not change these — they are already embedded
 * in load-number prefixes across live tenant data.
 */

export const LOAD_TYPES = [
  {
    value: 'import',
    label: 'Import',
    letter: 'M',
    allowsNullContainer: false,
    matchesTariffs: true,
    matchesDriverTariffs: true,
    showsOnDispatcherBoard: true,
    description: 'Import container from port to consignee',
  },
  {
    value: 'inbound',
    label: 'Inbound',
    letter: 'N',
    allowsNullContainer: false,
    matchesTariffs: true,
    matchesDriverTariffs: true,
    showsOnDispatcherBoard: true,
    description: 'Inbound rail container to consignee',
  },
  {
    value: 'export',
    label: 'Export',
    letter: 'E',
    allowsNullContainer: false,
    matchesTariffs: true,
    matchesDriverTariffs: true,
    showsOnDispatcherBoard: true,
    description: 'Export container from shipper to port',
  },
  {
    value: 'outbound',
    label: 'Outbound',
    letter: 'O',
    allowsNullContainer: false,
    matchesTariffs: true,
    matchesDriverTariffs: true,
    showsOnDispatcherBoard: true,
    description: 'Outbound rail container from shipper',
  },
  {
    value: 'road',
    label: 'Road',
    letter: 'R',
    allowsNullContainer: false,
    matchesTariffs: true,
    matchesDriverTariffs: true,
    showsOnDispatcherBoard: true,
    description: 'Over-the-road move (non-intermodal)',
  },
  {
    value: 'bill_only',
    label: 'Bill Only',
    letter: 'B',
    allowsNullContainer: true,
    matchesTariffs: false,
    matchesDriverTariffs: false,
    showsOnDispatcherBoard: false,
    description: 'Manual invoice-only; no driver or container ops',
  },
  {
    value: 'chassis_reposition',
    label: 'Chassis Reposition',
    letter: 'C',
    allowsNullContainer: true,
    matchesTariffs: true,
    matchesDriverTariffs: true,
    showsOnDispatcherBoard: true,
    description: 'Move a chassis between terminals (no container)',
    requiresHookChassisLocation: true,
    requiresTerminateChassisLocation: true,
  },
];

// Derived lookups (preserve existing names — zero breaking changes for consumers)
export const VALID_LOAD_TYPES = LOAD_TYPES.map((t) => t.value);
export const LOAD_TYPE_LETTER = Object.fromEntries(LOAD_TYPES.map((t) => [t.value, t.letter]));
export const LOAD_TYPE_LABELS = Object.fromEntries(LOAD_TYPES.map((t) => [t.value, t.label]));

// Filtered lists for UI chip groups + engines
export const TARIFF_MATCHING_LOAD_TYPES = LOAD_TYPES.filter((t) => t.matchesTariffs);
export const DRIVER_TARIFF_MATCHING_LOAD_TYPES = LOAD_TYPES.filter((t) => t.matchesDriverTariffs);
export const DISPATCHER_BOARD_LOAD_TYPES = LOAD_TYPES.filter((t) => t.showsOnDispatcherBoard);

// Helpers
export function getLoadType(value) {
  return LOAD_TYPES.find((t) => t.value === value) || null;
}

export function isValidLoadType(value) {
  return VALID_LOAD_TYPES.includes(value);
}
```

- [ ] **Step 4: Run tests — expect all pass**

Run: `node --test tests/load-types-constants.test.mjs`

Expected: all 12 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/constants/load-types.js tests/load-types-constants.test.mjs
git commit -m "feat(foundation): single source of truth for load types (FU-059 part 1)

Adds lib/constants/load-types.js — consolidates VALID_LOAD_TYPES,
LOAD_TYPE_LETTER, LOAD_TYPE_LABELS, plus filtered lists for tariff,
driver tariff, and dispatcher board matching. Each entry carries its
behavior policy (allowsNullContainer, matchesTariffs, etc.), so
consumers read intent rather than string-match.

Introduces chassis_reposition load type (letter C — 'R' is taken by
road per pages/api/tenant/loads/index.js:24).

Consumer refactors (8 files) land in follow-up commits.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

### Task 3: Refactor consumers to import from new module

Apply the **same pattern** across all consumers: delete the local `LOAD_TYPES` / `VALID_LOAD_TYPES` / `LOAD_TYPE_LETTER` array, import from `lib/constants/load-types.js`.

**Files (8 consumers):**
- Modify: `pages/api/tenant/loads/index.js` (remove lines 14-26 hardcoded constants)
- Modify: `components/loads/NewLoadModal.js`
- Modify: `pages/settings/tariffs/[id].js`
- Modify: `pages/settings/driver-tariffs/[id].js`
- Modify: `components/settings/tariff-detail/TariffMatchingPanel.js`
- Modify: `components/settings/driver-tariff-detail/DriverTariffMatchingPanel.js`
- Modify: `lib/tariff-engine.js`
- Modify: `lib/driver-tariff-engine.js`
- Modify: `components/ar/FilterSidebar.js` (verify whether it's currently hardcoded)

- [ ] **Step 1: Refactor `pages/api/tenant/loads/index.js`**

Before (at the top of the file, lines 12-26):

```javascript
import { fetchLoadMarginInputs, computeLoadMargin } from '../../../../lib/load-margin';

const VALID_LOAD_TYPES = ['import', 'inbound', 'export', 'outbound', 'road', 'bill_only'];
const VALID_STATUSES = ['pending', 'available', 'dispatched', 'in_transit', 'dropped', 'delivered', 'completed', 'cancelled'];

// Single-letter prefix per load type, industry-standard drayage convention.
// Matches PortPro (M for Main/Import) and user-defined letters for the rest.
const LOAD_TYPE_LETTER = {
  import: 'M',
  inbound: 'N',
  export: 'E',
  outbound: 'O',
  road: 'R',
  bill_only: 'B',
};
```

After:

```javascript
import { fetchLoadMarginInputs, computeLoadMargin } from '../../../../lib/load-margin';
import { VALID_LOAD_TYPES, LOAD_TYPE_LETTER } from '../../../../lib/constants/load-types.js';

const VALID_STATUSES = ['pending', 'available', 'dispatched', 'in_transit', 'dropped', 'delivered', 'completed', 'cancelled'];
// (VALID_STATUSES consolidation remains open — tracked as separate FU-059 half.)
```

- [ ] **Step 2: Search each consumer file for its local `LOAD_TYPES` / `LOAD_TYPE_LETTER` definition**

For each file in the list, use `Grep` to locate the hardcoded constants:

```bash
# Pattern: look for `const LOAD_TYPES = ` or `LOAD_TYPE_LETTER`
```

Then delete the local definition and add:

```javascript
import { LOAD_TYPES } from '<relative-path>/lib/constants/load-types.js';
// OR specific filtered list:
import { TARIFF_MATCHING_LOAD_TYPES } from '<relative-path>/lib/constants/load-types.js';
```

Import path depth varies per file. Example mappings:
- `components/loads/NewLoadModal.js` → `../../lib/constants/load-types.js`
- `pages/settings/tariffs/[id].js` → `../../../lib/constants/load-types.js`
- `lib/tariff-engine.js` → `./constants/load-types.js`
- `components/ar/FilterSidebar.js` → `../../lib/constants/load-types.js`

- [ ] **Step 3: For `TariffMatchingPanel.js` and `DriverTariffMatchingPanel.js`**

These exclude `bill_only` today per Plan G1. Import the filtered list:

```javascript
import { TARIFF_MATCHING_LOAD_TYPES } from '../../../lib/constants/load-types.js';
// was: const LOAD_TYPES = [ ... list without bill_only ... ]
// now: use TARIFF_MATCHING_LOAD_TYPES directly
```

For `DriverTariffMatchingPanel.js` use `DRIVER_TARIFF_MATCHING_LOAD_TYPES` (functionally the same list but named for clarity).

- [ ] **Step 4: For `components/ar/FilterSidebar.js`**

Grep for load_type chips / options:

```bash
# Check whether it has a hardcoded load_type list
```

If hardcoded, replace with:

```javascript
import { LOAD_TYPES } from '../../lib/constants/load-types.js';
```

If it already fetches from an API or from the DB, no refactor needed — document the state in the commit body.

- [ ] **Step 5: Run the full test suite to verify no regression**

```bash
npm test
```

Expected: all existing tests still pass. No import errors.

- [ ] **Step 6: Run dev server and smoke-test load creation**

```bash
npm run dev
```

In the browser:
1. Navigate to Loads → New Load → verify load_type dropdown shows all 7 types including "Chassis Reposition"
2. Navigate to Settings → Tariffs → [any tariff] → verify Load Type Matching chips show 6 types (no bill_only)
3. Navigate to Settings → Driver Tariffs → [any driver tariff] → same check
4. Navigate to AR → verify load_type filter chips still render

- [ ] **Step 7: Commit consumer refactors**

```bash
git add pages/api/tenant/loads/index.js \
        components/loads/NewLoadModal.js \
        pages/settings/tariffs/[id].js \
        pages/settings/driver-tariffs/[id].js \
        components/settings/tariff-detail/TariffMatchingPanel.js \
        components/settings/driver-tariff-detail/DriverTariffMatchingPanel.js \
        lib/tariff-engine.js \
        lib/driver-tariff-engine.js \
        components/ar/FilterSidebar.js

git commit -m "refactor(foundation): import LOAD_TYPES from single source (FU-059 part 2)

Replaces hardcoded VALID_LOAD_TYPES / LOAD_TYPE_LETTER / LOAD_TYPES
arrays in 8 consumers with imports from lib/constants/load-types.js.

Behavior preserved — each filtered list (TARIFF_MATCHING_LOAD_TYPES,
DRIVER_TARIFF_MATCHING_LOAD_TYPES, DISPATCHER_BOARD_LOAD_TYPES)
mirrors the hardcoded filters that existed per Plan G1 convention.

Any consumer that references load_type as a string literal retains that
literal — this refactor only touches list/array duplication.

Resolves: FU-059 (partial — VALID_STATUSES consolidation remains open)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

### Task 4: Create `GET /api/tenant/load-types` endpoint

**Files:**
- Create: `pages/api/tenant/load-types.js`

- [ ] **Step 1: Create the endpoint**

```javascript
import { getTenantContext } from '../../../lib/auth-tenant';
import { LOAD_TYPES } from '../../../lib/constants/load-types.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Tenant-scoped for auth; list itself is static across tenants.
  const ctx = await getTenantContext(req, res);
  if (!ctx) return; // getTenantContext already sent response

  return res.status(200).json({ load_types: LOAD_TYPES });
}
```

> **Implementer note:** verify `getTenantContext` is the right auth helper for this codebase. Grep other `pages/api/tenant/*` endpoints for the pattern — match what they use.

- [ ] **Step 2: Manual smoke test**

```bash
npm run dev
```

Then in a second terminal or via browser devtools (authenticated session):

```bash
curl -H "Cookie: <session-cookie>" http://localhost:3000/api/tenant/load-types
```

Expected: `200 OK` with JSON body containing all 7 load types.

- [ ] **Step 3: Commit**

```bash
git add pages/api/tenant/load-types.js
git commit -m "feat(foundation): GET /api/tenant/load-types endpoint

Exposes canonical LOAD_TYPES list to frontend. Tenant-scoped for
auth; list is static across tenants.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

**End of PR 2.**

---

## Phase 3 — Chassis-split helper + reposition validation + engine context

### Task 5: Create `lib/routing/chassis-split.js`

**Files:**
- Create: `lib/routing/chassis-split.js`
- Create: `tests/chassis-split-detection.test.mjs`

- [ ] **Step 1: Write failing tests**

Create `tests/chassis-split-detection.test.mjs`:

```javascript
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import {
  detectChassisSplit,
  isChassisReposition,
  hasChassisHandling,
} from '../lib/routing/chassis-split.js';

test('detectChassisSplit returns false when both chassis location fields are null', () => {
  const load = { hook_chassis_location_id: null, terminate_chassis_location_id: null };
  const r = detectChassisSplit(load);
  assert.equal(r.isSplit, false);
  assert.equal(r.isHookSplit, false);
  assert.equal(r.isTerminateSplit, false);
  assert.equal(r.hookLocationId, null);
  assert.equal(r.terminateLocationId, null);
});

test('detectChassisSplit returns true when hook_chassis_location_id is set', () => {
  const load = { hook_chassis_location_id: 'yard-uuid', terminate_chassis_location_id: null };
  const r = detectChassisSplit(load);
  assert.equal(r.isSplit, true);
  assert.equal(r.isHookSplit, true);
  assert.equal(r.isTerminateSplit, false);
  assert.equal(r.hookLocationId, 'yard-uuid');
});

test('detectChassisSplit returns true when terminate_chassis_location_id is set', () => {
  const load = { hook_chassis_location_id: null, terminate_chassis_location_id: 'yard-uuid-2' };
  const r = detectChassisSplit(load);
  assert.equal(r.isSplit, true);
  assert.equal(r.isHookSplit, false);
  assert.equal(r.isTerminateSplit, true);
  assert.equal(r.terminateLocationId, 'yard-uuid-2');
});

test('detectChassisSplit handles undefined fields as non-split', () => {
  const load = {};  // no keys set
  const r = detectChassisSplit(load);
  assert.equal(r.isSplit, false);
});

test('isChassisReposition checks load_type', () => {
  assert.equal(isChassisReposition({ load_type: 'chassis_reposition' }), true);
  assert.equal(isChassisReposition({ load_type: 'import' }), false);
  assert.equal(isChassisReposition({}), false);
});

test('hasChassisHandling is true for reposition OR split', () => {
  assert.equal(hasChassisHandling({ load_type: 'chassis_reposition' }), true);
  assert.equal(hasChassisHandling({ hook_chassis_location_id: 'uuid' }), true);
  assert.equal(hasChassisHandling({ terminate_chassis_location_id: 'uuid' }), true);
  assert.equal(hasChassisHandling({ load_type: 'import' }), false);
});
```

- [ ] **Step 2: Run tests — expect fail**

Run: `node --test tests/chassis-split-detection.test.mjs`

Expected: FAIL — module not found.

- [ ] **Step 3: Create `lib/routing/chassis-split.js`**

```javascript
/**
 * Chassis-split detection. Pure module — no side effects, no DB access.
 *
 * A chassis split exists iff the load has a non-null hook_chassis_location_id
 * or terminate_chassis_location_id (columns added in migration 065). Presence
 * of the column value IS the signal; no comparison against container pickup
 * or return locations is needed — the user explicitly set a separate location,
 * so it's a split by definition.
 *
 * Chassis reposition is a distinct concept: load_type === 'chassis_reposition'
 * means the whole load is about moving the chassis (no container). Splits are
 * about chassis handling WITHIN a container load.
 */

/**
 * @param {object} load - Order row (may be partial; only chassis location fields required)
 * @returns {{
 *   isSplit: boolean,
 *   isHookSplit: boolean,
 *   isTerminateSplit: boolean,
 *   hookLocationId: string | null,
 *   terminateLocationId: string | null,
 * }}
 */
export function detectChassisSplit(load) {
  const hookLoc = load?.hook_chassis_location_id ?? null;
  const terminateLoc = load?.terminate_chassis_location_id ?? null;
  const isHookSplit = hookLoc != null;
  const isTerminateSplit = terminateLoc != null;
  return {
    isSplit: isHookSplit || isTerminateSplit,
    isHookSplit,
    isTerminateSplit,
    hookLocationId: hookLoc,
    terminateLocationId: terminateLoc,
  };
}

/**
 * @param {object} load - Order row with load_type field
 * @returns {boolean}
 */
export function isChassisReposition(load) {
  return load?.load_type === 'chassis_reposition';
}

/**
 * @param {object} load
 * @returns {boolean} true if the load involves any chassis handling (reposition OR split)
 */
export function hasChassisHandling(load) {
  return isChassisReposition(load) || detectChassisSplit(load).isSplit;
}
```

- [ ] **Step 4: Run tests — expect pass**

Run: `node --test tests/chassis-split-detection.test.mjs`

Expected: all 6 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/routing/chassis-split.js tests/chassis-split-detection.test.mjs
git commit -m "feat(foundation): chassis-split detection helper

Pure module reading orders.hook_chassis_location_id /
terminate_chassis_location_id (added in migration 065) to detect splits.
Also provides isChassisReposition() and hasChassisHandling() predicates.

No new schema. No DB access. Downstream consumers (tariff engines,
dispatcher board, routing UI) can import without coupling to DB.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

### Task 6: Create `lib/validation/load-payload.js`

**Files:**
- Create: `lib/validation/load-payload.js`
- Create: `tests/load-payload-validation.test.mjs`

- [ ] **Step 1: Write failing tests**

Create `tests/load-payload-validation.test.mjs`:

```javascript
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { validateLoadPayload } from '../lib/validation/load-payload.js';

test('rejects unknown load_type', () => {
  const r = validateLoadPayload({ load_type: 'nonsense' });
  assert.equal(r.ok, false);
  assert.match(r.error, /Unknown load_type/);
});

test('import load with no chassis location fields is ok', () => {
  const r = validateLoadPayload({ load_type: 'import', container_number: 'ABCD1234567' });
  assert.equal(r.ok, true);
});

test('chassis_reposition without hook_chassis_location_id fails', () => {
  const r = validateLoadPayload({
    load_type: 'chassis_reposition',
    terminate_chassis_location_id: 'yard-uuid-2',
  });
  assert.equal(r.ok, false);
  assert.match(r.error, /hook_chassis_location_id is required/);
});

test('chassis_reposition without terminate_chassis_location_id fails', () => {
  const r = validateLoadPayload({
    load_type: 'chassis_reposition',
    hook_chassis_location_id: 'yard-uuid-1',
  });
  assert.equal(r.ok, false);
  assert.match(r.error, /terminate_chassis_location_id is required/);
});

test('chassis_reposition with both chassis locations is ok (no container required)', () => {
  const r = validateLoadPayload({
    load_type: 'chassis_reposition',
    hook_chassis_location_id: 'yard-uuid-1',
    terminate_chassis_location_id: 'yard-uuid-2',
    // NO container_number — reposition allows null container
  });
  assert.equal(r.ok, true);
});

test('bill_only with no container is ok (allowsNullContainer)', () => {
  const r = validateLoadPayload({ load_type: 'bill_only' });
  assert.equal(r.ok, true);
});
```

- [ ] **Step 2: Run tests — expect fail**

Run: `node --test tests/load-payload-validation.test.mjs`

Expected: FAIL — module not found.

- [ ] **Step 3: Create `lib/validation/load-payload.js`**

```javascript
/**
 * Load-payload validation. Pure module — consumed by POST /api/tenant/loads
 * and PUT /api/tenant/loads/[id]. Keeps all load_type-specific validation
 * in one place so the API handlers stay thin.
 *
 * Returns { ok: true } on success; { ok: false, error: <string> } on failure.
 */

import { getLoadType } from '../constants/load-types.js';

export function validateLoadPayload(body) {
  const cfg = getLoadType(body?.load_type);
  if (!cfg) {
    return { ok: false, error: `Unknown load_type: ${body?.load_type}` };
  }

  if (cfg.requiresHookChassisLocation && !body.hook_chassis_location_id) {
    return {
      ok: false,
      error: `hook_chassis_location_id is required for ${cfg.label} loads`,
    };
  }

  if (cfg.requiresTerminateChassisLocation && !body.terminate_chassis_location_id) {
    return {
      ok: false,
      error: `terminate_chassis_location_id is required for ${cfg.label} loads`,
    };
  }

  // container_number / container_size are optional when allowsNullContainer is true.
  // Any stricter check (e.g., ISO format validation) lives outside this module.

  return { ok: true };
}
```

- [ ] **Step 4: Run tests — expect pass**

Run: `node --test tests/load-payload-validation.test.mjs`

Expected: all 6 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/validation/load-payload.js tests/load-payload-validation.test.mjs
git commit -m "feat(foundation): load-payload validation helper

Validates load_type against LOAD_TYPES + enforces requires* flags
(e.g., chassis_reposition requires both chassis location fields).
Consumed by POST /api/tenant/loads and PUT /api/tenant/loads/[id].

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

### Task 7: Wire validation into load API handlers

**Files:**
- Modify: `pages/api/tenant/loads/index.js` (POST handler)
- Modify: `pages/api/tenant/loads/[id]/index.js` (PUT handler)

- [ ] **Step 1: Read `pages/api/tenant/loads/index.js` POST handler**

Locate the POST branch that validates and inserts the load. It already has `VALID_LOAD_TYPES.includes(body.load_type)` check after Task 3's refactor — replace that with the new validator.

- [ ] **Step 2: Modify POST handler**

Add the import at the top:

```javascript
import { validateLoadPayload } from '../../../../lib/validation/load-payload.js';
```

In the POST handler, before the INSERT (around line 329-331 in the current file; adjust after Task 3):

Before:

```javascript
const loadType =
  body.load_type && VALID_LOAD_TYPES.includes(body.load_type) ? body.load_type : 'import';
```

After:

```javascript
const validation = validateLoadPayload(body);
if (!validation.ok) {
  return res.status(400).json({ error: validation.error });
}

const loadType = body.load_type || 'import';
```

(The `VALID_LOAD_TYPES.includes` check is redundant — the validator already rejects unknowns.)

- [ ] **Step 3: Modify PUT handler**

Open `pages/api/tenant/loads/[id]/index.js` and add:

```javascript
import { validateLoadPayload } from '../../../../../lib/validation/load-payload.js';
```

In the PUT branch, run `validateLoadPayload(body)` early — but **only if `body.load_type` is being set** (PUT is partial update). Example:

```javascript
if (body.load_type !== undefined) {
  const validation = validateLoadPayload(body);
  if (!validation.ok) {
    return res.status(400).json({ error: validation.error });
  }
}
```

> **Implementer note:** the PUT handler may use spread over existing fields. If so, the validation must combine existing record + body to get the effective final state. Use `{ ...existingLoad, ...body }` as the validation input if partial-update semantics apply.

- [ ] **Step 4: Write integration test for reposition API validation**

Append to `tests/load-payload-validation.test.mjs` (or create `tests/loads-api-reposition.test.mjs` if separate integration tests are the codebase pattern — check `tests/` for precedent):

```javascript
// Integration: real POST to /api/tenant/loads (requires authenticated session)
// Pseudocode — adjust to codebase test-runner / auth pattern:
//
// test('POST /api/tenant/loads with chassis_reposition but missing location fails 400', async () => {
//   const res = await authenticatedPost('/api/tenant/loads', {
//     load_type: 'chassis_reposition',
//     // no hook_chassis_location_id
//     terminate_chassis_location_id: 'yard-uuid',
//   });
//   assert.equal(res.status, 400);
//   assert.match(res.body.error, /hook_chassis_location_id/);
// });
//
// test('POST /api/tenant/loads with valid chassis_reposition succeeds', async () => {
//   const res = await authenticatedPost('/api/tenant/loads', {
//     load_type: 'chassis_reposition',
//     hook_chassis_location_id: VALID_YARD_UUID,
//     terminate_chassis_location_id: VALID_YARD_UUID_2,
//   });
//   assert.equal(res.status, 201);
//   assert.equal(res.body.container_number, null); // reposition has no container
// });
```

> **Implementer note:** if the codebase has no existing API-integration test pattern, validate manually instead via curl in Step 5.

- [ ] **Step 5: Manual smoke test**

Start the dev server (`npm run dev`). In browser devtools or curl:

```bash
# Expect 400
curl -X POST http://localhost:3000/api/tenant/loads \
  -H 'Content-Type: application/json' -H 'Cookie: <session>' \
  -d '{"load_type":"chassis_reposition"}'

# Expect 201
curl -X POST http://localhost:3000/api/tenant/loads \
  -H 'Content-Type: application/json' -H 'Cookie: <session>' \
  -d '{"load_type":"chassis_reposition","hook_chassis_location_id":"<real-uuid>","terminate_chassis_location_id":"<real-uuid-2>"}'
```

- [ ] **Step 6: Commit**

```bash
git add pages/api/tenant/loads/index.js pages/api/tenant/loads/[id]/index.js
git commit -m "feat(foundation): wire load-payload validation into POST + PUT handlers

chassis_reposition now returns 400 when missing hook/terminate chassis
locations. All load_types validated via lib/validation/load-payload.js
single source.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

### Task 8: Extend tariff + driver-tariff engine context with chassisSplit

**Files:**
- Modify: `lib/tariff-engine.js`
- Modify: `lib/driver-tariff-engine.js`

- [ ] **Step 1: Locate the context builder in `lib/tariff-engine.js`**

Grep for where the engine loads an order and constructs the context object passed to rule evaluation. Look for functions like `buildContext`, `loadOrderContext`, or inline `{ order, moves, events, ... }` construction.

- [ ] **Step 2: Add imports**

```javascript
import {
  detectChassisSplit,
  isChassisReposition,
} from './routing/chassis-split.js';
```

- [ ] **Step 3: Enrich the context object**

Wherever the context object is built, add:

```javascript
const context = {
  ...existingContext,
  chassisSplit: detectChassisSplit(order),        // { isSplit, isHookSplit, isTerminateSplit, hookLocationId, terminateLocationId }
  isChassisReposition: isChassisReposition(order),
};
```

- [ ] **Step 4: Repeat for `lib/driver-tariff-engine.js`**

Same imports, same enrichment, same shape — so rule conditions can be written identically across both engines.

- [ ] **Step 5: Run existing engine test suite**

```bash
node --test tests/tariff-engine*.test.mjs tests/driver-tariff-engine*.test.mjs
```

Expected: no regression. The new fields are additive and don't affect existing rule paths.

- [ ] **Step 6: Commit**

```bash
git add lib/tariff-engine.js lib/driver-tariff-engine.js
git commit -m "feat(foundation): enrich tariff engine context with chassisSplit + isChassisReposition

Both engines now receive context.chassisSplit and context.isChassisReposition
so rule conditions can key on chassis handling without each rule reading
raw hook/terminate chassis location columns.

Enables B.1g chassis splits feature spec to wire new rule types against
these context primitives without touching the engines.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

**End of PR 3.**

---

## Phase 4 — Event-status transition helper + API + cascade

### Task 9: Create `lib/routing/event-status-transition.js`

**Files:**
- Create: `lib/routing/event-status-transition.js`
- Create: `tests/event-status-transition.test.mjs`

- [ ] **Step 1: Write failing tests**

Create `tests/event-status-transition.test.mjs`:

```javascript
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import {
  isValidTransition,
  getAllowedNextStatuses,
  transitionEventStatus,
} from '../lib/routing/event-status-transition.js';

test('isValidTransition — pending can go to arrived or skipped', () => {
  assert.equal(isValidTransition('pending', 'arrived'), true);
  assert.equal(isValidTransition('pending', 'skipped'), true);
  assert.equal(isValidTransition('pending', 'departed'), false); // must pass through arrived
});

test('isValidTransition — arrived can go to departed or skipped', () => {
  assert.equal(isValidTransition('arrived', 'departed'), true);
  assert.equal(isValidTransition('arrived', 'skipped'), true);
  assert.equal(isValidTransition('arrived', 'pending'), false);
});

test('isValidTransition — departed is terminal', () => {
  assert.equal(isValidTransition('departed', 'arrived'), false);
  assert.equal(isValidTransition('departed', 'pending'), false);
  assert.equal(isValidTransition('departed', 'skipped'), false);
});

test('isValidTransition — skipped is terminal', () => {
  assert.equal(isValidTransition('skipped', 'arrived'), false);
  assert.equal(isValidTransition('skipped', 'departed'), false);
});

test('getAllowedNextStatuses', () => {
  assert.deepEqual(getAllowedNextStatuses('pending'), ['arrived', 'skipped']);
  assert.deepEqual(getAllowedNextStatuses('arrived'), ['departed', 'skipped']);
  assert.deepEqual(getAllowedNextStatuses('departed'), []);
  assert.deepEqual(getAllowedNextStatuses('skipped'), []);
});

// For transitionEventStatus, use a lightweight supabase stub to assert
// the calls it would make. Full integration with real DB is tested
// separately in tests/event-status-transition-integration.test.mjs.

test('transitionEventStatus rejects invalid transition', async () => {
  const fakeSupabase = {
    from: () => ({
      select: () => ({
        eq: () => ({ single: async () => ({ data: { id: 'e1', event_status: 'departed' }, error: null }) }),
      }),
    }),
  };
  await assert.rejects(
    transitionEventStatus({
      supabase: fakeSupabase, tenantId: 't1', eventId: 'e1', toStatus: 'arrived',
      actor: { id: 'u1', type: 'human' },
    }),
    /Invalid transition/,
  );
});

test('transitionEventStatus requires actor.type', async () => {
  const fakeSupabase = {
    from: () => ({
      select: () => ({
        eq: () => ({ single: async () => ({ data: { id: 'e1', event_status: 'pending' }, error: null }) }),
      }),
    }),
  };
  await assert.rejects(
    transitionEventStatus({
      supabase: fakeSupabase, tenantId: 't1', eventId: 'e1', toStatus: 'arrived',
      actor: { id: 'u1' }, // missing type
    }),
    /actor\.type is required/,
  );
});

test('transitionEventStatus rejects actor.type outside the enum', async () => {
  const fakeSupabase = {
    from: () => ({
      select: () => ({
        eq: () => ({ single: async () => ({ data: { id: 'e1', event_status: 'pending' }, error: null }) }),
      }),
    }),
  };
  await assert.rejects(
    transitionEventStatus({
      supabase: fakeSupabase, tenantId: 't1', eventId: 'e1', toStatus: 'arrived',
      actor: { id: 'u1', type: 'robot' }, // not in enum
    }),
    /actor\.type must be one of/,
  );
});
```

- [ ] **Step 2: Run tests — expect fail**

Run: `node --test tests/event-status-transition.test.mjs`

Expected: FAIL — module not found.

- [ ] **Step 3: Create `lib/routing/event-status-transition.js`**

```javascript
/**
 * Routing-event status transitions. Central state-machine enforcement for
 * all routing events (primary + stop-off alike).
 *
 * Pattern follows B.1a (lib/routing/moves/transition.js + history table).
 * Actor threading per B.1d is MANDATORY — no default. dd-ai-ready skill
 * enforces this.
 */

const ALLOWED_TRANSITIONS = {
  pending:  ['arrived', 'skipped'],
  arrived:  ['departed', 'skipped'],
  departed: [],
  skipped:  [],
};

const VALID_ACTOR_TYPES = ['human', 'system', 'agent'];

/**
 * @param {string} fromStatus
 * @param {string} toStatus
 * @returns {boolean}
 */
export function isValidTransition(fromStatus, toStatus) {
  const allowed = ALLOWED_TRANSITIONS[fromStatus];
  return Array.isArray(allowed) && allowed.includes(toStatus);
}

/**
 * @param {string} currentStatus
 * @returns {string[]}
 */
export function getAllowedNextStatuses(currentStatus) {
  return ALLOWED_TRANSITIONS[currentStatus] ?? [];
}

/**
 * Transitions an event's status atomically:
 *   1. Reads current event
 *   2. Validates transition is allowed
 *   3. Updates event_status + arrived_at/departed_at (as side effects)
 *   4. Writes history row with actor threading
 *   5. Returns updated event
 *
 * Throws on invalid transition, missing actor, or invalid actor.type.
 *
 * @param {object} params
 * @param {object} params.supabase - Supabase service client
 * @param {string} params.tenantId
 * @param {string} params.eventId
 * @param {string} params.toStatus
 * @param {{ id?: string, type: 'human' | 'system' | 'agent', context?: object }} params.actor
 * @param {string} [params.note]
 * @returns {Promise<object>} updated event row
 */
export async function transitionEventStatus({
  supabase, tenantId, eventId, toStatus,
  actor, note,
}) {
  if (!actor || typeof actor !== 'object') {
    throw new Error('actor is required');
  }
  if (!actor.type) {
    throw new Error('actor.type is required (one of: human, system, agent)');
  }
  if (!VALID_ACTOR_TYPES.includes(actor.type)) {
    throw new Error(`actor.type must be one of ${VALID_ACTOR_TYPES.join(', ')}; got: ${actor.type}`);
  }

  // 1. Read current event
  const { data: event, error: readErr } = await supabase
    .from('order_routing_events')
    .select('*')
    .eq('id', eventId)
    .eq('tenant_id', tenantId)
    .single();
  if (readErr) throw readErr;
  if (!event) throw new Error(`Event not found: ${eventId}`);

  const fromStatus = event.event_status;

  // 2. Validate
  if (!isValidTransition(fromStatus, toStatus)) {
    throw new Error(`Invalid transition: ${fromStatus} -> ${toStatus} for event ${eventId}`);
  }

  // 3. Update event (single-statement — event_status + timestamps together)
  const update = { event_status: toStatus };
  const now = new Date().toISOString();
  if (toStatus === 'arrived' && !event.arrived_at) {
    update.arrived_at = now;
  }
  if (toStatus === 'departed') {
    if (!event.departed_at) update.departed_at = now;
    if (!event.arrived_at) update.arrived_at = now; // forgotten-arrival UX
  }
  // 'skipped' leaves timestamps null

  const { data: updated, error: updateErr } = await supabase
    .from('order_routing_events')
    .update(update)
    .eq('id', eventId)
    .eq('tenant_id', tenantId)
    .select()
    .single();
  if (updateErr) throw updateErr;

  // 4. Write history row (actor threading required by DB CHECK constraint)
  const { error: historyErr } = await supabase
    .from('order_routing_event_status_history')
    .insert({
      tenant_id: tenantId,
      event_id: eventId,
      from_status: fromStatus,
      to_status: toStatus,
      actor_id: actor.id ?? null,
      actor_type: actor.type,
      actor_context: actor.context ?? null,
      note: note ?? null,
    });
  if (historyErr) throw historyErr;

  return updated;
}
```

- [ ] **Step 4: Run tests — expect pass**

Run: `node --test tests/event-status-transition.test.mjs`

Expected: all 8 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/routing/event-status-transition.js tests/event-status-transition.test.mjs
git commit -m "feat(foundation): event-status transition helper (B.1a pattern)

Central state-machine enforcement for all routing events:
  pending -> arrived -> departed (terminal)
  pending -> skipped (terminal)
  arrived -> skipped (terminal)

Updates event_status + arrived_at/departed_at timestamps atomically and
writes history row with actor threading (required — no default; dd-ai-ready
enforces). DB CHECK constraint on history table enforces actor_type enum.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

### Task 10: Wire transition helper into event API handler

**Files:**
- Modify: `pages/api/tenant/loads/[id]/routing/events/[eventId].js`

- [ ] **Step 1: Read the existing handler**

Locate the PUT branch. It likely hand-updates event_status / timestamps today — replace with the helper call.

- [ ] **Step 2: Modify PUT handler**

Add imports:

```javascript
import { transitionEventStatus } from '../../../../../../../lib/routing/event-status-transition.js';
import { getTenantContext } from '../../../../../../../lib/auth-tenant';
```

(Adjust relative path depth to match this file's location under `pages/api/tenant/loads/[id]/routing/events/[eventId].js`.)

In the PUT branch:

```javascript
if (req.method === 'PUT') {
  const ctx = await getTenantContext(req, res);
  if (!ctx) return;

  const { toStatus, note, actorContext } = req.body;

  if (toStatus === undefined) {
    // Existing PUT behavior for non-status updates (e.g., editing location)
    // stays — only intercept when toStatus is supplied.
    return existingPutHandler(req, res);
  }

  try {
    const updated = await transitionEventStatus({
      supabase: ctx.supabase,
      tenantId: ctx.tenantId,
      eventId: req.query.eventId,
      toStatus,
      actor: {
        id: ctx.userId,
        type: 'human',          // API call from UI == human origin
        context: actorContext ?? null,
      },
      note,
    });
    return res.status(200).json({ event: updated });
  } catch (err) {
    if (/Invalid transition/.test(err.message)) {
      return res.status(409).json({ error: err.message });
    }
    if (/actor\./.test(err.message) || /not found/i.test(err.message)) {
      return res.status(400).json({ error: err.message });
    }
    throw err;
  }
}
```

> **Implementer note:** wrap existing PUT logic into a helper function (`existingPutHandler`) for cleanliness, OR structure with `if (toStatus)` short-circuit + fall-through. Match codebase conventions.

- [ ] **Step 3: Manual smoke test**

Start dev server. In browser devtools, on a load with routing events, issue:

```javascript
fetch('/api/tenant/loads/<load-id>/routing/events/<event-id>', {
  method: 'PUT',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ toStatus: 'arrived' }),
}).then(r => r.json()).then(console.log);
```

Expected: event row returned with `event_status: 'arrived'` + `arrived_at` set.

Then check the history table:

```sql
SELECT * FROM order_routing_event_status_history
WHERE event_id = '<event-id>'
ORDER BY transitioned_at DESC LIMIT 1;
```

Expected: 1 row with `from_status = 'pending'`, `to_status = 'arrived'`, `actor_type = 'human'`, `actor_id = <your-user-id>`.

- [ ] **Step 4: Commit**

```bash
git add pages/api/tenant/loads/[id]/routing/events/[eventId].js
git commit -m "feat(foundation): wire event-status transition into PUT handler

Endpoint now accepts { toStatus, note?, actorContext? } and delegates to
transitionEventStatus helper. Invalid transitions return 409; missing
actor fields return 400 (should be impossible in practice — actor is
always derived from session). Writes history row with actor_type='human'.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

### Task 11: Cascade pending events to departed on move completion

**Files:**
- Modify: `lib/routing/moves/transition.js`

- [ ] **Step 1: Read existing `lib/routing/moves/transition.js`**

Locate where moves transition to `completed`. There's an existing helper (ref: B.1a Stream) — find the `completed` branch.

- [ ] **Step 2: Add the cascade**

Add import:

```javascript
import { transitionEventStatus } from './event-status-transition.js';
```

(Path: both files are under `lib/routing/`, so `./event-status-transition.js` is correct from `lib/routing/moves/transition.js` one level up — actual path is `../event-status-transition.js`.)

Corrected import:

```javascript
import { transitionEventStatus } from '../event-status-transition.js';
```

After a move is successfully transitioned to `completed`, add:

```javascript
if (toStatus === 'completed') {
  // Cascade: any still-pending or still-arrived events under this move
  // auto-transition to 'departed' with actor_type='system'.
  const { data: stuckEvents } = await supabase
    .from('order_routing_events')
    .select('id, event_status')
    .eq('tenant_id', tenantId)
    .eq('move_id', moveId)
    .in('event_status', ['pending', 'arrived']);

  for (const ev of stuckEvents ?? []) {
    // pending -> arrived -> departed takes two steps
    if (ev.event_status === 'pending') {
      await transitionEventStatus({
        supabase, tenantId, eventId: ev.id, toStatus: 'arrived',
        actor: { type: 'system', context: { reason: 'cascaded from parent move completion', moveId } },
        note: 'cascaded from parent move completion',
      });
    }
    await transitionEventStatus({
      supabase, tenantId, eventId: ev.id, toStatus: 'departed',
      actor: { type: 'system', context: { reason: 'cascaded from parent move completion', moveId } },
      note: 'cascaded from parent move completion',
    });
  }
}
```

> **Implementer note:** This is a simple loop. If performance matters for moves with >50 events, batch-insert history rows. For B.1e ship, correctness over perf — loops are fine.

- [ ] **Step 3: Add integration test**

Append to `tests/event-status-transition.test.mjs` (or a new `tests/move-completion-cascade.test.mjs` if the codebase splits integration from unit):

```javascript
// Pseudocode — adjust to actual DB integration-test helpers.
// Setup: create a move with 2 events, both event_status='pending'.
// Act: transition the move to 'completed'.
// Assert: both events are event_status='departed' with 2 history rows
//         each (pending->arrived, arrived->departed), all actor_type='system'.
```

- [ ] **Step 4: Manual smoke test via SQL + API**

Create a test load + move + 2 events, then PUT move to `completed`, then verify:

```sql
SELECT id, event_status FROM order_routing_events WHERE move_id = '<move-id>';
-- Expected: both events have event_status='departed'

SELECT event_id, from_status, to_status, actor_type, note
FROM order_routing_event_status_history
WHERE event_id IN (SELECT id FROM order_routing_events WHERE move_id = '<move-id>')
ORDER BY transitioned_at;
-- Expected: 4 rows total (2 events × 2 transitions), all actor_type='system'
```

- [ ] **Step 5: Commit**

```bash
git add lib/routing/moves/transition.js
git commit -m "feat(foundation): cascade pending events to departed on move completion

When a move transitions to 'completed', any still-pending or arrived
events under that move auto-transition to 'departed' with
actor_type='system' and note='cascaded from parent move completion'.

Keeps move+event state consistent without dispatcher rework. History
rows preserve the audit trail — cascades are reversible with explicit
human action if needed.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

**End of PR 4.**

---

## Phase 5 — Stop-off types CRUD API + rules-engine primitives

### Task 12: Create `GET /api/tenant/stop-off-types` + POST

**Files:**
- Create: `pages/api/tenant/stop-off-types/index.js`
- Create: `tests/stop-off-types-api.test.mjs`

- [ ] **Step 1: Write failing tests**

Create `tests/stop-off-types-api.test.mjs`. Keep tests against the handler with a fake supabase stub; full integration (if the codebase supports it) lives elsewhere.

```javascript
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import handler from '../pages/api/tenant/stop-off-types/index.js';

// Fake req/res + supabase stub per codebase conventions.
// Pseudocode — adjust to the actual test harness this project uses.

function mockRes() {
  const res = { statusCode: 200, body: null };
  res.status = (s) => { res.statusCode = s; return res; };
  res.json = (b) => { res.body = b; return res; };
  res.end = () => res;
  return res;
}

test('GET lists all types for the tenant, ordered by sort_order', async () => {
  const fakeCtx = {
    tenantId: 't1',
    userId: 'u1',
    supabase: {
      from: () => ({
        select: () => ({
          eq: () => ({
            order: async () => ({
              data: [
                { id: 'a', name: 'Fuel Stop', sort_order: 10 },
                { id: 'b', name: 'Driver Break', sort_order: 20 },
              ],
              error: null,
            }),
          }),
        }),
      }),
    },
  };
  // Inject fakeCtx per codebase's test pattern (e.g., mock getTenantContext)
  // Assert: handler returns 200 with the array.
});

test('POST creates a new type', async () => {
  // Similar harness. Assert 201 + new row returned.
});

test('POST rejects duplicate name (409)', async () => {
  // Supabase stub returns PG unique-constraint error. Assert 409.
});
```

> **Implementer note:** the test harness depends on how other `pages/api/` endpoints are tested. Scan `tests/*-api.test.mjs` for a pattern; copy that scaffolding rather than inventing. If no pattern exists, manual smoke testing (Step 4) is sufficient.

- [ ] **Step 2: Create the handler**

```javascript
import { getTenantContext } from '../../../../lib/auth-tenant';

export default async function handler(req, res) {
  const ctx = await getTenantContext(req, res);
  if (!ctx) return;

  if (req.method === 'GET') {
    return getList(req, res, ctx);
  }
  if (req.method === 'POST') {
    return createType(req, res, ctx);
  }
  return res.status(405).json({ error: 'Method not allowed' });
}

async function getList(req, res, ctx) {
  const { data, error } = await ctx.supabase
    .from('stop_off_types')
    .select('*')
    .eq('tenant_id', ctx.tenantId)
    .order('sort_order', { ascending: true });
  if (error) return res.status(500).json({ error: error.message });
  return res.status(200).json({ stop_off_types: data });
}

async function createType(req, res, ctx) {
  const {
    name, description,
    has_cargo_transfer = false,
    is_paid_to_driver = false,
    is_billable_to_customer = false,
    counts_toward_detention = false,
    requires_location_pick = true,
    is_active = true,
    sort_order = 0,
  } = req.body ?? {};

  if (!name || typeof name !== 'string') {
    return res.status(400).json({ error: 'name is required' });
  }

  const { data, error } = await ctx.supabase
    .from('stop_off_types')
    .insert({
      tenant_id: ctx.tenantId,
      name, description,
      has_cargo_transfer, is_paid_to_driver, is_billable_to_customer,
      counts_toward_detention, requires_location_pick,
      is_active, sort_order,
      created_by: ctx.userId,
    })
    .select()
    .single();

  if (error) {
    if (error.code === '23505') { // unique_violation on (tenant_id, name)
      return res.status(409).json({ error: `Stop-off type "${name}" already exists` });
    }
    return res.status(500).json({ error: error.message });
  }
  return res.status(201).json({ stop_off_type: data });
}
```

- [ ] **Step 3: Manual smoke test**

```bash
# GET
curl -H 'Cookie: <session>' http://localhost:3000/api/tenant/stop-off-types
# Expect: 4 seeded defaults

# POST
curl -X POST -H 'Content-Type: application/json' -H 'Cookie: <session>' \
  -d '{"name":"Wash","description":"Container wash","sort_order":50}' \
  http://localhost:3000/api/tenant/stop-off-types
# Expect: 201 with new row

# POST duplicate
curl -X POST -H 'Content-Type: application/json' -H 'Cookie: <session>' \
  -d '{"name":"Wash"}' \
  http://localhost:3000/api/tenant/stop-off-types
# Expect: 409
```

- [ ] **Step 4: Commit**

```bash
git add pages/api/tenant/stop-off-types/index.js tests/stop-off-types-api.test.mjs
git commit -m "feat(foundation): stop-off types GET list + POST create API

GET /api/tenant/stop-off-types — list ordered by sort_order
POST /api/tenant/stop-off-types — create new type; 409 on duplicate name

RBAC: tenant-scoped auth; settings-permission gating (if applied via
middleware or inside handler per codebase convention) lives in B.1f
feature spec when admin UI ships.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

### Task 13: Create GET / PUT / DELETE [id] endpoint

**Files:**
- Create: `pages/api/tenant/stop-off-types/[id].js`

- [ ] **Step 1: Create the handler**

```javascript
import { getTenantContext } from '../../../../lib/auth-tenant';

export default async function handler(req, res) {
  const ctx = await getTenantContext(req, res);
  if (!ctx) return;

  const { id } = req.query;
  if (!id) return res.status(400).json({ error: 'id required' });

  if (req.method === 'GET') {
    const { data, error } = await ctx.supabase
      .from('stop_off_types')
      .select('*')
      .eq('tenant_id', ctx.tenantId)
      .eq('id', id)
      .maybeSingle();
    if (error) return res.status(500).json({ error: error.message });
    if (!data) return res.status(404).json({ error: 'Not found' });
    return res.status(200).json({ stop_off_type: data });
  }

  if (req.method === 'PUT') {
    const allowed = [
      'name', 'description',
      'has_cargo_transfer', 'is_paid_to_driver', 'is_billable_to_customer',
      'counts_toward_detention', 'requires_location_pick',
      'is_active', 'sort_order',
    ];
    const patch = {};
    for (const k of allowed) if (req.body?.[k] !== undefined) patch[k] = req.body[k];
    patch.updated_at = new Date().toISOString();

    const { data, error } = await ctx.supabase
      .from('stop_off_types')
      .update(patch)
      .eq('tenant_id', ctx.tenantId)
      .eq('id', id)
      .select()
      .maybeSingle();
    if (error) {
      if (error.code === '23505') return res.status(409).json({ error: 'Name conflict' });
      return res.status(500).json({ error: error.message });
    }
    if (!data) return res.status(404).json({ error: 'Not found' });
    return res.status(200).json({ stop_off_type: data });
  }

  if (req.method === 'DELETE') {
    // Hard-delete blocked if any events reference this type.
    // Soft-delete (set is_active=false) is always allowed via PUT.
    const { count, error: refErr } = await ctx.supabase
      .from('order_routing_events')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', ctx.tenantId)
      .eq('stop_off_type_id', id);
    if (refErr) return res.status(500).json({ error: refErr.message });
    if (count && count > 0) {
      return res.status(409).json({
        error: `Cannot delete: ${count} routing event(s) reference this type. Deactivate it instead (PUT with is_active=false).`,
        referenced_event_count: count,
      });
    }

    const { error: delErr } = await ctx.supabase
      .from('stop_off_types')
      .delete()
      .eq('tenant_id', ctx.tenantId)
      .eq('id', id);
    if (delErr) return res.status(500).json({ error: delErr.message });
    return res.status(204).end();
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
```

- [ ] **Step 2: Manual smoke test**

```bash
# GET one
curl -H 'Cookie: <session>' http://localhost:3000/api/tenant/stop-off-types/<id>
# Expect: 200 with row

# PUT (deactivate)
curl -X PUT -H 'Content-Type: application/json' -H 'Cookie: <session>' \
  -d '{"is_active":false}' \
  http://localhost:3000/api/tenant/stop-off-types/<id>
# Expect: 200 with updated row

# DELETE (no references — succeeds)
curl -X DELETE -H 'Cookie: <session>' http://localhost:3000/api/tenant/stop-off-types/<id>
# Expect: 204

# DELETE (with references — blocked)
# First, insert a routing event with stop_off_type_id=<other-type-id>, then:
curl -X DELETE -H 'Cookie: <session>' http://localhost:3000/api/tenant/stop-off-types/<other-type-id>
# Expect: 409 with referenced_event_count
```

- [ ] **Step 3: Commit**

```bash
git add pages/api/tenant/stop-off-types/[id].js
git commit -m "feat(foundation): stop-off types GET/PUT/DELETE [id] API

GET    — read one
PUT    — partial update (whitelisted fields; toggle is_active for soft-delete)
DELETE — hard-delete; 409 if any order_routing_events reference the type

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

### Task 14: New-tenant provisioning hook

**Files:**
- Modify: (dependent on what exists — audit first)

- [ ] **Step 1: Audit tenant-creation path**

Grep:

```bash
# Find tenant-provisioning logic
```

Use Grep:
- pattern: `INSERT INTO tenants|from('tenants').insert`
- glob: `**/*.{js,ts}`

Expected results: `pages/api/admin/tenants/*.js` or `lib/tenant-provisioning*.js` or similar.

- [ ] **Step 2: Decide approach**

- **If a provisioning module exists** (e.g., `lib/tenant-provisioning.js`): add a call that inserts the 4 default stop-off types for the new tenant, using the same VALUES tuple as migration 100 Step 6.
- **If tenant creation is scattered across a handful of endpoints**: add a Postgres trigger instead. Place it in a tiny migration `supabase/migrations/101_seed_stop_off_types_on_new_tenant.sql`:

```sql
BEGIN;

CREATE OR REPLACE FUNCTION seed_default_stop_off_types() RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO stop_off_types (
    tenant_id, name, description,
    has_cargo_transfer, is_paid_to_driver, is_billable_to_customer,
    counts_toward_detention, requires_location_pick, sort_order
  ) VALUES
    (NEW.id, 'Fuel Stop',        'Driver refuels en route',                                false, false, false, false, true,  10),
    (NEW.id, 'Driver Break',     'Mandated rest or meal break',                            false, false, false, false, false, 20),
    (NEW.id, 'Scale',            'Weigh station / scale verification',                     false, false, true,  false, true,  30),
    (NEW.id, 'Chassis Exchange', 'Swap chassis mid-route (e.g., different size or owner)', false, true,  false, false, true,  40)
  ON CONFLICT (tenant_id, name) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_seed_stop_off_types ON tenants;
CREATE TRIGGER trg_seed_stop_off_types
  AFTER INSERT ON tenants
  FOR EACH ROW
  EXECUTE FUNCTION seed_default_stop_off_types();

NOTIFY pgrst, 'reload schema';

COMMIT;
```

Pick whichever approach matches what exists. Both are acceptable.

- [ ] **Step 3: Verify**

Create a test tenant (via admin flow or direct SQL) and confirm 4 stop-off types appear for the new tenant.

- [ ] **Step 4: Commit**

```bash
# If module-based approach:
git add lib/tenant-provisioning.js
git commit -m "feat(foundation): seed default stop-off types on new tenant provisioning"

# If trigger approach:
git add supabase/migrations/101_seed_stop_off_types_on_new_tenant.sql
git commit -m "feat(foundation): migration 101 — seed stop-off types on new tenant INSERT"
```

### Task 15: Rules-engine primitives for stop-off-type conditions

**Files:**
- Modify: rules-engine operator registry (location TBD by grep — typically `lib/routing-rules.js` or similar)

- [ ] **Step 1: Locate the rules-engine operator registry**

Grep:

```bash
# Find where rule operators are registered
# Pattern: look for existing operators like 'IN', 'BETWEEN', 'GT', etc.
```

Use Grep:
- pattern: `operators|OPERATORS|registerOperator|evaluateCondition`
- glob: `lib/**/*.{js,ts}`

Expected files: `lib/routing-rules.js`, `lib/tariff-engine.js`, `lib/driver-tariff-engine.js`.

> **Implementer note:** if the rules engine has a pluggable operator registry, add the two primitives there. If operators are hardcoded into `evaluateCondition`-style switch statements, add cases in the switch. The two approaches yield the same behavior.

- [ ] **Step 2: Add `event.stop_off_type_id` operator**

Pattern (adjust to actual engine shape):

```javascript
// Primitive 1: direct match on stop_off_type_id
// Rule condition shape:
//   { field: 'event.stop_off_type_id', op: '=', value: '<uuid>' }
//
// Evaluation: for each event in context.routingEvents, return true if
// event.stop_off_type_id === value. Used by charge profile rules that
// target a specific stop-off type.

case 'event.stop_off_type_id':
  return evaluateEventField(context, condition, (ev) => ev.stop_off_type_id);
```

- [ ] **Step 3: Add `event.stop_off_type.{flag}` operator**

```javascript
// Primitive 2: behavior-flag match
// Rule condition shape:
//   { field: 'event.stop_off_type.is_paid_to_driver', op: '=', value: true }
//
// Evaluation: for each event, join to its stop_off_type row (already in
// context via the context builder — see Task 16) and read the flag.

case 'event.stop_off_type.has_cargo_transfer':
case 'event.stop_off_type.is_paid_to_driver':
case 'event.stop_off_type.is_billable_to_customer':
case 'event.stop_off_type.counts_toward_detention':
case 'event.stop_off_type.requires_location_pick':
  return evaluateEventField(context, condition, (ev) => {
    const fieldName = condition.field.split('.').pop();
    return ev.stop_off_type?.[fieldName] ?? null;
  });
```

- [ ] **Step 4: Write unit tests for new operators**

Append to the rules-engine test file (locate with: `tests/*rules*.test.mjs`):

```javascript
test('event.stop_off_type_id operator matches specific type', () => {
  const context = {
    routingEvents: [
      { id: 'e1', stop_off_type_id: 'fuel-type-id' },
      { id: 'e2', stop_off_type_id: null },
    ],
  };
  const condition = { field: 'event.stop_off_type_id', op: '=', value: 'fuel-type-id' };
  assert.equal(evaluateCondition(context, condition), true);
});

test('event.stop_off_type.is_paid_to_driver operator matches joined flag', () => {
  const context = {
    routingEvents: [
      { id: 'e1', stop_off_type_id: 'chassis-exchange-id', stop_off_type: { is_paid_to_driver: true } },
    ],
  };
  const condition = { field: 'event.stop_off_type.is_paid_to_driver', op: '=', value: true };
  assert.equal(evaluateCondition(context, condition), true);
});
```

- [ ] **Step 5: Extend context builder to join stop_off_type on events**

In `lib/tariff-engine.js` + `lib/driver-tariff-engine.js` (same spots as Task 8), the events query needs to also fetch the joined `stop_off_type` record:

```javascript
// Where events are fetched for context:
const { data: events } = await supabase
  .from('order_routing_events')
  .select(`
    *,
    stop_off_type:stop_off_types ( id, name, has_cargo_transfer, is_paid_to_driver, is_billable_to_customer, counts_toward_detention, requires_location_pick )
  `)
  .eq('order_id', orderId);
```

This makes `event.stop_off_type.<flag>` directly readable in rules.

- [ ] **Step 6: Run full test suite**

```bash
npm test
```

Expected: existing tests still pass; new operator tests pass.

- [ ] **Step 7: Commit**

```bash
git add <rules-engine files> lib/tariff-engine.js lib/driver-tariff-engine.js <test files>
git commit -m "feat(foundation): rules-engine primitives for stop-off-type conditions

Two new operators:
  event.stop_off_type_id = ?      — match specific stop-off type
  event.stop_off_type.{flag} = ?  — match behavior flag (has_cargo_transfer,
                                     is_paid_to_driver, etc.)

Context builders in tariff-engine.js + driver-tariff-engine.js now join
stop_off_types into event rows so rules read flags directly without
additional DB queries.

B.1f + B.1g feature specs will build actual rule types (e.g., 'per
stop-off driver pay', 'split detention') using these primitives.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

### Task 16: Close FU-059 in followups ledger

**Files:**
- Modify: `C:\Users\bento\.claude\projects\C--Users-bento-app-drayagedirect\memory\followups.md`

- [ ] **Step 1: Mark FU-059 as resolved**

Edit followups.md: locate the FU-059 entry (around line 148) and change from "open" status to "resolved" format. Check the file's existing convention for resolved items (e.g., prefix with `~~strikethrough~~` or move to a "Recently resolved" section).

Add a one-line "Resolved:" note:

```
### FU-059: [ai-ready] Business-logic: Extract VALID_LOAD_TYPES / VALID_STATUSES / LOAD_TYPE_LETTER from loads/index.js
- Status: **Partially resolved** 2026-04-24 by B.1e foundation (commit <hash>)
  - VALID_LOAD_TYPES + LOAD_TYPE_LETTER: consolidated to lib/constants/load-types.js
  - VALID_STATUSES: remains open — tracked as standalone follow-up
- Source: docs/superpowers/audits/2026-04-24-ai-readiness-audit.md (audit run 2026-04-24)
- Scope: small
- Area: infra
...
```

> **Implementer note:** if followups.md convention is to move resolved items to a separate section, follow that convention instead.

- [ ] **Step 2: Update MEMORY.md audit line if applicable**

If the living ledger entry on MEMORY.md line ~9 mentions "68 open, ~24 recently-resolved", increment the resolved count.

- [ ] **Step 3: Commit**

```bash
# Note: followups.md lives under user home, NOT under the app repo.
# Commit it separately (the memory dir is often a sibling git repo OR
# uncommitted working state — follow user's convention).
```

- [ ] **Step 4: PR commit for Phase 5**

```bash
git add pages/api/tenant/stop-off-types/*.js \
        (rules-engine files) \
        lib/tariff-engine.js lib/driver-tariff-engine.js \
        tests/stop-off-types-api.test.mjs \
        (rules-engine tests)
# If trigger approach for Task 14:
git add supabase/migrations/101_seed_stop_off_types_on_new_tenant.sql

# Final PR commit already done incrementally in Tasks 12-15.
# Verify branch state:
git log --oneline -15
```

Expected: 5 commits for Phase 5 (12 / 13 / 14 / 15 / followups update), 4 for Phase 4, etc.

**End of PR 5 and end of foundation spec implementation.**

---

## Verification gates (run before each PR)

- [ ] **Full test suite passes**

```bash
npm test
```

- [ ] **dd-qa skill passes**

The skill auto-runs on file edits in pages/, components/, lib/, pages/api/. Any drift in field consistency (e.g., a new column not surfaced in sidebar, a new enum value missing from a picker) fails the gate.

- [ ] **dd-ai-ready skill passes**

The skill auto-runs after dd-qa. Key gates for this foundation:
- Any new state-change write must pass `actor_type` (G6 actor-attribution check from B.1d)
- Any new enum value must be tenant-override-capable or explicitly justified as system-level (per FU-069 tracker)
- Any business logic conditional on enum values must be reviewable for externalization

If the skill flags anything, log to followups.md per its convention and continue if advisory-only — do not block the ship.

- [ ] **Manual UI smoke (for PRs that touch components)**

Per `qa_zoom_responsive.md` and `dev_dark_mode_convention.md`:
- Test at 80%, 100%, 125% browser zoom (any new UI)
- Toggle dark mode — any new UI must have dark: variants

For B.1e foundation, UI touches are minimal (component imports change but rendering stays the same after Task 3). A quick spot-check of New Load modal + Tariffs page + AR filter is enough.

---

## Self-review (run after completing the plan)

- [ ] **Spec coverage:** every section of the spec has at least one task implementing it
  - Section 1 (overview): N/A — descriptive, no tasks
  - Section 2 (schema): Task 1
  - Section 3 (load-types consolidation + chassis_reposition): Tasks 2, 3, 4
  - Section 4 (stop-off catalog + status tracking): Tasks 9, 10, 11, 12, 13, 14
  - Section 5 (chassis-split helper + reposition validation + charge-profile hooks): Tasks 5, 6, 7, 8, 15
  - Section 6 (testing + rollout): embedded in every task (test-first)
- [ ] **No placeholders:** all "implementer note" callouts are clarifications, not blockers
- [ ] **Type consistency:** `LOAD_TYPES`, `VALID_LOAD_TYPES`, `LOAD_TYPE_LETTER`, `getLoadType`, `isValidLoadType` used consistently across Tasks 2-4. `detectChassisSplit`, `isChassisReposition`, `hasChassisHandling` consistent in Tasks 5, 7, 8. `transitionEventStatus`, `isValidTransition`, `getAllowedNextStatuses` consistent in Tasks 9, 10, 11.
- [ ] **Migration numbers:** Task 1 = migration 100 (confirmed free; baseline = 099). Task 14 optional-trigger = migration 101 (also free).
- [ ] **Letter-collision resolved:** chassis_reposition = `'C'` consistently across Task 2 test + module + tests.

## Execution options

**Plan complete and saved to [docs/superpowers/plans/2026-04-24-stop-offs-chassis-splits-foundation.md](docs/superpowers/plans/2026-04-24-stop-offs-chassis-splits-foundation.md). Two execution options:**

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration. Best for 15+ task plans like this one.

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints for review.
