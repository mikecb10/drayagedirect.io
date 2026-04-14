-- ============================================================
-- Migration 055: Email System — Shared Tenant Account Support
-- ============================================================
-- Extends the email_accounts infrastructure from migration 053 with
-- support for SHARED COMPANY mailboxes alongside the existing personal
-- OAuth connections.
--
-- A shared mailbox is a scope='tenant' email_accounts row that doesn't
-- belong to any one user but can be used by multiple tenant members
-- who have been granted access via the new email_account_permissions
-- junction table.
--
-- This supports tenants who want to segment email operations by
-- department (dispatch group, billing/AR group, driver ops, etc.)
-- — a super admin connects dispatch@abcdrayage.com as a shared
-- Gmail mailbox, then grants send / view access to specific users.
--
-- What this migration does
-- ────────────────────────
--
--   email_accounts
--     + scope                   ('user' | 'tenant')
--     + connected_by_user_id    UUID NOT NULL (who ran the OAuth flow)
--     ~ user_id                 DROP NOT NULL (nullable for tenant scope)
--     + CHECK                   (scope invariants — see body)
--     + partial unique index    on (tenant_id, email_address) for tenant
--     + partial index           on tenant_id for shared lookups
--     ~ RLS policies            replaced with scope-aware versions
--
--   email_account_permissions   NEW junction table: (account, user, grants)
--     + full RLS
--     + indexes
--     + updated_at trigger
--
--   email_configurations
--     + shared_account_id       UUID REFERENCES email_accounts(id)
--     + index                   on shared_account_id
--     - CHECK                   drop the old 2-way CHECK
--     + CHECK                   new 3-way exclusive sender CHECK
--
-- Safe to re-run: every operation uses IF (NOT) EXISTS or a DO block
-- that checks pg_constraint first, so applying this twice is a no-op.
-- ============================================================

BEGIN;

-- ==================================================================
-- SECTION 1: email_accounts schema extension
-- ==================================================================

-- 1a. Add scope column. Existing rows get 'user' via the default.
ALTER TABLE email_accounts
  ADD COLUMN IF NOT EXISTS scope TEXT NOT NULL DEFAULT 'user';

-- 1b. Add scope domain CHECK via DO block for idempotency.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'email_accounts'::regclass
      AND conname = 'email_accounts_scope_check'
  ) THEN
    ALTER TABLE email_accounts
      ADD CONSTRAINT email_accounts_scope_check
      CHECK (scope IN ('user', 'tenant'));
  END IF;
END $$;

-- 1c. Add connected_by_user_id. Three-step pattern:
--     (a) add column as nullable,
--     (b) backfill existing rows (which are all scope='user' with user_id set),
--     (c) mark NOT NULL and attach the FK.
ALTER TABLE email_accounts
  ADD COLUMN IF NOT EXISTS connected_by_user_id UUID;

UPDATE email_accounts
  SET connected_by_user_id = user_id
  WHERE connected_by_user_id IS NULL
    AND user_id IS NOT NULL;

-- Idempotent FK attachment
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'email_accounts'::regclass
      AND conname = 'email_accounts_connected_by_user_id_fkey'
  ) THEN
    ALTER TABLE email_accounts
      ADD CONSTRAINT email_accounts_connected_by_user_id_fkey
      FOREIGN KEY (connected_by_user_id)
      REFERENCES users(id) ON DELETE RESTRICT;
  END IF;
END $$;

-- Mark NOT NULL now that every existing row is backfilled
ALTER TABLE email_accounts
  ALTER COLUMN connected_by_user_id SET NOT NULL;

-- 1d. user_id becomes nullable so tenant-scoped rows can store NULL
ALTER TABLE email_accounts
  ALTER COLUMN user_id DROP NOT NULL;

-- 1e. Scope invariants CHECK: user-scoped rows MUST have user_id set;
--     tenant-scoped rows MUST have user_id NULL. This is the one
--     constraint preventing accidental mixed states.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'email_accounts'::regclass
      AND conname = 'email_accounts_scope_user_match'
  ) THEN
    ALTER TABLE email_accounts
      ADD CONSTRAINT email_accounts_scope_user_match
      CHECK (
        (scope = 'user' AND user_id IS NOT NULL)
        OR (scope = 'tenant' AND user_id IS NULL)
      );
  END IF;
END $$;

-- 1f. Keep the original UNIQUE (tenant_id, user_id, email_address)
--     constraint untouched — it still enforces uniqueness for
--     user-scoped rows correctly. For tenant-scoped rows (user_id =
--     NULL), the old constraint does NOT enforce uniqueness because
--     NULL != NULL in standard UNIQUE constraints, so we add a
--     dedicated partial unique index below.
CREATE UNIQUE INDEX IF NOT EXISTS idx_email_accounts_tenant_unique
  ON email_accounts(tenant_id, email_address)
  WHERE scope = 'tenant';

-- 1g. Lookup index for "all shared accounts in tenant X"
CREATE INDEX IF NOT EXISTS idx_email_accounts_shared
  ON email_accounts(tenant_id)
  WHERE is_active = true AND scope = 'tenant';

