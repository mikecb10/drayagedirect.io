# Advanced Route Matching Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the Advanced Route Matching stub on both AR (load tariffs) and AP (driver tariffs) into a working feature — schema, UI, engine, scoring — so a tariff can define a specific route template (origin → waypoints → delivery) and only match loads whose `order_routing_events` exactly traverse that template.

**Architecture:** Two new child tables (`tariff_advanced_routes`, `driver_tariff_advanced_routes`) store a route template as a JSONB `moves` blob. A shared pure-function matcher `lib/advanced-route-matcher.js` normalizes both the load's routing and the template and does a structural compare. Shared UI components `AdvancedRouteBuilder` + `EventLocationPicker` render a 3-column route builder layout. Both engines import the same matcher and get a specificity `+1000` bump when a route matches.

**Tech Stack:** Next.js 15 (Pages Router), React 19, Tailwind v4, `@supabase/supabase-js`, `@dnd-kit/core` + `@dnd-kit/sortable` (already in the project). Zero new npm dependencies.

**Spec:** [docs/superpowers/specs/2026-04-17-advanced-route-matching-design.md](../specs/2026-04-17-advanced-route-matching-design.md)

---

## Hard rules (bake into every commit)

- **No new npm dependencies.** All primitives already exist in the project.
- **Every migration uses the mandatory wrapper**: `BEGIN; ... NOTIFY pgrst, 'reload schema'; COMMIT;` per `memory/dev_migration_template.md`. Run via Supabase SQL editor.
- **Every new component must include `dark:` variants** on every gray/white/border class per `memory/dev_dark_mode_convention.md`.
- **Event types are restricted** to the 9 lane-defining types already in `PALETTE_EVENT_TYPES` at [lib/routing-rules.js:148](../../../lib/routing-rules.js): `pull`, `pickup`, `drop`, `hook`, `deliver`, `return`, `hook_chassis`, `lift_off`, `terminate`. Operational types (`scale`, `wait`, `complete`) are excluded from the palette.
- **`location_match` object shape is stable**: always `{ mode, org_id, city, state, zip }`, with unused fields null. Don't branch on `if key in obj`.
- **Don't run `npm run build`** during implementation — it clobbers the running dev server's `.next/`. Verify via `git diff --staged` and runtime smoke tests.
- **Silent-insert rule** ([session_2026_04_15_recap.md memory](../../../)): every Supabase `.insert()` / `.update()` captures its error and bails with `500 + step:` on failure. No cheerful 200s that dropped data.
- **Don't commit `.superpowers/`** — already in `.gitignore`, but double-check before `git add -A`.

---

## File structure (target state)

```
supabase/migrations/
  ├─ 074_tariff_advanced_routes.sql           (NEW)
  └─ 075_driver_tariff_advanced_routes.sql    (NEW)

lib/
  ├─ advanced-route-matcher.js                (NEW, ~150 LoC)  pure matcher + normalizer
  ├─ tariff-engine.js                         (modified)        import matcher, add branch + bonus
  └─ driver-tariff-engine.js                  (modified)        import matcher, add branch + bonus

scripts/
  └─ test-advanced-route-matcher.js           (NEW, ~200 LoC)  node smoke script

components/settings/shared/                    (NEW directory)
  ├─ EventLocationPicker.js                   (NEW, ~120 LoC)  4-mode location picker
  └─ AdvancedRouteBuilder.js                  (NEW, ~250 LoC)  palette + moves list + per-event rows

components/settings/tariff-detail/
  ├─ TariffAdvancedRoutePanel.js              (NEW, ~30 LoC)   thin AR wrapper
  └─ TariffMatchingPanel.js                   (modified)        hide pickup/delivery/return when advanced

components/settings/driver-tariff-detail/
  ├─ DriverTariffAdvancedRoutePanel.js        (NEW, ~30 LoC)   thin AP wrapper
  └─ DriverTariffMatchingPanel.js             (modified)        hide pickup/delivery/return when advanced

pages/settings/tariffs/[id].js                (modified)        load/save advanced_route, switch layout
pages/settings/driver-tariffs/[id].js         (modified)        load/save advanced_route, switch layout

pages/api/tenant/tariffs/[id].js              (modified)        nest advanced_route in GET, upsert on PUT
pages/api/tenant/tariffs/index.js             (modified)        upsert advanced_route on POST
pages/api/tenant/ap/tariffs/[id].js           (modified)        mirror
pages/api/tenant/ap/tariffs/index.js          (modified)        mirror
```

---

## Phase 1: Schema migrations

Two atomic migrations. Run each via Supabase SQL editor.

### Task 1.1: Create AR migration `074_tariff_advanced_routes.sql`

**Files:**
- Create: `supabase/migrations/074_tariff_advanced_routes.sql`

- [ ] **Step 1: Write the migration file**

Create `supabase/migrations/074_tariff_advanced_routes.sql`:

```sql
-- ============================================================
-- Migration 074: tariff_advanced_routes
-- ============================================================
-- Advanced Route Matching (AR side). Stores a per-tariff route
-- template (moves + events + per-event location match) that the
-- tariff engine compares against a load's order_routing_events.
-- See docs/superpowers/specs/2026-04-17-advanced-route-matching-design.md
-- ============================================================

BEGIN;

CREATE TABLE IF NOT EXISTS tariff_advanced_routes (
  id                   UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id            UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  tariff_id            UUID NOT NULL REFERENCES tariffs(id) ON DELETE CASCADE,
  routing_template_id  UUID REFERENCES routing_templates(id),
  moves                JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tariff_id)
);

CREATE INDEX IF NOT EXISTS idx_tariff_advanced_routes_tenant
  ON tariff_advanced_routes(tenant_id);
CREATE INDEX IF NOT EXISTS idx_tariff_advanced_routes_tariff
  ON tariff_advanced_routes(tariff_id);

ALTER TABLE tariff_advanced_routes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tariff_advanced_routes_select ON tariff_advanced_routes;
CREATE POLICY tariff_advanced_routes_select ON tariff_advanced_routes FOR SELECT
  USING (tenant_id::text = current_setting('request.jwt.claims', true)::json ->> 'tenant_id');

DROP POLICY IF EXISTS tariff_advanced_routes_insert ON tariff_advanced_routes;
CREATE POLICY tariff_advanced_routes_insert ON tariff_advanced_routes FOR INSERT
  WITH CHECK (tenant_id::text = current_setting('request.jwt.claims', true)::json ->> 'tenant_id');

DROP POLICY IF EXISTS tariff_advanced_routes_update ON tariff_advanced_routes;
CREATE POLICY tariff_advanced_routes_update ON tariff_advanced_routes FOR UPDATE
  USING (tenant_id::text = current_setting('request.jwt.claims', true)::json ->> 'tenant_id');

DROP POLICY IF EXISTS tariff_advanced_routes_delete ON tariff_advanced_routes;
CREATE POLICY tariff_advanced_routes_delete ON tariff_advanced_routes FOR DELETE
  USING (tenant_id::text = current_setting('request.jwt.claims', true)::json ->> 'tenant_id');

NOTIFY pgrst, 'reload schema';

COMMIT;
```

- [ ] **Step 2: Apply the migration**

User action: open Supabase SQL editor, paste the file contents, run. Confirm success: "Success. No rows returned."

- [ ] **Step 3: Verify the table exists**

In the Supabase SQL editor:

```sql
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'tariff_advanced_routes'
ORDER BY ordinal_position;
```

Expected: 7 rows — `id` uuid NO, `tenant_id` uuid NO, `tariff_id` uuid NO, `routing_template_id` uuid YES, `moves` jsonb NO, `created_at` timestamptz NO, `updated_at` timestamptz NO.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/074_tariff_advanced_routes.sql
git commit -m "$(cat <<'EOF'
feat(advanced-route): add tariff_advanced_routes table

New child table storing the per-tariff route template (moves JSONB)
for Advanced Route Matching on the AR side. RLS + UNIQUE (tariff_id).
Matcher in lib/advanced-route-matcher.js will consume the moves blob.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

### Task 1.2: Create AP migration `075_driver_tariff_advanced_routes.sql`

**Files:**
- Create: `supabase/migrations/075_driver_tariff_advanced_routes.sql`

- [ ] **Step 1: Write the migration file**

Create `supabase/migrations/075_driver_tariff_advanced_routes.sql`:

```sql
-- ============================================================
-- Migration 075: driver_tariff_advanced_routes
-- ============================================================
-- Advanced Route Matching (AP side). Mirror of tariff_advanced_routes
-- but FK'd to driver_tariffs(id). Consumed by the same shared matcher
-- (lib/advanced-route-matcher.js).
-- See docs/superpowers/specs/2026-04-17-advanced-route-matching-design.md
-- ============================================================

BEGIN;

CREATE TABLE IF NOT EXISTS driver_tariff_advanced_routes (
  id                   UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id            UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  driver_tariff_id     UUID NOT NULL REFERENCES driver_tariffs(id) ON DELETE CASCADE,
  routing_template_id  UUID REFERENCES routing_templates(id),
  moves                JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (driver_tariff_id)
);

CREATE INDEX IF NOT EXISTS idx_driver_tariff_advanced_routes_tenant
  ON driver_tariff_advanced_routes(tenant_id);
CREATE INDEX IF NOT EXISTS idx_driver_tariff_advanced_routes_tariff
  ON driver_tariff_advanced_routes(driver_tariff_id);

ALTER TABLE driver_tariff_advanced_routes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS driver_tariff_advanced_routes_select ON driver_tariff_advanced_routes;
CREATE POLICY driver_tariff_advanced_routes_select ON driver_tariff_advanced_routes FOR SELECT
  USING (tenant_id::text = current_setting('request.jwt.claims', true)::json ->> 'tenant_id');

DROP POLICY IF EXISTS driver_tariff_advanced_routes_insert ON driver_tariff_advanced_routes;
CREATE POLICY driver_tariff_advanced_routes_insert ON driver_tariff_advanced_routes FOR INSERT
  WITH CHECK (tenant_id::text = current_setting('request.jwt.claims', true)::json ->> 'tenant_id');

DROP POLICY IF EXISTS driver_tariff_advanced_routes_update ON driver_tariff_advanced_routes;
CREATE POLICY driver_tariff_advanced_routes_update ON driver_tariff_advanced_routes FOR UPDATE
  USING (tenant_id::text = current_setting('request.jwt.claims', true)::json ->> 'tenant_id');

DROP POLICY IF EXISTS driver_tariff_advanced_routes_delete ON driver_tariff_advanced_routes;
CREATE POLICY driver_tariff_advanced_routes_delete ON driver_tariff_advanced_routes FOR DELETE
  USING (tenant_id::text = current_setting('request.jwt.claims', true)::json ->> 'tenant_id');

NOTIFY pgrst, 'reload schema';

COMMIT;
```

- [ ] **Step 2: Apply the migration**

User action: paste into Supabase SQL editor, run.

- [ ] **Step 3: Verify the table exists**

```sql
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'driver_tariff_advanced_routes'
ORDER BY ordinal_position;
```

Expected: 7 rows — identical to Task 1.1 Step 3 with `driver_tariff_id` instead of `tariff_id`.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/075_driver_tariff_advanced_routes.sql
git commit -m "$(cat <<'EOF'
feat(advanced-route): add driver_tariff_advanced_routes table

AP-side mirror of tariff_advanced_routes. Same JSONB moves shape,
consumed by the same shared matcher. RLS + UNIQUE (driver_tariff_id).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase 2: Shared matcher library

Pure logic, no DB. Build + smoke-test before any UI or engine integration.

### Task 2.1: Create `lib/advanced-route-matcher.js` with constants + normalizer

**Files:**
- Create: `lib/advanced-route-matcher.js`

- [ ] **Step 1: Create the file with constants + `normalizeLoadRouting`**

Write `lib/advanced-route-matcher.js`:

