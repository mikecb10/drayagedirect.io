-- ============================================================
-- Migration 053: Email System — Infrastructure
-- ============================================================
-- Plumbing that sits behind the templates + umbrellas + triggers:
--
--   email_accounts              Per-user Gmail OAuth connections
--                               (user sends from their own mailbox)
--
--   tenant_sender_domains       Tenant-authenticated domains for
--                               SendGrid transactional sends
--                               (carrier@tenant-domain.com)
--
--   tenant_sender_addresses     Specific From: addresses bound to
--                               a verified sender_domain — the list
--                               a user picks from in Configurations
--
--   email_configurations        Top-level wiring of "when X, send via Y"
--                               binding umbrellas to a chosen sender
--
--   email_configuration_umbrellas  Junction: which umbrellas a
--                                  configuration owns
--
--   email_messages              Every email the system has tried
--                               to send or receive. Unified timeline
--                               for the Communication tab.
--
--   email_message_attachments   Attachments (stored by reference to
--                               existing documents or inline files)
--
--   email_trigger_log           Audit trail of every trigger fire —
--                               what fired, what matched, who got it,
--                               dedupe hits, errors. Powers the
--                               "Trigger Activity" admin screen.
--
-- FOLLOW-UP: Migration 055 extends this layer with shared-account
-- support: scope column on email_accounts, email_account_permissions
-- junction table, and a third sender identity (shared_account_id) on
-- email_configurations. See 055_email_shared_accounts.sql.
-- ============================================================

BEGIN;

-- ──────────────────────────────────────────────────────────────
-- email_accounts — per-user Gmail OAuth connections
--
-- One row per connected mailbox per user. Multiple users can
-- each connect their own Gmail; the From: dropdown shows their
-- connected account(s) alongside any tenant sender addresses
-- they have permission to use.
--
-- Refresh tokens are encrypted at rest using the tenant's
-- encryption key (managed via pgsodium or Supabase Vault — we
-- use pgcrypto PGP here as a baseline and can move to Vault
-- later without a data migration).
--
-- NOTE: Migration 055 extends this table with a scope column,
-- nullable user_id, connected_by_user_id, and the companion
-- email_account_permissions junction table to support shared
-- tenant mailboxes. See 055_email_shared_accounts.sql.
-- ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS email_accounts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  provider TEXT NOT NULL CHECK (provider IN ('gmail', 'outlook', 'sendgrid')),
  email_address TEXT NOT NULL,       -- The authenticated mailbox address
  display_name TEXT,                 -- What appears in From: "Display Name <addr>"

  -- OAuth tokens (Gmail / Outlook only — SendGrid senders don't need these)
  access_token_encrypted TEXT,       -- PGP-encrypted
  refresh_token_encrypted TEXT,      -- PGP-encrypted
  token_expires_at TIMESTAMPTZ,
  oauth_scopes TEXT[],

  -- Status
  is_active BOOLEAN NOT NULL DEFAULT true,
  last_verified_at TIMESTAMPTZ,
  last_error TEXT,                   -- Last OAuth / send error for this account

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (tenant_id, user_id, email_address)
);

CREATE INDEX IF NOT EXISTS idx_email_accounts_user
  ON email_accounts(user_id) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_email_accounts_tenant
  ON email_accounts(tenant_id) WHERE is_active = true;

-- ──────────────────────────────────────────────────────────────
-- tenant_sender_domains — verified domains for transactional email
--
-- One row per domain a tenant has authenticated with SendGrid.
-- Verification walks DKIM CNAMEs and an optional DMARC record.
-- While pending, the domain shows in the UI with a "Verify DNS"
-- checklist and cannot be used as a sender.
-- ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tenant_sender_domains (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

  domain TEXT NOT NULL,              -- e.g. "tenant-carrier.com"
  sendgrid_domain_id TEXT,           -- SendGrid's internal ID for the domain
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'verifying', 'verified', 'failed', 'revoked')),

  -- DNS records the tenant needs to create, stored so the UI can
  -- show the checklist without hitting SendGrid on every page load.
  dns_records JSONB NOT NULL DEFAULT '[]'::jsonb,
  -- Shape: [{ "type": "CNAME", "host": "em1234.tenant.com", "points_to": "u123.wl.sendgrid.net", "verified": true }, ...]

  last_verification_check_at TIMESTAMPTZ,
  last_verification_error TEXT,

  -- Optional default From: name for this domain if the sender address
  -- doesn't override it.
  default_from_name TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,

  UNIQUE (tenant_id, domain)
);

