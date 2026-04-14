-- ============================================================
-- Migration 059: Chassis Owners
-- ============================================================
-- Tenant-created profile table for chassis owner / chassis pool
-- operator entities. This is INTENTIONALLY separate from
-- container_owners (SSLs) because:
--
--   - SSLs (Maersk, MSC, Evergreen...) are the OCEAN CARRIERS
--     that own the container. They are seeded system-wide.
--
--   - Chassis owners (FlexiVan pools, TRAC pools, the carrier's
--     own chassis fleet, leasing companies like DCLI) are
--     ENTIRELY different. They're chassis providers, not ocean
--     carriers. Every trucking carrier creates their own list.
--
-- A chassis owner profile is a simple directory entry with:
--   - name
--   - optional short code (e.g. "FLXI", "TRAC", "MYCO")
--   - address
--   - point of contact
--   - phone / email
--
-- Used in:
--   - orders.chassis_owner (text field on loads)
--   - email_umbrellas.chassis_owner (filter column)
--   - dispatcher board chassis owner chip
--   - driver mobile app chassis owner display
-- ============================================================

BEGIN;

CREATE TABLE IF NOT EXISTS chassis_owners (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

  name TEXT NOT NULL,
  code TEXT,                 -- Optional short code (e.g. "FLXI", "TRAC")

  -- Address
  address_line1 TEXT,
  address_line2 TEXT,
  city TEXT,
  state TEXT,
  zip TEXT,
  country TEXT DEFAULT 'US',

  -- Contact
  contact_name TEXT,
  phone TEXT,
  email TEXT,

  -- Status + metadata
  is_enabled BOOLEAN NOT NULL DEFAULT true,
  is_own_fleet BOOLEAN NOT NULL DEFAULT false,  -- true = "this is the carrier's own chassis fleet"
  notes TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ,

  -- Unique code per tenant (when populated)
  CONSTRAINT chassis_owners_tenant_code_unique UNIQUE (tenant_id, code)
);

CREATE INDEX IF NOT EXISTS idx_chassis_owners_tenant
  ON chassis_owners(tenant_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_chassis_owners_enabled
  ON chassis_owners(tenant_id) WHERE deleted_at IS NULL AND is_enabled = true;
CREATE INDEX IF NOT EXISTS idx_chassis_owners_name
  ON chassis_owners(tenant_id, name) WHERE deleted_at IS NULL;

-- ──────────────────────────────────────────────────────────────
-- updated_at trigger
-- ──────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION set_chassis_owners_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_chassis_owners_updated_at ON chassis_owners;
CREATE TRIGGER trg_chassis_owners_updated_at
  BEFORE UPDATE ON chassis_owners
  FOR EACH ROW
  EXECUTE FUNCTION set_chassis_owners_updated_at();

-- ──────────────────────────────────────────────────────────────
-- RLS
-- ──────────────────────────────────────────────────────────────
ALTER TABLE chassis_owners ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS chassis_owners_select ON chassis_owners;
CREATE POLICY chassis_owners_select ON chassis_owners
  FOR SELECT
  USING (tenant_id = current_tenant_id() OR is_dd_admin());

DROP POLICY IF EXISTS chassis_owners_insert ON chassis_owners;
CREATE POLICY chassis_owners_insert ON chassis_owners
  FOR INSERT
  WITH CHECK (tenant_id = current_tenant_id() OR is_dd_admin());

DROP POLICY IF EXISTS chassis_owners_update ON chassis_owners;
CREATE POLICY chassis_owners_update ON chassis_owners
  FOR UPDATE
  USING (tenant_id = current_tenant_id() OR is_dd_admin())
  WITH CHECK (tenant_id = current_tenant_id() OR is_dd_admin());

DROP POLICY IF EXISTS chassis_owners_delete ON chassis_owners;
CREATE POLICY chassis_owners_delete ON chassis_owners
  FOR DELETE
  USING (tenant_id = current_tenant_id() OR is_dd_admin());

NOTIFY pgrst, 'reload schema';

COMMIT;
