---
name: 2026-04-24-driver-modal-polish-design
description: FU-042 — polish audit on the already-built Driver Modal. Aligns `EDITABLE_FIELDS` in API handlers with UI form state so every field the modal sends actually persists. Adds Mobile Permissions "Profile" section (memory spec's 3rd section, possibly missing). Sweeps dark-mode variants across all 4 tabs + modal. Verifies + adds audit-logging via logTenantAction with actorType='human'. Flags `drivers.status` state-machine gap as follow-up FU-077 (transition helper + status-history table) but doesn't build it — pure polish. No new migrations. Closes FU-042.
type: spec
---

# Driver Modal Polish — Design Spec (FU-042)

## Summary

The Driver Modal is substantially built — 4 tabs, 40+ fields in form state, schema 100% complete via migrations 001 + 002 (including `endorsements` + `mobile_permissions` JSONB columns). The feature is functional but unpolished: API `EDITABLE_FIELDS` may miss fields the UI sends, the Mobile Permissions tab may be missing its 3rd "Profile" section per memory spec, dark-mode variants may be incomplete per `dev_dark_mode_convention.md`, and audit-logging may not yet thread `actorType: 'human'` through driver CRUD.

This spec runs a surgical polish audit: read → diff → fix → commit. No new features. No new tables. Closes FU-042 and opens FU-077 for the separate `transitionDriverStatus` infrastructure work (deferred because building a new helper + history table + migration is net-new scope that doesn't fit a "polish" cycle).

First product-polish feature on a mostly-complete UI — exercises the `dd-qa` + `dd-ai-ready` skill gates on a real touchup pass.

## Goals

- Audit `EDITABLE_FIELDS` in `pages/api/tenant/drivers/[id]/index.js` PUT handler: compare against `components/drivers/DriverModal.js` `EMPTY` form state. Add every missing field so UI edits persist end-to-end.
- Audit `pages/api/tenant/drivers/index.js` POST handler: same — ensure every form field the create flow sends is inserted.
- Verify Mobile Permissions tab has all 3 sections from memory spec: Dispatch + Other + **Profile**. Add Profile section if absent (4 permissions: update truck info, update chassis info, update trailer info, update driver docs/expirations).
- Dark-mode variant sweep across `DriverModal.js`, `DriverInfoTab.js`, `DriverPreferencesTab.js`, `DriverMobilePermissionsTab.js`, `DriverNotesTab.js`. Every gray/white/border class gets a `dark:` variant.
- Verify driver create / update / delete API handlers call `logTenantAction` with `actorType: 'human'` (the B.1d foundation). Add any missing calls.
- Open FU-077 for the `transitionDriverStatus` + `driver_status_history` + migration 100 work (deferred).
- Closes FU-042.

## Non-Goals (explicitly out of scope)

1. **No `transitionDriverStatus` helper.** `drivers.status` (active/inactive/on_leave) is a state machine that ought to have a transition helper + history table per the Stream B.1a pattern, but building it is net-new infrastructure. Deferred to FU-077.
2. **No new migrations.** Schema is complete; any "missing" field is a UI/API gap, not a schema gap.
3. **No ELD integration.** The "Connect to ELD" button stays stub.
4. **No expiration-date alerts or notifications.** Dashboard / dispatcher warnings for upcoming expirations are a separate feature.
5. **No load-auto-matching from endorsements.** Using `drivers.endorsements.hazmat=true` to filter eligible drivers when assigning a hazmat load is a separate dispatcher-side feature.
6. **No new tests unless fixing something that requires one.** A pure polish pass (dark-mode + EDITABLE_FIELDS + audit-logging) rarely needs new tests; regression-run the existing suite.
7. **No refactoring beyond the 5 listed files.** Don't touch unrelated driver code (`DriverPayRatesTab.js`, `pay-rates/`, etc.) unless necessary.
8. **No changes to `drivers.endorsements` or `drivers.mobile_permissions` JSONB shapes.** UI already reads/writes these; schema was set up for it.

## Locked Decisions

| # | Decision | Rationale |
|---|---|---|
| D1 | Audit-driven — no net-new features | Pure polish; user said "we don't have a specific gap, just polishing" |
| D2 | FU-077 tracks the state-machine infrastructure separately | `transitionDriverStatus` + history table + migration is net-new, doesn't fit a polish cycle |
| D3 | `logTenantAction` defaults `actorType: 'human'` per B.1d | No explicit `actorType` needed in handler code — default suffices for UI-initiated driver edits |
| D4 | Mobile Permissions Profile section: add if absent | Memory spec lists 4 Profile permissions; current file is 91 lines (2 sections visible); add the 3rd |
| D5 | Dark-mode audit uses `dev_dark_mode_convention.md` rules | Every gray/white/border class in the 5 files gets a `dark:` variant |
| D6 | No migration 100 in this spec | Schema is complete; additions (e.g., driver_status_history for FU-077) are separate |
| D7 | No test additions unless a fix introduces untested behavior | Existing test suite regression-checks; polish rarely requires new tests |

## Scope — 5 files touched (maximum)

1. `pages/api/tenant/drivers/index.js` (POST handler — ensure all UI fields accepted)
2. `pages/api/tenant/drivers/[id]/index.js` (PUT handler — EDITABLE_FIELDS audit)
3. `components/drivers/DriverModal.js` (dark-mode sweep)
4. `components/drivers/tabs/DriverInfoTab.js` (dark-mode sweep)
5. `components/drivers/tabs/DriverPreferencesTab.js` (dark-mode sweep)
6. `components/drivers/tabs/DriverMobilePermissionsTab.js` (dark-mode sweep + add Profile section if missing)
7. `components/drivers/tabs/DriverNotesTab.js` (dark-mode sweep — trivial, 17 lines)

## Testing

Regression-check full test suite after changes. No new tests required unless an issue surfaces that warrants one (e.g., if `EDITABLE_FIELDS` adds a complex field type that needs validation).

## Risks

1. **EDITABLE_FIELDS might include fields the schema doesn't have.** Low probability — migration 002 added every UI-state field. Mitigation: cross-reference against schema during the audit.
2. **Mobile Permissions Profile section might already exist under different labels.** Memory spec is 19 days old. Read the actual file before adding; if the section is there but labeled differently, no change needed.
3. **Dark-mode sweep produces a large diff.** ~5 files × dozens of classes each = potentially 100+ class-string touches. Mitigation: grep first (`grep -nE "(bg|text|border)-(white|gray|slate)" | grep -v "dark:"`), then touch only the unmatched lines.
4. **Audit-log missing from a handler.** If so, add via `logTenantAction` with defaults. No spec change; the helper defaults are correct.

## Open Questions (deferred to plan)

1. **Exact `EDITABLE_FIELDS` gaps** — plan enumerates by diffing PUT handler against DriverModal `EMPTY` state.
2. **Profile section present or not** — plan's first read confirms.
3. **Which audit-log calls (if any) are missing** — plan enumerates from reading the 2 API handlers.

## What closes

- FU-042 closes (driver modal polish shipped)
- FU-077 opens — `transitionDriverStatus` helper + `driver_status_history` table + migration for driver state transitions. Follow-up, not blocking.