```js
/**
 * Advanced Route Matcher — shared pure logic used by both the AR
 * tariff engine (lib/tariff-engine.js) and the AP driver tariff
 * engine (lib/driver-tariff-engine.js).
 *
 * A tariff with matching_mode === 'advanced_route' carries a route
 * template (moves JSONB) that describes a specific lane. This matcher
 * decides whether a load's order_routing_events align with that
 * template, exactly (after stripping operational events).
 *
 * See docs/superpowers/specs/2026-04-17-advanced-route-matching-design.md.
 */

// Event types that affect matching. These are lane-defining — they
// describe where the container physically is. Mirrors
// PALETTE_EVENT_TYPES in lib/routing-rules.js but excludes the
// operational types below.
export const LANE_DEFINING_EVENT_TYPES = [
  'pull', 'pickup', 'drop', 'hook', 'deliver', 'return',
  'hook_chassis', 'lift_off', 'terminate',
];

// Event types stripped before structural compare. These happen
// mid-execution and don't change the physical lane — a scale stop
// or a wait shouldn't de-price a load.
const OPERATIONAL_EVENT_TYPES = new Set([
  'scale', 'wait', 'complete', 'notes',
]);

/**
 * Normalize a load's routing into a move-grouped, sequence-ordered
 * tree with operational events stripped. Result:
 *   [{ events: [{ event_type, location_id, city, state, zip }, ...] }, ...]
 *
 * Empty moves (those whose events were all operational) are dropped
 * so they don't inflate the move count during structural compare.
 *
 * @param {Array} routingEvents — flat list of order_routing_events rows
 * @param {Array} containerMoves — flat list of order_container_moves rows (for ordering)
 * @returns {Array<{ events: Array }>}
 */
export function normalizeLoadRouting(routingEvents, containerMoves) {
  if (!Array.isArray(routingEvents) || routingEvents.length === 0) return [];

  const sortedMoves = [...(containerMoves || [])]
    .sort((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0));

  const result = [];
  for (const move of sortedMoves) {
    const events = routingEvents
      .filter((e) => e.move_id === move.id)
      .filter((e) => !OPERATIONAL_EVENT_TYPES.has(e.event_type))
      .sort((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0))
      .map((e) => ({
        event_type: e.event_type,
        location_id: e.location_id || null,
        city: e.city || null,
        state: e.state || null,
        zip: e.zip || null,
      }));
    if (events.length > 0) {
      result.push({ events });
    }
  }
  return result;
}
```

- [ ] **Step 2: Commit**

```bash
git add lib/advanced-route-matcher.js
git commit -m "$(cat <<'EOF'
feat(advanced-route): add matcher skeleton + normalizeLoadRouting

First chunk of the shared advanced-route matcher. Constants for
lane-defining vs operational event types, and the load-side
normalizer that strips operational events and drops empty moves.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

### Task 2.2: Add `matchLocation` to the matcher

**Files:**
- Modify: `lib/advanced-route-matcher.js`

- [ ] **Step 1: Append `matchLocation` to the file**

Add to the bottom of `lib/advanced-route-matcher.js`:

```js
/**
 * Compare one load event's location against one template event's
 * location_match specifier.
 *
 * @param {object} loadEvent — normalized { location_id, city, state, zip }
 * @param {object} match — template { mode, org_id, city, state, zip }
 * @returns {boolean}
 */
export function matchLocation(loadEvent, match) {
  if (!match || !match.mode) return false;
  switch (match.mode) {
    case 'specific':
      if (!match.org_id || !loadEvent.location_id) return false;
      return loadEvent.location_id === match.org_id;

    case 'city_state': {
      if (!match.city || !match.state) return false;
      if (!loadEvent.city || !loadEvent.state) return false;
      const cityEq = loadEvent.city.trim().toLowerCase() === match.city.trim().toLowerCase();
      const stateEq = loadEvent.state.toUpperCase() === match.state.toUpperCase();
      return cityEq && stateEq;
    }

    case 'state':
      if (!match.state) return false;
      if (!loadEvent.state) return false;
      return loadEvent.state.toUpperCase() === match.state.toUpperCase();

    case 'zip':
      if (!match.zip || !loadEvent.zip) return false;
      return loadEvent.zip === match.zip;

    default:
      return false;
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add lib/advanced-route-matcher.js
git commit -m "$(cat <<'EOF'
feat(advanced-route): add matchLocation for 4 specificity modes

Pure compare for specific / city_state / state / zip. Case-insensitive
state + city (with trim on city); exact zip; equality on location_id
for specific mode. Defensive nulls → false, never throw.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

### Task 2.3: Add `matchesAdvancedRoute` entry point

**Files:**
- Modify: `lib/advanced-route-matcher.js`

- [ ] **Step 1: Append `matchesAdvancedRoute` to the file**

Add to the bottom of `lib/advanced-route-matcher.js`:

```js
/**
 * Does a load's routing align with a tariff's advanced route template?
 *
 * Structural, exact match after normalization:
 *   - same move count
 *   - same event count per move
 *   - same event_type per position
 *   - location match per event (per the template's mode)
 *
 * @param {object} advancedRoute — { moves: [{ events: [...] }, ...] } row
 * @param {object} load — must include routing_events + container_moves arrays
 * @returns {boolean}
 */
export function matchesAdvancedRoute(advancedRoute, load) {
  if (!advancedRoute || !Array.isArray(advancedRoute.moves)) return false;
  const template = advancedRoute.moves;
  if (template.length === 0) return false;

  const loadMoves = normalizeLoadRouting(
    load?.routing_events || [],
    load?.container_moves || [],
  );

  if (loadMoves.length !== template.length) return false;

  for (let mi = 0; mi < template.length; mi++) {
    const tMove = template[mi];
    const lMove = loadMoves[mi];
    const tEvents = Array.isArray(tMove.events) ? tMove.events : [];
    const lEvents = lMove.events || [];

    if (lEvents.length !== tEvents.length) return false;

    for (let ei = 0; ei < tEvents.length; ei++) {
      const tEv = tEvents[ei];
      const lEv = lEvents[ei];
      if (tEv.event_type !== lEv.event_type) return false;
      if (!matchLocation(lEv, tEv.location_match)) return false;
    }
  }

  return true;
}
```

- [ ] **Step 2: Commit**

```bash
git add lib/advanced-route-matcher.js
git commit -m "$(cat <<'EOF'
feat(advanced-route): add matchesAdvancedRoute entry point

Structural compare of the normalized load routing against the tariff
template. Returns false on any mismatch — move count, event count,
event_type at any position, or location_match failing for any event.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

### Task 2.4: Write smoke-test script `scripts/test-advanced-route-matcher.js`

**Files:**
- Create: `scripts/test-advanced-route-matcher.js`

This is a runnable-via-`node` smoke script since the project has no Jest/Vitest. It exercises the matcher with hardcoded fixtures and exits 1 on the first failed assertion.

- [ ] **Step 1: Create the scripts directory and the test script**

Create `scripts/test-advanced-route-matcher.js`:

```js
/**
 * Smoke test for lib/advanced-route-matcher.js.
 *
 * Run with:
 *   node scripts/test-advanced-route-matcher.js
 *
 * Exits 1 on first failed assertion. Exits 0 with "All tests passed"
 * on success. No dependencies — just ESM import + console.assert-ish
 * logic.
 */

import assert from 'node:assert/strict';
import {
  matchesAdvancedRoute,
  matchLocation,
  normalizeLoadRouting,
  LANE_DEFINING_EVENT_TYPES,
} from '../lib/advanced-route-matcher.js';

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failed++;
    console.log(`  ✗ ${name}`);
    console.log(`    ${e.message}`);
  }
}

console.log('\n--- LANE_DEFINING_EVENT_TYPES ---');
test('includes 9 types, excludes operational', () => {
  assert.deepEqual([...LANE_DEFINING_EVENT_TYPES].sort(), [
    'deliver', 'drop', 'hook', 'hook_chassis', 'lift_off',
    'pickup', 'pull', 'return', 'terminate',
  ]);
});

console.log('\n--- normalizeLoadRouting ---');
test('empty inputs return []', () => {
  assert.deepEqual(normalizeLoadRouting([], []), []);
  assert.deepEqual(normalizeLoadRouting(null, null), []);
});

test('strips operational events from moves', () => {
  const moves = [{ id: 'm1', sequence: 0 }];
  const events = [
    { move_id: 'm1', sequence: 0, event_type: 'pull', location_id: 'o1', city: 'LA', state: 'CA', zip: '90001' },
    { move_id: 'm1', sequence: 1, event_type: 'scale',  location_id: null, city: null, state: null, zip: null },
    { move_id: 'm1', sequence: 2, event_type: 'deliver', location_id: 'o2', city: 'Chicago', state: 'IL', zip: '60601' },
  ];
  const out = normalizeLoadRouting(events, moves);
  assert.equal(out.length, 1);
  assert.equal(out[0].events.length, 2);
  assert.equal(out[0].events[0].event_type, 'pull');
  assert.equal(out[0].events[1].event_type, 'deliver');
});

test('drops moves that become empty after stripping', () => {
  const moves = [
    { id: 'm1', sequence: 0 },
    { id: 'm2', sequence: 1 }, // only has scale events — should be dropped
    { id: 'm3', sequence: 2 },
  ];
  const events = [
    { move_id: 'm1', sequence: 0, event_type: 'pull', location_id: 'o1' },
    { move_id: 'm1', sequence: 1, event_type: 'drop', location_id: 'o2' },
    { move_id: 'm2', sequence: 0, event_type: 'scale', location_id: null },
    { move_id: 'm3', sequence: 0, event_type: 'hook', location_id: 'o2' },
    { move_id: 'm3', sequence: 1, event_type: 'deliver', location_id: 'o3' },
  ];
  const out = normalizeLoadRouting(events, moves);
  assert.equal(out.length, 2);
  assert.equal(out[0].events[0].event_type, 'pull');
  assert.equal(out[1].events[0].event_type, 'hook');
});

console.log('\n--- matchLocation ---');
test('specific: matches on equal org_id', () => {
  const m = { mode: 'specific', org_id: 'abc' };
  assert.equal(matchLocation({ location_id: 'abc' }, m), true);
  assert.equal(matchLocation({ location_id: 'xyz' }, m), false);
  assert.equal(matchLocation({ location_id: null }, m), false);
});

test('city_state: case-insensitive + trim', () => {
  const m = { mode: 'city_state', city: 'Dallas', state: 'TX' };
  assert.equal(matchLocation({ city: 'dallas',   state: 'tx' }, m), true);
  assert.equal(matchLocation({ city: '  Dallas ', state: 'TX' }, m), true);
  assert.equal(matchLocation({ city: 'Houston',  state: 'TX' }, m), false);
  assert.equal(matchLocation({ city: 'Dallas',   state: 'AR' }, m), false);
  assert.equal(matchLocation({ city: null,       state: 'TX' }, m), false);
});

test('state: case-insensitive', () => {
  const m = { mode: 'state', state: 'TX' };
  assert.equal(matchLocation({ state: 'tx' }, m), true);
  assert.equal(matchLocation({ state: 'TX' }, m), true);
  assert.equal(matchLocation({ state: 'AR' }, m), false);
  assert.equal(matchLocation({ state: null }, m), false);
});

test('zip: exact', () => {
  const m = { mode: 'zip', zip: '75201' };
  assert.equal(matchLocation({ zip: '75201' }, m), true);
  assert.equal(matchLocation({ zip: '75202' }, m), false);
  assert.equal(matchLocation({ zip: null }, m), false);
});

test('unknown mode returns false', () => {
  assert.equal(matchLocation({ location_id: 'x' }, { mode: 'radius' }), false);
  assert.equal(matchLocation({ location_id: 'x' }, null), false);
});

console.log('\n--- matchesAdvancedRoute ---');