CREATE INDEX IF NOT EXISTS idx_sender_domains_tenant
  ON tenant_sender_domains(tenant_id);
CREATE INDEX IF NOT EXISTS idx_sender_domains_status
  ON tenant_sender_domains(tenant_id, status);

-- ──────────────────────────────────────────────────────────────
-- tenant_sender_addresses — specific From: addresses on a domain
--
-- After a domain is verified, users create named sender
-- addresses under it (noreply@, dispatch@, billing@, etc.)
-- with friendly display names. These show up in the From:
-- picker in Configurations alongside user Gmail accounts.
-- ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tenant_sender_addresses (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  domain_id UUID NOT NULL REFERENCES tenant_sender_domains(id) ON DELETE CASCADE,

  local_part TEXT NOT NULL,          -- "dispatch" in "dispatch@tenant.com"
  display_name TEXT NOT NULL,        -- "Tenant Dispatch" in the From: field
  reply_to TEXT,                     -- Optional override
  is_default BOOLEAN NOT NULL DEFAULT false,
  is_active BOOLEAN NOT NULL DEFAULT true,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (domain_id, local_part)
);

CREATE INDEX IF NOT EXISTS idx_sender_addresses_tenant
  ON tenant_sender_addresses(tenant_id) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_sender_addresses_domain
  ON tenant_sender_addresses(domain_id);

-- Only one default per tenant
CREATE UNIQUE INDEX IF NOT EXISTS idx_sender_addresses_default_per_tenant
  ON tenant_sender_addresses(tenant_id) WHERE is_default = true;

-- ──────────────────────────────────────────────────────────────
-- email_configurations — top-level wiring of "when X, send via Y"
--
-- A Configuration is the glue between umbrellas/triggers and a
-- concrete sender account. Gives tenants a top-down view of
-- "for these umbrellas, send via this account, with these
-- defaults".
--
-- Most tenants will have one or two configurations. Example:
--   "Customer-facing emails" → SendGrid dispatch@tenant.com
--   "Internal ops emails"    → each user's own Gmail
--
-- NOTE: Migration 055 adds a third sender identity option
-- (shared_account_id, pointing at a scope='tenant' email_accounts
-- row) and rewrites the CHECK constraint to be 3-way exclusive.
-- See 055_email_shared_accounts.sql.
-- ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS email_configurations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

  name TEXT NOT NULL,
  description TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  is_default BOOLEAN NOT NULL DEFAULT false,

  -- Sender: either a shared tenant address (SendGrid) OR the sending
  -- user's own connected Gmail. Exactly one must be set.
  sender_address_id UUID REFERENCES tenant_sender_addresses(id) ON DELETE SET NULL,
  -- When true, the configuration uses the current user's connected
  -- Gmail (email_accounts row for the acting user) instead of a
  -- shared address. Mutually exclusive with sender_address_id.
  use_user_gmail BOOLEAN NOT NULL DEFAULT false,

  -- Optional priority (lower number = higher priority) if a template
  -- fires and multiple configurations could deliver it. 0 = normal.
  priority INT NOT NULL DEFAULT 0,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,

  CHECK (
    (sender_address_id IS NOT NULL AND use_user_gmail = false) OR
    (sender_address_id IS NULL AND use_user_gmail = true)
  )
);

CREATE INDEX IF NOT EXISTS idx_email_configurations_tenant
  ON email_configurations(tenant_id) WHERE is_active = true;

-- Only one default configuration per tenant
CREATE UNIQUE INDEX IF NOT EXISTS idx_email_configurations_default
  ON email_configurations(tenant_id) WHERE is_default = true;

-- ──────────────────────────────────────────────────────────────
-- email_configuration_umbrellas
--
-- Which umbrellas a configuration "owns". A configuration matches
-- a send if ANY of its umbrellas match the load. Empty means
-- "catch-all / fallback" — used by the default configuration.
-- ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS email_configuration_umbrellas (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  configuration_id UUID NOT NULL REFERENCES email_configurations(id) ON DELETE CASCADE,
  umbrella_id UUID NOT NULL REFERENCES email_umbrellas(id) ON DELETE CASCADE,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (configuration_id, umbrella_id)
);

