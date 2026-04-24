# Stop-Offs + Chassis Splits Foundation — Design

**Working title:** B.1e — Stop-Offs + Chassis Splits Foundation
**Date:** 2026-04-24
**Status:** Design — awaiting user review before plan write-up
**Brainstorming session:** Chassis splits + stop-offs as first-class concepts (this session)

## Context

Chassis splits and stop-offs are core drayage workflows that DrayageDirect models only implicitly today:

- **Chassis splits** — driver picks up / drops off the chassis at a separate yard from the container terminal. Today modeled as event sequences (`hook_chassis` → `lift_off` → `terminate`) inside existing moves. No first-class concept, no "split detected" helper.
- **Stop-offs** — additional typed stops added to a routing by the dispatcher (Fuel Stop, Scale, Driver Break, Chassis Exchange, etc.). Today there's no catalog, no tracked status per stop, no charge-profile integration.

Both features need **shared infrastructure** before they can ship independently: a unified load-type source of truth, a typed stop-off catalog, event status tracking, a chassis-split detection helper, and rules-engine hooks for charge profiles. Rather than each feature spec dragging its own schema changes (risking churn and review conflicts), this foundation spec does the shared plumbing once. Two follow-up feature specs (B.1f stop-offs, B.1g chassis splits) then build on a stable base.

## Scope decomposition (decided in brainstorm)

This is Approach B from the brainstorm: **shared foundation + two features**. That decision broke into these locked sub-decisions:

| Question | Decision |
|---|---|
| One spec or decompose? | Foundation + two features (B.1e, B.1f, B.1g) |
| Stop-off tracking depth | B — tracked unit (status + timestamps + pay/billing hooks) |
| Catalog unity | A — unified catalog with behavior flags (`has_cargo_transfer`, `is_paid_to_driver`, `is_billable_to_customer`, `counts_toward_detention`, `requires_location_pick`) |
| Chassis-split modeling | A — event-only, polished (use existing migration 065 fields; detect splits via helper) |
| Chassis reposition as load type | A — in scope for foundation (`load_type = 'chassis_reposition'`) |
| Load-type consolidation | B — resolve FU-059 inline (centralize `LOAD_TYPES` in new module) |

Other concepts mentioned but explicitly deferred to future specs:
- **Multi-delivery OTR** (warehouse A → B → C) — different problem, different future spec. Foundation does not preclude it.
- **Chassis owner** (TRAC, FlexiVan, DCLI) — belongs in B.1g chassis splits feature spec; `equipment_chassis` schema extension there.
- **Driver-portal chassis-# edit (permission-gated)** — belongs in B.1g; touches driver permissions + FU-077 driver state-machine infra.
- **Chassis location inventory** (which chassis is at which yard right now) — not to be built as a new table. If ever needed, derive from event history.

## Section 1 — Overview & scope boundaries

### IN scope for the foundation spec

1. **Load-type consolidation (resolves [FU-059](../../../../memory/followups.md))** — single source of truth for load types + their behavior metadata in `lib/constants/load-types.js`.
2. **New `chassis_reposition` load type** — schema-feasible today (`orders.container_number` is already nullable); adds validation + letter prefix + dispatcher-board behavior.
3. **Stop-off types catalog** — tenant-scoped CRUD table (`stop_off_types`) with behavior flags; serves both ancillary (Fuel, Scale, Break) and business-context stops (e.g., Chassis Exchange, Customs Hold).
4. **Stop-off + event status tracking** — `order_routing_events` extended with `stop_off_type_id` FK + `event_status` enum (applies to ALL events, not just stop-offs) + transition helper + history table.
5. **Chassis-split detection helper** — pure module reading `orders.hook_chassis_location_id` / `terminate_chassis_location_id` (already exist via migration 065) to determine if a load is a split. No new chassis schema.
6. **Actor-type threading** — every new state-change write threads `actor_type` per B.1d convention. `dd-ai-ready` skill fails the build if any new write skips it. History table `CHECK (actor_type IN ('human', 'system', 'agent'))` enforces at DB level.
7. **Rules-engine primitives for charge profiles** — two new condition operators (`event.stop_off_type_id = ?`, `event.stop_off_type.{flag} = true`) so feature specs can wire stop-off-aware and split-aware charge profile rules without touching the engine core.