const templateMove1 = {
  events: [
    {
      event_type: 'pull',
      location_match: { mode: 'specific', org_id: 'lax' },
    },
    {
      event_type: 'drop',
      location_match: { mode: 'city_state', city: 'Dallas', state: 'TX' },
    },
  ],
};
const templateMove2 = {
  events: [
    {
      event_type: 'hook',
      location_match: { mode: 'city_state', city: 'Dallas', state: 'TX' },
    },
    {
      event_type: 'deliver',
      location_match: { mode: 'specific', org_id: 'acme' },
    },
    {
      event_type: 'return',
      location_match: { mode: 'specific', org_id: 'lax' },
    },
  ],
};
const template = { moves: [templateMove1, templateMove2] };

function makeLoad(opts = {}) {
  return {
    container_moves: [
      { id: 'm1', sequence: 0 },
      { id: 'm2', sequence: 1 },
    ],
    routing_events: [
      { move_id: 'm1', sequence: 0, event_type: 'pull',    location_id: 'lax',  city: 'Long Beach', state: 'CA', zip: '90802' },
      { move_id: 'm1', sequence: 1, event_type: 'drop',    location_id: 'pilot',city: 'Dallas',      state: 'TX', zip: '75201' },
      { move_id: 'm2', sequence: 0, event_type: 'hook',    location_id: 'pilot',city: 'Dallas',      state: 'TX', zip: '75201' },
      { move_id: 'm2', sequence: 1, event_type: 'deliver', location_id: 'acme', city: 'Chicago',     state: 'IL', zip: '60601' },
      { move_id: 'm2', sequence: 2, event_type: 'return',  location_id: 'lax',  city: 'Long Beach',  state: 'CA', zip: '90802' },
    ],
    ...opts,
  };
}

test('matching load passes', () => {
  assert.equal(matchesAdvancedRoute(template, makeLoad()), true);
});

test('empty template returns false', () => {
  assert.equal(matchesAdvancedRoute({ moves: [] }, makeLoad()), false);
  assert.equal(matchesAdvancedRoute(null, makeLoad()), false);
});

test('load with no routing events returns false', () => {
  assert.equal(matchesAdvancedRoute(template, { routing_events: [], container_moves: [] }), false);
});

test('wrong move count returns false', () => {
  const load = makeLoad();
  // Remove move 2
  load.container_moves = load.container_moves.slice(0, 1);
  load.routing_events = load.routing_events.filter((e) => e.move_id === 'm1');
  assert.equal(matchesAdvancedRoute(template, load), false);
});

test('wrong event_type at a position returns false', () => {
  const load = makeLoad();
  load.routing_events[0].event_type = 'pickup'; // was 'pull'
  assert.equal(matchesAdvancedRoute(template, load), false);
});

test('wrong city for city_state waypoint returns false', () => {
  const load = makeLoad();
  load.routing_events[1].city = 'Memphis'; // was 'Dallas'
  load.routing_events[1].state = 'TN';     // was 'TX'
  load.routing_events[2].city = 'Memphis';
  load.routing_events[2].state = 'TN';
  assert.equal(matchesAdvancedRoute(template, load), false);
});

test('wrong org for specific waypoint returns false', () => {
  const load = makeLoad();
  load.routing_events[3].location_id = 'other_customer'; // was 'acme'
  assert.equal(matchesAdvancedRoute(template, load), false);
});

