---
name: 2026-04-22-dry-run-design
description: Dry Run feature — record a leg attempt that didn't complete its operational goal, producing a customer AR charge and a driver AP pay line. Lives as a line-item tied to a routing event (not an event itself).
type: spec
---

# Dry Run Feature — Design Spec

## Summary

Drayage drivers frequently perform a leg (drive to a terminal / customer / yard) without completing the operational goal — container not released, consignee refused delivery, yard closed, wrong chassis, etc. Today the dispatcher manually adds an ad-hoc charge in the Billing tab AND a separate pay line in the Driver Pay tab, with no linkage between them and no record of *which leg* it applied to.

The Dry Run feature replaces that workflow with a single entry point per leg. A dispatcher clicks **+ Add Dry Run** on the leg card, fills a slide-over popup, and on save gets: (1) an AR line item in the load's charge set, (2) an AP line item on the driver's pay, and (3) a first-class `dry_run_attempts` record that ties both sides together with auditable rate-source tracking.

## Goals

- One click from Routing tab to "record a dry run" — no tab-switching, no manual double-entry across Billing + Driver Pay.
- Reuse the existing charge-profile and driver-charge-profile engines (preset path) so dry-run pricing inherits rules, conditions, and time-range validity.
- Preserve an escape hatch (manual path) for one-off scenarios the preset doesn't cover.
- Keep routing timeline honest — a dry run is metadata attached to a leg, not a second event in the timeline.
- Safe data integrity: invoiced / settled dry runs are read-only; unbilled ones can be detached when a leg is deleted rather than destroyed.

## Non-Goals (explicitly out of scope for v1)

1. Driver mobile entry (dispatcher-only in v1).
2. "Move dry run to another leg" action.
3. "Unattached dry runs" section on the Routing tab.
4. Rules-engine extension to key conditions off `event_type`.
5. Auto-detecting dry runs from driver GPS traces.
6. Audit of how Pull-leg distance is computed today (tracked as separate follow-up).

## Locked Decisions (Q1–Q8 summary)