### OUT of scope (deferred to later specs)

- **B.1g Chassis splits feature:** chassis owner modeling, chassis-# editing from driver portal (permission-gated), split visual indicators in routing tab + dispatcher board, driver pay rate profiles specific to splits.
- **B.1f Stop-offs feature:** tenant-admin settings page for CRUD on stop-off types, routing-tab picker UI, driver pay / billing integration with the behavior flags.
- Multi-delivery OTR, chassis ownership, chassis location inventory (see Scope decomposition).

### Convention compliance

- `dev_migration_template.md` — BEGIN/COMMIT + `NOTIFY pgrst` + `IF NOT EXISTS`
- `dev_dark_mode_convention.md` — dark: variants on any new UI (unlikely in foundation)
- B.1a transition-helper pattern — helper + history table + optional event emit
- B.1d actor_type threading — required on every new state-change write

### Estimated size

~2 migrations (one new, one pure data), ~5-8 file edits for FU-059, ~3 new lib modules, ~2 new helper functions, 1 new table + 1 history table. Target ~3-5 days of implementation across 5 PRs.

## Section 2 — Schema changes

### Migration 100 — stop_off_types + routing_event_status

```sql
BEGIN;

-- 1. Stop-off types catalog (tenant-scoped, tenant-admin CRUD)
CREATE TABLE IF NOT EXISTS stop_off_types (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  -- Behavior flags (drives downstream pay/billing/detention logic)
  has_cargo_transfer BOOLEAN NOT NULL DEFAULT false,
  is_paid_to_driver BOOLEAN NOT NULL DEFAULT false,
  is_billable_to_customer BOOLEAN NOT NULL DEFAULT false,
  counts_toward_detention BOOLEAN NOT NULL DEFAULT false,
  requires_location_pick BOOLEAN NOT NULL DEFAULT true,
  -- Lifecycle
  is_active BOOLEAN NOT NULL DEFAULT true,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID REFERENCES users(id),
  UNIQUE (tenant_id, name)
);

CREATE INDEX IF NOT EXISTS idx_stop_off_types_tenant_active
  ON stop_off_types(tenant_id, sort_order) WHERE is_active = true;

-- 2. Routing-event status enum (applies to ALL events)
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
    WHEN arrived_at IS NOT NULL THEN 'arrived'::routing_event_status
    ELSE 'pending'::routing_event_status
  END
WHERE event_status = 'pending';

-- 5. Routing-event status history (audit trail per B.1a pattern)
CREATE TABLE IF NOT EXISTS order_routing_event_status_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  event_id UUID NOT NULL REFERENCES order_routing_events(id) ON DELETE CASCADE,
  from_status routing_event_status,      -- NULL for initial transition
  to_status routing_event_status NOT NULL,
  transitioned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  actor_id UUID REFERENCES users(id),
  actor_type TEXT NOT NULL CHECK (actor_type IN ('human', 'system', 'agent')),
  actor_context JSONB,
  note TEXT
);

CREATE INDEX IF NOT EXISTS idx_event_status_history_event
  ON order_routing_event_status_history(event_id, transitioned_at DESC);

-- 6. Seed default stop-off types for every existing tenant
INSERT INTO stop_off_types (tenant_id, name, description, has_cargo_transfer, is_paid_to_driver, is_billable_to_customer, counts_toward_detention, requires_location_pick, sort_order)
SELECT t.id, v.name, v.description, v.has_cargo_transfer, v.is_paid_to_driver, v.is_billable_to_customer, v.counts_toward_detention, v.requires_location_pick, v.sort_order
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

### Key schema decisions

1. **`event_status` applies to ALL routing events**, not just stop-offs. The reposition lifecycle (`start → arrive → depart → arrive → depart → complete`) requires every event to have status semantics. Backfill derives initial status from existing timestamps.
2. **`stop_off_type_id` is nullable** — only populated when the event IS a stop-off. Primary events (`pickup`, `deliver`, etc.) leave it NULL.
3. **No new `load_type` enum.** `orders.load_type` stays TEXT. The `chassis_reposition` value is added via the consolidated constants module. Validation that reposition loads have both chassis location fields happens at **API layer**, not as a DB CHECK — keeps draft creation flexible.
4. **No new chassis schema.** Migration 065 already laid `hook_chassis_location_id` / `terminate_chassis_location_id` on `orders`.
5. **Actor-type threading** baked into the history table CHECK constraint. Impossible to write a history row without declaring actor origin.

### What's NOT in this migration

- No `chassis_owners` table (deferred to B.1g)
- No chassis location inventory table (will not be built)
- No `stop_sequence` column for multi-delivery OTR (deferred)
- Existing `wait` / `scale` events are untouched. Tenants who want formal tracking create equivalent stop-off types in their catalog.

## Section 3 — Load-type consolidation (resolves FU-059)

### New module: `lib/constants/load-types.js`

Single source of truth. Every consumer imports from here. Each entry carries its policy, not just its name.

```js
export const LOAD_TYPES = [
  {
    value: 'import',
    label: 'Import',
    letter: 'M',                                    // preserved from pages/api/tenant/loads/index.js LOAD_TYPE_LETTER
    allowsNullContainer: false,
    matchesTariffs: true,
    matchesDriverTariffs: true,
    showsOnDispatcherBoard: true,
    description: 'Import container from port to consignee',
  },
  // ... inbound, export, outbound, road (all existing letters preserved)
  {
    value: 'bill_only',
    label: 'Bill Only',
    letter: 'B',
    allowsNullContainer: true,
    matchesTariffs: false,           // excluded per Plan G1
    matchesDriverTariffs: false,
    showsOnDispatcherBoard: false,
    description: 'Manual invoice-only; no driver or container ops',
  },
  {
    value: 'chassis_reposition',     // NEW
    label: 'Chassis Reposition',
    letter: 'R',                     // pick next free letter at implementation time if collision
    allowsNullContainer: true,
    matchesTariffs: true,
    matchesDriverTariffs: true,
    showsOnDispatcherBoard: true,
    description: 'Move a chassis between terminals (no container)',
    requiresHookChassisLocation: true,     // API validation
    requiresTerminateChassisLocation: true,
  },
];