test('scale stop mid-move does not break match', () => {
  const load = makeLoad();
  // Insert a scale event between pull and drop
  load.routing_events.splice(1, 0, {
    move_id: 'm1', sequence: 0.5, event_type: 'scale',
    location_id: null, city: null, state: null, zip: null,
  });
  assert.equal(matchesAdvancedRoute(template, load), true);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
console.log('All tests passed');
```

- [ ] **Step 2: Run the smoke script**

Run:

```bash
node scripts/test-advanced-route-matcher.js
```

Expected: `All tests passed` at the end; exit code 0. If any test fails, read the mismatch message, fix the matcher (or the test fixture if the test itself is wrong), and re-run.

- [ ] **Step 3: Commit**

```bash
git add scripts/test-advanced-route-matcher.js
git commit -m "$(cat <<'EOF'
test(advanced-route): add smoke script for matcher

Runnable via node — no Jest/Vitest dependency. Exercises
normalizeLoadRouting, matchLocation (all 4 modes), and
matchesAdvancedRoute (happy + 7 fail/edge cases incl. scale-stop
tolerance). Exit 1 on first failure.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase 3: Shared UI components

Two new components in `components/settings/shared/`. Built before either side's page integration so both sides use the exact same primitives.

### Task 3.1: Create `EventLocationPicker`

**Files:**
- Create: `components/settings/shared/EventLocationPicker.js`

- [ ] **Step 1: Create the directory**

```bash
mkdir -p components/settings/shared
```

- [ ] **Step 2: Write the component**

Create `components/settings/shared/EventLocationPicker.js`:

```jsx
import { useState } from 'react';
import OrgPicker from '../../ui/OrgPicker';

/**
 * EventLocationPicker — per-event location match picker for the
 * advanced-route builder.
 *
 * Four modes (mirrors the spec's location_match.mode enum):
 *   - specific    → OrgPicker (scoped by orgType prop)
 *   - city_state  → city text input + state dropdown
 *   - state       → state dropdown
 *   - zip         → zip text input
 *
 * Value shape (stable across modes — unused fields null):
 *   { mode, org_id, city, state, zip }
 *
 * Emits onChange(nextValue) with that full shape on any edit.
 * Switching modes clears the other fields so stale data doesn't
 * persist into a saved template.
 */

const MODES = [
  { key: 'specific',   label: 'Specific' },
  { key: 'city_state', label: 'City + State' },
  { key: 'state',      label: 'State' },
  { key: 'zip',        label: 'Zip' },
];

const US_STATES = [
  'AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA',
  'KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ',
  'NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT',
  'VA','WA','WV','WI','WY','DC',
];

const EMPTY_VALUE = {
  mode: 'specific',
  org_id: null,
  city: null,
  state: null,
  zip: null,
};

function normalizeForMode(mode) {
  return { ...EMPTY_VALUE, mode };
}

export default function EventLocationPicker({ value, onChange, orgType = 'customer' }) {
  const v = value && value.mode ? value : EMPTY_VALUE;
  const [orgLabel, setOrgLabel] = useState('');

  function setMode(nextMode) {
    if (nextMode === v.mode) return;
    onChange(normalizeForMode(nextMode));
    setOrgLabel('');
  }

  function setField(field, fieldValue) {
    onChange({ ...v, [field]: fieldValue });
  }

  return (
    <div className="flex-1">
      <div className="flex items-center gap-1.5 mb-2 flex-wrap">
        {MODES.map((m) => (
          <button
            key={m.key}
            type="button"
            onClick={() => setMode(m.key)}
            className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${
              v.mode === m.key
                ? 'bg-blue-600 text-white'
                : 'bg-gray-100 dark:bg-slate-800 text-gray-600 dark:text-slate-300 hover:bg-gray-200 dark:hover:bg-slate-700'
            }`}
          >
            {m.label}
          </button>
        ))}
      </div>

      {v.mode === 'specific' && (
        <OrgPicker
          type={orgType}
          placeholder={`Add ${orgType}...`}
          value={v.org_id ? { id: v.org_id, name: orgLabel || v.org_id.slice(0, 8) } : null}
          onChange={(org) => {
            if (org) {
              setField('org_id', org.id);
              setOrgLabel(org.name);
            } else {
              setField('org_id', null);
              setOrgLabel('');
            }
          }}
        />
      )}

      {v.mode === 'city_state' && (
        <div className="flex gap-2">
          <input
            type="text"
            value={v.city || ''}
            onChange={(e) => setField('city', e.target.value || null)}
            placeholder="City"
            className="flex-1 rounded-lg border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-900 px-3 py-2 text-sm focus:outline-none focus:border-blue-500 text-gray-900 dark:text-slate-100"
          />
          <select
            value={v.state || ''}
            onChange={(e) => setField('state', e.target.value || null)}
            className="w-24 rounded-lg border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-900 px-2 py-2 text-sm focus:outline-none focus:border-blue-500 text-gray-900 dark:text-slate-100"
          >
            <option value="">State</option>
            {US_STATES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
      )}

      {v.mode === 'state' && (
        <select
          value={v.state || ''}
          onChange={(e) => setField('state', e.target.value || null)}
          className="w-full rounded-lg border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-900 px-3 py-2 text-sm focus:outline-none focus:border-blue-500 text-gray-900 dark:text-slate-100"
        >
          <option value="">Select a state</option>
          {US_STATES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      )}

      {v.mode === 'zip' && (
        <input
          type="text"
          value={v.zip || ''}
          onChange={(e) => setField('zip', e.target.value || null)}
          placeholder="Zip code"
          pattern="\d{5}(-\d{4})?"
          className="w-full rounded-lg border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-900 px-3 py-2 text-sm focus:outline-none focus:border-blue-500 text-gray-900 dark:text-slate-100"
        />
      )}
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add components/settings/shared/EventLocationPicker.js
git commit -m "$(cat <<'EOF'
feat(advanced-route): add EventLocationPicker component

Per-event 4-mode location picker (specific / city_state / state / zip)
for the advanced-route builder. Emits the stable { mode, org_id,
city, state, zip } shape. Mode switch clears other fields to avoid
stale data. Dark-mode classes on every surface per convention.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

### Task 3.2: Create `AdvancedRouteBuilder`

**Files:**
- Create: `components/settings/shared/AdvancedRouteBuilder.js`

- [ ] **Step 1: Write the component**

Create `components/settings/shared/AdvancedRouteBuilder.js`:

```jsx
import { useEffect, useState } from 'react';
import { Plus, Trash2, GripVertical } from 'lucide-react';
import EventLocationPicker from './EventLocationPicker';

/**
 * AdvancedRouteBuilder — owns columns 2 and 3 of the advanced-mode
 * tariff layout (see the design spec § UI).
 *
 * Props:
 *   value             — advancedRoute shape: { moves, routing_template_id }
 *   onChange(next)    — emits the full value object on any edit
 *   routingTemplates  — list of system + tenant routing_templates (for picker)
 *
 * moves shape (spec): [{ sequence, events: [{ sequence, event_type,
 *   location_match: { mode, org_id, city, state, zip } }] }]
 *
 * Drag-drop is intentionally simple (click-to-add + reorder buttons)
 * for the first cut rather than @dnd-kit. The routing tab's complex
 * split-move / auto-restructure logic isn't needed here — a tariff
 * template never progresses, so we don't need palette-to-move drop
 * zones. Users click to append and use up/down to reorder.
 */

// Mirrors PALETTE_EVENT_TYPES (lib/routing-rules.js) minus operational.
const PALETTE = [
  { type: 'hook_chassis', label: 'Hook Chassis' },
  { type: 'pickup',       label: 'Pick Up Container' },
  { type: 'pull',         label: 'Pull from Terminal' },
  { type: 'deliver',      label: 'Deliver Container' },
  { type: 'return',       label: 'Return Container' },
  { type: 'drop',         label: 'Drop Container' },
  { type: 'hook',         label: 'Hook Container' },
  { type: 'lift_off',     label: 'Lift Off' },
  { type: 'terminate',    label: 'Terminate Chassis' },
];

function emptyLocationMatch() {
  return { mode: 'specific', org_id: null, city: null, state: null, zip: null };
}

function orgTypeForEvent(eventType) {
  if (eventType === 'pull' || eventType === 'return') return 'terminal';
  if (eventType === 'deliver') return 'warehouse';
  return 'customer';
}

export default function AdvancedRouteBuilder({ value, onChange, routingTemplates = [] }) {
  const moves = Array.isArray(value?.moves) ? value.moves : [];
  const templateId = value?.routing_template_id || null;

  function emit(nextMoves, nextTemplateId) {
    onChange({
      ...(value || {}),
      moves: nextMoves,
      routing_template_id: nextTemplateId !== undefined ? nextTemplateId : templateId,
    });
  }

  function onPickTemplate(newTemplateId) {
    const tpl = routingTemplates.find((t) => t.id === newTemplateId);
    if (!tpl) {
      emit(moves, newTemplateId || null);
      return;
    }
    if (moves.length > 0 && !window.confirm('Replace the current route with this template?')) {
      return;
    }
    const seqEvents = Array.isArray(tpl.event_sequence) ? tpl.event_sequence : [];
    const seededEvents = seqEvents
      .filter((e) => PALETTE.some((p) => p.type === e.type))
      .map((e, i) => ({
        sequence: i,
        event_type: e.type,
        location_match: emptyLocationMatch(),
      }));
    const seededMoves = seededEvents.length > 0
      ? [{ sequence: 0, events: seededEvents }]
      : [];
    emit(seededMoves, newTemplateId);
  }

  function onAddMove() {
    emit([...moves, { sequence: moves.length, events: [] }]);
  }

  function onRemoveMove(mIdx) {
    const next = moves.filter((_, i) => i !== mIdx).map((m, i) => ({ ...m, sequence: i }));
    emit(next);
  }

  function onAppendEvent(mIdx, eventType) {
    const next = moves.map((m, i) => {
      if (i !== mIdx) return m;
      const nextEvents = [
        ...(m.events || []),
        { sequence: (m.events || []).length, event_type: eventType, location_match: emptyLocationMatch() },
      ];
      return { ...m, events: nextEvents };
    });
    emit(next);
  }

  function onRemoveEvent(mIdx, eIdx) {
    const next = moves.map((m, i) => {
      if (i !== mIdx) return m;
      const nextEvents = (m.events || [])
        .filter((_, j) => j !== eIdx)
        .map((e, j) => ({ ...e, sequence: j }));
      return { ...m, events: nextEvents };
    });
    emit(next);
  }

  function onUpdateEventLocation(mIdx, eIdx, locationMatch) {
    const next = moves.map((m, i) => {
      if (i !== mIdx) return m;
      const nextEvents = (m.events || []).map((e, j) =>
        j === eIdx ? { ...e, location_match: locationMatch } : e
      );
      return { ...m, events: nextEvents };
    });
    emit(next);
  }

  return (
    <div className="flex gap-3">
      {/* Column 2 — Route Conditions (template picker + palette) */}
      <div className="w-[260px] shrink-0 border border-gray-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-900">
        <div className="px-3 py-2 border-b border-gray-200 dark:border-slate-700 text-xs font-semibold text-gray-700 dark:text-slate-200">
          Route Conditions
        </div>
        <div className="p-3 space-y-3">
          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-slate-300 mb-1">Routing Template</label>
            <select
              value={templateId || ''}
              onChange={(e) => onPickTemplate(e.target.value || null)}
              className="w-full rounded-lg border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-900 px-2 py-1.5 text-xs text-gray-900 dark:text-slate-100"
            >
              <option value="">(none)</option>
              {routingTemplates.map((t) => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-slate-300 mb-1">Append Event To Move</label>
            <div className="text-[10px] text-gray-400 dark:text-slate-500 mb-2">Click an event, then the move it should append to.</div>
            <div className="space-y-1">
              {PALETTE.map((p) => (
                <AppendButton key={p.type} label={p.label} type={p.type} moves={moves} onAppend={onAppendEvent} />
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Column 3 — Container Moves */}
      <div className="flex-1 border border-gray-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-900">
        <div className="flex items-center justify-between px-3 py-2 border-b border-gray-200 dark:border-slate-700">
          <span className="text-xs font-semibold text-gray-700 dark:text-slate-200">Container Moves</span>
          <button
            type="button"
            onClick={onAddMove}
            className="inline-flex items-center gap-1 text-xs text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300"
          >
            <Plus className="w-3.5 h-3.5" />
            Add Move
          </button>
        </div>
        <div className="p-3 space-y-3">
          {moves.length === 0 ? (
            <div className="text-xs text-gray-400 dark:text-slate-500 py-8 text-center">
              Pick a routing template or click "Add Move" to start.
            </div>
          ) : (
            moves.map((m, mIdx) => (
              <MoveCard
                key={mIdx}
                index={mIdx}
                events={m.events || []}
                onRemove={() => onRemoveMove(mIdx)}
                onRemoveEvent={(eIdx) => onRemoveEvent(mIdx, eIdx)}
                onUpdateEventLocation={(eIdx, lm) => onUpdateEventLocation(mIdx, eIdx, lm)}
              />
            ))
          )}
        </div>
      </div>
    </div>
  );
}

function AppendButton({ label, type, moves, onAppend }) {
  const [expanded, setExpanded] = useState(false);
  if (moves.length === 0) {
    return (
      <button
        type="button"
        disabled
        className="w-full text-left text-xs px-2 py-1.5 rounded bg-gray-50 dark:bg-slate-950 text-gray-400 dark:text-slate-600 cursor-not-allowed"
        title="Add a move first"
      >
        {label}
      </button>
    );
  }
  if (moves.length === 1) {
    return (
      <button
        type="button"
        onClick={() => onAppend(0, type)}
        className="w-full text-left text-xs px-2 py-1.5 rounded bg-gray-50 dark:bg-slate-950 text-gray-700 dark:text-slate-200 hover:bg-blue-50 dark:hover:bg-blue-950"
      >
        {label}
      </button>
    );
  }
  return (
    <div>
      <button
        type="button"
        onClick={() => setExpanded((x) => !x)}
        className="w-full text-left text-xs px-2 py-1.5 rounded bg-gray-50 dark:bg-slate-950 text-gray-700 dark:text-slate-200 hover:bg-blue-50 dark:hover:bg-blue-950"
      >
        {label}
      </button>
      {expanded && (
        <div className="mt-1 ml-2 space-y-0.5">
          {moves.map((_, mIdx) => (
            <button
              key={mIdx}
              type="button"
              onClick={() => { onAppend(mIdx, type); setExpanded(false); }}
              className="block w-full text-left text-[11px] px-2 py-1 rounded text-gray-600 dark:text-slate-300 hover:bg-gray-100 dark:hover:bg-slate-800"
            >
              → Move {mIdx + 1}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function MoveCard({ index, events, onRemove, onRemoveEvent, onUpdateEventLocation }) {
  return (
    <div className="border border-gray-200 dark:border-slate-700 rounded-lg bg-gray-50/60 dark:bg-slate-900/60">
      <div className="flex items-center justify-between px-3 py-2 border-b border-gray-200 dark:border-slate-700">
        <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-gray-700 dark:text-slate-200">
          <GripVertical className="w-3.5 h-3.5 text-gray-300 dark:text-slate-600" />
          Container Move {index + 1}
        </span>
        <button
          type="button"
          onClick={onRemove}
          className="text-gray-400 dark:text-slate-500 hover:text-red-500"
          aria-label="Remove move"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>
      <div className="p-2 space-y-2">
        {events.length === 0 ? (
          <div className="text-[11px] text-gray-400 dark:text-slate-500 py-4 text-center">
            Append events from the Route Conditions palette.
          </div>
        ) : (
          events.map((e, eIdx) => (
            <div key={eIdx} className="flex items-start gap-2 bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded-lg p-2">
              <span className="inline-block text-[10px] font-bold uppercase tracking-wider text-gray-600 dark:text-slate-300 bg-gray-100 dark:bg-slate-800 px-2 py-1 rounded shrink-0 mt-1">
                {e.event_type}
              </span>
              <EventLocationPicker
                value={e.location_match}
                onChange={(lm) => onUpdateEventLocation(eIdx, lm)}
                orgType={orgTypeForEvent(e.event_type)}
              />
              <button
                type="button"
                onClick={() => onRemoveEvent(eIdx)}
                className="text-gray-400 dark:text-slate-500 hover:text-red-500 mt-1 shrink-0"
                aria-label="Remove event"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add components/settings/shared/AdvancedRouteBuilder.js
git commit -m "$(cat <<'EOF'
feat(advanced-route): add AdvancedRouteBuilder component

Owns columns 2 and 3 of the advanced-mode layout: Route Conditions
(template picker + append-event palette) and Container Moves (each
move card with its event rows and per-event EventLocationPicker).
Click-based append (simpler than @dnd-kit for a pure matcher) since
the template never progresses. Dark-mode classes throughout.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase 4: AR API

Extend the existing AR tariff GET/PUT/POST to nest + upsert the new `advanced_route` blob. Validation lives in a shared helper.

### Task 4.1: Add the advanced-route validation helper

**Files:**
- Create: `lib/advanced-route-validator.js`

- [ ] **Step 1: Write the validator**

Create `lib/advanced-route-validator.js`:

```js
/**
 * Server-side validation of a tariff's advanced_route payload before
 * upsert. Shared by AR (tariffs) and AP (driver_tariffs) endpoints.
 *
 * Accepts the { moves, routing_template_id } shape emitted by the
 * AdvancedRouteBuilder component. Returns { ok: true } or
 * { ok: false, error: string }.
 *
 * Rules mirror the spec § Save-time validation:
 *   - At least one move
 *   - At least 2 events total across all moves
 *   - Each event's event_type ∈ LANE_DEFINING_EVENT_TYPES
 *   - Each event's location_match.mode ∈ MODES
 *   - Required fields per mode are non-null
 */

import { LANE_DEFINING_EVENT_TYPES } from './advanced-route-matcher';

const MODES = ['specific', 'city_state', 'state', 'zip'];

export function validateAdvancedRoute(advancedRoute) {
  if (!advancedRoute) return { ok: true }; // nothing to validate — caller decides if required

  const moves = Array.isArray(advancedRoute.moves) ? advancedRoute.moves : null;
  if (!moves || moves.length === 0) {
    return { ok: false, error: 'Advanced route must have at least one move' };
  }

  let totalEvents = 0;
  for (let mi = 0; mi < moves.length; mi++) {
    const m = moves[mi];
    const events = Array.isArray(m.events) ? m.events : [];
    for (let ei = 0; ei < events.length; ei++) {
      const e = events[ei];
      if (!LANE_DEFINING_EVENT_TYPES.includes(e.event_type)) {
        return { ok: false, error: `Move ${mi + 1} event ${ei + 1}: invalid event_type "${e.event_type}"` };
      }
      const lm = e.location_match || {};
      if (!MODES.includes(lm.mode)) {
        return { ok: false, error: `Move ${mi + 1} event ${ei + 1}: invalid location_match mode "${lm.mode}"` };
      }
      if (lm.mode === 'specific' && !lm.org_id) {
        return { ok: false, error: `Move ${mi + 1} event ${ei + 1}: specific mode requires org_id` };
      }
      if (lm.mode === 'city_state' && (!lm.city || !lm.state)) {
        return { ok: false, error: `Move ${mi + 1} event ${ei + 1}: city_state mode requires city + state` };
      }
      if (lm.mode === 'state' && !lm.state) {
        return { ok: false, error: `Move ${mi + 1} event ${ei + 1}: state mode requires state` };
      }
      if (lm.mode === 'zip' && !lm.zip) {
        return { ok: false, error: `Move ${mi + 1} event ${ei + 1}: zip mode requires zip` };
      }
      totalEvents += 1;
    }
  }

  if (totalEvents < 2) {
    return { ok: false, error: 'Advanced route must have at least 2 events total' };
  }

  return { ok: true };
}
```

- [ ] **Step 2: Commit**

```bash
git add lib/advanced-route-validator.js
git commit -m "$(cat <<'EOF'
feat(advanced-route): add shared server-side validator

Used by both AR and AP endpoints before upserting tariff_advanced_routes
rows. Enforces: ≥1 move, ≥2 events total, event_type in
LANE_DEFINING_EVENT_TYPES, location_match.mode in enum, required
fields per mode. Returns structured { ok, error } for API error bodies.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

### Task 4.2: Extend AR GET to nest `advanced_route`

**Files:**
- Modify: `pages/api/tenant/tariffs/[id].js`

- [ ] **Step 1: Extend the GET select**

In `pages/api/tenant/tariffs/[id].js` around the GET handler at lines 35-55, update the select to include a nested join:

```js
  if (req.method === 'GET') {
    const { data, error } = await svc
      .from('tariffs')
      .select(`
        *,
        advanced_route:tariff_advanced_routes(
          id, routing_template_id, moves
        ),
        charge_sets:tariff_charge_sets(
          *,
          profiles:tariff_charge_set_profiles(
            *,
            charge_profile:charge_profiles(id, name, charge_name, unit_of_measure, tag, tags)
          ),
          items:tariff_charge_items(*),
          tags:tariff_charge_set_tags(*)
        )
      `)
      .eq('tenant_id', ctx.tenantId)
      .eq('id', id)
      .single();
    if (error || !data) return res.status(404).json({ error: 'Tariff not found' });

    // Supabase returns to-many joins as arrays even for UNIQUE FKs.
    // Collapse advanced_route to the single row (or null).
    if (Array.isArray(data.advanced_route)) {
      data.advanced_route = data.advanced_route[0] || null;
    }

    return res.status(200).json({ tariff: data });
  }
```

- [ ] **Step 2: Smoke-test the GET**

In a running dev server, visit an existing tariff in the UI (Settings → Load Tariffs → pick one → Edit). Open DevTools → Network, inspect the `/api/tenant/tariffs/<id>` GET response. Confirm the body has `tariff.advanced_route` = `null` (no row exists yet). No 500. No changed behavior visible yet in the UI.

- [ ] **Step 3: Commit**

```bash
git add pages/api/tenant/tariffs/[id].js
git commit -m "$(cat <<'EOF'
feat(advanced-route): nest advanced_route in AR tariff GET

Single-tariff GET now joins tariff_advanced_routes and returns it
nested on the response. Supabase returns to-many joins as arrays
even for UNIQUE FKs; we collapse to the single row. Existing
tariffs without a row see advanced_route === null.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

### Task 4.3: Extend AR PUT to upsert `advanced_route`

**Files:**
- Modify: `pages/api/tenant/tariffs/[id].js`

- [ ] **Step 1: Add validator import + upsert logic**

At the top of `pages/api/tenant/tariffs/[id].js`, add this import (after the existing imports):

```js
import { validateAdvancedRoute } from '../../../../lib/advanced-route-validator';
```

Then, inside the PUT handler, AFTER the existing `updates` loop and `tariffs.update` call (around line 86, just before `res.status(200).json({ tariff: data })`), add the advanced_route upsert block:

```js
    // Upsert advanced_route if present in the body. Accepts:
    //   advanced_route: null   → delete any existing row
    //   advanced_route: {...}  → upsert (validate first)
    //   advanced_route: undef  → no-op (caller didn't touch it)
    if ('advanced_route' in body) {
      const ar = body.advanced_route;
      if (ar === null) {
        const { error: delErr } = await svc.from('tariff_advanced_routes').delete()
          .eq('tariff_id', id).eq('tenant_id', ctx.tenantId);
        if (delErr) return res.status(500).json({ error: delErr.message, step: 'delete_advanced_route' });
      } else {
        const v = validateAdvancedRoute(ar);
        if (!v.ok) return res.status(400).json({ error: v.error, step: 'validate_advanced_route' });
        const { error: upErr } = await svc.from('tariff_advanced_routes').upsert({
          tenant_id: ctx.tenantId,
          tariff_id: id,
          routing_template_id: ar.routing_template_id || null,
          moves: ar.moves,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'tariff_id' });
        if (upErr) return res.status(500).json({ error: upErr.message, step: 'upsert_advanced_route' });
      }
    }
```

- [ ] **Step 2: Smoke-test the PUT**

With the dev server running, open an existing tariff in the UI. In the browser console:

```js
await fetch('/api/tenant/tariffs/<paste-tariff-id>', {
  method: 'PUT',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    advanced_route: {
      routing_template_id: null,
      moves: [{
        sequence: 0,
        events: [
          { sequence: 0, event_type: 'pull', location_match: { mode: 'state', org_id: null, city: null, state: 'CA', zip: null } },
          { sequence: 1, event_type: 'deliver', location_match: { mode: 'state', org_id: null, city: null, state: 'IL', zip: null } },
        ],
      }],
    },
  }),
}).then((r) => r.json()).then(console.log);
```

Expected: `{ tariff: { ... } }` with status 200. Then refetch the tariff (GET) and confirm `tariff.advanced_route` is non-null with the 2-event move.

Invalid payload check:

```js
await fetch('/api/tenant/tariffs/<paste-tariff-id>', {
  method: 'PUT',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ advanced_route: { moves: [] } }),
}).then((r) => r.json()).then(console.log);
```

Expected: `{ error: 'Advanced route must have at least one move', step: 'validate_advanced_route' }`, HTTP 400.

- [ ] **Step 3: Commit**

```bash
git add pages/api/tenant/tariffs/[id].js
git commit -m "$(cat <<'EOF'
feat(advanced-route): PUT can upsert/delete AR advanced_route

