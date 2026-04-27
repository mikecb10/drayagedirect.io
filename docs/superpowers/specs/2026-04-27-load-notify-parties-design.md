---
name: 2026-04-27-load-notify-parties-design
description: Per-load notify parties — attach groups/contacts to a load (from customer, linked locations, or any org via search) and expose them as a `load_notify_parties` umbrella token. Per-customer defaults auto-populate at creation time. Editable on the load after creation. Builds on the FU-043 organization_groups foundation.
type: spec
---

# Load Notify Parties — Design Spec

## Summary

Today, when a tenant fires an email umbrella for a load (rate confirmation, dispatch notification, status update, etc.), the recipients come from a fixed list of role tokens (`customer_primary`, `load_dispatcher`, `driver`, etc.) plus any explicit emails/contacts/groups statically configured on the umbrella. There is no per-load way to say "for *this* load, also notify the warehouse Ops group, plus a specific consignee contact." Tenants today work around this by either (a) creating one umbrella per customer with hard-coded recipients (doesn't scale), or (b) sending separate manual emails outside the umbrella system (defeats automation).

This spec adds a per-load **notify parties** field. A load can have zero or more notify parties attached at creation time or edited later. Each party is one of:

- A contact group on the load's bill-to customer
- A single contact on the load's bill-to customer
- A group or contact on a different organization that's already linked to the load (pickup terminal, delivery warehouse, return yard)
- A group or contact on any other organization, picked via search ("Other org" escape hatch)

The umbrella system gets a new role token `load_notify_parties`. Any umbrella that includes this token in its To/CC/BCC will, at fire time, expand to the union of all notify parties' email addresses for the firing load. Umbrellas that don't reference the token are unaffected. This makes per-event filtering implicit: tenants control which event types pull in notify parties by including the token only in those umbrellas.

Per-customer defaults: tenants can configure a list of default notify parties on each customer's organization page. When a new load is created for that customer, those defaults are copied into the load's notify-party rows automatically. The picker then lets the user add/remove parties for *this* load specifically before creating it. This avoids the rigidity of either (a) "the same parties on every load forever" or (b) "always start blank, manual every time."

The feature is built on top of the FU-043 `organization_groups` + `organization_group_members` schema (shipped 2026-04-24). It does not touch the legacy `customer_contact_groups` system from migration 002. It also surfaces an inconsistency for follow-up: the existing `recipient-expander.js` `case 'contact_group'` still queries the legacy tables — that should be migrated to `organization_group_members` separately, not as part of this feature.

### Relationship to FU-043 default-for-purpose groups

FU-043 added `is_default_for_purpose` on `organization_groups`, used by `resolveBillingEmails` (Step 0) to pick the right group for invoice/rate-con emails in the AR pipeline. That mechanism is **purpose-keyed** (one group per purpose: billing / operations / dispatch / rate_confirmation / management) and lives at the **AR resolver layer**.

This spec's `customers.default_notify_parties` is a different mechanism at a different layer:

- **Different shape:** an unsorted list of `(type, id)` entries. Multiple groups of the same purpose are allowed; contacts (not just groups) are allowed; cross-org parties are allowed.
- **Different layer:** load-creation-time auto-populate. Copies into `load_notify_parties` rows that the umbrella resolver then reads via the `load_notify_parties` token.

A tenant who wants their FU-043 Operations group to *also* be a default notify party for new loads configures both — marks the group `is_default_for_purpose='operations'` for AR, and adds it to `default_notify_parties` for load-creation. The two systems are intentionally independent: an admin might want their AR-billing group to NOT be on every dispatch email (or vice versa), and the separation lets them choose.

This spec does **not** auto-derive `default_notify_parties` from FU-043 default groups. Defaults must be explicitly configured by the tenant on each customer's organization page.

## Goals

- New table `load_notify_parties (id, tenant_id, load_id, party_type, party_id, source, source_organization_id, audit cols)` storing 0..N parties per load.
- New column `customers.default_notify_parties JSONB` storing per-customer defaults as `[{type, id, source_organization_id?}, ...]`.
- New role token `load_notify_parties` recognized by `lib/email-dispatch/recipient-expander.js`. Expands to all member emails of the load's notify-party rows, deduped, with cache.
- New shared component `NotifyPartyPicker` used in:
  - `NewLoadModal` (collapsible "Notify parties" section near the bottom)
  - Load Detail edit surface (Communication tab if it exists, else Overview card)
  - Organization detail Overview card ("Default notify parties for new loads")
- API endpoints:
  - `GET /api/tenant/loads/[id]/notify-parties` — list current parties with hydrated names + org sublabels.
  - `POST /api/tenant/loads/[id]/notify-parties` — add a single party.
  - `DELETE /api/tenant/loads/[id]/notify-parties/[partyId]` — remove one row.
  - `PATCH /api/tenant/organizations/[id]` — extend to accept `default_notify_parties` updates.
- Auto-populate logic in NewLoadModal: when a customer is picked, fetch their `default_notify_parties` and populate the picker's chips. When the customer is changed, wipe and re-populate; show a confirm dialog only if the user manually edited the list since the last auto-populate.
- Audit log entries via `logTenantAction` for every add/remove (load) and update (customer default), `actorType: 'human'` for user actions, `actorType: 'system'` for the default-copy on load creation.
- Chip display groups parties under org-name headings ("Customer: Acme Corp", "Pickup Terminal: LBCT", etc.) on both the picker and the read-only view of an existing load — affiliation is always visible.
- Tests: resolver, API, and default-copy unit tests (three new files); manual integration smoke covered via dd-qa.

## Non-Goals (explicitly out of scope)

1. **No customer-portal exposure.** v1 is tenant-only. Customers can't see or set notify parties from their portal.
2. **No bulk operations.** Cannot "set this notify party on all 50 loads at once." Single-load only.
3. **No per-event filtering at the load level.** Which event types include notify parties is controlled at the umbrella layer (which umbrellas reference the token), not per-load.
4. **No notification *channel* choice.** Email-only. SMS, voice, push, in-app — separate features.
5. **No reply-routing or thread tracking from notify parties.** When a notify-party recipient replies to a notification, replies go wherever the umbrella's reply-to is configured today. No new routing logic.
6. **No automatic "always notify when X" rules.** Notify parties are static recipient additions, not conditional triggers. Conditional rules are the rules-engine's territory.
7. **No migration of existing tenants' workaround data.** Tenants who hard-coded recipients on per-customer umbrellas keep those umbrellas working; they can adopt notify parties incrementally.
8. **No cleanup of legacy `customer_contact_groups`.** Schema drift exists between migration 002's tables and migration 028+099's tables; this feature uses the newer ones and flags the inconsistency as a follow-up.
9. **No change to the existing `case 'contact_group':` resolver path.** It continues to query `customer_contact_group_members` (legacy). Migration filed as a follow-up FU.
10. **No customer-change support on existing loads.** Once a load is created, its `customer_id` is fixed (existing system behavior). Notify parties are tied to the load, not the customer, so no special handling needed.
11. **No notify-party templates / shared sets across customers.** Each customer's defaults are independent.

## Locked Decisions

| # | Decision | Rationale |
|---|---|---|
| D1 | `party_type` + `party_id` polymorphic over two-nullable-FK columns | Matches existing `recipient-expander.js` `{type, value}` pattern; "fetch all parties for load" stays a single query; FK integrity enforced at API layer |
| D2 | Multiple notify parties per load (junction table), not single-slot | Real drayage routinely needs separate parties (warehouse + consignee + broker) — single-slot forces awkward umbrella-level workarounds |
| D3 | One token `load_notify_parties` (plural) rather than per-source tokens | The picker already records the source per chip; consumers of the umbrella only care about the union. Per-source tokens would be over-decomposed and add UX complexity to the umbrella editor |
| D4 | New role-type token `load_notify_parties`, not a new top-level recipient type | The umbrella editor's mental model is role tokens for dynamic resolution. Reusing `role` keeps the editor's UI unchanged — just one more option in the existing dropdown |
| D5 | Per-customer defaults stored as JSONB on `customers`, not a separate table | Read-bulk-only; never queried as "which customers default to group X?"; one less join when loading the org page |
| D6 | Auto-populate-then-edit, not "always blank" | Real customers usually want the same parties on every load; defaults remove the repetitive work without locking the user out of per-load adjustments |
| D7 | Wipe and re-populate on customer change, with confirm only if user manually edited since last auto-populate | Sending notifications to the wrong customer's parties is a privacy/business risk; default behavior is safety-first; confirm only when there's something to lose |
| D8 | No FK on `party_id`; resolver and UI gracefully handle missing groups/contacts | DB-level FK on a polymorphic column is impossible without a check trigger; graceful skip is simpler and matches the legacy `contact_group` resolver's behavior |
| D9 | Cross-org party picking via "Search any organization" escape hatch respects existing org-list permissions | Don't introduce a new permission surface; reuse whatever filters the org-list API already applies |
| D10 | Three discrete API endpoints (GET / POST one / DELETE one), not one PUT-replace | Audit log granularity: "Jane added Acme Ops" reads better than "Jane replaced the whole list" |
| D11 | `default_notify_parties` JSONB filter dead refs at copy time, render dead refs in default-config UI as "Deleted" chips with × to remove | Dead refs are inevitable (customers delete groups/contacts over time); copy-time filter prevents orphan rows on new loads; UI lets admins clean up at their leisure |
| D12 | Chip display groups by org with "Customer: X" / "Pickup Terminal: Y" headings everywhere chips appear | Multi-source chip lists otherwise look like an undifferentiated tag soup; org-grouping makes affiliation visible at a glance, which matters for "should this party really be here?" sanity checks |
| D13 | Migration deploy order: schema migration FIRST, then code | Existing code doesn't read `load_notify_parties` or `customers.default_notify_parties`; migration is safe to run alone. New code requires the schema |
| D14 | Existing `case 'contact_group':` legacy-table path is NOT modified by this feature | Scope-creep avoidance; flagged separately for follow-up |

## Data Model

### Migration: `load_notify_parties` table + `customers.default_notify_parties` column

**File:** `supabase/migrations/<NNN>_load_notify_parties.sql` (the plan will pick the next available number — likely 111)

```sql
-- ============================================================
-- Migration NNN: Load notify parties + customer defaults
-- ============================================================
-- Adds per-load notify parties (groups/contacts attached to a
-- specific load that get added to email umbrella recipients via
-- the new `load_notify_parties` role token).
--
-- Adds `default_notify_parties` JSONB column on customers so a
-- tenant can pre-configure the parties auto-populated when a new
-- load is created for that customer.
--
-- Builds on FU-043 (migration 099): the parties referenced are
-- organization_groups + organization_contacts, NOT the legacy
-- customer_contact_groups system (migration 002).
-- ============================================================

BEGIN;

CREATE TABLE IF NOT EXISTS load_notify_parties (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  load_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  party_type TEXT NOT NULL CHECK (party_type IN ('group', 'contact')),
  party_id UUID NOT NULL,
  source TEXT CHECK (source IS NULL OR source IN (
    'customer', 'pickup_location', 'delivery_location', 'return_location', 'other_org', 'default'
  )),
  source_organization_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by UUID,
  UNIQUE (tenant_id, load_id, party_type, party_id)
);

CREATE INDEX IF NOT EXISTS idx_load_notify_parties_load
  ON load_notify_parties (tenant_id, load_id);

CREATE INDEX IF NOT EXISTS idx_load_notify_parties_party
  ON load_notify_parties (party_type, party_id);

ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS default_notify_parties JSONB NOT NULL DEFAULT '[]'::jsonb;

NOTIFY pgrst, 'reload schema';

COMMIT;
```

**JSONB shape for `customers.default_notify_parties`:**

```json
[
  { "type": "group",   "id": "uuid", "source_organization_id": "uuid" },
  { "type": "contact", "id": "uuid", "source_organization_id": "uuid" }
]
```

`source_organization_id` is denormalized for fast UI rendering of dead refs (we know which org it came from even if the underlying group/contact has been deleted).

### Cleanup behavior

- `ON DELETE CASCADE` on `load_id` — load deletion removes notify-party rows.
- **No** FK on `party_id`. If a referenced group/contact is deleted while still referenced, the row stays. The resolver and UI gracefully handle missing parties (resolver skips, UI shows "Deleted group/contact" with a remove button).
- Customer's `default_notify_parties` JSONB is similarly tolerant — the auto-populate logic filters dead refs at copy time.

### Multi-tenant safety

- API handlers verify `(party_id, party_type)` references a row whose `tenant_id` matches the load's `tenant_id` before insert.
- Same check on the customer's `default_notify_parties` writes.
- Resolver queries always filter by `tenant_id` from the firing context.

## API Contracts

### `GET /api/tenant/loads/[id]/notify-parties`

Lists the load's notify parties with hydrated display names. Returns:

```json
{
  "parties": [
    {
      "id": "row-uuid",
      "party_type": "group",
      "party_id": "group-uuid",
      "name": "Operations",
      "source": "customer",
      "source_organization_id": "org-uuid",
      "source_organization_name": "Acme Corp",
      "member_count": 4
    },
    {
      "id": "row-uuid",
      "party_type": "contact",
      "party_id": "contact-uuid",
      "name": "John Smith",
      "email": "john@warehouse.com",
      "source": "delivery_location",
      "source_organization_id": "org-uuid",
      "source_organization_name": "Pacific Warehouse"
    }
  ]
}
```

Hydration uses parallel queries to `organization_groups` and `organization_contacts` keyed by ID arrays. Dead refs are returned with `name: null` so the UI can render them as "Deleted" chips.

### `POST /api/tenant/loads/[id]/notify-parties`

Body:

```json
{
  "party_type": "group",
  "party_id": "uuid",
  "source": "customer",
  "source_organization_id": "uuid"
}
```

Validation:
- `party_type` is `'group'` or `'contact'`
- `party_id` exists and `tenant_id` matches the load's tenant_id (enforced via lookup before insert)
- `source` is null or one of the allowed values
- The triple `(tenant_id, load_id, party_type, party_id)` doesn't already exist (UNIQUE constraint enforces)

On success: insert the row, log via `logTenantAction` with `action: 'load.notify_party_added'`, return the hydrated row matching GET shape.

### `DELETE /api/tenant/loads/[id]/notify-parties/[partyId]`

Removes one row. Verifies `tenant_id` and `load_id` match before delete. Logs via `logTenantAction` with `action: 'load.notify_party_removed'`.

### `PATCH /api/tenant/organizations/[id]` — extend to accept `default_notify_parties`

The existing handler is extended. Body adds:

```json
{
  "default_notify_parties": [
    { "type": "group", "id": "uuid", "source_organization_id": "uuid" }
  ]
}
```

Validation: each entry's `(type, id)` must reference a row whose `tenant_id` matches. Empty array allowed.

Logs via `logTenantAction` with `action: 'customer.default_notify_parties_updated'`, including `oldValues` + `newValues` capturing the full array on each side (small; bounded by typical defaults of ≤5 entries).

### Resolver — `lib/email-dispatch/recipient-expander.js`

In `expandEntry`, the existing `case 'role':` block handles role tokens via a static `roleMap` of context-tree dotted paths. Add a special-case branch for `load_notify_parties` *before* the `roleMap` lookup:

```js
case 'role': {
  if (entry.value === 'load_notify_parties') {
    const loadId = context?.order?.id || context?.load?.id;
    if (!loadId) return [];
    const cacheKey = `lnp:${loadId}`;
    if (cache && cache.has(cacheKey)) return cache.get(cacheKey);

    const { data: parties } = await svc
      .from('load_notify_parties')
      .select('party_type, party_id')
      .eq('tenant_id', tenantId)
      .eq('load_id', loadId);

    const out = new Set();
    for (const p of parties || []) {
      if (p.party_type === 'group') {
        const { data } = await svc
          .from('organization_group_members')
          .select('contact:organization_contacts(email)')
          .eq('group_id', p.party_id)
          .eq('tenant_id', tenantId);
        for (const r of data || []) {
          const e = normalizeEmail(r.contact?.email);
          if (isValidEmail(e)) out.add(e);
        }
      } else {
        const { data } = await svc
          .from('organization_contacts')
          .select('email')
          .eq('id', p.party_id)
          .eq('tenant_id', tenantId)
          .maybeSingle();
        const e = normalizeEmail(data?.email);
        if (isValidEmail(e)) out.add(e);
      }
    }

    const result = Array.from(out);
    if (cache) cache.set(cacheKey, result);
    return result;
  }
  // ... existing roleMap logic unchanged
}
```

The plan will verify the exact context-tree shape (`context.order.id` vs `context.load.id`) by reading the dispatcher entry point and B.1c generalization work. If neither is present, the token returns `[]` (correct fallback for non-load entities).

## UI Changes

### `NotifyPartyPicker` — new shared component

**Location:** `components/loads/NotifyPartyPicker.js` (or `components/shared/` — plan picks based on existing convention).

**Props:**

```jsx
<NotifyPartyPicker
  mode="load" | "customer-default"            // controls which source sections appear
  customerId={uuid}                            // load's bill-to customer (for "Customer · Name" section)
  pickupLocationOrgId={uuid}                   // mode='load' only
  deliveryLocationOrgId={uuid}                 // mode='load' only
  returnLocationOrgId={uuid}                   // mode='load' only
  value={[{party_type, party_id, source, source_organization_id, name?, source_organization_name?}]}
  onChange={(newValue) => ...}
  onManualEdit={() => ...}                     // called whenever user adds/removes (used by NewLoadModal to set the manual-edit flag)
/>
```

**Behavior:**

- Renders existing chips, grouped under org-name headings:
  ```
  Customer: Acme Corp
    [📋 Operations]  [👤 Jane Doe]
  Pickup Terminal: LBCT
    [📋 Ops Group]
  Delivery Warehouse: Pacific Warehouse
    [📋 Receiving Group]  [👤 Bob Smith]
  Other: Some Broker LLC
    [📋 Notifications]
  ```
- Each chip has a `×` to remove. Removing fires `onChange` (without that party) and `onManualEdit`.
- Below the chips, a `[+ Add notify party ▾]` button opens a sectioned dropdown. Sections in `mode="load"`:
  - **CUSTOMER · {customer name}** — groups + contacts from the load's customer org
  - **PICKUP TERMINAL · {name}** — groups + contacts from `pickupLocationOrgId` (omitted if not set)
  - **DELIVERY WAREHOUSE · {name}** — groups + contacts from `deliveryLocationOrgId` (omitted if not set)
  - **RETURN YARD · {name}** — groups + contacts from `returnLocationOrgId` (omitted if not set)
  - **🔍 Search any organization...** — type-ahead search → click an org → expands to its groups + contacts
- Sections in `mode="customer-default"`:
  - **THIS ORGANIZATION · {name}** — groups + contacts from this customer org
  - **🔍 Search any organization...** — escape hatch
- Dead-ref chips render as muted gray with the label "Deleted [group|contact]" and a × to remove. No add allowed for dead refs.
- Picking an item adds a chip with `source` derived from which section it came from (`customer` / `pickup_location` / `delivery_location` / `return_location` / `other_org` / `default`).
- All elements include `dark:` variants per `dev_dark_mode_convention.md`.

**Internal data fetching:**

- On mount, fetch each section's groups + contacts via existing endpoints (`/api/tenant/organizations/[id]/groups` + `/api/tenant/organizations/[id]/contacts`).
- Cache fetched org data within the component lifetime; refetch only when an org id prop changes.
- "Search any organization" calls a typeahead endpoint (existing — verify name in plan; likely `/api/tenant/organizations?q=...`). Selecting an org triggers the same group/contact fetch.

### `NewLoadModal` integration

**Position:** new collapsible section labeled **"Notify parties (optional)"**, placed after the route-template selector and before the Create Load button.

**Default expansion state:**
- Collapsed if the picked customer has empty `default_notify_parties`.
- Expanded with chips populated if the customer has defaults (so user sees what's about to happen).

**Auto-populate:**
- When `customer_id` becomes truthy, fetch `default_notify_parties` for that customer.
- Resolve display names via a single batch query joining `organization_groups` + `organization_contacts` by id arrays.
- Filter dead refs (party no longer exists or returns no row).
- Set the picker's `value` to the resolved list. Reset the modal-state `manuallyEditedNotifyParties` flag to `false`.

**Customer-change behavior:**
- On `customer_id` change after auto-populate has run:
  - If `manuallyEditedNotifyParties` is `false` → wipe + re-populate silently from the new customer's defaults.
  - If `true` → show confirm dialog: "Changing customer will reset notify parties to the new customer's defaults. Your manual edits will be lost. Continue?"
    - Confirm → wipe + re-populate, reset flag to `false`.
    - Cancel → revert `customer_id` to the previous value.

**On submit (Create Load):**
- After the `orders` insert succeeds, batch-insert `load_notify_parties` rows from the picker's current value. Each row's `source` is whatever the chip carries (preserved from the picker's section labeling).
- Log a single audit entry `load.notify_parties_seeded` with the count and party descriptors. Use `actorType: 'system'` for the auto-populated portion and `'human'` for the manually added portion (the modal tracks which is which via the `source` field — `'default'` = system, others = human).

### Load Detail edit surface

The plan will read the current Load Detail page and pick the right home:

- **Preferred:** Communication tab if it exists.
- **Fallback:** a card on Overview titled "Notify parties."

Either way: same `NotifyPartyPicker` component in `mode="load"` with all the location org IDs hydrated from the load. Edits hit the GET / POST / DELETE endpoints directly (not bulk replace).

### Organization detail — default config

**Location:** Organization detail → Overview tab → new card titled **"Default notify parties for new loads"**.

- Description text: "*These will auto-populate when a new load is created for this customer. Editable per-load.*"
- Same `NotifyPartyPicker` in `mode="customer-default"`. Source sections limited to "This organization's groups + contacts" + the search escape hatch.
- Save button persists the picker's current value to `customers.default_notify_parties` via the extended PATCH endpoint.
- Dirty-state tracking: if the user has unsaved changes and tries to navigate away, prompt to save (matches existing org-detail-page convention — plan verifies).

### Umbrella editor — RecipientRow expansion

**Location:** `pages/settings/communications/umbrellas/[id].js` — `RecipientRow` (≈ line 1285) and `addRecipient` (≈ line 959).

**Reality check:** today `RecipientRow` only accepts text-typed email addresses (`addRecipient` always creates `{type: 'email', value}` entries). The expander supports `type: 'role'` / `'contact_group'` / `'contact'` / `'variable'` but those entries are only reachable via direct DB seeding today, not via the editor. To make `load_notify_parties` actually usable from the UI, we add a token picker alongside the email input.

**Change:**

1. Add an **"+ Insert dynamic recipient ▾"** button at the right edge of the chip-input box.
2. Clicking opens a small dropdown of role tokens, sectioned:
   - **Per-load** — `load_notify_parties` (new, label: "Load notify parties — recipients set per-load on the load itself"), `load_dispatcher`, `driver`
   - **Customer** — `customer_primary`
   - **Tenant** — `tenant_dispatcher`, `tenant_ops`, `acting_user`
3. Selecting one calls a new `addTokenRecipient(kind, token)` that pushes `{type: 'role', value: token}` into the recipients array.
4. The chip rendering is extended to show role chips visually distinct from email chips (e.g., a token-style chip with a `{}` icon prefix and the human-readable label, while the underlying value stays the token string).
5. Existing `type: 'contact_group'` / `'contact'` / `'variable'` entries that may already exist in DB stay rendered as their respective chip styles (covered by the same chip-rendering fork) — but adding new ones via the editor stays out of scope for this feature (file as separate FU).

**Token value:** `load_notify_parties`. Sort placement at top of "Per-load" section so it's the first thing a user sees if they're configuring a load-scoped umbrella.

## Testing

### `tests/load-notify-parties-resolver.test.mjs` (new)

Covers the `load_notify_parties` token in `recipient-expander.js`:

1. **Group party expands to all member emails** — load with one group party, group has 3 members → 3 emails returned.
2. **Contact party expands to one email** — load with one contact party → 1 email.
3. **Mixed group + contact, dedupe overlap** — group of 2 emails + a contact whose email matches one of them → 2 emails total.
4. **Empty notify-party list** — load has no parties → returns `[]`.
5. **Missing/deleted party** — party_id references a deleted group → row silently skipped, no error.
6. **No load.id in context** — call expander with `context = {}` → returns `[]`.
7. **Cache hit on second call** — call twice with same context → second call doesn't hit DB (verify via spy on `svc.from`).

### `tests/load-notify-parties-api.test.mjs` (new)

Covers the three new endpoints:

1. **GET hydrates names + org sublabels** — set up a load with 2 parties (one group, one contact); GET returns both with `name`, `source_organization_name`, `member_count` (groups only) populated.
2. **GET returns dead-ref entries with `name: null`** — set up a party then delete the group; GET still returns the row with `name: null`.
3. **POST rejects cross-tenant party_id** — attempt to POST a party_id whose `tenant_id` differs from the load's → 400.
4. **POST rejects unknown party_type** — `party_type: 'org'` → 400.
5. **POST 409 on duplicate** — POST same party twice → second returns 409.
6. **DELETE removes only the targeted row** — DELETE one of two rows → other remains.
7. **DELETE rejects cross-load partyId** — partyId belongs to a different load → 404.
8. **All three log a `tenant_audit_log` entry with the correct action and shape**.

### `tests/load-notify-parties-defaults.test.mjs` (new)

Covers the per-customer default copy:

1. **New load with customer that has 3 defaults** → 3 rows inserted into `load_notify_parties` with `source='default'`, all referencing the original `(type, id)` pairs.
2. **New load with customer that has empty defaults** → 0 rows.
3. **Default copy filters dead refs** — customer has 3 defaults but one's underlying group has been deleted → 2 rows inserted.
4. **PATCH `default_notify_parties` validates tenant match** — attempt to set a default with a cross-tenant party id → 400.
5. **PATCH allows empty array** → succeeds, persists `[]`.
6. **PATCH rejects malformed entries** — entry without `type` or `id` → 400.

### Integration smoke (manual, via dd-qa during plan execution)

- Create a load → verify chips auto-populate from customer default.
- Add an "Other org" party via search → verify chip renders with correct sublabel.
- Change customer (no manual edit) → verify silent wipe + re-populate.
- Change customer (with manual edit) → verify confirm dialog appears.
- Cancel confirm → verify customer reverts.
- Fire an umbrella that uses `load_notify_parties` → verify recipient list includes all party emails, deduped against any other recipients.
- Fire the same umbrella for a load with zero notify parties → verify it sends successfully (or no-ops gracefully if To: ends up empty — depends on existing umbrella validation).

### Existing tests unaffected

No changes to the legacy `case 'contact_group':` resolver path → existing umbrella tests pass unchanged.

## Risks

1. **Polymorphic FK can't be enforced at DB layer.** A buggy migration or direct SQL insert could create orphan rows. Mitigation: API handlers all go through one shared validator function; resolver is graceful on missing references.

2. **Cross-org notify parties leak organizational structure.** The "Search any organization" escape hatch lets a tenant user pick groups from any org. If the tenant has restrictive cross-customer visibility rules, this is a leak vector. Mitigation: the search calls the existing org-list API which already applies any per-user filtering (verify in plan).

3. **Auto-populate slows NewLoadModal on customer change.** Resolving N default-party display names is N+1 queries if done naively. Mitigation: batch-fetch via id arrays — one query for groups, one for contacts. For typical defaults (≤5 parties) impact is negligible.

4. **`default_notify_parties` JSONB doesn't reference-check at write time.** A tenant could PATCH a default referencing a not-yet-deleted group, then delete the group later. Auto-populate filters dead refs at copy time, so loads stay correct. Default-config UI renders dead refs as "Deleted" chips for cleanup.

5. **Multi-source chip lists could overwhelm the UI.** A load with 8 parties from 4 different orgs could look noisy. Mitigation: the org-grouping headers (D12) make the list scannable; if real-world usage hits >10 parties commonly, revisit with a collapsible-per-org variant.

6. **`load_notify_parties` token added to a non-load umbrella.** If a tenant adds the token to an umbrella that fires for non-load entities (invoice, charge set, etc.), it returns `[]` silently. This is correct behavior but might surprise an admin who expected an error. Mitigation: the umbrella editor's description text ("*Empty if none configured for this load.*") plus "*Has no effect on non-load notifications.*" documents the behavior.

7. **Customer change lost-state UX has subtle edge cases.** What if the user changes customer twice in quick succession (A→B→A)? The flag tracks "edited since last auto-populate," so going back to A would re-populate A's defaults if the user hasn't edited since the last auto-populate — fine. What if `default_notify_parties` itself changes between the two visits to A? The picker would reflect whatever's current at fetch time, which is correct.

8. **Legacy `contact_group` resolver still uses old tables.** Out of scope for this feature. Filed as follow-up.

## Open Questions (deferred to plan)

1. **Migration number** — likely 111, but plan verifies and bumps if needed.
2. **Where on Load Detail does the edit UI live?** Communication tab (preferred) or Overview card (fallback). Plan reads the page.
3. **NewLoadModal section order** — should the "Notify parties" section sit above "Document Types" / footer, or below? Plan reads the modal's current layout.
4. **Existing context-tree shape** — `context.order.id` vs `context.load.id` (or both, after B.1c generalization). Plan reads the dispatcher entry point and confirms.
5. **`organization_contacts` and `organization_group_members` query API shape** — Supabase nested-select syntax for member-list expansion needs verification; plan runs a quick query to confirm.
6. **Existing org-list typeahead endpoint name** — likely `/api/tenant/organizations?q=...` but plan verifies.
7. **Existing dirty-state convention on Organization detail** — does the page already show "unsaved changes" UX, or do we need to add it for this card? Plan reads the page.
8. **Audit-log action taxonomy** — does `tenant_audit_log` already have load-scoped action prefixes? If not, plan picks consistent names.
9. **Component path convention** — `components/loads/NotifyPartyPicker.js` vs `components/shared/`. Plan picks per existing convention.
10. **Dark-mode color tokens for "Deleted" chip styling** — plan picks per existing dead-ref conventions if any (e.g., does the GroupsTab render deleted groups specially? If yes, match that.).

## New follow-up FU to file

- **FU-NEW: Migrate `recipient-expander.js` `case 'contact_group'` from legacy `customer_contact_group_members` to `organization_group_members`.** Pure consistency fix; FU-043 created two parallel systems but left the resolver pointing at the old one. Should be a small atomic PR. File in `followups.md` as part of this spec's commit.