// Derived lookups (preserved names — zero breaking changes)
export const VALID_LOAD_TYPES = LOAD_TYPES.map(t => t.value);
export const LOAD_TYPE_LETTER = Object.fromEntries(LOAD_TYPES.map(t => [t.value, t.letter]));
export const LOAD_TYPE_LABELS = Object.fromEntries(LOAD_TYPES.map(t => [t.value, t.label]));

// Filtered lists (for UI chip groups + engines)
export const TARIFF_MATCHING_LOAD_TYPES = LOAD_TYPES.filter(t => t.matchesTariffs);
export const DRIVER_TARIFF_MATCHING_LOAD_TYPES = LOAD_TYPES.filter(t => t.matchesDriverTariffs);
export const DISPATCHER_BOARD_LOAD_TYPES = LOAD_TYPES.filter(t => t.showsOnDispatcherBoard);

// Helpers
export function getLoadType(value) { /* ... */ }
export function isValidLoadType(value) { /* ... */ }
```

### Consumers to refactor (~8 files)

| File | What to replace |
|---|---|
| `pages/api/tenant/loads/index.js:14-26` | `VALID_LOAD_TYPES` + `LOAD_TYPE_LETTER` literal arrays |
| `components/loads/NewLoadModal.js` | Local `LOAD_TYPES` array |
| `pages/settings/tariffs/[id].js` | Tariff-page `LOAD_TYPES` |
| `pages/settings/driver-tariffs/[id].js` | Driver-tariff-page `LOAD_TYPES` |
| `components/settings/tariff-detail/TariffMatchingPanel.js` | Uses `TARIFF_MATCHING_LOAD_TYPES` |
| `components/settings/driver-tariff-detail/DriverTariffMatchingPanel.js` | Same pattern |
| `lib/tariff-engine.js` + `lib/driver-tariff-engine.js` | Hardcoded load_type checks → helpers |
| `components/ar/FilterSidebar.js` | AR filter chip group |

Existing letter assignments are **preserved literally** from the current hardcoded values. Only new addition is `'R'` for chassis_reposition (resolve collision at implementation time if needed).

### API surface

- `GET /api/tenant/load-types` — returns `LOAD_TYPES` array. Tenant-scoped for auth only.

### Reposition-specific validation

In `pages/api/tenant/loads/index.js` POST and `pages/api/tenant/loads/[id].js` PUT:

```js
import { getLoadType } from '@/lib/constants/load-types';

