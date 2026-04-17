# Advanced Route Matching — Design

**Date:** 2026-04-17
**Status:** Approved design; implementation plan pending
**Scope:** AR (Load Tariffs) + AP (Driver Tariffs) — symmetric

## Context

Both Load Tariffs and Driver Tariffs have a toggle in the detail page header labeled "Advanced Route Matching" (basic | advanced_route). Today the toggle persists `form.matching_mode` to the row, but:

- No UI is rendered for the advanced mode — picking the tab is a no-op visually beyond the highlight.
- Neither `lib/tariff-engine.js` (AR) nor `lib/driver-tariff-engine.js` (AP) reads `matching_mode`. Every tariff is matched as if it were basic.

This spec turns the stub into a full feature: a per-lane route template that a load must match exactly. Use case: routing a container via a Dallas TX yard vs via a Memphis AR yard for the same endpoints should resolve to a different price.

Advanced tariffs are intended as rarely-created, per-lane exceptions that override basic tariffs for specific loads.

## Scope

**In scope:**
- Schema + UI + engine for AR side.
- Schema + UI + engine for AP side — symmetric.
- Structural, exact-match comparison of a load's `order_routing_events` against a tariff's saved route template.
- Integration with the existing specificity scoring so advanced matches always beat basic on the same load.

**Out of scope (future work):**
- Geometric / highway-level route inference ("did this load drive through TX without stopping?") — unreachable without a maps API.
- Fuzzy / subset matching. Match is always exact (after stripping operational event types).
- Per-user or per-load override of advanced route matching.
- Advanced route matching surfaced on the diagnostic UI beyond the reason strings described in §5.

## Mental model

A load's Routing tab shows a tree: **Load → Container Moves → Events → Location**. Each event has an `event_type` (pull / drop / hook / deliver / etc.) and a resolved location (org_id plus denormalized city/state/zip).

The tariff's Advanced Route Matching panel mirrors that tree. The tariff stores its own "template route" — same shape of moves and events — except each event's location is a **match specifier** rather than a real address:

- `specific` — pick one org by id.
- `city_state` — any location with this city + state.
- `state` — any location in this state.
- `zip` — any location with this zip.

When the engine evaluates a tariff, it does a structural comparison between the load's normalized routing tree and the tariff's template tree. If they align exactly (after stripping operational events like scale/wait), the tariff matches.

## Data model

Two new tables, one per side. JSONB `moves` rather than separate moves + events tables because the template is a pure matcher — no live progression, no timestamps, no child rows outliving the parent.

### AR side

```sql
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

NOTIFY pgrst, 'reload schema';

COMMIT;
```

### AP side

Identical table `driver_tariff_advanced_routes` with `driver_tariff_id UUID NOT NULL REFERENCES driver_tariffs(id)` in place of `tariff_id`.

### `moves` JSONB shape

```json
[
  {
    "sequence": 0,
    "events": [
      {
        "sequence": 0,
        "event_type": "pull",
        "location_match": {
          "mode": "specific",
          "org_id": "uuid",
          "city": null, "state": null, "zip": null
        }
      },
      {
        "sequence": 1,
        "event_type": "drop",
        "location_match": {
          "mode": "city_state",
          "city": "Dallas", "state": "TX",
          "org_id": null, "zip": null
        }
      }
    ]
  }
]
```

Every event carries the full `location_match` object with nulls for unused fields — keeps the shape stable across modes and avoids `if key in dict` branching in the engine.

### Save-time validation

