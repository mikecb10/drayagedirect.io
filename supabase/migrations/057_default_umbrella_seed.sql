-- ============================================================
-- Migration 057: Seed Default "All Loads" Umbrella
-- ============================================================
-- Every tenant gets a baseline catch-all umbrella with no filter
-- scope, so the trigger engine always has something to bind to
-- even before the tenant has configured any customer-specific
-- umbrellas.
--
-- The default umbrella has:
--   - name = "Default — All Loads"
--   - No filter columns populated (specificity_score = 0)
--   - is_active = true
--   - always_run = false (it WILL be suppressed by more specific
--     matching umbrellas — that's the expected behavior)
--   - Marker column `is_default` = true so it can be identified
--     and the UI can prevent accidental deletion
--
-- This migration:
--   1. Adds an `is_default` column to email_umbrellas for easy
--      identification in the UI and preventing deletion
--   2. Installs a seed function that creates the default umbrella
--      for a given tenant (idempotent via ON CONFLICT guard)
--   3. Backfills every existing active tenant
--   4. Installs a trigger on INSERT tenants so new signups get it
-- ============================================================

BEGIN;

-- ──────────────────────────────────────────────────────────────
-- 1. Add is_default marker column
-- ──────────────────────────────────────────────────────────────
ALTER TABLE email_umbrellas
  ADD COLUMN IF NOT EXISTS is_default BOOLEAN NOT NULL DEFAULT false;

-- Only one default umbrella per tenant (partial unique)
CREATE UNIQUE INDEX IF NOT EXISTS idx_email_umbrellas_default_per_tenant
  ON email_umbrellas(tenant_id) WHERE is_default = true;

-- ──────────────────────────────────────────────────────────────
-- 2. Per-tenant seed function
-- ──────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION seed_default_email_umbrella_for_tenant(p_tenant_id UUID)
RETURNS void AS $$
BEGIN
  INSERT INTO email_umbrellas (
    tenant_id,
    name,
    description,
    is_active,
    is_default,
    always_run
    -- All filter columns intentionally NULL → specificity_score = 0
  ) VALUES (
    p_tenant_id,
    'Default — All Loads',
    'Catch-all umbrella that matches every load. Suppressed when a more specific umbrella matches unless always_run is set. Cannot be deleted.',
    true,
    true,
    false
  )
  ON CONFLICT DO NOTHING;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ──────────────────────────────────────────────────────────────
-- 3. Auto-seed trigger on new tenants
-- ──────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION trg_seed_default_email_umbrella_fn()
RETURNS TRIGGER AS $$
BEGIN
  PERFORM seed_default_email_umbrella_for_tenant(NEW.id);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_seed_default_email_umbrella ON tenants;
CREATE TRIGGER trg_seed_default_email_umbrella
  AFTER INSERT ON tenants
  FOR EACH ROW
  EXECUTE FUNCTION trg_seed_default_email_umbrella_fn();

-- ──────────────────────────────────────────────────────────────
-- 4. Backfill existing active tenants
-- ──────────────────────────────────────────────────────────────
DO $$
DECLARE
  t RECORD;
BEGIN
  FOR t IN SELECT id FROM tenants WHERE deleted_at IS NULL LOOP
    PERFORM seed_default_email_umbrella_for_tenant(t.id);
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';

COMMIT;
