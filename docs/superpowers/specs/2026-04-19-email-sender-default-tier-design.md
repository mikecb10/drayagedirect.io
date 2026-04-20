# Email Sender Default Tier — Design Spec

**Date:** 2026-04-19
**Status:** Approved, ready for implementation planning
**Sub-project:** 2a.5 (renumbered — see "Roadmap fit" below)
**Author:** Mike (with Claude brainstorming assist)
**Related memory:** `project_email_sender_architecture.md`

---

## 1. Background

### 1.1 The limitation caught in 2a.4 Gate 8

During live verification of 2a.4 bulk invoice email (2026-04-19), a test send from
`mikecb2010@gmail.com` to `mikecb2010@gmail.com` returned SendGrid 202 Accepted,
wrote `email_messages.status='sent'` with a real `provider_message_id`, and still
never arrived in the Gmail inbox.

Root cause: **Gmail DMARC rejects mail claiming `From: user@gmail.com` that didn't
originate from Google's servers.** SendGrid signs DKIM with its own domain, its IPs
aren't in gmail.com's SPF, and consumer domains publish `p=reject`. The message is
silently dropped at the receiving MTA.

This is not a 2a.4 bug. The code chain worked correctly through SendGrid's API.
The issue is structural: the platform's current model of "any tenant can set any
`From:` address" does not work for consumer-domain senders.

### 1.2 Why this is blocking-level for real-tenant onboarding

DrayageDirect's target market is small-to-medium trucking companies. Those
companies overwhelmingly use gmail / yahoo / outlook as their business email.
Shipping more email features (2a.4b rate-con bulk send, 2a.6 delivery webhooks)
on top of the current architecture means shipping features that silently fail
for the majority of future tenants.

The default-tier fix must land before any real tenant onboards.

### 1.3 The existing schema is more built-out than the memo suggested

Investigation revealed the system already models a three-kind sender abstraction
(`sender_kind` ∈ `sendgrid` | `shared_gmail` | `user_gmail`) and already has a
`tenant_sender_domains` table with DKIM/SPF verification status. What's missing
is a **platform-owned subdomain** that every tenant can send from without
configuring their own DNS. This spec fills that gap.

### 1.4 Roadmap fit

```
2a.1 ✅ SHIPPED — PDF generation infrastructure
2a.2 ✅ SHIPPED — Invoice email popup + single-send
2a.3 ✅ SHIPPED — Rate confirmation email popup
2a.4 ✅ SHIPPED — Bulk email + grouping modal + queue dashboard
2a.5 ⬅ THIS SPEC — Email sender default tier (platform subdomain + Reply-To)
2a.5b          — Consumer-domain UI warning enrichment (deferred polish)
2a.6           — SendGrid delivery webhook tracking
2a.4b          — Bulk Send Rate Con
2a.4c          — Bulk Send from Invoices tab
2a.7           — Invoice + date picker backdate button
Later          — Pro tier (custom domain auth)
Later          — Enterprise tier (Gmail / MS Graph OAuth)
Later          — Document designer
```

2a.5 unblocks everything past it. Subsequent email features land on a
foundation that actually delivers.

---

## 2. Goals & Non-Goals

### 2.1 Goals

- Every tenant, regardless of what they type into the sender field, can deliver
  mail to Gmail / Outlook / Yahoo recipients without DMARC rejection.
- Tenants appear as "their company" in recipients' inboxes.
- Customer replies route to the tenant's real mailbox.
- Tenants don't have to configure DNS on their own domain.
- Existing tenants with consumer-domain senders are silently auto-migrated;
  their sends start working, their reply-expectations preserved.
- Server rejects any new `sender_address` on a consumer TLD with a helpful
  error message.
- Migration is atomic, idempotent, and rollback-safe.

### 2.2 Non-goals (explicitly deferred)

- **Pro tier** — tenant's own custom domain with their own DKIM. Different sub-project.
- **Enterprise tier** — Gmail OAuth / MS Graph send-on-behalf. Different sub-project.
- **Inbound / reply parsing** — replies go to the tenant's mailbox directly via
  `Reply-To`; DrayageDirect does not see them in-app. A future Communication
  tab can layer on top.
- **Delivery tracking webhooks** — that's 2a.6. Until then, `status='sent'` still
  means "SendGrid returned 202," just now with a sending domain that actually
  delivers.
- **Multi-domain platform sending** — one platform subdomain
  (`mail.drayagedirect.com`), one verified SendGrid Domain Authentication.
- **Auto-retry on SendGrid 5xx** — no change from today.
- **Dedicated-IP reputation management** — SendGrid handles shared IP pooling.
- **Homograph-attack protection** on the consumer-domain blocklist. ASCII only
  in v1. Note as a future hardening item.

---

## 3. Architecture Overview

### 3.1 One-line summary

Every outbound email sends as:

```
From:     "{Display Name}" <{tenants.slug}@mail.drayagedirect.com>
Reply-To: "{Reply-To Name}" <{reply_to_email}>
```

