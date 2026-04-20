-- supabase/migrations/082_email_sender_default_tier.sql
--
-- Email sender default tier: platform-owned subdomain + per-tenant senders.
-- See docs/superpowers/specs/2026-04-19-email-sender-default-tier-design.md
--
-- Parameterized:
--   :sendgrid_domain_id  — numeric SendGrid Domain Authentication ID for
--                          mail.drayagedirect.com. Supply via:
--                            psql -v sendgrid_domain_id=12345678 ...
--                          or via Supabase SQL editor by replacing the
--                          :sendgrid_domain_id placeholder with the value
--                          before running.

BEGIN;

-- ─────────────────────────────────────────────────────────────────────
-- PRE-MIGRATION CHECKS — abort if any tenant data is invalid.
-- ─────────────────────────────────────────────────────────────────────

DO $$
DECLARE
  null_count INT;
  dup_count INT;
  invalid_count INT;
BEGIN
  SELECT COUNT(*) INTO null_count
  FROM tenants WHERE slug IS NULL;
  IF null_count > 0 THEN
    RAISE EXCEPTION 'PRE-MIGRATION FAIL: % tenant(s) have NULL slug. Fix before running.', null_count;
  END IF;

  SELECT COUNT(*) INTO dup_count FROM (
    SELECT slug FROM tenants GROUP BY slug HAVING COUNT(*) > 1
  ) d;
  IF dup_count > 0 THEN
    RAISE EXCEPTION 'PRE-MIGRATION FAIL: % duplicate slug value(s). Fix before running.', dup_count;
  END IF;

  SELECT COUNT(*) INTO invalid_count
  FROM tenants WHERE slug !~ '^[a-zA-Z0-9._-]+$';
  IF invalid_count > 0 THEN
    RAISE EXCEPTION 'PRE-MIGRATION FAIL: % tenant slug(s) contain invalid email-local-part characters. Fix before running.', invalid_count;
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────
-- SCHEMA CHANGES — new columns first (additive, no data).
-- ─────────────────────────────────────────────────────────────────────