const cfg = getLoadType(body.load_type);
if (cfg?.requiresHookChassisLocation && !body.hook_chassis_location_id) {
  return res.status(400).json({ error: 'hook_chassis_location_id is required for this load type' });
}
if (cfg?.requiresTerminateChassisLocation && !body.terminate_chassis_location_id) {
  return res.status(400).json({ error: 'terminate_chassis_location_id is required for this load type' });
}
// Container fields optional when allowsNullContainer is true — reposition has no container.
```

## Section 4 — Stop-off catalog + status tracking

### Event-type conventions

`order_routing_events.event_type` vocabulary is unchanged for existing values. Stop-offs use a new conventional value:

- **Primary events** (unchanged): `pull, pickup, deliver, drop, hook, return, hook_chassis, lift_off, terminate, complete`
- **Stop-off events** (new): `event_type = 'stop_off'` — paired with non-null `stop_off_type_id`
- **Legacy** (untouched): `wait, scale` stay as-is. Tenants opt into the new system by creating equivalent stop-off types.

### Stop-off types CRUD API

Tenant-admin, RBAC-gated to settings permissions:

```
GET    /api/tenant/stop-off-types              → list active + inactive
POST   /api/tenant/stop-off-types              → create
GET    /api/tenant/stop-off-types/[id]         → read one
PUT    /api/tenant/stop-off-types/[id]         → update (inc. toggle is_active)
DELETE /api/tenant/stop-off-types/[id]         → soft delete (sets is_active = false)
```

**Protect-in-use rule:** hard-deleting a type referenced by any `order_routing_events.stop_off_type_id` returns `409` with referenced-event count. Soft-delete always allowed.

### Seeded default types

Migration 100 inserts these for every **existing** tenant via the `INSERT ... SELECT FROM tenants` pattern shown in the migration. For **new tenants** created after migration 100 ships, PR 5 (stop-off types CRUD) additionally audits the tenant-creation path:

- If a provisioning module exists (e.g., `lib/tenant-provisioning.js` or an admin API handler that creates tenants), wire in a call that seeds the default types for the new tenant.
- If no provisioning module exists, add a trigger on `tenants` INSERT that seeds defaults. Migration for the trigger lives in PR 5, not PR 1, since it's a conventions-only safety net (not blocking of foundation schema).

Either approach is acceptable; implementer picks based on what exists. The seed uses `ON CONFLICT (tenant_id, name) DO NOTHING` so re-running is safe.

Default types:

| name | has_cargo_transfer | is_paid_to_driver | is_billable_to_customer | counts_toward_detention | requires_location_pick |
|---|---|---|---|---|---|
| Fuel Stop | ❌ | ❌ | ❌ | ❌ | ✅ |
| Driver Break | ❌ | ❌ | ❌ | ❌ | ❌ |
| Scale | ❌ | ❌ | ✅ | ❌ | ✅ |
| Chassis Exchange | ❌ | ✅ | ❌ | ❌ | ✅ |

Tenant-admins can edit or deactivate these freely.

### Transition helper: `lib/routing/event-status-transition.js`

Central state-machine enforcement for all routing events:

```js
const ALLOWED_TRANSITIONS = {
  pending:  ['arrived', 'skipped'],
  arrived:  ['departed', 'skipped'],
  departed: [],    // terminal
  skipped:  [],    // terminal
};