-- ==================================================================
-- SECTION 2: email_account_permissions junction table
-- ==================================================================
-- Grants users access to a shared (scope='tenant') email account.
-- For scope='user' accounts, permissions come from ownership — no
-- row in this table is needed.
--
-- Columns
--   can_send        — user may use this account as a From: identity
--                     in compose, configurations, or trigger sends
--   can_view_inbox  — user sees this account's messages in the
--                     Communication tab timeline (useful for
--                     dispatchers who need visibility without send
--                     rights, e.g. read-only billing oversight)
--
-- Insert/update/delete is gated to tenant admins + super_admins via
-- RLS; users with no row on an account see nothing about it.

CREATE TABLE IF NOT EXISTS email_account_permissions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  account_id UUID NOT NULL REFERENCES email_accounts(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  can_send BOOLEAN NOT NULL DEFAULT true,
  can_view_inbox BOOLEAN NOT NULL DEFAULT true,

  granted_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (account_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_email_account_permissions_account
  ON email_account_permissions(account_id);
CREATE INDEX IF NOT EXISTS idx_email_account_permissions_user
  ON email_account_permissions(tenant_id, user_id);

ALTER TABLE email_account_permissions ENABLE ROW LEVEL SECURITY;

-- SELECT: users see their own grants; admins see every grant in tenant
DROP POLICY IF EXISTS eap_select ON email_account_permissions;
CREATE POLICY eap_select ON email_account_permissions FOR SELECT
  USING (
    is_dd_admin()
    OR (
      tenant_id = current_tenant_id()
      AND (
        user_id = (SELECT id FROM users WHERE auth_uid = auth.uid()::TEXT LIMIT 1)
        OR EXISTS (
          SELECT 1 FROM users u
          WHERE u.auth_uid = auth.uid()::TEXT
            AND u.tenant_id = current_tenant_id()
            AND u.role IN ('admin', 'super_admin')
        )
      )
    )
  );

-- INSERT/UPDATE/DELETE: admin or super_admin only
DROP POLICY IF EXISTS eap_insert ON email_account_permissions;
CREATE POLICY eap_insert ON email_account_permissions FOR INSERT
  WITH CHECK (
    is_dd_admin()
    OR (
      tenant_id = current_tenant_id()
      AND EXISTS (
        SELECT 1 FROM users u
        WHERE u.auth_uid = auth.uid()::TEXT
          AND u.tenant_id = current_tenant_id()
          AND u.role IN ('admin', 'super_admin')
      )
    )
  );

DROP POLICY IF EXISTS eap_update ON email_account_permissions;
CREATE POLICY eap_update ON email_account_permissions FOR UPDATE
  USING (
    is_dd_admin()
    OR (
      tenant_id = current_tenant_id()
      AND EXISTS (
        SELECT 1 FROM users u
        WHERE u.auth_uid = auth.uid()::TEXT
          AND u.tenant_id = current_tenant_id()
          AND u.role IN ('admin', 'super_admin')
      )
    )
  );

DROP POLICY IF EXISTS eap_delete ON email_account_permissions;
CREATE POLICY eap_delete ON email_account_permissions FOR DELETE
  USING (
    is_dd_admin()
    OR (
      tenant_id = current_tenant_id()
      AND EXISTS (
        SELECT 1 FROM users u
        WHERE u.auth_uid = auth.uid()::TEXT
          AND u.tenant_id = current_tenant_id()
          AND u.role IN ('admin', 'super_admin')
      )
    )
  );

-- updated_at trigger reuses the existing set_email_infra_updated_at()
-- function declared in migration 053.
DROP TRIGGER IF EXISTS trg_email_account_permissions_updated_at
  ON email_account_permissions;
CREATE TRIGGER trg_email_account_permissions_updated_at
  BEFORE UPDATE ON email_account_permissions
  FOR EACH ROW EXECUTE FUNCTION set_email_infra_updated_at();

-- ==================================================================
-- SECTION 3: Rewrite email_accounts RLS — scope-aware branching
-- ==================================================================
-- SELECT
--   - Personal (scope='user'): only the owner (user_id match)
--   - Shared (scope='tenant'): only users with a permissions row
--     (can_send OR can_view_inbox = true)
--   - admin/super_admin in the tenant: every account for admin UI
--   - dd_admin: everything for support
--
-- INSERT
--   - Personal: the authenticated user may insert their OWN account
--     (user_id + connected_by_user_id both equal themselves)
--   - Shared: only admin/super_admin may insert; user_id = NULL;
--     connected_by_user_id = themselves
--
-- UPDATE / DELETE
--   - Personal: only the owner
--   - Shared: admin or super_admin only

DROP POLICY IF EXISTS ea_select ON email_accounts;
CREATE POLICY ea_select ON email_accounts FOR SELECT
  USING (
    is_dd_admin()
    OR (
      tenant_id = current_tenant_id()
      AND (
        EXISTS (
          SELECT 1 FROM users u
          WHERE u.auth_uid = auth.uid()::TEXT
            AND u.tenant_id = current_tenant_id()
            AND u.role IN ('admin', 'super_admin')
        )
        OR (
          scope = 'user'
          AND user_id = (SELECT id FROM users WHERE auth_uid = auth.uid()::TEXT LIMIT 1)
        )
        OR (
          scope = 'tenant'
          AND EXISTS (
            SELECT 1 FROM email_account_permissions p
            WHERE p.account_id = email_accounts.id
              AND p.user_id = (SELECT id FROM users WHERE auth_uid = auth.uid()::TEXT LIMIT 1)
              AND (p.can_send = true OR p.can_view_inbox = true)
          )
        )
      )
    )
  );

DROP POLICY IF EXISTS ea_insert ON email_accounts;
CREATE POLICY ea_insert ON email_accounts FOR INSERT
  WITH CHECK (
    is_dd_admin()
    OR (
      tenant_id = current_tenant_id()
      AND (
        (
          scope = 'user'
          AND user_id = (SELECT id FROM users WHERE auth_uid = auth.uid()::TEXT LIMIT 1)
          AND connected_by_user_id = (SELECT id FROM users WHERE auth_uid = auth.uid()::TEXT LIMIT 1)
        )
        OR (
          scope = 'tenant'
          AND user_id IS NULL
          AND connected_by_user_id = (SELECT id FROM users WHERE auth_uid = auth.uid()::TEXT LIMIT 1)
          AND EXISTS (
            SELECT 1 FROM users u
            WHERE u.auth_uid = auth.uid()::TEXT
              AND u.tenant_id = current_tenant_id()
              AND u.role IN ('admin', 'super_admin')
          )
        )
      )
    )
  );

DROP POLICY IF EXISTS ea_update ON email_accounts;
CREATE POLICY ea_update ON email_accounts FOR UPDATE
  USING (
    is_dd_admin()
    OR (
      tenant_id = current_tenant_id()
      AND (
        (
          scope = 'user'
          AND user_id = (SELECT id FROM users WHERE auth_uid = auth.uid()::TEXT LIMIT 1)
        )
        OR (
          scope = 'tenant'
          AND EXISTS (
            SELECT 1 FROM users u
            WHERE u.auth_uid = auth.uid()::TEXT
              AND u.tenant_id = current_tenant_id()
              AND u.role IN ('admin', 'super_admin')
          )
        )
      )
    )
  );

DROP POLICY IF EXISTS ea_delete ON email_accounts;
CREATE POLICY ea_delete ON email_accounts FOR DELETE
  USING (
    is_dd_admin()
    OR (
      tenant_id = current_tenant_id()
      AND (
        (
          scope = 'user'
          AND user_id = (SELECT id FROM users WHERE auth_uid = auth.uid()::TEXT LIMIT 1)
        )
        OR (
          scope = 'tenant'
          AND EXISTS (
            SELECT 1 FROM users u
            WHERE u.auth_uid = auth.uid()::TEXT
              AND u.tenant_id = current_tenant_id()
              AND u.role IN ('admin', 'super_admin')
          )
        )
      )
    )
  );

-- ==================================================================
-- SECTION 4: email_configurations — third sender option
-- ==================================================================
-- Adds shared_account_id as a third mutually-exclusive sender
-- identity. The old 2-way CHECK from migration 053 would reject any
-- row where shared_account_id is set (because it would force
-- sender_address_id NULL AND use_user_gmail = true, neither of
-- which is true when shared_account_id is in play), so we MUST
-- drop and replace the CHECK.

-- 4a. Add the column + index
ALTER TABLE email_configurations
  ADD COLUMN IF NOT EXISTS shared_account_id UUID
  REFERENCES email_accounts(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_email_configurations_shared_account
  ON email_configurations(shared_account_id)
  WHERE shared_account_id IS NOT NULL;

-- 4b. Drop the old 2-way CHECK constraint by introspection. The
--     original had no explicit name so PostgreSQL auto-generated
--     one like email_configurations_check. We find any CHECK
--     constraint on this table whose definition mentions
--     sender_address_id AND use_user_gmail but NOT shared_account_id,
--     and drop it.
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'email_configurations'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) LIKE '%sender_address_id%'
      AND pg_get_constraintdef(oid) LIKE '%use_user_gmail%'
      AND pg_get_constraintdef(oid) NOT LIKE '%shared_account_id%'
  LOOP
    EXECUTE format('ALTER TABLE email_configurations DROP CONSTRAINT %I', r.conname);
  END LOOP;
END $$;

-- 4c. Add the new 3-way CHECK — exactly one sender identity set
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'email_configurations'::regclass
      AND conname = 'email_configurations_one_sender'
  ) THEN
    ALTER TABLE email_configurations
      ADD CONSTRAINT email_configurations_one_sender
      CHECK (
        (sender_address_id IS NOT NULL)::int +
        (shared_account_id IS NOT NULL)::int +
        (use_user_gmail)::int = 1
      );
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';

COMMIT;