ALTER TABLE email_configurations
  ADD COLUMN IF NOT EXISTS from_display_name TEXT,
  ADD COLUMN IF NOT EXISTS reply_to_email    TEXT,
  ADD COLUMN IF NOT EXISTS reply_to_name     TEXT,
  ADD COLUMN IF NOT EXISTS branch_id         UUID REFERENCES branches(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_email_configurations_branch_id
  ON email_configurations(branch_id) WHERE branch_id IS NOT NULL;

ALTER TABLE email_templates
  ADD COLUMN IF NOT EXISTS from_display_name TEXT;

ALTER TABLE email_messages
  ADD COLUMN IF NOT EXISTS reply_to_name TEXT;

ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS sender_migration_at TIMESTAMPTZ NULL;

-- ─────────────────────────────────────────────────────────────────────
-- MAKE tenant_sender_domains.tenant_id nullable — for the platform row.
-- ─────────────────────────────────────────────────────────────────────

ALTER TABLE tenant_sender_domains
  ALTER COLUMN tenant_id DROP NOT NULL;

-- ─────────────────────────────────────────────────────────────────────
-- RLS — allow READ of platform row (tenant_id IS NULL) for all tenants.
-- Writes remain scoped to own tenant.
-- ─────────────────────────────────────────────────────────────────────

-- Drop the legacy catch-all policy from migration 053 before replacing.
DROP POLICY IF EXISTS tsd_all ON tenant_sender_domains;

DROP POLICY IF EXISTS tenant_sender_domains_read ON tenant_sender_domains;
CREATE POLICY tenant_sender_domains_read ON tenant_sender_domains
  FOR SELECT
  USING (tenant_id = current_tenant_id() OR tenant_id IS NULL OR is_dd_admin());

DROP POLICY IF EXISTS tenant_sender_domains_write ON tenant_sender_domains;
CREATE POLICY tenant_sender_domains_write ON tenant_sender_domains
  FOR ALL
  USING (tenant_id = current_tenant_id() OR is_dd_admin())
  WITH CHECK (tenant_id = current_tenant_id() OR is_dd_admin());

-- ─────────────────────────────────────────────────────────────────────
-- SEED the platform domain row (idempotent).
-- ─────────────────────────────────────────────────────────────────────

INSERT INTO tenant_sender_domains
  (id, tenant_id, domain, sendgrid_domain_id, status, dns_records, created_at)
SELECT
  gen_random_uuid(), NULL, 'mail.drayagedirect.com',
  :sendgrid_domain_id, 'verified', '[]'::jsonb, now()
WHERE NOT EXISTS (
  SELECT 1 FROM tenant_sender_domains
  WHERE tenant_id IS NULL AND domain = 'mail.drayagedirect.com'
);

-- ─────────────────────────────────────────────────────────────────────
-- PROVISION per-tenant sender_address rows (idempotent).
-- ─────────────────────────────────────────────────────────────────────

INSERT INTO tenant_sender_addresses
  (tenant_id, local_part, display_name, domain_id, is_default)
SELECT
  t.id,
  t.slug,
  t.name,
  (SELECT id FROM tenant_sender_domains WHERE tenant_id IS NULL LIMIT 1),
  true
FROM tenants t
LEFT JOIN tenant_sender_addresses tsa
  ON tsa.tenant_id = t.id
  AND tsa.domain_id = (SELECT id FROM tenant_sender_domains WHERE tenant_id IS NULL LIMIT 1)
WHERE tsa.id IS NULL;

-- ─────────────────────────────────────────────────────────────────────
-- BACKUP table for rollback safety.
-- ─────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS _migration_email_config_backup (
  config_id              UUID PRIMARY KEY,
  old_sender_address_id  UUID,
  backed_up_at           TIMESTAMPTZ DEFAULT now()
);

-- Step 1: Back up every config that currently points at a consumer-domain sender.
INSERT INTO _migration_email_config_backup (config_id, old_sender_address_id)
SELECT ec.id, ec.sender_address_id
FROM email_configurations ec
JOIN tenant_sender_addresses tsa ON tsa.id = ec.sender_address_id
JOIN tenant_sender_domains   tsd ON tsd.id = tsa.domain_id
WHERE tsd.domain IN (
  'gmail.com', 'yahoo.com', 'outlook.com', 'hotmail.com',
  'live.com', 'icloud.com', 'aol.com', 'protonmail.com',
  'ymail.com', 'mail.com'
)
ON CONFLICT (config_id) DO NOTHING;

-- Step 2: Populate new reply_to_email + reply_to_name from the old consumer sender.
-- Columns are new in this migration → null for every row → no COALESCE needed.
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
-- Old consumer-domain rows in tenant_sender_addresses are left in place
-- for audit integrity; the API validator (forthcoming) prevents new refs.
UPDATE email_configurations ec
SET sender_address_id = (
  SELECT id FROM tenant_sender_addresses tsa
  WHERE tsa.tenant_id = ec.tenant_id
    AND tsa.domain_id = (SELECT id FROM tenant_sender_domains WHERE tenant_id IS NULL LIMIT 1)
  LIMIT 1
)
WHERE ec.id IN (SELECT config_id FROM _migration_email_config_backup);

-- ─────────────────────────────────────────────────────────────────────
-- Ensure every tenant has at least one active configuration.
-- ─────────────────────────────────────────────────────────────────────

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

-- ─────────────────────────────────────────────────────────────────────
-- Mark migrated tenants for the one-time banner.
-- ─────────────────────────────────────────────────────────────────────

UPDATE tenants
SET sender_migration_at = now()
WHERE id IN (
  SELECT DISTINCT ec.tenant_id
  FROM email_configurations ec
  JOIN _migration_email_config_backup b ON b.config_id = ec.id
);

COMMIT;

-- Reload PostgREST schema cache (per project convention).
NOTIFY pgrst, 'reload schema';