CREATE INDEX IF NOT EXISTS idx_email_config_umbrellas_config
  ON email_configuration_umbrellas(configuration_id);

-- ──────────────────────────────────────────────────────────────
-- email_messages — every email in or out of the system
--
-- Unified timeline table powering the Communication tab. Stores
-- both outbound (we sent it) and inbound (arrived via IMAP /
-- inbound parse webhook / SendGrid Inbound Parse) messages.
--
-- Each row is ONE message. If the same trigger fanned out to 3
-- groups, there will be 3 rows here (one per actual message
-- dispatched) sharing the same trigger_log_id.
-- ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS email_messages (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

  -- Scope: most messages belong to a load; some may be org-scoped
  -- or standalone (general broadcasts)
  load_id UUID REFERENCES orders(id) ON DELETE SET NULL,
  organization_id UUID REFERENCES customers(id) ON DELETE SET NULL,

  direction TEXT NOT NULL CHECK (direction IN ('outbound', 'inbound')),

  -- Content
  from_address TEXT NOT NULL,
  from_name TEXT,
  to_addresses JSONB NOT NULL DEFAULT '[]'::jsonb,   -- ["a@b.com", ...]
  cc_addresses JSONB NOT NULL DEFAULT '[]'::jsonb,
  bcc_addresses JSONB NOT NULL DEFAULT '[]'::jsonb,
  reply_to TEXT,
  subject TEXT NOT NULL,
  body_html TEXT,
  body_text TEXT,

  -- Provider metadata
  provider TEXT CHECK (provider IN ('gmail', 'outlook', 'sendgrid', 'manual', 'inbound_parse')),
  provider_message_id TEXT,          -- Gmail's threadId / SendGrid's x-message-id / etc.
  thread_key TEXT,                   -- Our stable thread hash (RFC-5322 Message-ID chain or slug)

  -- Status (outbound)
  status TEXT NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'sending', 'sent', 'delivered', 'bounced', 'failed', 'opened', 'clicked')),
  last_status_at TIMESTAMPTZ,
  error_message TEXT,

  -- Links back to the originating rule chain (outbound only)
  template_id UUID REFERENCES email_templates(id) ON DELETE SET NULL,
  umbrella_id UUID REFERENCES email_umbrellas(id) ON DELETE SET NULL,
  group_id UUID REFERENCES email_umbrella_groups(id) ON DELETE SET NULL,
  configuration_id UUID REFERENCES email_configurations(id) ON DELETE SET NULL,
  trigger_id UUID REFERENCES email_template_triggers(id) ON DELETE SET NULL,

  -- Who sent it (user id if the send was initiated by a user action)
  sent_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,

  -- When the message was sent / received at the provider level
  sent_at TIMESTAMPTZ,
  received_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_email_messages_tenant
  ON email_messages(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_email_messages_load
  ON email_messages(load_id, created_at DESC) WHERE load_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_email_messages_org
  ON email_messages(organization_id, created_at DESC) WHERE organization_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_email_messages_thread
  ON email_messages(thread_key) WHERE thread_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_email_messages_status
  ON email_messages(tenant_id, status) WHERE direction = 'outbound';

-- ──────────────────────────────────────────────────────────────
-- email_message_attachments
--
-- Attachments are either pointers to existing documents (POD, BOL,
-- invoice PDFs etc. already stored in Supabase Storage) OR inline
-- files uploaded with a manual compose send.
-- ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS email_message_attachments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  message_id UUID NOT NULL REFERENCES email_messages(id) ON DELETE CASCADE,

  -- Either a pointer into load documents OR a direct storage path
  document_submission_id UUID REFERENCES document_submissions(id) ON DELETE SET NULL,
  storage_path TEXT,                 -- e.g. "email-attachments/<tenant>/<uuid>.pdf"

  filename TEXT NOT NULL,
  content_type TEXT,
  size_bytes INT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CHECK (document_submission_id IS NOT NULL OR storage_path IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_email_message_attachments_message
  ON email_message_attachments(message_id);

-- ──────────────────────────────────────────────────────────────
-- email_trigger_log — every trigger evaluation (fired or skipped)
--
-- One row per (trigger × load × event) combination the engine
-- considered. This is the audit trail for the "Trigger Activity"
-- admin view AND the source of truth for dedupe checks.
-- ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS email_trigger_log (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

  trigger_id UUID REFERENCES email_template_triggers(id) ON DELETE SET NULL,
  template_id UUID REFERENCES email_templates(id) ON DELETE SET NULL,
  load_id UUID REFERENCES orders(id) ON DELETE SET NULL,

  -- Why the engine looked at this trigger (event_name + dotted fire_key)
  -- e.g. 'document.uploaded'  with  fire_key = 'bol'
  event_name TEXT NOT NULL,
  fire_key TEXT,

  -- What happened: fired (emails sent), skipped (conditions didn't match),
  -- deduped (within window), errored (exception), disabled (not active)
  outcome TEXT NOT NULL CHECK (outcome IN ('fired', 'skipped', 'deduped', 'errored', 'disabled')),
  outcome_detail TEXT,

  -- Umbrella resolution snapshot (what matched, what got suppressed)
  -- Stored as JSONB so the admin UI can render the decision tree
  umbrella_decisions JSONB NOT NULL DEFAULT '[]'::jsonb,
  -- Shape: [{ "umbrella_id": "...", "name": "...", "specificity_score": 5,
  --          "matched": true, "suppressed_by": "<other-id>" | null,
  --          "always_run": false, "groups_fired": [{...}] }]

  -- Count of messages the fire produced (0 for non-fired outcomes)
  messages_created INT NOT NULL DEFAULT 0,

  fired_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_email_trigger_log_tenant
  ON email_trigger_log(tenant_id, fired_at DESC);
CREATE INDEX IF NOT EXISTS idx_email_trigger_log_load
  ON email_trigger_log(load_id, fired_at DESC) WHERE load_id IS NOT NULL;
-- Dedupe check: look up the most recent fired-outcome row for this
-- (tenant, trigger, load, fire_key) combo within the dedupe window.
CREATE INDEX IF NOT EXISTS idx_email_trigger_log_dedupe
  ON email_trigger_log(tenant_id, trigger_id, load_id, fire_key, fired_at DESC)
  WHERE outcome = 'fired';

-- ──────────────────────────────────────────────────────────────
-- RLS
-- ──────────────────────────────────────────────────────────────
ALTER TABLE email_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_sender_domains ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_sender_addresses ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_configurations ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_configuration_umbrellas ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_message_attachments ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_trigger_log ENABLE ROW LEVEL SECURITY;

-- email_accounts are scoped per-user within a tenant: a user can
-- only see and manage their own connected mailboxes. Admins can
-- see all their tenant's accounts for troubleshooting.
--
-- NOTE: auth.uid() returns the Supabase Auth UUID, while
-- email_accounts.user_id references users.id (the tenant-scoped
-- row ID). We resolve one to the other via users.auth_uid which
-- holds the stringified auth UUID (see migration 040 for the
-- canonical lookup pattern).
--
-- NOTE: Migration 055 replaces these policies with scope-aware
-- versions that also check the email_account_permissions table.
DROP POLICY IF EXISTS ea_select ON email_accounts;
CREATE POLICY ea_select ON email_accounts FOR SELECT
  USING (
    (
      tenant_id = current_tenant_id()
      AND user_id = (SELECT id FROM users WHERE auth_uid = auth.uid()::TEXT LIMIT 1)
    )
    OR (
      tenant_id = current_tenant_id()
      AND EXISTS (
        SELECT 1 FROM users u
        WHERE u.auth_uid = auth.uid()::TEXT
          AND u.tenant_id = current_tenant_id()
          AND u.role IN ('admin', 'super_admin')
      )
    )
    OR is_dd_admin()
  );
DROP POLICY IF EXISTS ea_insert ON email_accounts;
CREATE POLICY ea_insert ON email_accounts FOR INSERT
  WITH CHECK (
    tenant_id = current_tenant_id()
    AND user_id = (SELECT id FROM users WHERE auth_uid = auth.uid()::TEXT LIMIT 1)
  );
DROP POLICY IF EXISTS ea_update ON email_accounts;
CREATE POLICY ea_update ON email_accounts FOR UPDATE
  USING (
    tenant_id = current_tenant_id()
    AND user_id = (SELECT id FROM users WHERE auth_uid = auth.uid()::TEXT LIMIT 1)
  );
DROP POLICY IF EXISTS ea_delete ON email_accounts;
CREATE POLICY ea_delete ON email_accounts FOR DELETE
  USING (
    tenant_id = current_tenant_id()
    AND user_id = (SELECT id FROM users WHERE auth_uid = auth.uid()::TEXT LIMIT 1)
  );

-- Remaining tables use the standard tenant-scoped ALL policy
DROP POLICY IF EXISTS tsd_all ON tenant_sender_domains;
CREATE POLICY tsd_all ON tenant_sender_domains FOR ALL
  USING (tenant_id = current_tenant_id() OR is_dd_admin())
  WITH CHECK (tenant_id = current_tenant_id() OR is_dd_admin());

DROP POLICY IF EXISTS tsa_all ON tenant_sender_addresses;
CREATE POLICY tsa_all ON tenant_sender_addresses FOR ALL
  USING (tenant_id = current_tenant_id() OR is_dd_admin())
  WITH CHECK (tenant_id = current_tenant_id() OR is_dd_admin());

DROP POLICY IF EXISTS ec_all ON email_configurations;
CREATE POLICY ec_all ON email_configurations FOR ALL
  USING (tenant_id = current_tenant_id() OR is_dd_admin())
  WITH CHECK (tenant_id = current_tenant_id() OR is_dd_admin());

DROP POLICY IF EXISTS ecu_all ON email_configuration_umbrellas;
CREATE POLICY ecu_all ON email_configuration_umbrellas FOR ALL
  USING (tenant_id = current_tenant_id() OR is_dd_admin())
  WITH CHECK (tenant_id = current_tenant_id() OR is_dd_admin());

DROP POLICY IF EXISTS em_all ON email_messages;
CREATE POLICY em_all ON email_messages FOR ALL
  USING (tenant_id = current_tenant_id() OR is_dd_admin())
  WITH CHECK (tenant_id = current_tenant_id() OR is_dd_admin());

DROP POLICY IF EXISTS ema_all ON email_message_attachments;
CREATE POLICY ema_all ON email_message_attachments FOR ALL
  USING (tenant_id = current_tenant_id() OR is_dd_admin())
  WITH CHECK (tenant_id = current_tenant_id() OR is_dd_admin());

DROP POLICY IF EXISTS etl_all ON email_trigger_log;
CREATE POLICY etl_all ON email_trigger_log FOR ALL
  USING (tenant_id = current_tenant_id() OR is_dd_admin())
  WITH CHECK (tenant_id = current_tenant_id() OR is_dd_admin());

-- ──────────────────────────────────────────────────────────────
-- updated_at triggers
-- ──────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION set_email_infra_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_email_accounts_updated_at ON email_accounts;
CREATE TRIGGER trg_email_accounts_updated_at
  BEFORE UPDATE ON email_accounts
  FOR EACH ROW EXECUTE FUNCTION set_email_infra_updated_at();

DROP TRIGGER IF EXISTS trg_tenant_sender_domains_updated_at ON tenant_sender_domains;
CREATE TRIGGER trg_tenant_sender_domains_updated_at
  BEFORE UPDATE ON tenant_sender_domains
  FOR EACH ROW EXECUTE FUNCTION set_email_infra_updated_at();

DROP TRIGGER IF EXISTS trg_tenant_sender_addresses_updated_at ON tenant_sender_addresses;
CREATE TRIGGER trg_tenant_sender_addresses_updated_at
  BEFORE UPDATE ON tenant_sender_addresses
  FOR EACH ROW EXECUTE FUNCTION set_email_infra_updated_at();

DROP TRIGGER IF EXISTS trg_email_configurations_updated_at ON email_configurations;
CREATE TRIGGER trg_email_configurations_updated_at
  BEFORE UPDATE ON email_configurations
  FOR EACH ROW EXECUTE FUNCTION set_email_infra_updated_at();

DROP TRIGGER IF EXISTS trg_email_messages_updated_at ON email_messages;
CREATE TRIGGER trg_email_messages_updated_at
  BEFORE UPDATE ON email_messages
  FOR EACH ROW EXECUTE FUNCTION set_email_infra_updated_at();

NOTIFY pgrst, 'reload schema';

COMMIT;