New advanced_route body key on the AR tariff PUT:
 - null → delete existing row
 - object → validate + upsert (onConflict tariff_id)
 - absent → no-op

Validation returns 400 with a specific step. Every Supabase call
captures its error and bails with 500 + step on failure — no
silent persistence drops.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

### Task 4.4: Extend AR POST (index) to accept `advanced_route` on create

**Files:**
- Modify: `pages/api/tenant/tariffs/index.js`

- [ ] **Step 1: Locate the POST handler**

Read `pages/api/tenant/tariffs/index.js` and find the POST handler that creates a new tariff. After it inserts the tariff row and gets back the new ID, add an advanced_route upsert.

- [ ] **Step 2: Add the upsert**

At the top of the file, add:

```js
import { validateAdvancedRoute } from '../../../../lib/advanced-route-validator';
```

Then, inside the POST handler, AFTER the tariff row has been inserted and `newTariff.id` is known (and ideally before charge-sets are inserted), add:

```js
    if (body.advanced_route) {
      const v = validateAdvancedRoute(body.advanced_route);
      if (!v.ok) return res.status(400).json({ error: v.error, step: 'validate_advanced_route' });
      const { error: arErr } = await svc.from('tariff_advanced_routes').insert({
        tenant_id: ctx.tenantId,
        tariff_id: newTariff.id,
        routing_template_id: body.advanced_route.routing_template_id || null,
        moves: body.advanced_route.moves,
      });
      if (arErr) return res.status(500).json({ error: arErr.message, step: 'insert_advanced_route' });
    }
```

Adapt the local variable name if the existing POST uses something other than `newTariff`.

- [ ] **Step 3: Smoke-test**

Create a new tariff in the UI with Advanced mode and confirm the advanced_route row persists. Re-open it, confirm moves/events round-trip.

- [ ] **Step 4: Commit**

```bash
git add pages/api/tenant/tariffs/index.js
git commit -m "$(cat <<'EOF'
feat(advanced-route): POST can create AR advanced_route alongside tariff

When the create-tariff body includes advanced_route, validate + insert
the row in the same request. Keeps the client's "save the whole form
at once" flow working.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase 5: AR page integration

### Task 5.1: Create `TariffAdvancedRoutePanel` wrapper

**Files:**
- Create: `components/settings/tariff-detail/TariffAdvancedRoutePanel.js`

- [ ] **Step 1: Write the wrapper**

Create `components/settings/tariff-detail/TariffAdvancedRoutePanel.js`:

```jsx
import AdvancedRouteBuilder from '../shared/AdvancedRouteBuilder';

/**
 * TariffAdvancedRoutePanel — thin AR wrapper around the shared
 * AdvancedRouteBuilder. Exists so the AR page imports a route-
 * specific symbol even if the underlying component is shared.
 *
 * Mirror on the AP side: DriverTariffAdvancedRoutePanel.
 */