/**
 * Transitions an event's status atomically:
 *   1. Validates transition is allowed
 *   2. Updates event_status + arrived_at/departed_at timestamp
 *   3. Writes history row with actor threading (B.1d required)
 *   4. Returns updated event
 *
 * Throws on invalid transition or missing actor. actor.type is mandatory
 * ('human' | 'system' | 'agent') — no defaults, per B.1d.
 */
export async function transitionEventStatus({
  supabase, tenantId, eventId, toStatus,
  actor,   // { id, type, context }  ← REQUIRED
  note,
}) { /* ... */ }

export function isValidTransition(fromStatus, toStatus) { /* ... */ }
export function getAllowedNextStatuses(currentStatus) { /* ... */ }
```

**Timestamp side-effects** (inside the helper, single update):
- `toStatus = 'arrived'` → set `arrived_at = now()` if null
- `toStatus = 'departed'` → set `departed_at = now()` if null; also set `arrived_at = now()` if null (covers "driver forgot to mark arrival" UX)
- `toStatus = 'skipped'` → leave timestamps null

### Integration points (foundation only)

| Call site | What changes |
|---|---|
| `pages/api/tenant/loads/[id]/routing/events/[eventId]` | PUT handler accepts `{ toStatus, actorContext? }` and delegates to `transitionEventStatus(...)` |
| `lib/routing/moves/transition.js` | When a move transitions to `completed`, cascade any still-`pending`/`arrived` events to `departed` with `actor.type='system'` and note `'cascaded from parent move completion'` |
| System-initiated auto-advance | Passes `actor.type = 'system'` explicitly |

**What's NOT built in foundation:** driver-portal UI for transitions, dispatcher-UI stop-off picker, settings page for catalog CRUD. Feature-spec territory.

## Section 5 — Chassis-split helper + reposition validation + charge-profile hooks

### Split detection helper: `lib/routing/chassis-split.js`

Pure module. No side effects.

```js
/**
 * A chassis split exists iff the load has a non-null hook_chassis_location_id
 * or terminate_chassis_location_id. Presence of the column value IS the signal;
 * no comparison against container pickup/return needed — the user explicitly
 * set a separate location, so it's a split by definition.
 */
export function detectChassisSplit(load) {
  const isHookSplit = load.hook_chassis_location_id != null;
  const isTerminateSplit = load.terminate_chassis_location_id != null;
  return {
    isSplit: isHookSplit || isTerminateSplit,
    isHookSplit,
    isTerminateSplit,
    hookLocationId: load.hook_chassis_location_id,
    terminateLocationId: load.terminate_chassis_location_id,
  };
}

export function isChassisReposition(load) {
  return load.load_type === 'chassis_reposition';
}

export function hasChassisHandling(load) {
  return isChassisReposition(load) || detectChassisSplit(load).isSplit;
}
```

### Reposition validation: `lib/validation/load-payload.js` (new)

Reusable validator for `POST /api/tenant/loads` and `PUT /api/tenant/loads/[id]`:

```js
import { getLoadType } from '@/lib/constants/load-types';