- At least one move, and at least 2 events total across all moves (a route with only an origin and no destination can't match anything meaningful).
- UI prevents creating empty moves; the server validates on PUT/POST regardless.
- Every `event_type` is lane-defining: `pull | pickup | drop | hook | deliver | return | hook_chassis | lift_off | terminate`.
- Every `location_match.mode` is one of `specific | city_state | state | zip`.
- Required fields for the mode are non-null (`specific` → `org_id`; `city_state` → `city` + `state`; `state` → `state`; `zip` → `zip`).

`routing_template_id` is a cosmetic breadcrumb ("seeded from: Prepull + Drop & Hook"). Not used by the matcher.

## UI

### Tab toggle (no change)

The existing `TariffHeader` / `DriverTariffHeader` toggle persists `form.matching_mode`. Selecting Advanced Route Matching now causes a different layout to render.

### Basic mode (unchanged)

Two-panel: `TariffMatchingPanel` (left, ~280px) + `TariffChargeSetsPanel` (right, fills).

### Advanced mode — 3 columns + full-width Charge Sets

When `matching_mode === 'advanced_route'`:

1. **Column 1 (~280px) — Load Matching Conditions.** Same component as Basic (`TariffMatchingPanel` / `DriverTariffMatchingPanel`), but it hides its Pickup / Delivery / Return location pickers. Name, effective dates, load types, customer (AR) / driver group (AP), equipment (container type/size, SSL, chassis), and flags remain.

2. **Column 2 (~260px) — Route Conditions.** A routing template picker (reuses the existing `routing_templates` rows) at the top. Below it, a draggable Event Palette showing the lane-defining event types already registered in `PALETTE_EVENT_TYPES` (`lib/routing-rules.js`): Hook Chassis, Pick Up Container (pickup), Pull from Terminal (pull), Deliver Container (deliver), Return Container (return), Drop Container (drop), Hook Container (hook), Lift Off, Terminate Chassis. Operational types (scale / wait / complete) are excluded from the advanced-route palette since they never affect matching. Selecting a routing template seeds the Container Moves column (with a confirmation if a route is already being edited). Dragging an event type onto a move inserts it.

3. **Column 3 (fills remaining width) — Container Moves.** The route being built. Each move renders as a card with a header ("Container Move 1", etc.). Each event row shows its event-type pill and an inline per-event location picker.

4. **Below, full-width — Charge Sets** (AR) / **Driver Pay** (AP). The existing component (`TariffChargeSetsPanel` / `DriverPayPanel`) moves from the right-panel slot to a full-width slot beneath the 3-column section.

When the user toggles back to Basic, the layout collapses back to the current two-panel arrangement. Advanced route data is preserved on the row so re-entering Advanced restores it.

### Per-event location picker

Four mode buttons horizontally: **Specific** · **City + State** · **State** · **Zip**. The visible input changes based on the selected mode:

- Specific → `OrgPicker` (type varies by event — terminal for pull/return, warehouse for deliver, etc., matching the existing location-field conventions).
- City + State → a combined city + state-dropdown pair.
- State → state dropdown only.
- Zip → free-text input with a format validator.

Changing the mode clears the other fields in the `location_match` object to avoid stale data.

### Shared components

New files:
- `components/settings/shared/AdvancedRouteBuilder.js` — owns columns 2 and 3 together (palette + moves list + per-event rows + drag-drop wiring).
- `components/settings/shared/EventLocationPicker.js` — the 4-mode location picker for a single event.

Thin per-side wrappers:
- `components/settings/tariff-detail/TariffAdvancedRoutePanel.js`.
- `components/settings/driver-tariff-detail/DriverTariffAdvancedRoutePanel.js`.

Each page (`pages/settings/tariffs/[id].js` and `pages/settings/driver-tariffs/[id].js`) mounts the advanced panel conditionally on `form.matching_mode === 'advanced_route'`.

## Engine match algorithm

A shared helper lives in `lib/advanced-route-matcher.js`:

```
matchesAdvancedRoute(advancedRoute, load) → boolean
```

Pure function, no DB access, imported by both `lib/tariff-engine.js` and `lib/driver-tariff-engine.js`.

### Entry integration

`matchesTariff(tariff, load, today)` keeps its existing non-location checks (date range, load type, customer, equipment, flags). After those, the location branch changes:

```
if (tariff.matching_mode === 'advanced_route') {
  return matchesAdvancedRoute(tariff.advanced_route, load);
}
// else: existing basic pickup / delivery / return checks
```

### Algorithm

1. Defensive: if `advancedRoute` is missing or has zero moves → return `false`.

2. Normalize the **load**'s routing:
   - Group `load.routing_events` by `move_id`, sort each group by `sequence`.
   - Strip operational event types (`scale | wait | complete | notes`) from every group.
   - Drop any resulting empty moves so they don't inflate the move count.

3. The **tariff template** is already normalized (the palette only exposes lane-defining types; the save-time validator rejects empties).

4. Structural compare (against the NORMALIZED load from step 2):
   - Normalized move count must equal tariff move count.
   - For each move-pair at the same index, event counts must match.
   - For each event-pair at the same index, `event_type` must match AND `matchLocation(loadEvent, template.location_match)` must return `true`.

5. `matchLocation`:
   - `specific` → `loadEvent.location_id === match.org_id`.
   - `city_state` → `lower(trim(loadEvent.city)) === lower(trim(match.city))` AND `upper(loadEvent.state) === upper(match.state)`.
   - `state` → `upper(loadEvent.state) === upper(match.state)`.
   - `zip` → `loadEvent.zip === match.zip` (exact).

### Edge cases

- **Load not dispatched yet** (no routing_events): advanced tariffs can't match — returns `false` (not an error).
- **Load's event missing denorm city/state/zip** when a wildcard mode is specified: returns `false`. Denorm is populated via the existing reverse-cascade on event writes.
- **Empty tariff template**: guarded at save-time; defensive `false` return if it slips through.

### Diagnostic surface

`pages/api/tenant/loads/[id]/recalculate-charges-diagnostic` already returns per-tariff match/no-match traces. When an advanced tariff fails, its reason string now names the specific mismatch (e.g., `advanced_route: Move 2 event 1 city_state: expected Dallas TX, got Memphis TN`). AP diagnostic gets the same treatment.

## Specificity scoring

Extends the existing `tariffSpecificity(tariff)` / `driverTariffSpecificity(tariff)` functions.

### Base bonus

A tariff with `matching_mode === 'advanced_route'` that successfully matches gets a flat **+1000** score. This guarantees any advanced match beats any basic match on the same load.

### Within-advanced tiebreaker

Per event in the template:

| `location_match.mode` | Points |
|---|---|
| `specific` | +4 |
| `zip` | +3 |
| `city_state` | +2 |
| `state` | +1 |

### Other bonuses still apply

An advanced tariff scoped to a specific customer (AR) / driver group (AP) still picks up its +100 bonus on top. Load type, equipment, flag bonuses likewise.

### Priority is the final tiebreaker (no change)

Same as today.

### Worked example

Two advanced tariffs both match the same load:

- A: 5 events, all `specific`, customer-scoped → 1000 + 100 + (5 × 4) = **1120**.
- B: 5 events, all `city_state`, no customer filter → 1000 + (5 × 2) = **1010**.

A wins.

## AR / AP parity

**Shared:**
- `lib/advanced-route-matcher.js` — the match helper.
- `components/settings/shared/AdvancedRouteBuilder.js` — the UI component.
- `components/settings/shared/EventLocationPicker.js` — the per-event picker.

**AR side:**
- Schema: `tariff_advanced_routes`.
- Page: `pages/settings/tariffs/[id].js` mounts `TariffAdvancedRoutePanel` when advanced.
- API: extend `pages/api/tenant/tariffs/[id].js` GET+PUT to nest `advanced_route`; extend `pages/api/tenant/tariffs/index.js` POST+PUT symmetrically.
- Engine: `lib/tariff-engine.js` imports `matchesAdvancedRoute`.

**AP side:**
- Schema: `driver_tariff_advanced_routes`.
- Page: `pages/settings/driver-tariffs/[id].js` mounts `DriverTariffAdvancedRoutePanel`.
- API: same extensions on `pages/api/tenant/ap/tariffs/[id].js` + `pages/api/tenant/ap/tariffs/index.js`.
- Engine: `lib/driver-tariff-engine.js` imports `matchesAdvancedRoute`.

**What's explicitly not shared:**
- The Basic-fields panel stays per-side (`TariffMatchingPanel` vs `DriverTariffMatchingPanel`) — already decomposed in Plan G1/G3 and has intentional AR/AP differences (customer_ids vs driver_group_id, etc.). Each side hides its own location fields when advanced is on.
- Charge Sets (AR) vs Driver Pay (AP) below — untouched, each side uses its existing sub-component.

## Testing strategy

**Layer 1 — unit tests for `lib/advanced-route-matcher.js`** (bulk of coverage)

Pure function, one test file, shared across AR and AP.

- Happy paths: 1-move / 2-event template; multi-move pull → drop/hook → deliver → return template; one case per location mode.
- Fail paths: wrong move count; wrong event count within a move; wrong event_type at a position; location mismatch for each mode; partial location match (city right, state wrong, etc.).
- Normalization: operational events stripped from both sides; case-insensitive state compare; case-insensitive + trimmed city compare; exact zip.
- Defensive: empty template; load with no routing events; null denorm fields on the load side.

**Layer 2 — API tests for persistence**

- PUT `/api/tenant/tariffs/[id]` with nested `advanced_route.moves` persists and round-trips.
- Same for `/api/tenant/ap/tariffs/[id]`.
- Server-side validator rejects empty moves, invalid event_types, invalid modes, missing required fields per mode.

**Layer 3 — integration against a real load**

One end-to-end test per side:
- Create a tariff with an advanced route + a charge profile (AR) / driver charge profile (AP).
- Create a load whose routing events match the template; dispatch it.
- Call `/api/tenant/loads/[id]/recalculate-charges` and assert the expected line items / pay lines land.
- Repeat with a near-miss load (one wrong event_type or city) and assert no charges land.

**Not tested:**
- Drag-and-drop mechanics inside the builder — covered by the same `@dnd-kit` primitives the Routing tab already uses. Smoke-render the panel is enough.
- `routing_template_id` breadcrumb — cosmetic, no match impact.

## Open questions / future work

- **Route visualization on the tariff detail page.** Today the load Routing tab has a `RouteMap` component. A future iteration could surface a similar map preview on the tariff template to show the shape being matched. Out of scope for the first cut.
- **Advanced route diffing in the diagnostic UI.** The reason strings described in §5 are terminal-style. A richer UI surface (Advanced Route Matched / Almost Matched) could live in the upcoming load-level "why this price" panel.
- **Multi-template tariffs.** A tariff matches exactly one route template today. A future extension could allow a tariff to list several alternative templates (OR'd together). Not in scope.
- **"Stop Off" event type.** The PortPro-style mockup the user referenced shows a "Stop Off" entry in the event palette. `PALETTE_EVENT_TYPES` in `lib/routing-rules.js` does not currently include `stop_off` — the closest existing types are `scale` (weigh station, operational) and `drop` (loaded/empty). If "Stop Off" should be its own lane-defining type, it needs to be added to `PALETTE_EVENT_TYPES` + the routing validation rules first, then surfaced in the advanced-route palette. Flagged as a pre-implementation question.