| # | Decision |
|---|---|
| Q1 | Shape: line-item tied to a leg, **not** a routing event |
| Q2 | Pricing: **hybrid** — preset profile OR manual override (full D) |
| Q3 | Mileage: auto pre-fill from leg's one-way distance |
| Q4 | Scope: any event with a physical location |
| Q5 | Multiplicity: multiple dry runs allowed per leg |
| Q6 | Data model: parent `dry_run_attempts` table + derived AR/AP rows (approach #2) |
| Q7 | UI placement: labeled button + inline list at leg-card footer |
| Q8 | Popup container: right-side slide-over (matches `EmailComposeSlideOver`) |

Rollout: full hybrid ships in one plan — no phasing.

## Data Model

### New table: `dry_run_attempts`

```sql
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
  deleted_at                timestamptz NULL
);

CREATE INDEX idx_dry_run_attempts_tenant_event ON dry_run_attempts (tenant_id, event_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_dry_run_attempts_tenant_order ON dry_run_attempts (tenant_id, order_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_dry_run_attempts_tenant_driver ON dry_run_attempts (tenant_id, driver_id) WHERE deleted_at IS NULL;
```

**Note:** `event_id` is nullable to support the **detach** flow when a leg is deleted (see Save Flow & Edge Cases).

### FK additions on existing tables

```sql
ALTER TABLE order_charge_set_line_items
  ADD COLUMN dry_run_attempt_id uuid NULL
  REFERENCES dry_run_attempts(id) ON DELETE CASCADE;

ALTER TABLE order_driver_pay_lines
  ADD COLUMN dry_run_attempt_id uuid NULL
  REFERENCES dry_run_attempts(id) ON DELETE CASCADE;
```

### Flag on existing profile tables

```sql
ALTER TABLE charge_profiles         ADD COLUMN is_dry_run boolean NOT NULL DEFAULT false;
ALTER TABLE driver_charge_profiles  ADD COLUMN is_dry_run boolean NOT NULL DEFAULT false;
```

### New enum value

```sql
ALTER TYPE driver_pay_line_type ADD VALUE IF NOT EXISTS 'dry_run';
```

### Invariants (enforced at DB + app layer)

1. `rate_source = 'preset'` → both `charge_profile_id` AND `driver_charge_profile_id` must be non-null.
2. `rate_source = 'manual'` → both profile IDs must be null.
3. `rate_method = 'per_mile'` → `miles` must be non-null and > 0.
4. Soft-delete cascade: setting `deleted_at` on the parent soft-deletes both derived line items (via trigger OR app code in the DELETE endpoint).
5. `event_id` deletion is gated at the API layer (see Edge Cases) — the FK uses `ON DELETE RESTRICT` as a safety net, but dispatchers interact via the explicit "Detach" or "Delete All" action in the UI.

## API Surface

All under `/api/tenant/loads/[id]/dry-runs` except the preset profile lookup (reuses existing endpoints with a filter).

```
POST   /api/tenant/loads/[id]/dry-runs/preview      # live-preview compute (popup)
POST   /api/tenant/loads/[id]/dry-runs              # create attempt + derived rows
GET    /api/tenant/loads/[id]/dry-runs              # list for load, optional ?event_id=
PATCH  /api/tenant/loads/[id]/dry-runs/[attemptId]  # edit amounts/driver/notes
DELETE /api/tenant/loads/[id]/dry-runs/[attemptId]  # soft delete; cascades
```

Preset lookup:

```
GET /api/tenant/charge-profiles?is_dry_run=true
GET /api/tenant/driver-charge-profiles?is_dry_run=true
```

### POST payload (create)

```json
{
  "event_id": "uuid",
  "driver_id": "uuid",
  "occurred_at": "2026-04-22T14:30:00Z",
  "rate_source": "preset",
  "charge_profile_id": "uuid",
  "driver_charge_profile_id": "uuid",
  "rate_method": "per_mile",
  "miles": 42.5,
  "ar_amount_cents": 12500,
  "ap_amount_cents": 8000,
  "notes": "Container not released at BNSF"
}
```

### Server-side compute rule (critical)

- **`rate_source = 'preset'`** → server **recomputes** `ar_amount_cents` and `ap_amount_cents` using the existing charge-profile and driver-charge-profile engines. Client-sent amounts are ignored. The preview endpoint returns what the compute will be so the UI can show live numbers without storing them.
- **`rate_source = 'manual'`** → server **trusts** client-sent amounts, applying bounds checks (≥ $0, ≤ a sane ceiling like $100k).

Rationale: preset profiles mutate over time. Snapshotting the computed amount at save time (Edge Case #5) is intentional — it preserves pricing history for dispute defense.

### Save flow — single transaction

```
BEGIN;
  1. Validate: event belongs to load, driver active, permissions, CHECK invariants
  2. Compute amounts (preset path) OR validate (manual path)
  3. INSERT dry_run_attempts (snapshot amounts, profile IDs, miles, notes)
  4. Find-or-create open charge_set for the load's bill-to customer (reuses existing logic)
     INSERT order_charge_set_line_items with:
       name = "Dry Run — <event label>"
       description = "Driver: <name> · <miles> mi · <occurred_at>"
       per_unit_price_cents = ar_amount_cents
       unit_count = 1
       total_cents = ar_amount_cents
       is_auto = false
       dry_run_attempt_id = <attempt.id>
  5. INSERT order_driver_pay_lines with:
       driver_id, line_type = 'dry_run'
       miles, amount_cents = ap_amount_cents
       worked_at = occurred_at
       description = same as above
       dry_run_attempt_id = <attempt.id>
  6. Audit: tenant_audit_log action='dry_run.create' with payload snapshot
COMMIT;
```

Any step fails → full rollback.

### Permissions

Create / edit / delete requires: `LOAD_EDIT` + `ACCOUNTS_RECEIVABLE` + `DRIVER_PAY` (or `ALL`). Typical dispatcher role has all three.

### Audit

Every create / edit / soft-delete writes a `tenant_audit_log` row: `action='dry_run.{create|update|delete}'`, `entity_type='dry_run'`, `entity_id=<attempt.id>`, `new_values` = serialized payload.

## UI

### Button placement (Q7 / C)

On every event card whose event type has a physical location (`PICK_UP_CONTAINER`, `DELIVER_CONTAINER`, `RETURN_CONTAINER`, `DROP_CONTAINER`, `HOOK_CHASSIS`, `TERMINATE_CHASSIS`, `STOP_OFF`):

- **When no dry runs exist on the leg:** a small labeled button `+ Add Dry Run` at the bottom of the leg card, below the status rows and metrics panel.
- **When dry runs exist:** an inline summary row above the button — `⚠ 2 dry runs · $375 AR · $200 AP · tap to expand`. Clicking expands a stacked list of dry runs (driver, miles, amount, occurred_at). Each row clickable to open the slide-over in edit mode.

### Popup container (Q8 / B — right-side slide-over)

Component: `components/loads/routing/DryRunSlideOver.js` — new component, pattern matches `components/ar/EmailComposeSlideOver.js`.

**Fields (top → bottom):**

1. **Header:** `Add Dry Run` (or `Edit Dry Run`) — subtitle shows the leg name + location.
2. **What happened section:**
   - Driver picker (default: leg's current driver if assigned)
   - Occurred at (datetime picker, default: now)
3. **Rate section:**
   - Rate source dropdown: `[Preset ▾]` / `[Manual]`
   - **If preset:** two dropdowns — AR profile + AP profile (populated from `GET /api/tenant/{,driver-}charge-profiles?is_dry_run=true`)
   - **If manual:** rate method (`fixed` / `per_mile`) + rate input; if `per_mile`, miles input (pre-filled from leg's one-way distance)
4. **Notes section:** textarea, optional.
5. **Live preview box:** `$375 AR · $200 AP` — updates as fields change via the `/preview` endpoint (debounced).
6. **Footer:** `[Cancel]` `[Save Dry Run]`.

### Billing tab appearance

Line shows as:
- **Name:** `Dry Run — Pull from Terminal`
- **Description:** `Driver: John Doe · 42.5 mi · 2026-04-22 14:30`
- **Amount:** formatted AR amount
- Clicking the row opens `DryRunSlideOver` in edit mode.

### Driver Pay tab appearance

Line shows as:
- **Line type:** `dry_run`
- **Description:** same as Billing
- **Amount / miles:** as saved
- Clicking the row opens `DryRunSlideOver` in edit mode.

## Save Flow & Edge Cases

| Scenario | Behavior |
|---|---|
| **Leg delete, dry run already invoiced or settled** | Blocked with friendly error: "Contains N invoiced/settled dry runs. Create a credit memo / pay adjustment first." |
| **Leg delete, all dry runs unbilled** | Confirmation modal: "This leg has 2 dry runs ($375 pending AR, $200 pending AP). [Detach — keep as load-level charges] [Delete leg + all dry runs] [Cancel]." Default action = Detach. |
| **Detach action** | Sets `dry_run_attempts.event_id = NULL` for all runs on the leg. Leg deletes cleanly. Line items untouched. Detached runs continue to show in Billing + Driver Pay tabs; they do NOT appear on any leg card (no leg to attach to). |
| **Leg reorder or move to different Container Move** | Event `id` is stable → dry runs follow the event. No action needed. |
| **Driver change on the Container Move after dry run exists** | Dry run's `driver_id` is independent and unchanged — it records the driver who actually did the attempt, decoupled from the leg's current assignee. |
| **Tenant edits preset profile rate after dry runs saved under it** | Past dry runs keep their snapshotted `ar_amount_cents` / `ap_amount_cents`. Only future dry runs use the new rate. |
| **Dry run's AR line invoiced** | Edit / soft-delete blocked. UI shows: "This dry run has been invoiced. Create a credit memo to reverse." |
| **Dry run's AP line in closed settlement period** | Edit / soft-delete blocked. UI shows: "This dry run is in a closed settlement. Create a pay adjustment to reverse." |
| **No open charge set on load** | Save auto-creates one (`status='open'`, `customer_id = load bill_to`). |
| **Soft-delete cascade** | Parent `deleted_at` set → trigger OR app code soft-deletes both line items so invoices regenerate correctly. |

## Settings

### Charge Profiles editor (`/settings/charge-profiles/[id]`)

Add a single checkbox:
- Label: **"Available for dry runs"**
- Binds `charge_profiles.is_dry_run`
- Default unchecked

### Driver Charge Profiles editor (`/settings/driver-charge-profiles/[id]`)

Same checkbox, binds `driver_charge_profiles.is_dry_run`, default unchecked.

### Discovery

Tenants who never check the box: popup's preset dropdown is empty, only the "Manual" option is usable. That's a valid end-state — no migration / setup required.

## Testing Strategy

Matches the proven cadence from the AR filter-bar work.

### Unit tests — new file `tests/dry-run-engine.test.mjs`

~25 tests covering:
- Preset pricing compute (fixed, per_mile, profile validation)
- Manual pricing validation (bounds, negative rejection)
- Leg-delete cascade paths (RESTRICT, detach, delete-all)
- Invariants (rate_source ↔ profile IDs; per_mile ↔ miles; soft-delete cascade)

Target total test count after feature: ~71 (46 existing + 25 new).

### Live gates via Chrome subagent (ZERO screenshots rule)

Twelve gates, batched 3–4 per subagent, ~3 batches total:

1. Leg card shows `+ Add Dry Run` button + empty list when no runs exist
2. Slide-over opens on click, miles pre-fill from leg's distance
3. Preset path: pick AR + AP profiles → live preview updates → save
4. Manual path: fixed amount → save
5. Manual path: per_mile × miles → save
6. Leg card shows summary "1 dry run · $375 AR · $200 AP"
7. Billing tab shows AR line named "Dry Run — Pull from Terminal"
8. Driver Pay tab shows AP line with `line_type='dry_run'`
9. Edit existing dry run via slide-over (re-open from leg-card list)
10. Delete leg with unbilled dry run → confirmation → Detach → leg gone, run detached
11. Invoice the AR line → edit blocked with "Create credit memo" message
12. Settings: toggle `is_dry_run` on a charge profile → appears in slide-over dropdown

### Code review

`superpowers:code-reviewer` agent runs against the full diff before ship. Target: catch real semantic bugs, not style nits. Expected reviewer focus areas: transaction atomicity, invariant enforcement, rate-source / preset-lookup correctness, cascade semantics on detach vs delete-all.

## Open Follow-Ups (tracked, not built)

1. **Pull-leg distance audit** — how is the "Distance" field on Pull from Terminal legs computed today? Home yard? Office HQ? Flat? This affects the accuracy of the mileage pre-fill in the dry-run popup.
2. **Move dry run to another leg** — cleaner primitive than detach-then-reattach; build when dispatchers actually need it.
3. **Driver mobile entry** — dispatcher-only for v1; mobile entry warrants its own spec.
4. **"Unattached dry runs" section on Routing tab** — hold until dispatchers report detached runs feel "lost."
5. **Rules-engine extension to key off `event_type`** — enables preset profiles that apply only to Pull-leg dry runs vs Deliver-leg dry runs.
6. **Auto-detect dry runs from GPS** — future reliability enhancement; requires telematics integration.

## File / Component Map (for the implementation plan)

### New

- `supabase/migrations/XXX_dry_runs.sql` — schema changes above
- `pages/api/tenant/loads/[id]/dry-runs/index.js` — GET list, POST create
- `pages/api/tenant/loads/[id]/dry-runs/preview.js` — POST preview compute
- `pages/api/tenant/loads/[id]/dry-runs/[attemptId]/index.js` — PATCH, DELETE
- `lib/dry-run-engine.js` — compute functions (preset pricing, manual validation, invariants)
- `components/loads/routing/DryRunSlideOver.js` — the slide-over popup
- `components/loads/routing/DryRunList.js` — inline list on leg card (existing-runs summary + expanded view)
- `tests/dry-run-engine.test.mjs` — unit tests

### Modified

- `components/loads/routing/EventRow.js` — render `+ Add Dry Run` button + `<DryRunList>` for events with a physical location
- `components/loads/tabs/BillingTab.js` — detect `dry_run_attempt_id` on line items and open `DryRunSlideOver` on row-click
- `components/loads/tabs/DriverPayTab.js` — same for pay lines with `line_type='dry_run'`
- `pages/api/tenant/charge-profiles/index.js` — accept `?is_dry_run=true` filter
- `pages/api/tenant/driver-charge-profiles/index.js` — same
- `pages/api/tenant/loads/[id]/routing/events/[eventId].js` DELETE handler — implement the two-tier delete (invoiced/settled check + detach vs delete-all)
- `components/settings/ChargeProfileEditor.js` — add `is_dry_run` checkbox
- `components/settings/DriverChargeProfileEditor.js` — same

## Dependencies / Assumptions

- Existing charge-profile engine at `lib/condition-evaluator.js` + profile compute handles the preset AR path with no changes needed.
- Existing driver-charge-profile engine (AP side) at `lib/driver-pay-engine.js` (or equivalent — confirm path during implementation) handles the preset AP path.
- `order_charge_set_line_items` supports `is_auto = false` and manual pricing — no new shape needed beyond the FK column.
- `order_driver_pay_lines` accepts arbitrary `line_type` values via the enum extension.
- The existing `find-or-create open charge set` helper from the manual-line-item flow is reusable here.

---

End of spec.