export function validateLoadPayload(body) {
  const cfg = getLoadType(body.load_type);
  if (!cfg) return { ok: false, error: `Unknown load_type: ${body.load_type}` };

  if (cfg.requiresHookChassisLocation && !body.hook_chassis_location_id) {
    return { ok: false, error: `hook_chassis_location_id is required for ${cfg.label} loads` };
  }
  if (cfg.requiresTerminateChassisLocation && !body.terminate_chassis_location_id) {
    return { ok: false, error: `terminate_chassis_location_id is required for ${cfg.label} loads` };
  }
  // Container fields optional when allowsNullContainer is true.
  return { ok: true };
}
```

### Charge-profile hooks

Foundation's job is to make the data reachable — **not** to write the rules engine changes. Two hooks:

1. **Context enrichment** — `lib/tariff-engine.js` + `lib/driver-tariff-engine.js` context builders include:
   ```js
   {
     ...existingContext,
     chassisSplit: detectChassisSplit(load),        // { isSplit, isHookSplit, isTerminateSplit, ... }
     isChassisReposition: isChassisReposition(load),
     routingEvents: [
       // existing shape + stop_off_type_id (raw) + stop_off_type (joined) per row
       { ..., stop_off_type_id, stop_off_type: { has_cargo_transfer, is_paid_to_driver, ... } }
     ],
   }
   ```
2. **Condition primitives** — two new operators added to the rules engine (per `feature_rules_engine.md`), not new rule types:
   - `event.stop_off_type_id = ?` — exact match
   - `event.stop_off_type.{flag} = true` — behavior-flag match (e.g., `event.stop_off_type.is_paid_to_driver = true`)

   The operator registry lives in the rules engine entrypoint (`lib/routing-rules.js` today plus the tariff-engine / driver-tariff-engine consumers). Implementer locates the operator extension point during PR 5 — the two new primitives are pure functions reading `event.stop_off_type_id` and joined `event.stop_off_type` fields from the already-enriched context.

   Feature specs (B.1f, B.1g) build the actual rule **types** using these primitives.

### What feature specs get for free

**B.1g chassis splits feature spec** can assume:
- `detectChassisSplit(load)` works everywhere
- Rules engine evaluates `context.chassisSplit.isSplit` and `context.isChassisReposition`
- Routing API + validation handle `chassis_reposition` end-to-end
- `event_status` applies to chassis events (`hook_chassis`, `terminate`)

**B.1f stop-offs feature spec** can assume:
- `stop_off_types` catalog + CRUD API exists
- Seeded defaults present
- `event_status` transitions work
- Rules engine can reference stop-off type flags via the two new primitives
- Context builder exposes behavior flags on each event's joined stop-off type

## Section 6 — Testing & rollout

### Test coverage

| Layer | Target | What to verify |
|---|---|---|
| Unit (`tests/*.test.mjs`) | `lib/constants/load-types.js` | LOAD_TYPES shape integrity, no duplicate letters, helpers |
| Unit | `lib/validation/load-payload.js` | Reposition rejects without chassis locations; non-reposition passes; unknown load_type rejected |
| Unit | `lib/routing/chassis-split.js` | `detectChassisSplit` all branches; `isChassisReposition`; `hasChassisHandling` |
| Unit | `lib/routing/event-status-transition.js` | Valid/invalid transitions; timestamp side-effects; missing actor throws; history row written; cascade behavior |
| Integration (real DB, legacy JWT keys per `feedback_supabase_keys.md`) | Migration 100 | Applies inside BEGIN/COMMIT; backfill derives `event_status` correctly; seeds 4 default types per tenant; reverse is safe |
| Integration | Stop-off types CRUD | Round-trip; soft-delete flips `is_active`; hard-delete with referenced events → 409 |
| Integration | Load POST with `chassis_reposition` | Missing chassis location → 400; valid → 201; container fields may be null |
| Integration | Event status transition | `PUT /api/tenant/loads/[id]/routing/events/[eventId]` accepts `toStatus`, writes history row with actor threading |

Target: ~35-45 unit tests, ~10 integration tests. Aligns with B.1a-B.1d volume.

### Mandatory gates per PR

- **`dd-qa`** — field-consistency check (new `stop_off_type_id`, new `chassis_reposition` load type, new `event_status`)
- **`dd-ai-ready`** (6-check gate) — every new state-change write threads `actor_type`. DB CHECK constraint makes violations impossible.
- **Zoom 80/100/125%** (per `qa_zoom_responsive.md`) — only if UI lands in a PR (foundation is mostly backend)
- **Dark mode** (per `dev_dark_mode_convention.md`) — any new UI ships dark: variants

### Rollout sequence (5 PRs, each reviewable in one sitting)

**PR 1 — Migration 100 + seed + backfill**
- `supabase/migrations/100_stop_offs_foundation.sql`
- Commit: `feat(foundation): migration 100 — stop-off types + event status tracking`

**PR 2 — FU-059 consolidation + chassis_reposition load type**
- `lib/constants/load-types.js` (new)
- Refactor ~8 consumers to import from the new module
- Add `chassis_reposition` entry + `GET /api/tenant/load-types`
- Commit: `feat(foundation): consolidate load types (FU-059) + chassis_reposition`
- Body includes: `Resolves: FU-059`

**PR 3 — Chassis-split helper + reposition API validation**
- `lib/routing/chassis-split.js` (new)
- `lib/validation/load-payload.js` (new)
- Wire validation into POST/PUT `/api/tenant/loads`
- Extend `tariff-engine` + `driver-tariff-engine` context builders
- Commit: `feat(foundation): chassis split detection + reposition validation`

**PR 4 — Event-status transition helper + API + cascade**
- `lib/routing/event-status-transition.js` (new)
- Wire into `PUT /api/tenant/loads/[id]/routing/events/[eventId]`
- Cascade on move completion in `lib/routing/moves/transition.js`
- Commit: `feat(foundation): routing event status transitions + history`

**PR 5 — Stop-off types CRUD API + rules-engine primitives**
- `pages/api/tenant/stop-off-types/*.js` (new)
- Rules engine: add `event.stop_off_type_id` + `event.stop_off_type.{flag}` operators
- Commit: `feat(foundation): stop-off types CRUD + rules engine primitives`

PRs 2-5 are independent and can land in any order after PR 1.

### Risks + mitigations

| Risk | Mitigation |
|---|---|
| Migration 100 backfill mis-derives `event_status` for historic events with odd timestamp patterns | Backfill is idempotent (`WHERE event_status = 'pending'`); rerun with corrected logic if needed. Verified against staging before prod. |
| FU-059 consolidation breaks a hardcoded `load_type` consumer not in the enumerated list | Exhaustive `Grep` during implementation; `dd-qa` cross-surface consistency catches drift |
| Cascade-on-move-completion auto-departs events a dispatcher wanted to review | History row tagged `actor_type='system'`, `note='cascaded from parent move completion'` — auditable + reversible. Future feature-spec setting can opt out per tenant. |
| `event_status` enum blocks schema changes later | `ALTER TYPE ... ADD VALUE` is online in Postgres — extensible without downtime. |
| Letter `'R'` for chassis_reposition collides with existing load type | Collision check in PR 2; pick next available letter (no DDL impact). |

## Follow-ups closed by this spec

- **[FU-059](../../../../memory/followups.md)** — Extract VALID_LOAD_TYPES / VALID_STATUSES / LOAD_TYPE_LETTER from loads/index.js (partial — closes the `LOAD_TYPES` + `LOAD_TYPE_LETTER` halves; `VALID_STATUSES` remains open for a separate consolidation)

## What ships after foundation

Two follow-up feature specs become independently buildable with no foundation refactor needed:

- **B.1f Stop-offs feature** — tenant-admin settings page, routing-tab picker, charge-profile rule types for stop-offs, driver-portal status transitions
- **B.1g Chassis splits feature** — chassis-owner schema on `equipment_chassis`, driver-portal chassis-# edit with permission gating (ref FU-077), split-aware driver pay rule types, split visual indicators in routing tab + dispatcher board

## Glossary

- **Stop-off** — A typed intermediate stop on a load (Fuel Stop, Scale, Driver Break, Chassis Exchange, etc.). Tenant-configured catalog.
- **Chassis split** — A load where the chassis is picked up or returned at a location different from the container terminal. Detected by non-null `hook_chassis_location_id` or `terminate_chassis_location_id`.
- **Chassis reposition** — A load whose only purpose is moving a chassis between terminals. No container. New `load_type = 'chassis_reposition'`.
- **Actor type** — Per B.1d convention, every state-change write declares origin: `'human'` (user action), `'system'` (automated), `'agent'` (LLM/AI agent, future).
- **Behavior flag** — Column on `stop_off_types` that drives downstream logic: `has_cargo_transfer`, `is_paid_to_driver`, `is_billable_to_customer`, `counts_toward_detention`, `requires_location_pick`.
