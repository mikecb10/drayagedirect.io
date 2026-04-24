---
name: 2026-04-24-contact-groups-email-design
description: FU-043 — Finish the contact-groups email-auto-populate feature. Migration 099 enriches `organization_groups` with `purpose` + `is_default_for_purpose` columns. Auto-seeds 4 default groups (Billing, Operations, Dispatch, Rate Confirmation) on org creation + backfills existing orgs. Extends `resolveBillingEmails` to prefer default-for-purpose group members over legacy `customer_billing_emails` fallback chain. Polishes `GroupsTab` + `GroupModal` UI to expose purpose + default-for-purpose controls. No new email composer modal — invisible upgrade to existing invoice + rate-con send UX. First real product-polish feature built on the AI-ready foundation shipped in Streams A–B.1d.
type: spec
---

# Contact Groups Email — Design Spec (FU-043)

## Summary

FU-043 is the finishing layer on a contact-groups feature whose schema + UI + CRUD API were already shipped in migration 028 and the `organizations/*` API/components but never wired to the actual email-send flows. Today an admin can create groups like "Billing Team" inside an organization, but when the AR pipeline sends an invoice or rate confirmation, the recipient resolver ignores groups entirely — it falls back to legacy `customer_billing_emails` rows. The group mechanism exists but delivers no value.

