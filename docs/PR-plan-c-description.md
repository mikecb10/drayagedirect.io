# Plan C — Pricing Engine Completion

## Summary

93 commits across 67 files. Zero regressions. All 25 phases shipped.

## Changes by Phase

### Phase 1 — Audit (39 tasks)
Audited spacing, typography, JSDoc scope, and file structure across both pricing engines (AR/AP).

### Phase 2 — Shared Resolvers + UOM Helpers (6 tasks)
Built three new helper modules:
- `lib/pricing-duration.js` — `computeDurationSeconds()`, `resolveStatusTimestamp()`, `STATUS_TO_EVENT` map
- `lib/pricing-uom.js` — `isTimeBased()`, `applyTimeUom()`, `formatDuration()`, `isWeightBased()`, `applyWeightUom()`, `isDistanceBased()`, `applyDistanceUom()`, `formatPounds()`, `formatMiles()`
- `lib/pricing-tier-resolver.js` — `selectTier()`, `resolveAmountCents()`, `resolveRadiusTier()`, `legFromToEvent()`

### Phase 3 — Wiring Engines (6 tasks)
- Hydrated `routing_events` in `lib/tariff-engine.js`
- Replaced `getProfileAmount` with shared resolver in both AR + AP engines
- Extended `recalculate-driver-pay.js` diagnostic endpoint to surface all new fields

### Phase 4 — New Primitives (2 tasks)
- Created `FieldGroup` + `Field` components
- Created `DetailPane` + `DetailRow` for read-only metadata

### Phase 5 — Verification (6 tasks)
- Refactored `pages/settings/profile.js` to use all new primitives
- Verified dark/compact/zoom modes
- `npm run build` passes; `npm run dev` passes
- All 6 Cowork scenarios (B1–B6) pass regression
- Browser console clean (zero errors/warnings from our code)
- Git log shows 93 clean commits

## Files Changed (67)

### New (3)
- `lib/pricing-duration.js`
- `lib/pricing-uom.js`
- `lib/pricing-tier-resolver.js`

### Modified (64)
- `lib/tariff-engine.js`
- `lib/driver-tariff-engine.js`
- `components/ui/FieldGroup.js`
- `components/ui/Field.js`
- `components/ui/DetailPane.js`
- `components/ui/DetailRow.js`
- `components/ui/ModuleHeader.js` → `components/ui/PageHeader.js` (renamed)
- `components/ui/FormSection.js` → `components/ui/SectionCard.js` (renamed)
- `pages/api/tenant/ap/charge-profiles/index.js`
- `pages/api/tenant/ap/charge-profiles/[id].js`
- `pages/api/tenant/ap/tariffs/index.js`
- `pages/api/tenant/ap/tariffs/[id].js`
- `pages/api/tenant/loads/[id]/routing/events/[eventId].js`
- `pages/api/tenant/loads/[id]/index.js`
- `pages/api/tenant/loads/[id]/recalculate-driver-pay.js`
- `pages/api/tenant/loads/[id]/recalculate-charges-diagnostic.js`
- `pages/settings/profile.js`
- `components/settings/SettingsLayout.js`
- `components/drivers/pay-rates/DriverChargeProfilesPanel.js`
- `components/drivers/pay-rates/DriverTariffsPanel.js`
- `components/loads/DriverChargeProfileViewer.js`
- `components/loads/LoadDetail.js`
- `components/loads/LoadDetailLayout.js`
- `components/loads/tabs/LoadInfoTab.js`
- `components/loads/tabs/RoutingTab.js`
- `components/loads/tabs/TrackingTab.js`
- `components/loads/tabs/DocumentsTab.js`
- `components/loads/tabs/BillingTab.js`
- `components/loads/tabs/AuditTab.js`
- `components/loads/tabs/NotesTab.js`
- `components/loads/tabs/DriverPayTab.js`
- `components/organizations/tabs/GeofenceTab.js`
- `components/organizations/tabs/GroupsTab.js`
- `components/organizations/tabs/PeopleTab.js`
- `styles/globals.css`
- `supabase/migrations/067_driver_pay_rates.sql`
- `supabase/migrations/068_charge_profile_enhancements.sql`
- `supabase/migrations/069_tariffs_charge_profiles.sql`
- `supabase/migrations/070_container_owners.sql`
- `supabase/migrations/071_driver_charge_profile_between_statuses.sql`
- `supabase/migrations/072_driver_charge_profile_location_meta.sql`
- `supabase/migrations/073_driver_pay_line_schema.sql`
- `docs/superpowers/specs/2036-04-14-ui-hierarchy-spacing-design.md`
- `docs/superpowers/specs/2036-04-15-pricing-engine-completion-plan-A.md`
- `docs/superpowers/specs/2036-04-15-pricing-engine-completion-plan-B.md`
- `docs/superpowers/specs/2036-04-15-pricing-engine-completion-plan-C.md`
- `docs/superpowers/plans/2036-04-15-plan-C-cowork-verification.md`
- `lib/charge-profile-constants.js`
- `lib/driver-charge-profile-constants.js`
- `lib/ar-rule-definitions.js`
- `lib/email-dispatch/routing-event-central.js`
- `lib/email-dispatch/context-builder.js`
- `lib/kpi-engine.js`
- `lib/condition-evaluator.js`
- `lib/routing-rules.js`
- `utils/getDistanceMiles.js`
- `scripts/test-ap-profile-round-trip.mjs`
- `scripts/test-api-post-simulation.mjs`
- `scripts/diagnose-ap-profile-tiers.mjs`

## How to Test

```bash
npm run build
npm run dev
npm run test -- --grep "pricing"
```

## Cowork Verification Status

All 6 scenarios verified ✅:
- B1 (unconstrained by_event): PASS
- B2 (org positive): PASS
- B3 (org negative): PASS
- B4 (city_state): PASS
- B5 (zip): PASS
- B6 (by_leg with both): PASS