`mail.drayagedirect.com` is a SendGrid-verified subdomain the platform owns.
DKIM signs with it, SPF aligns with it, DMARC passes. `Reply-To` routes customer
replies to the tenant's real mailbox — including consumer-domain mailboxes,
because `Reply-To` has no DMARC constraints.

Display name, reply-to, and optional template-level display-name overrides are
configurable by the tenant.

### 3.2 Precedence chains (send-time resolution)

**Display Name (`From:` name portion):**

1. `email_templates.from_display_name` — template-level override.
2. `email_configurations.from_display_name` — branch-scoped if a branch config
   won selection; otherwise tenant-default config.
3. `tenants.name` — legal organisation name.
4. `"DrayageDirect Notifications"` — platform floor (hardcoded string).

First non-null, non-empty wins.

**Reply-To (`Reply-To:` header):**

1. `email_configurations.reply_to_email` + `reply_to_name` — from the selected
   configuration.
2. `{ email: tenants.email, name: null }` — tenant admin email.
3. `null` — no `Reply-To` header set. Customer replies route to `From:` and
   bounce with a clear SendGrid error, which is preferable to silently routing
   to `noreply@mail.drayagedirect.com`.

**From: email address:**

1. `{tenants.slug}@mail.drayagedirect.com` — resolved via the existing
   `resolveFromAddress()` code path. Zero code change; the shared
   `tenant_sender_domains` row just happens to be the platform row.

### 3.3 Configuration selection (new — branch-aware)

The `email_configurations` selection query becomes branch-aware:

```sql
SELECT * FROM email_configurations
 WHERE tenant_id = :tenant_id
   AND is_active = true
   AND (branch_id = :load_branch_id OR branch_id IS NULL)
 ORDER BY
   (branch_id = :load_branch_id) DESC,   -- prefer branch match
   priority ASC
 LIMIT 1;
```