This spec closes that gap. Migration 099 adds two columns to `organization_groups`: `purpose` (enum-style TEXT with CHECK constraint matching memory spec's vocabulary) and `is_default_for_purpose` (boolean). A partial unique index ensures at most one default group per purpose per organization. Four default groups — Billing, Operations, Dispatch, Rate Confirmation — auto-seed on new organization creation and backfill for existing organizations via the same migration.

The value unlock happens in `resolveBillingEmails` at `lib/ar/resolve-billing-email.js`: a new Step 0 queries the organization's default group matching the email purpose (billing for invoices, rate_confirmation for rate cons) and expands to its members' emails. If no default group exists (or it has no members with emails), fall through to the existing 4-step chain unchanged. Existing tenants who never configure groups see identical behavior; tenants who do configure groups get per-organization fine-grained recipient lists without UI changes to the send flow.

UI polish extends `GroupsTab` + `GroupModal`: display purpose as a badge, allow setting purpose on create/edit, allow marking a group as default-for-purpose (with an atomic swap when replacing an existing default). No changes to the invoice-send or rate-con-send UX — both remain one-click operations that just pick up better recipient defaults automatically.

First real product-polish feature built on the AI-ready foundation. Every `organization_groups` + `organization_group_members` INSERT, UPDATE, DELETE flows through `logTenantAction` with `actorType: 'human'` (human-initiated via the UI) or `actorType: 'system'` (auto-seeded on org creation, which is automation from the group's perspective even though a human created the org). Demonstrates that the foundation works for non-infrastructure feature work.

## Goals

- Enrich `organization_groups` schema: add `purpose TEXT` + `is_default_for_purpose BOOLEAN NOT NULL DEFAULT false` columns (migration 099). Purpose values enforced by CHECK: `'billing' | 'operations' | 'dispatch' | 'rate_confirmation' | 'management' | 'custom'`.
- Partial unique index: `(tenant_id, organization_id, purpose) WHERE is_default_for_purpose = true` — at most one default per purpose per org.
- Auto-seed 4 default groups (Billing, Operations, Dispatch, Rate Confirmation) on new org creation. Each marked `is_default_for_purpose = true` with a well-known name. Seeded via `logTenantAction` with `actorType: 'system'`.
- Migration 099 includes one-time backfill: for every existing organization, insert the 4 default groups if they don't exist. Idempotent via `NOT EXISTS` check.
- Extend `resolveBillingEmails` at `lib/ar/resolve-billing-email.js` with a new **Step 0** that queries the org's default-for-purpose group and returns its members' emails. Existing 4-step fallback chain preserved as Steps 1–4.
- UI polish in `components/organizations/tabs/GroupsTab.js` + `components/organizations/GroupModal.js`:
  - Show purpose as a colored badge on each group row
  - Allow selecting purpose from dropdown on create/edit
  - Checkbox "Set as default for this purpose" (with atomic swap — if another group already holds the default, transfer it)
- API updates:
  - `POST /api/tenant/organizations/index.js` — auto-seed 4 default groups after creating the org
  - `POST /api/tenant/organizations/[id]/groups/index.js` — accept `purpose` + `is_default_for_purpose` in request body; swap atomically if setting default
  - `PUT /api/tenant/organizations/[id]/groups/[groupId]/index.js` — accept purpose changes; swap atomically
- All audit-log writes use `actorType: 'human'` (user-initiated edits) or `actorType: 'system'` (migration backfill + org-creation auto-seeding).
- Tests: unit tests for the Step 0 resolver path, one round-trip test for default-swap atomicity.

## Non-Goals (explicitly out of scope)

1. **No new email composer modal with "Add from Group" picker.** The invoice + rate-con send flows stay one-click. An edit-recipients-before-send UI is a separate feature (FU-077 candidate).
2. **No bulk-send-to-group flow outside AR.** Memory spec mentions cross-customer mass email as a "bonus" — Stream-C territory (agent-driven).
3. **No cleanup of legacy `customer_contact_groups` (migration 002).** These tables are unused by any production code today. Leave them alone; track as a separate cleanup FU if someone wants to drop them.
4. **No cleanup of legacy `customer_billing_emails` fallback.** Steps 1–4 of the existing resolver chain stay intact as backward-compat for tenants who don't configure groups.
5. **No email-template-variable changes.** Template variables today reference customer/load fields — they don't need group-aware changes in this spec.
6. **No migration of existing `customer_billing_emails` rows into groups.** Tenants keep both systems; group preference (Step 0) simply wins when configured.
7. **No "Management" default group.** Memory spec included it but it doesn't map to any email-send flow today. Admins can create one manually with purpose `'management'`.
8. **No CC inheritance rules** ("always CC AR manager on Billing emails"). Memory spec lists this as a bonus feature; separate FU.
9. **No reply-routing / inbound email integration.** Deferred.
10. **No audit of existing data to ensure every tenant has a billing email somewhere.** Migration just backfills default groups; if they're empty, resolver falls through to Steps 1–4.
11. **No ML / smart group suggestions.** Pure manual configuration.

## Locked Decisions

| # | Decision | Rationale |
|---|---|---|
| D1 | `purpose` is TEXT with CHECK constraint, NOT an enum type | TEXT + CHECK is easier to extend (new purpose = `ALTER TABLE ... CHECK` migration). Enum migrations are expensive in Postgres. |
| D2 | `purpose` nullable — free-form groups without purpose continue to work | Backward-compat: existing custom groups (created before this spec) have `purpose = NULL` and participate in recipient resolution only via manual picker (future FU), never via auto-resolve |
| D3 | `is_default_for_purpose` enforced as at-most-one via partial unique index | Atomic: if admin sets a new default, existing default must be unset in the same transaction (handled in API handler) |
| D4 | 4 default groups seeded: Billing, Operations, Dispatch, Rate Confirmation | Matches every major email-send flow DrayageDirect has today. Management skipped (no email flow yet). |
| D5 | Auto-seed on org creation uses `actorType: 'system'` | The human created the org, but the group seeding is automation following from that. Distinguishes in audit log from manual group creation. |
| D6 | Migration backfill also uses `actorType: 'system'` via direct SQL INSERT (no logTenantAction call from migration) | Migrations run outside the app's audit layer; SQL-level INSERT directly uses `actor_type = 'system'` column value |
| D7 | Step 0 in resolver only returns emails if group has >=1 member with a non-null email | Empty groups fall through to legacy chain rather than returning `{to: []}`, which would mean "send to nobody" |
| D8 | Step 0 does NOT check `is_active` on contacts (yet) | `organization_contacts.is_active` exists (migration 028) but isn't surfaced anywhere yet. Simpler first pass: all contacts in a group are eligible. If inactive-contact exclusion is needed, separate follow-up. |
| D9 | Default-swap on create/update happens in the API handler, not via DB trigger | Easier to reason about; trigger would need row-version tracking for audit. Handler: find existing default, unset it, set new default — all in one transaction via Supabase's `.update().eq(...)` then `.insert(...)` pattern (non-atomic; acceptable given the rarity of concurrent default-swap) |
| D10 | Migration deploy order: migration 099 FIRST, then code | Safe: existing code doesn't read `purpose` / `is_default_for_purpose`; migration adds columns with safe defaults. New code reads them; safe because migration ran first. |

## Data Model

### Migration 099: `organization_groups` schema enrichment + default-group backfill

**File:** `supabase/migrations/099_contact_groups_purpose.sql`

```sql
-- ============================================================
-- Migration 099: Contact groups purpose + default-for-purpose
-- ============================================================
-- Adds `purpose` + `is_default_for_purpose` columns to
-- organization_groups so the recipient resolver can prefer group
-- members over legacy customer_billing_emails. Backfills 4 default
-- groups for every existing organization: Billing, Operations,
-- Dispatch, Rate Confirmation.
--
-- Purpose nullable: existing free-form custom groups preserved.
-- Partial unique index enforces at-most-one-default per purpose.
--
-- Part of FU-043 (contact groups email feature).
-- ============================================================

BEGIN;

ALTER TABLE organization_groups
  ADD COLUMN IF NOT EXISTS purpose TEXT;

ALTER TABLE organization_groups
  DROP CONSTRAINT IF EXISTS chk_org_groups_purpose;

ALTER TABLE organization_groups
  ADD CONSTRAINT chk_org_groups_purpose
  CHECK (purpose IS NULL OR purpose IN (
    'billing', 'operations', 'dispatch', 'rate_confirmation', 'management', 'custom'
  ));

ALTER TABLE organization_groups
  ADD COLUMN IF NOT EXISTS is_default_for_purpose BOOLEAN NOT NULL DEFAULT false;

-- At most one default per (tenant, organization, purpose).
-- Partial index: only applies when is_default_for_purpose = true,
-- so non-defaults can freely coexist.
CREATE UNIQUE INDEX IF NOT EXISTS idx_org_groups_default_purpose
  ON organization_groups (tenant_id, organization_id, purpose)
  WHERE is_default_for_purpose = true AND purpose IS NOT NULL;

-- ============================================================
-- Backfill: seed 4 default groups for every existing organization
-- ============================================================
-- Uses NOT EXISTS to stay idempotent if re-run. Cross-join each
-- customer row with a values list of the 4 defaults, skipping any
-- that already exist at the (tenant, org, purpose) default slot.
--
-- Rows inserted here are attributed via actor_type='system' once
-- migration 098's actor_type column exists on organization_groups.
-- Note: organization_groups does NOT yet have actor_type (migration 098
-- only touched the 6 action-recording tables, not CRUD tables). So the
-- insert here is plain — no actor_type column on organization_groups.
-- Audit attribution happens when the _members_ get added, not when
-- groups themselves get created.
-- ============================================================

INSERT INTO organization_groups
  (tenant_id, organization_id, name, purpose, is_default_for_purpose, description)
SELECT
  c.tenant_id,
  c.id,
  defaults.group_name,
  defaults.purpose_value,
  true,
  defaults.default_description
FROM customers c
CROSS JOIN (VALUES
  ('Billing',            'billing',            'Default billing group — receives invoice emails'),
  ('Operations',         'operations',         'Default operations group — receives operational notifications'),
  ('Dispatch',           'dispatch',           'Default dispatch group — receives dispatch notifications'),
  ('Rate Confirmation',  'rate_confirmation',  'Default rate-confirmation group — receives rate con emails')
) AS defaults(group_name, purpose_value, default_description)
WHERE c.deleted_at IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM organization_groups g
    WHERE g.tenant_id = c.tenant_id
      AND g.organization_id = c.id
      AND g.purpose = defaults.purpose_value
      AND g.is_default_for_purpose = true
  );

NOTIFY pgrst, 'reload schema';

COMMIT;
```

**Row count estimate:** 4 × (active-customer count per tenant). For a tenant with 500 customers, that's 2,000 new rows in `organization_groups`. All empty (no members until admins populate them). Falls through to legacy chain until populated.

### New indexes (part of migration 099)

- `idx_org_groups_default_purpose` — partial unique index on `(tenant_id, organization_id, purpose) WHERE is_default_for_purpose = true AND purpose IS NOT NULL`

## API Contracts

### `POST /api/tenant/organizations/index.js` — auto-seed on org creation

After inserting the new organization (existing logic unchanged), insert 4 default groups:

```js
const DEFAULT_GROUPS = [
  { name: 'Billing',            purpose: 'billing',            description: '...' },
  { name: 'Operations',         purpose: 'operations',         description: '...' },
  { name: 'Dispatch',           purpose: 'dispatch',           description: '...' },
  { name: 'Rate Confirmation',  purpose: 'rate_confirmation',  description: '...' },
];

await svc.from('organization_groups').insert(
  DEFAULT_GROUPS.map((g) => ({
    tenant_id: ctx.tenantId,
    organization_id: newOrg.id,
    name: g.name,
    purpose: g.purpose,
    is_default_for_purpose: true,
    description: g.description,
  }))
);

// Audit: one log entry for the seed operation (not 4 separate ones)
await logTenantAction(svc, {
  tenantId: ctx.tenantId,
  userId: ctx.userId,
  action: 'organization.default_groups_seeded',
  entityType: 'organization',
  entityId: newOrg.id,
  newValues: { groups: DEFAULT_GROUPS.map((g) => g.name) },
  ipAddress: getClientIp(req),
  actorType: 'system',  // auto-seed = system action
});
```

### `POST /api/tenant/organizations/[id]/groups/index.js` — accept purpose + default

Extend the existing handler:

```js
const { name, description, member_ids, purpose, is_default_for_purpose } = req.body || {};

// If setting as default for a purpose, first unset any existing default
if (is_default_for_purpose && purpose) {
  await svc
    .from('organization_groups')
    .update({ is_default_for_purpose: false })
    .eq('tenant_id', ctx.tenantId)
    .eq('organization_id', id)
    .eq('purpose', purpose)
    .eq('is_default_for_purpose', true);
}

const { data: group, error } = await svc
  .from('organization_groups')
  .insert({
    tenant_id: ctx.tenantId,
    organization_id: id,
    name,
    description: description || null,
    purpose: purpose || null,
    is_default_for_purpose: !!is_default_for_purpose,
  })
  .select().single();
// ... existing logTenantAction call with actorType: 'human' (default)
```

### `PUT /api/tenant/organizations/[id]/groups/[groupId]/index.js` — accept purpose changes

Analogous — if the update sets `is_default_for_purpose = true` AND a different group already holds it, unset the other first (same pattern).

### `resolveBillingEmails` at `lib/ar/resolve-billing-email.js` — new Step 0

Insert BEFORE the existing Step 1:

```js
// Step 0: default group for the email purpose
const purposeByEmailType = {
  invoice: 'billing',
  rate_confirmation: 'rate_confirmation',
  statement: 'billing', // statements use billing group too
};
const groupPurpose = purposeByEmailType[emailType];

if (groupPurpose) {
  const { data: defaultGroup } = await svc
    .from('organization_groups')
    .select('id, members:organization_group_members(contact:organization_contacts(email, is_active))')
    .eq('tenant_id', tenantId)
    .eq('organization_id', customerId)
    .eq('purpose', groupPurpose)
    .eq('is_default_for_purpose', true)
    .maybeSingle();

  if (defaultGroup?.members?.length > 0) {
    const emails = defaultGroup.members
      .map((m) => m.contact?.email)
      .filter((e) => typeof e === 'string' && e.length > 0);
    if (emails.length > 0) {
      return { to: emails, source: 'organization_groups' };
    }
  }
}

// Fall through to existing Step 1 (unchanged)
```

Note: per D8, we do NOT filter by `is_active` on contacts yet. Add later if needed.

## UI Changes

### `components/organizations/tabs/GroupsTab.js`

- Add purpose badge on each group row (color-coded: billing=green, rate_con=blue, ops=yellow, dispatch=orange, management=purple, custom=gray)
- "Default" star/star icon on the group that's `is_default_for_purpose = true` (only one per purpose)
- "Add Group" button opens `GroupModal` with purpose dropdown + default checkbox

### `components/organizations/GroupModal.js`

New fields:
- **Purpose dropdown** — options: Billing, Operations, Dispatch, Rate Confirmation, Management, Custom (or None)
- **Default checkbox** — "Set as default for this purpose" — disabled if purpose is None/Custom
- On submit with `is_default_for_purpose=true`: API handler swaps atomically

### No changes to invoice/rate-con send flows

The send UX stays one-click. The recipient display in the AR pipeline ("Sending to: jane@acme.com, ar@acme.com") just pulls from the group members instead of the legacy table. Same look and feel.

## Testing

### `tests/ar-resolve-billing-email-groups.test.mjs` (new)

Cover the new Step 0 path:

1. **Group with members wins** — seed `organization_groups` with `purpose='billing', is_default_for_purpose=true` and 2 contact members with emails. Call `resolveBillingEmails` with `emailType='invoice'`. Assert `to` contains both emails, `source='organization_groups'`.
2. **Empty group falls through to Step 1** — seed the default group with zero members. Assert resolver returns Step-1 result (legacy `customer_billing_emails` fallback) rather than empty.
3. **Members without emails fall through** — seed group with 2 members, both having `email=null`. Assert falls through to Step 1.
4. **No default group falls through** — no group with `is_default_for_purpose=true`. Assert Step 1 logic runs.
5. **rate_confirmation maps to rate_confirmation group** — seed a group with `purpose='rate_confirmation'` and members. Call with `emailType='rate_confirmation'`. Assert those emails returned.
6. **statement maps to billing group** — verify statement emails also use billing group (per D8 mapping).

### `tests/contact-groups-default-swap.test.mjs` (new)

Cover the default-swap behavior in API handlers (mock-tested):

1. **Setting new default unsets existing default** — create group A with `purpose='billing', is_default=true`. Create group B with same purpose + default flag. Assert A is now `is_default=false` and B is `is_default=true`.
2. **Setting default on group with no purpose is rejected** — attempt to set default on a custom-purpose group. Assert 400 response.

### Existing tests unaffected

All existing tests (`charge-sets-transition.test.mjs`, `routing-moves-transition.test.mjs`, etc.) continue to pass — this spec doesn't touch helpers in `lib/`.

## Risks

1. **Migration backfill creates many empty groups.** 4 × customer-count new rows. For a tenant with 10,000 customers that's 40,000 rows. Fine — `organization_groups` is a lightweight table. Mitigation: none needed; indexed on `(tenant_id, organization_id)`.

2. **Partial unique index confused by NULL purposes.** The index is `WHERE is_default_for_purpose = true AND purpose IS NOT NULL`. NULL-purpose rows never participate — correct. If a default is set with purpose=NULL (shouldn't happen via API but schema allows it), no uniqueness check applies. Mitigation: UI prevents setting default without purpose; API handler validates.

3. **Resolver Step 0 adds 1 query per email send.** Impact: one `maybeSingle()` with joins per invoice/rate-con send. Small. At bulk-send scale (100 invoices at once), that's 100 new queries. Mitigation: acceptable at current volume; revisit if scale becomes a concern.

4. **Default-swap isn't atomic** — the API handler does UPDATE (unset existing default) then INSERT (new group). Brief window where no default exists. Mitigation: fine in practice (two admins rarely set the default simultaneously); if needed later, wrap in an RPC function.

5. **Existing empty-default groups look weird in UI.** After backfill, every org has 4 default groups with 0 members. UI shows "Billing (0 members)" etc. User confusion. Mitigation: the GroupsTab clearly shows "0 members" and an "Add members" CTA; resolver falls through to legacy chain so email sends still work.

6. **Memory spec said "Management" should be a default group.** Omitted here because no email flow targets it. If a user requests it, one-line addition. Mitigation: the purpose enum includes 'management' so admins can create one manually.

7. **`customer_contact_groups` legacy tables unused but exist.** Schema drift risk if someone references them in new code. Mitigation: `dd-qa` skill catches unusual table references; `dd-ai-ready` G2 (Schema) gate flags new FKs. Document in a cleanup FU.

## Open Questions (deferred to plan)

1. **Exact existing `POST /api/tenant/organizations/index.js` shape** — plan reads the handler to confirm where the seed logic should insert (after the `insert().select().single()` that returns the new org). Current file needs verification.
2. **Exact import path for `logTenantAction` in the POST handler** — plan verifies.
3. **Migration 099 availability** — plan verifies 099 is free; bumps if taken.
4. **Does `GroupModal.js` currently accept `description` as a field, or just `name`?** — plan reads the modal; adds purpose + default checkbox alongside whatever's there.
5. **Is there a dark-mode requirement for the new purpose badges?** — yes, per `dev_dark_mode_convention.md`. Plan specifies dark variants.
6. **Does `dd-qa` skill verify the auto-seeding doesn't break when the org insert fails?** — plan verifies the handler's error path (if org insert fails, no group-seeding query runs).