export default function TariffAdvancedRoutePanel({ value, onChange, routingTemplates }) {
  return (
    <AdvancedRouteBuilder
      value={value}
      onChange={onChange}
      routingTemplates={routingTemplates}
    />
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add components/settings/tariff-detail/TariffAdvancedRoutePanel.js
git commit -m "$(cat <<'EOF'
feat(advanced-route): add TariffAdvancedRoutePanel AR wrapper

Thin re-export of the shared AdvancedRouteBuilder so the AR page
has a semantic import path. Mirror coming on the AP side.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

### Task 5.2: Hide pickup/delivery/return in `TariffMatchingPanel` when Advanced is active

**Files:**
- Modify: `components/settings/tariff-detail/TariffMatchingPanel.js`

- [ ] **Step 1: Add `isAdvanced` prop and gate the three location fields**

Edit the component signature in `components/settings/tariff-detail/TariffMatchingPanel.js` to accept `isAdvanced`:

```jsx
export default function TariffMatchingPanel({
  form,
  update,
  toggleLoadType,
  toggleFlag,
  toggleLocationAll,
  addLocationId,
  removeLocationId,
  isLocationAll,
  showAdditional,
  onShowAdditionalChange,
  customerLabels,
  setCustomerLabels,
  isAdvanced = false,  // NEW — when true, pickup/delivery/return pickers are hidden
}) {
```

Then wrap the three `<LocationConditionField>` JSX blocks for pickup / delivery / return in a single `{!isAdvanced && ( ... )}` conditional. Keep every other field (name, dates, load types, customer, additional conditions, flags) unconditional.

Locate the Pickup / Delivery / Return Location block (currently around the lines with `* Pick Up Location`, `* Delivery Location`, `Return Location`) and wrap as:

```jsx
        {!isAdvanced && (
          <>
            {/* Pick Up Location */}
            <LocationConditionField ... />
            {/* Delivery Location */}
            <LocationConditionField ... />
            {/* Return Location */}
            <LocationConditionField ... />
          </>
        )}
```

- [ ] **Step 2: Verify no TS/JS errors**

Run: `git diff components/settings/tariff-detail/TariffMatchingPanel.js`

Expected: the three `<LocationConditionField>` blocks wrapped in a single conditional; a new prop `isAdvanced = false` on the function signature; no other changes.

- [ ] **Step 3: Commit**

```bash
git add components/settings/tariff-detail/TariffMatchingPanel.js
git commit -m "$(cat <<'EOF'
feat(advanced-route): hide pickup/delivery/return when advanced mode is on

Adds an isAdvanced prop to TariffMatchingPanel. When true, the three
LocationConditionField pickers for pickup, delivery, and return are
hidden — their role is replaced by the route template in the
advanced-route builder. All other basic fields (name, dates, load
types, customer, equipment, flags) stay visible.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

### Task 5.3: Update `pages/settings/tariffs/[id].js` — state + load + save

**Files:**
- Modify: `pages/settings/tariffs/[id].js`

- [ ] **Step 1: Add `advancedRoute` state and routing-templates fetch**

Near the top of the component in `pages/settings/tariffs/[id].js`, inside `TariffForm`, add state for the advanced route and the routing templates list:

```jsx
  // Advanced route state — separate from form so the AR panel can
  // emit the whole blob atomically.
  const [advancedRoute, setAdvancedRoute] = useState(null);
  const [routingTemplates, setRoutingTemplates] = useState([]);
```

Then, right after the existing `useEffect` that loads the tariff, add a second effect to fetch routing templates once:

```jsx
  useEffect(() => {
    async function loadTemplates() {
      try {
        const res = await fetch('/api/tenant/routing-templates');
        if (res.ok) {
          const body = await res.json();
          setRoutingTemplates(body.templates || []);
        }
      } catch { /* silent — template picker just stays empty */ }
    }
    loadTemplates();
  }, []);
```

- [ ] **Step 2: Hydrate `advancedRoute` from the loaded tariff**

Inside the existing `load()` async function that runs in the first `useEffect`, after the `setForm({ ... })` call and before the charge_sets logic, add:

```jsx
        setAdvancedRoute(t.advanced_route || null);
```

- [ ] **Step 3: Include `advanced_route` in the save payload**

In `handleSave()`, edit the `payload` object so it conditionally includes the advanced_route blob:

```jsx
    const payload = {
      ...form,
      effective_start: form.effective_start || null,
      effective_end: form.effective_end || null,
      charge_sets: chargeSets,
    };
    if (form.matching_mode === 'advanced_route') {
      payload.advanced_route = advancedRoute;
    }
    // When matching_mode === 'basic', don't send advanced_route at all.
    // The PUT handler treats an absent key as a no-op, so a previously-
    // saved advanced route is PRESERVED on the row. This matches the
    // spec's "so re-entering Advanced restores it" behavior.
```

Edge case: if the user actively wants to delete a saved advanced route, they can do it via API (send `advanced_route: null`). The UI doesn't expose a manual delete — toggling between modes never destroys the blob.

- [ ] **Step 4: Commit**

```bash
git add pages/settings/tariffs/[id].js
git commit -m "$(cat <<'EOF'
feat(advanced-route): wire advanced_route state into AR tariff page

Adds advancedRoute + routingTemplates state; hydrates from the
nested GET response; sends back in the save payload (or null when
matching_mode === 'basic'). No UI change yet — that's the next task.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

### Task 5.4: Switch layout in `pages/settings/tariffs/[id].js` — render advanced panel

**Files:**
- Modify: `pages/settings/tariffs/[id].js`

- [ ] **Step 1: Import the new panel**

Add to the existing imports at the top of `pages/settings/tariffs/[id].js`:

```jsx
import TariffAdvancedRoutePanel from '../../../components/settings/tariff-detail/TariffAdvancedRoutePanel';
```

- [ ] **Step 2: Split layout conditionally on `matching_mode`**

In the `formContent()` return JSX, find the two-panel `<div className="flex gap-0 rounded-xl ...">` block. Replace it with a conditional that renders basic (two-panel) or advanced (3-column + full-width charge sets):

```jsx
        {form.matching_mode === 'advanced_route' ? (
          <>
            {/* 3-column top row: matching conditions | route conditions | container moves */}
            <div className="flex gap-3 rounded-xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-0 mb-4">
              <TariffMatchingPanel
                form={form}
                update={update}
                toggleLoadType={toggleLoadType}
                toggleFlag={toggleFlag}
                toggleLocationAll={toggleLocationAll}
                addLocationId={addLocationId}
                removeLocationId={removeLocationId}
                isLocationAll={isLocationAll}
                showAdditional={showAdditional}
                onShowAdditionalChange={setShowAdditional}
                customerLabels={customerLabels}
                setCustomerLabels={setCustomerLabels}
                isAdvanced
              />
              <div className="flex-1 p-3">
                <TariffAdvancedRoutePanel
                  value={advancedRoute}
                  onChange={setAdvancedRoute}
                  routingTemplates={routingTemplates}
                />
              </div>
            </div>

            {/* Full-width charge sets beneath */}
            <div className="rounded-xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-900">
              <TariffChargeSetsPanel
                chargeSets={chargeSets}
                onAddChargeSet={addChargeSet}
                onRemoveChargeSet={removeChargeSet}
                onOpenProfilePicker={openProfilePicker}
                onRemoveProfile={removeProfile}
                onAddChargeItem={addChargeItem}
                onUpdateChargeItem={updateChargeItem}
                onRemoveChargeItem={removeChargeItem}
                onUpdateChargeSet={updateChargeSet}
              />
            </div>
          </>
        ) : (
          <div className="flex gap-0 rounded-xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-900 min-h-[calc(100vh-200px)]">
            <TariffMatchingPanel
              form={form}
              update={update}
              toggleLoadType={toggleLoadType}
              toggleFlag={toggleFlag}
              toggleLocationAll={toggleLocationAll}
              addLocationId={addLocationId}
              removeLocationId={removeLocationId}
              isLocationAll={isLocationAll}
              showAdditional={showAdditional}
              onShowAdditionalChange={setShowAdditional}
              customerLabels={customerLabels}
              setCustomerLabels={setCustomerLabels}
            />
            <TariffChargeSetsPanel
              chargeSets={chargeSets}
              onAddChargeSet={addChargeSet}
              onRemoveChargeSet={removeChargeSet}
              onOpenProfilePicker={openProfilePicker}
              onRemoveProfile={removeProfile}
              onAddChargeItem={addChargeItem}
              onUpdateChargeItem={updateChargeItem}
              onRemoveChargeItem={removeChargeItem}
              onUpdateChargeSet={updateChargeSet}
            />
          </div>
        )}
```

- [ ] **Step 3: Verify in the browser**

Start the dev server if not already running. Open Settings → Load Tariffs → Add Tariff. Click the "Advanced Route Matching" tab in the header. Confirm:
- Left column shows Load Matching Conditions WITHOUT the three location fields.
- Middle column shows Route Conditions with a template dropdown and a palette of clickable event types.
- Right column shows "Container Moves" with "Add Move" button.
- Below the 3-column row, Charge Sets spans full width.
- Toggle back to Basic. Layout collapses to the original two-panel. The three location fields reappear.

- [ ] **Step 4: Verify advanced route saves + round-trips**

In the Advanced tab:
1. Click "Add Move"
2. Click "Pull from Terminal" in the palette
3. Click "Pull from Terminal" again, it appends — actually remove and use "Deliver Container"
4. In each event row, pick the City + State mode and fill in "Dallas / TX" and "Chicago / IL"
5. Fill in a tariff name, effective dates, at least one load type
6. Click Create Load Tariff

Re-open the tariff. The Advanced tab should restore the move + events + city/state matches you entered.

- [ ] **Step 5: Commit**

```bash
git add pages/settings/tariffs/[id].js
git commit -m "$(cat <<'EOF'
feat(advanced-route): render AR advanced panel layout

pages/settings/tariffs/[id].js now renders:
 - basic mode: current two-panel (unchanged)
 - advanced mode: 3-column top row (matching | route conditions |
   container moves) + full-width charge sets below

Verified via dev server: create → save → reload → round-trips.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase 6: AR engine + specificity scoring

### Task 6.1: Wire matcher into `lib/tariff-engine.js`

**Files:**
- Modify: `lib/tariff-engine.js`

- [ ] **Step 1: Import + fetch advanced_route in the select**

At the top of `lib/tariff-engine.js`, add the import after the existing imports:

```js
import { matchesAdvancedRoute } from './advanced-route-matcher';
```

Then, in `findMatchingCharges`, extend the `.select(...)` on `.from('tariffs')` to include the advanced_route join:

```js
    .from('tariffs')
    .select(`
      *,
      advanced_route:tariff_advanced_routes(
        id, routing_template_id, moves
      ),
      charge_sets:tariff_charge_sets(
        *,
        profiles:tariff_charge_set_profiles(
          *,
          charge_profile:charge_profiles(
            id, name, charge_name, unit_of_measure, auto_add, calculation_mode, percentage_based_on,
            tiers:charge_profile_tiers(*)
          )
        ),
        items:tariff_charge_items(*)
      )
    `)
```

Right after the `tariffs` array is loaded, normalize advanced_route to single row/null (Supabase returns to-many as array):

```js
  if (tariffs) {
    for (const t of tariffs) {
      if (Array.isArray(t.advanced_route)) {
        t.advanced_route = t.advanced_route[0] || null;
      }
    }
  }
```

- [ ] **Step 2: Also hydrate `container_moves` alongside `routing_events`**

The matcher needs `load.container_moves`. Today the engine only hydrates `routing_events`. Extend the hydration block at the top of `findMatchingCharges`:

```js
  if (!Array.isArray(load.routing_events)) {
    const { data: events } = await svc
      .from('order_routing_events')
      .select('id, event_type, arrived_at, departed_at, sequence, location_id, city, state, zip, move_id')
      .eq('tenant_id', tenantId)
      .eq('order_id', load.id)
      .order('sequence', { ascending: true });
    load.routing_events = events || [];
  }
  if (!Array.isArray(load.container_moves)) {
    const { data: moves } = await svc
      .from('order_container_moves')
      .select('id, sequence')
      .eq('tenant_id', tenantId)
      .eq('order_id', load.id)
      .order('sequence', { ascending: true });
    load.container_moves = moves || [];
  }
```

Note `move_id` added to the routing_events select (previously absent) — the matcher groups by move_id.

- [ ] **Step 3: Branch on `matching_mode` in `matchesTariff`**

Update `matchesTariff(tariff, load, today)` in `lib/tariff-engine.js`. Find the location-check block (currently around "Pickup location check" / "Delivery location check" / "Return location check") and replace with a mode-aware branch.

BEFORE the location checks, add:

```js
  // Advanced route matching — branches out of the basic location checks.
  if (tariff.matching_mode === 'advanced_route') {
    if (!matchesAdvancedRoute(tariff.advanced_route, load)) return false;
  } else {
    // Basic pickup / delivery / return checks (unchanged)
    if (tariff.pickup_conditions && !tariff.pickup_conditions.all) {
      const ids = tariff.pickup_conditions.ids || [];
      if (ids.length > 0 && !ids.includes(load.pickup_location_id)) return false;
    }
    if (tariff.delivery_conditions && !tariff.delivery_conditions.all) {
      const ids = tariff.delivery_conditions.ids || [];
      if (ids.length > 0 && !ids.includes(load.delivery_location_id)) return false;
    }
    if (tariff.return_conditions && !tariff.return_conditions.all && tariff.return_conditions.ids?.length > 0) {
      if (!tariff.return_conditions.ids.includes(load.return_location_id)) return false;
    }
  }
```

Delete the original pickup/delivery/return blocks (they're now inside the else branch above).

- [ ] **Step 4: Commit**

```bash
git add lib/tariff-engine.js
git commit -m "$(cat <<'EOF'
feat(advanced-route): engine branches on matching_mode (AR)

tariff-engine.js imports the shared matcher, hydrates container_moves
alongside routing_events, nests advanced_route in the tariff select,
and branches out of the basic pickup/delivery/return filters when
matching_mode === 'advanced_route'. Non-location filters (customer,
load type, equipment, flags) still run unchanged.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

### Task 6.2: Add specificity bonus + per-event scoring in `lib/tariff-engine.js`

**Files:**
- Modify: `lib/tariff-engine.js`

- [ ] **Step 1: Extend `tariffSpecificity`**

Find `function tariffSpecificity(tariff)` in `lib/tariff-engine.js` and add the advanced-route bonus at the top of the function:

```js
function tariffSpecificity(tariff) {
  let score = 0;

  // Advanced-route matches always beat basic (+1000 base) plus per-event
  // specificity bonus so more-precisely-pinned templates beat looser ones.
  if (tariff.matching_mode === 'advanced_route' && tariff.advanced_route) {
    score += 1000;
    const moves = Array.isArray(tariff.advanced_route.moves) ? tariff.advanced_route.moves : [];
    for (const move of moves) {
      for (const ev of (move.events || [])) {
        const mode = ev.location_match?.mode;
        if (mode === 'specific')   score += 4;
        else if (mode === 'zip')    score += 3;
        else if (mode === 'city_state') score += 2;
        else if (mode === 'state')  score += 1;
      }
    }
  }

  if (tariff.customer_ids?.length > 0) score += 100;
  // ... rest of the existing function unchanged ...
```

- [ ] **Step 2: Commit**

```bash
git add lib/tariff-engine.js
git commit -m "$(cat <<'EOF'
feat(advanced-route): add specificity scoring for AR advanced tariffs

An advanced tariff that matched this load gets +1000 base (ensures
it beats any basic tariff) plus per-event location-specificity points
(specific +4, zip +3, city_state +2, state +1). Existing customer /
equipment / flag bonuses still compose on top. Priority stays the
final tiebreaker.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

### Task 6.3: Update AR diagnostic reason strings

**Files:**
- Modify: `lib/advanced-route-matcher.js`
- Modify: `pages/api/tenant/loads/[id]/recalculate-charges-diagnostic.js` (if that's the diagnostic endpoint path — check the actual file name first)

- [ ] **Step 1: Add a diagnostic variant that returns the reason**

Add a second exported function to `lib/advanced-route-matcher.js`:

```js
/**
 * Same match logic as matchesAdvancedRoute, but returns a structured
 * { matched, reason } object. Used by the diagnostic endpoint to
 * surface WHY an advanced tariff did/didn't match a load.
 */
export function diagnoseAdvancedRoute(advancedRoute, load) {
  if (!advancedRoute || !Array.isArray(advancedRoute.moves)) {
    return { matched: false, reason: 'advanced_route: no route template on tariff' };
  }
  const template = advancedRoute.moves;
  if (template.length === 0) {
    return { matched: false, reason: 'advanced_route: empty route template' };
  }

  const loadMoves = normalizeLoadRouting(
    load?.routing_events || [],
    load?.container_moves || [],
  );

  if (loadMoves.length !== template.length) {
    return { matched: false, reason: `advanced_route: move count mismatch (template=${template.length}, load=${loadMoves.length})` };
  }

  for (let mi = 0; mi < template.length; mi++) {
    const tEvents = Array.isArray(template[mi].events) ? template[mi].events : [];
    const lEvents = loadMoves[mi].events || [];
    if (lEvents.length !== tEvents.length) {
      return { matched: false, reason: `advanced_route: Move ${mi + 1} event count mismatch (template=${tEvents.length}, load=${lEvents.length})` };
    }
    for (let ei = 0; ei < tEvents.length; ei++) {
      const tEv = tEvents[ei];
      const lEv = lEvents[ei];
      if (tEv.event_type !== lEv.event_type) {
        return { matched: false, reason: `advanced_route: Move ${mi + 1} event ${ei + 1} type mismatch (expected ${tEv.event_type}, got ${lEv.event_type})` };
      }
      if (!matchLocation(lEv, tEv.location_match)) {
        const mode = tEv.location_match?.mode;
        return { matched: false, reason: `advanced_route: Move ${mi + 1} event ${ei + 1} location ${mode} mismatch` };
      }
    }
  }

  return { matched: true, reason: null };
}
```

- [ ] **Step 2: Wire into the AR diagnostic endpoint**

The endpoint is `pages/api/tenant/loads/[id]/recalculate-charges-diagnostic.js`. It has a `diagnoseTariffMatch(svc, load, tenantId)` async helper that iterates tariffs and for each one pushes a series of `{ check, pass, detail }` objects into a `checks` array.

Changes:

(a) At the top of the file, add the imports:

```js
import { diagnoseAdvancedRoute } from '../../../../../lib/advanced-route-matcher';
```

Also add a `routing_events` + `container_moves` hydration on the load fetch — the matcher needs both. Replace the single-`.maybeSingle()` load select with one that also nests these, OR just hydrate them separately after the load loads (same pattern as `lib/tariff-engine.js`).

(b) Inside `diagnoseTariffMatch`, first hydrate routing + container_moves + `advanced_route` per tariff (re-fetch advanced_route since the simple `select('*')` above won't bring it in):

```js
  // Pre-fetch advanced_route blobs for any advanced-mode tariffs in the list.
  const advIds = (tariffs || []).filter((t) => t.matching_mode === 'advanced_route').map((t) => t.id);
  const advByTariff = new Map();
  if (advIds.length > 0) {
    const { data: advs } = await svc
      .from('tariff_advanced_routes')
      .select('tariff_id, routing_template_id, moves')
      .in('tariff_id', advIds)
      .eq('tenant_id', tenantId);
    for (const a of (advs || [])) advByTariff.set(a.tariff_id, a);
  }

  // Hydrate load.routing_events + container_moves for the matcher
  const { data: re } = await svc
    .from('order_routing_events')
    .select('id, event_type, sequence, location_id, city, state, zip, move_id')
    .eq('tenant_id', tenantId).eq('order_id', load.id)
    .order('sequence', { ascending: true });
  const { data: cm } = await svc
    .from('order_container_moves')
    .select('id, sequence')
    .eq('tenant_id', tenantId).eq('order_id', load.id)
    .order('sequence', { ascending: true });
  load.routing_events = re || [];
  load.container_moves = cm || [];
```

(c) Replace the "Pickup / Delivery / Return location checks" loop (around the existing `for (const field of ['pickup', 'delivery', 'return'])` block) with a mode-aware branch. When `t.matching_mode === 'advanced_route'`, call `diagnoseAdvancedRoute(advByTariff.get(t.id), load)` and push a single `{ check: 'advanced_route', pass, detail }` check. Otherwise run the existing pickup/delivery/return loop unchanged.

Concretely, wrap the existing loop:

```js
    if (t.matching_mode === 'advanced_route') {
      const ar = advByTariff.get(t.id) || null;
      const r = diagnoseAdvancedRoute(ar, load);
      checks.push({
        check: 'advanced_route',
        pass: r.matched,
        detail: r.matched ? 'route matched' : r.reason,
      });
      if (!r.matched) matched = false;
    } else {
      // existing pickup / delivery / return loop — keep as-is
      for (const field of ['pickup', 'delivery', 'return']) {
        // ...
      }
    }
```

- [ ] **Step 3: Smoke-test the diagnostic**

With the dev server running and an advanced tariff + a near-miss load, hit `/api/tenant/loads/<id>/recalculate-charges-diagnostic`. Confirm the response includes the specific reason string.

- [ ] **Step 4: Commit**

```bash
git add lib/advanced-route-matcher.js pages/api/tenant/loads/[id]/recalculate-charges-diagnostic.js
git commit -m "$(cat <<'EOF'
feat(advanced-route): surface AR match diagnostics

Adds diagnoseAdvancedRoute to the shared matcher — same logic but
returns { matched, reason }. AR diagnostic endpoint now reports the
specific first-failed location / event_type / move-count issue in
its trace so dispatchers can see why an advanced tariff didn't match.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase 7: AP mirror

Mirror of Phases 4–6 for the AP (driver tariffs) side. Structurally identical. Each task in this phase mirrors the AR task of the same final digit.

### Task 7.1: Extend AP GET to nest `advanced_route`

**Files:**
- Modify: `pages/api/tenant/ap/tariffs/[id].js`

- [ ] **Step 1: Extend the GET select**

In `pages/api/tenant/ap/tariffs/[id].js`, update the GET handler's select to include `advanced_route`:

```js
  if (req.method === 'GET') {
    const { data, error } = await svc
      .from('driver_tariffs')
      .select(`
        *,
        driver_group:driver_groups(id, name),
        advanced_route:driver_tariff_advanced_routes(
          id, routing_template_id, moves
        ),
        charge_sets:driver_tariff_charge_sets(
          id, pay_to_mode, pay_to_driver_id, notes,
          profiles:driver_tariff_charge_set_profiles(
            id, driver_charge_profile_id,
            charge_profile:driver_charge_profiles(id, name, charge_name, unit_of_measure, calculation_mode,
              versions:driver_charge_profile_versions(id, label, effective_from, effective_to,
                tiers:driver_charge_profile_tiers(*)
              )
            )
          )
        )
      `)
      .eq('id', id).eq('tenant_id', ctx.tenantId).single();
    if (error || !data) return res.status(404).json({ error: 'Tariff not found' });

    if (Array.isArray(data.advanced_route)) {
      data.advanced_route = data.advanced_route[0] || null;
    }

    return res.status(200).json({ tariff: data });
  }
```

- [ ] **Step 2: Extend PUT to upsert/delete advanced_route**

Add to the top of `pages/api/tenant/ap/tariffs/[id].js`:

```js
import { validateAdvancedRoute } from '../../../../../lib/advanced-route-validator';
```

Note the extra `..` — AP lives one directory deeper.

Inside the PUT handler, AFTER the existing `driver_tariffs` update and BEFORE the charge_sets block, add the advanced_route upsert mirror of Task 4.3:

```js
    if ('advanced_route' in body) {
      const ar = body.advanced_route;
      if (ar === null) {
        const { error: delErr } = await svc.from('driver_tariff_advanced_routes').delete()
          .eq('driver_tariff_id', id).eq('tenant_id', ctx.tenantId);
        if (delErr) return res.status(500).json({ error: delErr.message, step: 'delete_advanced_route' });
      } else {
        const v = validateAdvancedRoute(ar);
        if (!v.ok) return res.status(400).json({ error: v.error, step: 'validate_advanced_route' });
        const { error: upErr } = await svc.from('driver_tariff_advanced_routes').upsert({
          tenant_id: ctx.tenantId,
          driver_tariff_id: id,
          routing_template_id: ar.routing_template_id || null,
          moves: ar.moves,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'driver_tariff_id' });
        if (upErr) return res.status(500).json({ error: upErr.message, step: 'upsert_advanced_route' });
      }
    }
```

- [ ] **Step 3: Smoke-test AP GET + PUT**

Same console calls as Task 4.3 Step 2, but against `/api/tenant/ap/tariffs/<id>`.

- [ ] **Step 4: Commit**

```bash
git add pages/api/tenant/ap/tariffs/[id].js
git commit -m "$(cat <<'EOF'
feat(advanced-route): AP GET nests + PUT upserts advanced_route

Mirror of AR endpoint changes. GET joins driver_tariff_advanced_routes
and collapses to single row. PUT accepts advanced_route body key:
null deletes, object validates + upserts, absent is no-op.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

### Task 7.2: Extend AP POST (index) to accept `advanced_route` on create

**Files:**
- Modify: `pages/api/tenant/ap/tariffs/index.js`

- [ ] **Step 1: Add advanced_route insert after the driver_tariffs insert**

At the top of `pages/api/tenant/ap/tariffs/index.js`:

```js
import { validateAdvancedRoute } from '../../../../../lib/advanced-route-validator';
```

In the POST handler, after the new `driver_tariffs` row is inserted and its ID is known, add the mirror of Task 4.4:

```js
    if (body.advanced_route) {
      const v = validateAdvancedRoute(body.advanced_route);
      if (!v.ok) return res.status(400).json({ error: v.error, step: 'validate_advanced_route' });
      const { error: arErr } = await svc.from('driver_tariff_advanced_routes').insert({
        tenant_id: ctx.tenantId,
        driver_tariff_id: newTariff.id,
        routing_template_id: body.advanced_route.routing_template_id || null,
        moves: body.advanced_route.moves,
      });
      if (arErr) return res.status(500).json({ error: arErr.message, step: 'insert_advanced_route' });
    }
```

Adapt the local var name (`newTariff` may be something else in this file).

- [ ] **Step 2: Smoke-test creation**

Create a new driver tariff via the UI in advanced mode. Confirm the row persists.

- [ ] **Step 3: Commit**

```bash
git add pages/api/tenant/ap/tariffs/index.js
git commit -m "$(cat <<'EOF'
feat(advanced-route): AP POST can create advanced_route on new tariff

Mirror of the AR POST extension. Validates + inserts
driver_tariff_advanced_routes in the same request when the body
includes advanced_route.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

### Task 7.3: Create `DriverTariffAdvancedRoutePanel` wrapper

**Files:**
- Create: `components/settings/driver-tariff-detail/DriverTariffAdvancedRoutePanel.js`

- [ ] **Step 1: Write the wrapper**

Create `components/settings/driver-tariff-detail/DriverTariffAdvancedRoutePanel.js`:

```jsx
import AdvancedRouteBuilder from '../shared/AdvancedRouteBuilder';

/**
 * DriverTariffAdvancedRoutePanel — thin AP wrapper around the shared
 * AdvancedRouteBuilder. Exists so the AP page imports a route-specific
 * symbol even if the underlying component is shared with AR.
 */
export default function DriverTariffAdvancedRoutePanel({ value, onChange, routingTemplates }) {
  return (
    <AdvancedRouteBuilder
      value={value}
      onChange={onChange}
      routingTemplates={routingTemplates}
    />
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add components/settings/driver-tariff-detail/DriverTariffAdvancedRoutePanel.js
git commit -m "$(cat <<'EOF'
feat(advanced-route): add DriverTariffAdvancedRoutePanel AP wrapper

Mirror of the AR wrapper. Thin re-export of the shared builder.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

### Task 7.4: Hide pickup/delivery/return in `DriverTariffMatchingPanel` when Advanced is active

**Files:**
- Modify: `components/settings/driver-tariff-detail/DriverTariffMatchingPanel.js`

- [ ] **Step 1: Add `isAdvanced` prop and gate the three location fields**

Mirror of Task 5.2: add an `isAdvanced` prop defaulted to `false`, wrap the pickup / delivery / return `LocationConditionField` blocks in a single `{!isAdvanced && (...)}` conditional. Every other field stays unconditional.

Read the file first to match its specific layout — the AP panel was decomposed as part of Plan G3 and has a slightly different structure than AR.

- [ ] **Step 2: Commit**

```bash
git add components/settings/driver-tariff-detail/DriverTariffMatchingPanel.js
git commit -m "$(cat <<'EOF'
feat(advanced-route): hide AP pickup/delivery/return when advanced

Mirror of TariffMatchingPanel change. DriverTariffMatchingPanel
accepts isAdvanced and hides pickup/delivery/return LocationConditionFields
when true.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

### Task 7.5: Update `pages/settings/driver-tariffs/[id].js` — state, load, save, layout

**Files:**
- Modify: `pages/settings/driver-tariffs/[id].js`

- [ ] **Step 1: Add state + templates fetch + hydrate from GET**

Mirror of Tasks 5.3 and 5.4 combined. Add:

```jsx
  const [advancedRoute, setAdvancedRoute] = useState(null);
  const [routingTemplates, setRoutingTemplates] = useState([]);
```

Add a `useEffect` that fetches `/api/tenant/routing-templates` once.

Inside the existing `load()` that fetches the tariff, after `setForm({ ... })`:

```jsx
        setAdvancedRoute(t.advanced_route || null);
```

In `handleSave`, include `advanced_route` in the payload (mirror of Task 5.3 Step 3 — preserve on toggle, don't destroy):

```jsx
    const payload = {
      ...form,
      priority: Number(form.priority) || 0,
      effective_start: form.effective_start || null,
      effective_end: form.effective_end || null,
      charge_sets,
    };
    if (form.matching_mode === 'advanced_route') {
      payload.advanced_route = advancedRoute;
    }
```

- [ ] **Step 2: Import panel + split layout**

Add to imports:

```jsx
import DriverTariffAdvancedRoutePanel from '../../../components/settings/driver-tariff-detail/DriverTariffAdvancedRoutePanel';
```

Replace the two-panel JSX with a conditional that renders basic (current) or advanced (3-column + full-width DriverPayPanel). Mirror of Task 5.4 but use `DriverTariffMatchingPanel`, `DriverTariffAdvancedRoutePanel`, and `DriverPayPanel`:

```jsx
        {form.matching_mode === 'advanced_route' ? (
          <>
            <div className="flex gap-3 rounded-xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-0 mb-4">
              <DriverTariffMatchingPanel
                form={form}
                update={update}
                toggleLoadType={toggleLoadType}
                toggleFlag={toggleFlag}
                toggleLocationAll={toggleLocationAll}
                addLocationId={addLocationId}
                removeLocationId={removeLocationId}
                isLocationAll={isLocationAll}
                showAdditional={showAdditional}
                onToggleAdditional={() => setShowAdditional((s) => !s)}
                isAdvanced
              />
              <div className="flex-1 p-3">
                <DriverTariffAdvancedRoutePanel
                  value={advancedRoute}
                  onChange={setAdvancedRoute}
                  routingTemplates={routingTemplates}
                />
              </div>
            </div>

            <div className="rounded-xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-900">
              <DriverPayPanel
                linkedProfiles={linkedProfiles}
                onOpenPicker={openProfilePicker}
                onRemoveProfile={removeProfile}
              />
            </div>
          </>
        ) : (
          <div className="flex gap-0 rounded-xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-900 min-h-[calc(100vh-200px)]">
            <DriverTariffMatchingPanel
              form={form}
              update={update}
              toggleLoadType={toggleLoadType}
              toggleFlag={toggleFlag}
              toggleLocationAll={toggleLocationAll}
              addLocationId={addLocationId}
              removeLocationId={removeLocationId}
              isLocationAll={isLocationAll}
              showAdditional={showAdditional}
              onToggleAdditional={() => setShowAdditional((s) => !s)}
            />
            <DriverPayPanel
              linkedProfiles={linkedProfiles}
              onOpenPicker={openProfilePicker}
              onRemoveProfile={removeProfile}
            />
          </div>
        )}
```

- [ ] **Step 3: Verify in the browser**

Same as Task 5.4 Step 3, but on the AP side (Settings → Driver Tariffs → Add / Edit).

- [ ] **Step 4: Commit**

```bash
git add pages/settings/driver-tariffs/[id].js
git commit -m "$(cat <<'EOF'
feat(advanced-route): render AP advanced panel layout

pages/settings/driver-tariffs/[id].js mirrors the AR layout branch:
basic stays two-panel, advanced becomes 3-column top row + full-width
driver-pay panel below.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

### Task 7.6: Wire matcher into `lib/driver-tariff-engine.js`

**Files:**
- Modify: `lib/driver-tariff-engine.js`

- [ ] **Step 1: Mirror of Task 6.1 for AP**

Add the import at the top of `lib/driver-tariff-engine.js`:

```js
import { matchesAdvancedRoute } from './advanced-route-matcher';
```

Extend the `.select(...)` on `.from('driver_tariffs')` to include `advanced_route:driver_tariff_advanced_routes(id, routing_template_id, moves)`.

After the tariffs array is loaded, normalize advanced_route to single row/null.

In the existing routing_events hydration block, also hydrate `container_moves` (same pattern as Task 6.1 Step 2), and add `move_id` to the routing_events select.

In `matchesDriverTariff(tariff, load, driverGroupIds, today)`, branch out of the basic location checks when `matching_mode === 'advanced_route'` (same shape as Task 6.1 Step 3).

- [ ] **Step 2: Commit**

```bash
git add lib/driver-tariff-engine.js
git commit -m "$(cat <<'EOF'
feat(advanced-route): engine branches on matching_mode (AP)

driver-tariff-engine.js imports the shared matcher, hydrates
container_moves, nests advanced_route in the tariff select, and
branches out of the basic pickup/delivery/return filters when
matching_mode === 'advanced_route'. Driver-group + flag + equipment
filters still run.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

### Task 7.7: Add specificity bonus + per-event scoring in `lib/driver-tariff-engine.js`

**Files:**
- Modify: `lib/driver-tariff-engine.js`

- [ ] **Step 1: Extend `driverTariffSpecificity`**

Mirror of Task 6.2. Find `function driverTariffSpecificity(tariff)` in `lib/driver-tariff-engine.js` and add the advanced-route block at the top:

```js
function driverTariffSpecificity(tariff) {
  let score = 0;

  if (tariff.matching_mode === 'advanced_route' && tariff.advanced_route) {
    score += 1000;
    const moves = Array.isArray(tariff.advanced_route.moves) ? tariff.advanced_route.moves : [];
    for (const move of moves) {
      for (const ev of (move.events || [])) {
        const mode = ev.location_match?.mode;
        if (mode === 'specific')   score += 4;
        else if (mode === 'zip')    score += 3;
        else if (mode === 'city_state') score += 2;
        else if (mode === 'state')  score += 1;
      }
    }
  }

  if (tariff.driver_group_id) score += 100;
  // ... rest unchanged ...
```

- [ ] **Step 2: Commit**

```bash
git add lib/driver-tariff-engine.js
git commit -m "$(cat <<'EOF'
feat(advanced-route): specificity scoring for AP advanced tariffs

Same +1000 base + per-event specificity scoring as the AR side.
Keeps AR/AP scoring symmetric.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

### Task 7.8: AP diagnostic reason strings — deferred

**Status:** No standalone AP diagnostic endpoint exists today. The AR side has `recalculate-charges-diagnostic.js`, but the AP side only has `recalculate-driver-pay.js` (which applies pay lines — no read-only diagnostic variant).

Building an AP diagnostic endpoint is a separate concern from Advanced Route Matching and belongs in its own plan. The AP engine itself (Tasks 7.6 + 7.7) has everything it needs to match advanced routes correctly — only the diagnostic surfacing is missing, which affects "why didn't this pay line apply" rather than correctness.

- [ ] **Step 1: Note this as an open follow-up**

No code change here. The spec's "AP diagnostic gets the same treatment" goal is acknowledged but deferred. When a future plan builds `pages/api/tenant/loads/[id]/recalculate-driver-pay-diagnostic.js` (mirror of AR), it should import `diagnoseAdvancedRoute` from `lib/advanced-route-matcher` and use the same mode-aware branch pattern as Task 6.3 Step 2.

- [ ] **Step 2: No commit** — this task is a deferral marker.

---

## Phase 8: End-to-end verification

### Task 8.1: AR end-to-end smoke test

- [ ] **Step 1: Set up test data**

In the dev UI:
1. Create a load tariff in **Advanced Route Matching** mode with a 2-move template:
   - Move 1: Pull → Drop (city_state: Dallas, TX)
   - Move 2: Hook (city_state: Dallas, TX) → Deliver (city_state: Chicago, IL) → Return (specific: your LAX terminal org)
2. Link one charge profile (e.g., a fixed Line Haul amount).
3. Set status to active, effective dates covering today.

Create a matching load with those exact stops + a near-miss load (change Dallas to Memphis).

- [ ] **Step 2: Trigger recalc on the matching load**

```bash
curl -X POST http://localhost:3000/api/tenant/loads/<matching-load-id>/recalculate-charges
```

Expected response includes the tariff's charge profile in the applied list.

- [ ] **Step 3: Trigger recalc on the near-miss load**

```bash
curl -X POST http://localhost:3000/api/tenant/loads/<nearmiss-load-id>/recalculate-charges
```

Expected: the advanced tariff does NOT apply (no line item from it).

- [ ] **Step 4: Check diagnostic on near-miss load**

```bash
curl http://localhost:3000/api/tenant/loads/<nearmiss-load-id>/recalculate-charges-diagnostic
```

Expected: the trace mentions the specific mismatch (e.g., "Move 1 event 2 location city_state mismatch").

- [ ] **Step 5: No commit** — this task is verification only, no files changed.

### Task 8.2: AP end-to-end smoke test

- [ ] **Step 1: Set up test data**

Same as 8.1 but in **Settings → Driver Tariffs → Add Driver Tariff**. Link one driver charge profile. Dispatch a driver to the matching load.

- [ ] **Step 2: Trigger recalc**

```bash
curl -X POST http://localhost:3000/api/tenant/loads/<matching-load-id>/recalculate-driver-pay
```

Expected response includes the driver charge profile pay line.

Repeat with the near-miss load. Expected: no pay line from that tariff.

- [ ] **Step 3: No commit** — verification only.

---

## Self-review

After every task above is committed, walk back through the spec and this plan and confirm:

- [ ] Every spec section maps to at least one task in this plan.
- [ ] No "TODO" / "TBD" / "handle edge cases" / "similar to Task N" shortcuts remain.
- [ ] The function names `normalizeLoadRouting`, `matchLocation`, `matchesAdvancedRoute`, `diagnoseAdvancedRoute`, `validateAdvancedRoute`, `LANE_DEFINING_EVENT_TYPES` are consistent across tasks.
- [ ] The `location_match` JSON shape is identical in the spec, validator, matcher, and UI component.
- [ ] Dark-mode classes appear on every new component's gray/white/border utilities.
- [ ] Both migrations follow the `BEGIN / COMMIT / NOTIFY pgrst` template.

If any check fails, open a Follow-up Task in this plan rather than editing completed commits.