If `load.branch_id` is null (tenant doesn't use branches), the clause collapses
to the existing behaviour — tenant-default configuration wins.

---

## 4. Schema Changes

All changes in one migration (working name: `migration_082_email_sender_default_tier.sql`),
wrapped in `BEGIN` / `COMMIT`, with trailing `NOTIFY pgrst 'reload schema'` per
project migration convention.

### 4.1 New columns on existing tables

```sql
-- email_configurations: display name + branch scoping + structured reply-to
ALTER TABLE email_configurations
  ADD COLUMN from_display_name TEXT,
  ADD COLUMN reply_to_email    TEXT,
  ADD COLUMN reply_to_name     TEXT,
  ADD COLUMN branch_id         UUID REFERENCES branches(id) ON DELETE SET NULL;

CREATE INDEX idx_email_configurations_branch_id
  ON email_configurations(branch_id) WHERE branch_id IS NOT NULL;

-- email_templates: optional display name override (tier-1 precedence)
ALTER TABLE email_templates
  ADD COLUMN from_display_name TEXT;

-- email_messages: persist structured reply-to so audit replay is complete
ALTER TABLE email_messages
  ADD COLUMN reply_to_name TEXT;
-- (reply_to already exists; treat it as reply_to_email going forward)

-- tenants: mark migrated tenants for the one-time banner
ALTER TABLE tenants
  ADD COLUMN sender_migration_at TIMESTAMPTZ NULL;
```

**Length constraint on `from_display_name`:** the API-level validator enforces
`LENGTH(from_display_name) <= 100` characters. A DB `CHECK` constraint is not
added because we want to surface validation errors with helpful messages at
the API layer, not via a raw Postgres error.

**`branch_id` verification:** confirmed via `supabase/migrations/053_email_system_infrastructure.sql`
and `055_email_shared_accounts.sql` — neither adds `branch_id` to
`email_configurations`. Straight ADD, no conditional needed.

**Clarification — "branch" semantics:** `branch_id` here refers to the tenant's
own regional branches (per the `feature_branches.md` system already built —
e.g., Acme Trucking LA vs Acme Trucking Houston). It is NOT about the tenant's
customers' branches of business. The use case: a dispatcher at Acme Houston
should be able to send as "Acme Houston" with Houston's reply-to address,
without affecting what LA's dispatcher sends as.

### 4.2 `tenant_sender_domains` — nullable `tenant_id` + platform seed

```sql
ALTER TABLE tenant_sender_domains
  ALTER COLUMN tenant_id DROP NOT NULL;

INSERT INTO tenant_sender_domains
  (id, tenant_id, domain, sendgrid_domain_id, status, dns_records, created_at)
VALUES
  (gen_random_uuid(), NULL, 'mail.drayagedirect.com',
   :sendgrid_domain_id, 'verified', '[]'::jsonb, now())
ON CONFLICT DO NOTHING;
```

`:sendgrid_domain_id` is a migration parameter. Resolved at migration time from
the environment (`SENDGRID_PLATFORM_DOMAIN_ID`), captured manually during the
one-time DNS setup (Section 8).

### 4.3 RLS update on `tenant_sender_domains`

Existing `SELECT` policy scopes rows to `tenant_id = current_tenant()`. Updated
policy allows reading the platform row:

```sql
-- READ: tenant's own rows OR the platform row
USING (tenant_id = current_tenant_id() OR tenant_id IS NULL)

-- INSERT / UPDATE / DELETE: tenant's own rows only
WITH CHECK (tenant_id = current_tenant_id())
```

Tenants cannot edit or delete the platform row — only the migration / a platform
admin can.

### 4.4 `tenant_sender_addresses` — provision per tenant (idempotent)

```sql
INSERT INTO tenant_sender_addresses
  (tenant_id, local_part, domain_id, is_default)
SELECT
  t.id,
  t.slug,
  (SELECT id FROM tenant_sender_domains WHERE tenant_id IS NULL LIMIT 1),
  true
FROM tenants t
LEFT JOIN tenant_sender_addresses tsa
  ON tsa.tenant_id = t.id
  AND tsa.domain_id = (SELECT id FROM tenant_sender_domains WHERE tenant_id IS NULL LIMIT 1)
WHERE tsa.id IS NULL;
```

For new tenants going forward, this same provisioning runs inside the tenant-
creation code path (Section 6.7).

### 4.5 Migration backup table (rollback safety)

```sql
CREATE TABLE IF NOT EXISTS _migration_email_config_backup (
  config_id              UUID PRIMARY KEY,
  old_sender_address_id  UUID,
  backed_up_at           TIMESTAMPTZ DEFAULT now()
);
```

Populated before any `UPDATE` on `email_configurations` in step 4.8. Only
`old_sender_address_id` needs to be captured — `reply_to_email` and
`reply_to_name` are **new** columns added in 4.1 (null for every row at backup
time), so there is no prior value to preserve. Preserved post-commit for the
rollback path; dropped manually once cutover is stable (~30 days).

### 4.6 Pre-migration checks (RAISE EXCEPTION on failure)

Block the migration from proceeding if any of the following hold:

- Any tenant has `slug IS NULL`.
- Any tenant has a `slug` that doesn't match `^[a-zA-Z0-9._-]+$`.
- Any two tenants share the same `slug` (duplicates).
- `SENDGRID_PLATFORM_DOMAIN_ID` is null or not resolvable to an existing
  SendGrid domain record (validated by a separate pre-check script before
  the migration runs).

### 4.7 Seed the platform domain (step 3 of migration)

Covered in 4.2.

### 4.8 Migrate consumer-domain configurations

```sql
-- Step 1: Backup sender_address_id of every config we're about to touch
INSERT INTO _migration_email_config_backup (config_id, old_sender_address_id)
SELECT ec.id, ec.sender_address_id
FROM email_configurations ec
JOIN tenant_sender_addresses tsa ON tsa.id = ec.sender_address_id
JOIN tenant_sender_domains  tsd ON tsd.id = tsa.domain_id
WHERE tsd.domain IN (
  'gmail.com', 'yahoo.com', 'outlook.com', 'hotmail.com',
  'live.com', 'icloud.com', 'aol.com', 'protonmail.com',
  'ymail.com', 'mail.com'
);

-- Step 2: Populate new reply_to_email / reply_to_name from the old consumer sender.
-- These columns were just added in 4.1 and are null for every row — no COALESCE
-- needed; every migrated row has a null reply_to_* to start.
UPDATE email_configurations ec
SET reply_to_email = tsa.local_part || '@' || tsd.domain,
    reply_to_name  = t.name
FROM tenant_sender_addresses tsa,
     tenant_sender_domains   tsd,
     tenants                 t
WHERE ec.sender_address_id = tsa.id
  AND tsa.domain_id = tsd.id
  AND ec.tenant_id = t.id
  AND tsd.domain IN (
    'gmail.com', 'yahoo.com', 'outlook.com', 'hotmail.com',
    'live.com', 'icloud.com', 'aol.com', 'protonmail.com',
    'ymail.com', 'mail.com'
  );

-- Step 3: Point sender_address_id at the tenant's platform sender.
-- Note: the OLD consumer-domain tenant_sender_addresses rows are intentionally
-- left in place (not deleted, not is_default=false flipped). Other configs may
-- reference them, and email_messages rows still point at them for audit replay.
-- The validator in 6.4 prevents any NEW write from referencing them going forward.
UPDATE email_configurations ec
SET sender_address_id = (
  SELECT id FROM tenant_sender_addresses tsa
  WHERE tsa.tenant_id = ec.tenant_id
    AND tsa.domain_id = (SELECT id FROM tenant_sender_domains WHERE tenant_id IS NULL LIMIT 1)
  LIMIT 1
)
WHERE ec.id IN (SELECT config_id FROM _migration_email_config_backup);
```

**Consumer-domain list consistency:** the list hardcoded in this migration
must match `CONSUMER_EMAIL_DOMAINS` in `lib/email-dispatch/consumer-domains.js`
(Section 6.4). After migration, the JS file is the source of truth going
forward; the SQL list only matters at migration-run-time.

### 4.9 Ensure every tenant has at least one active configuration

```sql
INSERT INTO email_configurations
  (id, tenant_id, name, sender_address_id, is_active, is_default, priority, created_at)
SELECT
  gen_random_uuid(),
  t.id,
  'Default (DrayageDirect Sender)',
  (SELECT id FROM tenant_sender_addresses tsa
     WHERE tsa.tenant_id = t.id
       AND tsa.domain_id = (SELECT id FROM tenant_sender_domains WHERE tenant_id IS NULL LIMIT 1)
     LIMIT 1),
  true,
  true,
  100,
  now()
FROM tenants t
WHERE NOT EXISTS (
  SELECT 1 FROM email_configurations ec WHERE ec.tenant_id = t.id
);
```

### 4.10 Mark migrated tenants for the banner

```sql
UPDATE tenants
SET sender_migration_at = now()
WHERE id IN (
  SELECT DISTINCT ec.tenant_id
  FROM email_configurations ec
  JOIN _migration_email_config_backup b ON b.config_id = ec.id
);
```

---

## 5. Data Flow — Send-Time

### 5.1 End-to-end happy path

```
User clicks Send in EmailComposeSlideOver (or BulkActionBar)
  → POST /api/tenant/ar/.../send  (or /bulk-send)
  → build context: { tenantId, template_id, load_id, load.branch_id }
  → pick email_configuration (branch-aware query from 3.3)
  → resolve From:  → resolveFromAddress(fullConfig, ctx, tenant)
                    → `{tenants.slug}@mail.drayagedirect.com`
  → resolve Display Name → resolveFromDisplayName(template, config, tenant)
                           → precedence chain
  → resolve Reply-To    → resolveReplyTo(config, tenant)
                          → { email, name } | null
  → dispatchEmail(svc, {
      tenantId, fromAddress, fromName, replyTo, replyToName,
      to, cc, bcc, subject, html, text, attachments
    })
  → SendGrid API call with structured `from` + `replyTo` objects
  → email_messages row persists from_address, from_name,
                              reply_to, reply_to_name, configuration_id
```

### 5.2 New helper functions

Both live in `lib/email-dispatch/dispatcher.js` alongside the existing
`resolveFromAddress`.

```js
/**
 * Resolve the display-name portion of the From: header.
 * Returns the first non-null, non-empty value in the precedence chain.
 */
export function resolveFromDisplayName(template, config, tenant) {
  const chain = [
    template?.from_display_name,
    config?.from_display_name,
    tenant?.name,
    'DrayageDirect Notifications',
  ];
  for (const candidate of chain) {
    const trimmed = (candidate || '').trim();
    if (trimmed) return trimmed;
  }
  return 'DrayageDirect Notifications';
}

/**
 * Resolve the Reply-To header value.
 * Returns { email, name } or null (meaning: do not set Reply-To).
 */
export function resolveReplyTo(config, tenant) {
  if (config?.reply_to_email?.trim()) {
    return {
      email: config.reply_to_email.trim(),
      name: config.reply_to_name?.trim() || null,
    };
  }
  if (tenant?.email?.trim()) {
    return { email: tenant.email.trim(), name: null };
  }
  return null;
}
```

### 5.3 SendGrid payload shape

The existing `lib/email-dispatch/providers/sendgrid.js` dispatch function
receives a `message` object that already includes `from_name` and `reply_to`.
One addition: `reply_to_name`.

```js
const sgMsg = {
  to: message.to.map((email) => ({ email })),
  from: {
    email: message.from_address,
    name:  message.from_name || undefined,
  },
  subject: message.subject || '(no subject)',
  html: includeHtml ? message.html : undefined,
  text: includeText ? message.text : undefined,
  cc:  message.cc?.length > 0  ? message.cc.map((email)  => ({ email })) : undefined,
  bcc: message.bcc?.length > 0 ? message.bcc.map((email) => ({ email })) : undefined,
  replyTo: message.reply_to
    ? { email: message.reply_to, name: message.reply_to_name || undefined }
    : undefined,
  // attachments, sandbox mode, etc unchanged
};
```

### 5.4 `email_messages` row after send

Columns written:

- `from_address` — resolved email (always `{slug}@mail.drayagedirect.com`).
- `from_name` — resolved display name.
- `reply_to` — resolved reply-to email (or null if none).
- `reply_to_name` — resolved reply-to display name (new column).
- `configuration_id` — which config was selected. Answers "why did this email
  look like X?" after the fact.

### 5.5 Existing endpoints that change

Verified during spec-write (2026-04-20):

- `pages/api/tenant/ar/invoices/bulk-send.js` — add `load.branch_id` to the
  config-selection query; pass `template` object into the dispatch call so
  the helper can read `template.from_display_name`.
- `pages/api/tenant/ar/invoices/[invoiceId]/send-email.js` — same changes.
- `pages/api/tenant/ar/charge-sets/[id]/send-rate-con-email.js` — same
  changes (rate-con send endpoint).
- `lib/email-dispatch/dispatcher.js` — add `resolveFromDisplayName()` and
  `resolveReplyTo()` helpers; wire into the point where the SendGrid payload
  is built.
- `lib/email-dispatch/providers/sendgrid.js` — accept `reply_to_name`,
  pass into `replyTo: { email, name }`.

---

## 6. UI Changes

Four surfaces. No new pages; new fields and sections on existing pages.

### 6.1 Email Configuration page — new "Sender Identity" section

Added to the create + edit forms. Fields:

- **Display Name** — single free-text input, max 100 chars.
  - Label: "Display Name"
  - Help text: "How your company appears in the recipient's inbox."
  - Placeholder: `{tenants.name}` (e.g., "Acme Trucking")
- **Reply-To Address** — single free-text input, combined format.
  - Label: "Reply-To Address"
  - Help text: "Where replies go. Format: \"Display Name\" <email>. Leave blank to use your account email."
  - Placeholder: `"Acme Trucking" <acmetrucking@acmetrucking.com>`
  - On save: light parse (see 6.1.1) into `{reply_to_email, reply_to_name}`.
- **Live Preview pane** — read-only, updates as the tenant types:
  ```
  From:     {Display Name} <{slug}@mail.drayagedirect.com>
  Reply-To: "{name}" <{email}>      ← or hidden if none
  (Will appear as "via mail.drayagedirect.com" in Gmail —
   upgrade to a custom domain to remove this.)
  ```

Branch picker: the existing UI's branch dropdown (if present) stays where it
is. If no branch picker exists yet, it's not added here — branch scoping is a
schema-level addition that surfaces in the config selection query; UI for
branch-scoped config creation can come later.

#### 6.1.1 Reply-To parser

Uses the `address-rfc2822` npm package (small, stable, no runtime deps) — or
equivalent like `email-addresses`. **Neither is currently in `package.json`**
(verified 2026-04-20); implementation adds whichever is chosen as a new
dependency. Cases:

| Input | Parsed | Result |
|---|---|---|
| `"Acme Trucking" <acme@acme.com>` | `{name: "Acme Trucking", email: "acme@acme.com"}` | Saved as-is |
| `acme@acme.com` | `{name: null, email: "acme@acme.com"}` | Saved; name null |
| `Acme <acme@acme.com>` | `{name: "Acme", email: "acme@acme.com"}` | Saved as-is |
| `Acme Trucking` | Parse error | Reject with format hint |
| `"Acme <acme@acme.com` | Parse error | Reject with format hint |
| `` (empty after trim) | — | Saved as null (= no reply-to configured) |

Rejection message: `Please use the format: "Your Company" <you@yourdomain.com>`.

### 6.2 Email Template editor — preview header + optional override

Added above the template body editor.

```
┌─ Sender Preview ──────────────────────────────────────┐
│ From:      Acme Trucking                              │
│            <acmetrucking@mail.drayagedirect.com>      │
│ Reply-To:  "Acme" <acme@acmetrucking.com>             │
│                               [Change sender identity →]│
└───────────────────────────────────────────────────────┘

Display Name Override (optional)
[ Acme Billing Department             ]
Leave blank to use your account-wide Display Name.
Use this if this specific template should appear as a
different identity.
```

Preview updates live as the tenant types into the override field.
"Change sender identity →" is a link to the Email Configuration page.

The Reply-To line in the preview is **read-only** here; tenants cannot
override Reply-To at the template level (per Section 5.2 Reply-To chain).

### 6.3 One-time migration banner

Shown at the top of the Email Configuration page for any tenant where
`tenants.sender_migration_at IS NOT NULL` AND the localStorage key
`sender_migration_dismissed:{tenant_id}` is unset.

```
┌─ ℹ  We've upgraded your email sender ─────────────────────┐
│ Your emails now send from                                 │
│   acmetrucking@mail.drayagedirect.com                     │
│ for better deliverability. Customer replies still come    │
│ to you at dispatch@acmeowner.gmail.com.                   │
│                                   [Learn more →]  [Dismiss]│
└───────────────────────────────────────────────────────────┘
```

Dismissal stored in localStorage — no schema change, no API call. Banner is
cosmetic; dismissing doesn't affect sends. If tenant clears localStorage
later, banner reappears; acceptable because the info is still accurate.

### 6.4 Consumer-domain server validator

Applies to any write (`POST` / `PUT`) to `tenant_sender_addresses` that would
set a `domain_id` pointing at a consumer-TLD row (new or existing).

Rejection response: `400 Bad Request` with body:

```json
{
  "error": "consumer_domain_not_allowed",
  "message": "Consumer email providers (gmail.com, yahoo.com, outlook.com, hotmail.com, live.com, icloud.com, aol.com, protonmail.com, ymail.com, mail.com) can't be used as a From address — their DMARC policies cause silent delivery failures. Use the DrayageDirect default sender and put your personal address in the Reply-To field instead."
}
```

UI surfaces this inline next to the field that triggered it.

Normalization before blocklist match: `domain.trim().toLowerCase()`. Exact
domain match only — `gmail.com.evil.com` does NOT match `gmail.com`.

The consumer-domain list lives in `lib/email-dispatch/consumer-domains.js`:

```js
export const CONSUMER_EMAIL_DOMAINS = Object.freeze([
  'gmail.com', 'yahoo.com', 'outlook.com', 'hotmail.com',
  'live.com', 'icloud.com', 'aol.com', 'protonmail.com',
  'ymail.com', 'mail.com',
]);

export function isConsumerDomain(domain) {
  if (!domain) return false;
  return CONSUMER_EMAIL_DOMAINS.includes(domain.trim().toLowerCase());
}
```

---

## 7. Migration Strategy

### 7.1 Ordering

1. SendGrid + DNS setup (Section 8) — one-time, operator-driven, before any SQL.
2. Pre-migration checks (Section 4.6) — abort if any fail.
3. Migration SQL (Section 4) — atomic BEGIN / COMMIT.
4. Deploy code that uses the new columns.
5. Monitor for 48 hours (Section 9.3).

### 7.2 Atomicity

Whole migration wrapped in one transaction. Any failure rolls back all writes.
`_migration_email_config_backup` persists post-commit so post-cutover rollback
is possible (Section 7.3).

### 7.3 Rollback path

If something goes wrong in production after cutover:

1. Reverse Section 4.8 Step 3 by restoring `sender_address_id` from the backup:
   ```sql
   UPDATE email_configurations ec
   SET sender_address_id = b.old_sender_address_id
   FROM _migration_email_config_backup b
   WHERE ec.id = b.config_id;
   ```
   Note: `reply_to_email` / `reply_to_name` stay populated post-rollback with
   whatever value they held at rollback-time (possibly migration-set, possibly
   user-edited). This is intentional — we don't wipe tenant edits made between
   migration and rollback. Leftover migration-populated reply_to values are
   harmless: they restore the tenant's reply-expectation to "replies go to my
   real mailbox," which is correct either way.
2. Leave Sections 4.2 – 4.4 untouched — additive, tenants can ignore new rows.
3. Leave new columns untouched — nullable, no consumers break.
4. Banner disappears on its own (localStorage-scoped).

No destructive operations in rollback — no `DROP COLUMN`, no `DROP TABLE`,
no `DELETE`.

Rollback restores pre-migration delivery behaviour, which means consumer-
domain tenants go back to having their sends silently dropped. This is the
intended semantics of "rollback" — it's for when the new code path is broken
and we need to disable it entirely, accepting the pre-existing deliverability
bug as the lesser evil until the code is fixed.

### 7.4 Tenants NOT auto-migrated

- Tenants whose current sender is on a **verified custom domain** — intentionally
  on pro-tier (or early adopter). Leave alone.
- Tenants whose current sender is on an **unverified custom domain that isn't
  a consumer domain** — may have their own DNS setup in progress. Don't
  rewrite their choice.

A future polish pass (2a.5b) can add a warning banner for the unverified-
custom-domain case, suggesting they either complete verification or switch
to default tier.

### 7.5 New tenant provisioning

Tenant creation happens in `pages/admin/tenants/index.js` (`CreateTenantModal`
component, line 88). Form fields include `name`, `slug`, `contact_email`,
`subscription_tier_id`, `mc_number`, `dot_number`. Verified 2026-04-20.

Provisioning must hook the API route this modal posts to (identified during
implementation) so that tenant creation is a single transaction containing:

1. `INSERT INTO tenants (..., slug, ...)`
2. `INSERT INTO tenant_sender_addresses (tenant_id, local_part=slug, domain_id=<platform>, is_default=true)`
3. `INSERT INTO email_configurations (tenant_id, name='Default (DrayageDirect Sender)', sender_address_id=<new_row>, is_active=true, is_default=true, priority=100)`

New tenants are never in a "no sender configured" state.

---

## 8. SendGrid + DNS Setup (One-Time Manual)

This section is operator-facing; it's a runbook, not code.

### 8.1 SendGrid dashboard

1. Settings → Sender Authentication → Authenticate Your Domain.
2. Domain: `drayagedirect.com`. Custom return path / subdomain: `mail`.
3. **Automated Security: OFF** — CNAME rotation is hostile to multi-tenant use.
4. **Link Branding: OFF** — transactional emails shouldn't have click-tracking
   redirects.
5. SendGrid generates 3 CNAMEs:
   - `em####.mail.drayagedirect.com` → `u####.wl.sendgrid.net`
   - `s1._domainkey.mail.drayagedirect.com` → `s1.domainkey.u####.wl.sendgrid.net`
   - `s2._domainkey.mail.drayagedirect.com` → `s2.domainkey.u####.wl.sendgrid.net`
6. Record the **SendGrid Domain ID** (numeric, shown at the top of the domain
   record). Store as `SENDGRID_PLATFORM_DOMAIN_ID`.

### 8.2 DNS registrar

Add all 3 CNAMEs above at `drayagedirect.com`'s registrar. TTL 300–3600.
Proxy / CDN must be **OFF** (Cloudflare "grey cloud," not "orange cloud").

Recommended: add SPF on the subdomain.

- Type: `TXT`
- Host: `mail.drayagedirect.com`
- Value: `v=spf1 include:sendgrid.net ~all`

### 8.3 DMARC check (inspect, don't modify)

Read the current `_dmarc.drayagedirect.com` record. Regardless of `p=` value,
DKIM passing on `mail.drayagedirect.com` satisfies DMARC because the DKIM `d=`
aligns with the From: domain's organisational domain. No DMARC action needed.

### 8.4 Verification

1. Run SendGrid's **Verify** button. All 3 CNAMEs must turn green.
2. Send a test email via SendGrid's API with `from: test@mail.drayagedirect.com`
   to a Gmail address you control. Open "Show original":
   - `dkim=pass header.d=mail.drayagedirect.com` ✓
   - `spf=pass smtp.mailfrom=mail.drayagedirect.com` ✓
   - `dmarc=pass` ✓
3. All three = safe to run the migration.

### 8.5 Env vars

Added to `.env.example`:

```
SENDGRID_PLATFORM_SENDER_DOMAIN=mail.drayagedirect.com
SENDGRID_PLATFORM_DOMAIN_ID=<numeric id from SendGrid>
```

Consumed by the migration SQL (via `psql -v`) and a runtime constant in
`lib/email-dispatch/constants.js`:

```js
export const PLATFORM_SENDER_DOMAIN = process.env.SENDGRID_PLATFORM_SENDER_DOMAIN
  ?? 'mail.drayagedirect.com';
```

---

## 9. Error Handling & Edge Cases

### 9.1 DNS / SendGrid drift

- **Verification fails post-launch.** DKIM fails, Gmail bounces, `email_messages.status='failed'`. Operator re-verifies in SendGrid. No code-level auto-heal in v1.
- **Subdomain unreachable.** Same pattern — failed row, operator intervention.

### 9.2 Consumer-domain validator bypass attempts

- **Case / whitespace tricks** → normalized via `domain.trim().toLowerCase()`.
- **Subdomain tricks** (`gmail.com.evil.com`) → exact match, not substring.
- **Homograph attacks** → out of scope v1. Future hardening item.
- **New consumer provider we didn't list** → one-line addition to `CONSUMER_EMAIL_DOMAINS` plus unit test.

### 9.3 Reply-To parsing

- **Invalid format** → rejected on save with the format hint from 6.1.1.
- **Empty after trim** → saved as null.
- **Email only, no name** → `{email, name: null}` valid.
- **Name only, no email** → rejected.
- **HTML / control chars** → SendGrid's structured API escapes them. Never build headers manually.

### 9.4 Slug issues (blocked by pre-migration checks)

- **`tenants.slug` not unique** → pre-check blocks migration.
- **`tenants.slug` NULL** → pre-check blocks migration.
- **Invalid chars for email local-part** → pre-check blocks migration.

These must be fixed in the tenants table before the migration can proceed.

### 9.5 Branch lifecycle

- **Branch deleted while referenced** → `ON DELETE SET NULL`; config downgrades to tenant-default.
- **Branch deactivated** → no cascade; operator re-assigns or reactivates.

### 9.6 Configuration selection edge cases

- **Zero active configs** → send fails with `"No active email configuration for this tenant"`. Migration step 4.9 + new-tenant provisioning make this state nearly impossible; guard remains.
- **Tie on priority** → `ORDER BY priority ASC LIMIT 1` picks deterministically via Postgres sort tiebreak.
- **Mid-send config swap** → each send captures `configuration_id` at resolution time; audit honest.

### 9.7 Display name input validation

- **Length cap** — 100 chars enforced by API layer.
- **Empty / whitespace only** — saved as null; falls through in precedence chain.
- **Unicode / emoji** — allowed; UTF-8 end-to-end.

### 9.8 Template override edge cases

- **Override set, config deleted** → override still wins (independent of config selection).
- **Multiple templates, different overrides** → not a conflict; only one template renders per send.

### 9.9 SendGrid API failures

- **Transient 5xx** → existing behaviour. `email_messages.status='failed'` with `error_message`. User retries manually. Retry logic is a separate concern.

---

## 10. Testing & Verification

### 10.1 Unit tests

Four pure helpers, one test file each. Pattern matches 2a.4's `computeGroups`
— inlined node-script verification if the test harness isn't wired up.

- `resolveFromDisplayName(template, config, tenant)` — all 4 precedence tiers;
  empty-string and whitespace-only inputs fall through.
- `resolveReplyTo(config, tenant)` — 3 tiers including the null return.
- `isConsumerDomain(domain)` — normalization, exact match, each blocklist entry.
- `parseReplyToString(input)` — all rows of the 6.1.1 table.

### 10.2 Verification gates (walked through live, in order)

**Gate 1 — DNS + SendGrid.** `mail.drayagedirect.com` fully verified. All 3
CNAMEs resolve via `dig`.

**Gate 2 — Migration applied in dev.** Run migration SQL against local
Supabase. Confirm:
- `_migration_email_config_backup` populated.
- Platform `tenant_sender_domains` row exists with `tenant_id IS NULL`.
- Every tenant has a `tenant_sender_addresses` row for the platform domain.
- `tenants.sender_migration_at` set only for migrated tenants.

**Gate 3 — Consumer-domain validator.** POST `tenant_sender_addresses` with
`domain='gmail.com'` via API. Expect 400. Repeat with `Gmail.COM` and
`  gmail.com  ` — both rejected.

**Gate 4 — Deliverability gate.** Send a real invoice via UI to a real Gmail
address. In "Show original":
- `dkim=pass header.d=mail.drayagedirect.com` ✓
- `spf=pass smtp.mailfrom=mail.drayagedirect.com` ✓
- `dmarc=pass` ✓
- Inbox placement, not spam ✓

This is the gate that validates the whole exercise. Stop and fix before
moving on if it fails.

**Gate 5 — Reply path.** Reply to the email from Gmail. Confirm it lands in
the tenant's configured Reply-To address.

**Gate 6 — Display name precedence.** Set template override, send, confirm
`email_messages.from_name` matches. Clear override, confirm config-level wins.
Null config-level, confirm `tenants.name` wins. Null tenant name, confirm
platform fallback.

**Gate 7 — Branch-scoped config wins.** Tenant with two configs (one
branch-scoped, one default). Send load belonging to branch → branch config
selected. Send load with no branch → default wins. Verify via
`email_messages.configuration_id`.

**Gate 8 — Migration banner behaviour.** Log in as migrated tenant → banner
visible on Email Configuration page. Click Dismiss → gone. Hard refresh →
still gone. Clear localStorage → reappears. Log in as non-migrated tenant →
banner never shows.

**Gate 9 — UI integration.** Edit Display Name in Email Configuration, save →
preview updates. Open Email Template → preview reflects new name. Fill
template override → preview updates live. Save → persisted. Send test →
`email_messages.from_name` matches.

**Gate 10 — Rollback drill (staging only).** Apply migration, manually run
rollback SQL. Confirm configs revert to pre-migration state. Do not do this
in prod unless actually needed.

### 10.3 Post-cutover monitoring (first 48 hours)

- `SELECT status, count(*) FROM email_messages WHERE created_at > :cutover GROUP BY status` — compare to 48 hours pre-cutover. Investigate if failed-rate meaningfully higher.
- Spot-check 5–10 random tenants' Email Configuration pages.
- SendGrid Bounces + Blocks dashboard — new patterns.

No custom dashboards in v1. SendGrid's event stream is the source of truth
until 2a.6 lands.

---

## 11. Out of Scope / Deferred Items

Captured here so they're not forgotten but explicitly not in this spec:

- **Pro tier (custom domain auth).** Own sub-project.
- **Enterprise tier (Gmail OAuth / MS Graph).** Own sub-project.
- **Inbound / reply parsing.** Replies go to tenant mailbox via `Reply-To`.
- **Delivery tracking webhooks.** 2a.6.
- **Auto-retry on SendGrid 5xx.** Separate concern.
- **Homograph protection on consumer-domain blocklist.** ASCII v1 only.
- **Warning banner for unverified-custom-domain tenants.** 2a.5b polish.
- **Staging environment with its own subdomain.** Future if needed.
- **SendGrid API key rotation runbook.** Ops concern.

---

## 12. Open Items for Implementation

All items from the initial spec were resolved during self-review on 2026-04-20:

- ~~Exact file path for the tenant-creation code path~~ → `pages/admin/tenants/index.js:88` (`CreateTenantModal`). Section 7.5.
- ~~Whether `email_configurations` already has a `branch_id` column~~ → No. Straight ADD. Section 4.1.
- ~~Existence and shape of the rate-con send endpoint~~ → Lives at `pages/api/tenant/ar/charge-sets/[id]/send-rate-con-email.js`. Section 5.5.
- ~~AR Configuration page UI — create form present?~~ → Full suite lives at `pages/settings/communications/configurations/` (list + `[id].js` edit). Sender Identity section slots into the existing edit view. Not "AR" — it's under Settings → Communications.
- ~~Whether `address-rfc2822` is a dependency~~ → No. Neither it nor `email-addresses` is installed. Section 6.1.1.

Remaining items to nail down during implementation (minor):

- Exact API route the `CreateTenantModal` POSTs to (for the provisioning hook in 7.5).
- Exact endpoint paths where sender-address / sender-domain writes happen — needed by the consumer-domain validator (Section 6.4). The UI suggests at least `pages/settings/communications/sender-addresses/` and `pages/settings/communications/sender-domains/` have corresponding API routes.

---

## 13. Approval Trail

- **Brainstorming session:** 2026-04-19 (this document)
- **Decisions locked:**
  - From: format — per-tenant slug (A)
  - Display name location — both template + configuration, with precedence chain
  - Reply-To — configuration-level only, combined free-text input
  - Slug source — existing `tenants.slug`
  - Migration — silent auto-migrate + banner + block future consumer-domain senders
  - Schema approach — reuse `sender_kind='sendgrid'`, nullable `tenant_id`, shared row (A)
