-- ============================================================
-- Migration 063: Branches
-- ============================================================
-- Regional sub-divisions within a tenant (e.g. "Houston",
-- "Savannah", "NY/NJ", "LA/LB"). Branches scope data
-- visibility — dispatchers assigned to a branch only see
-- that branch's loads, customers, drivers, etc.
--
-- Architecture:
--   - branches: first-class tenant-scoped entity
--   - user_branches: M:N junction (users can have multiple)
--   - customer_branches: M:N junction (customers can span branches)
--   - orders.branch_id: FK (a load belongs to ONE branch)
--   - drivers.branch_id: FK (a driver belongs to ONE branch)
--
-- All branch_id columns are NULLABLE for backwards compat.
-- Existing data (NULL branch) is visible to everyone.
-- ============================================================

BEGIN;

-- ──────────────────────────────────────────────────────────────
-- 1. branches table
-- ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS branches (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

  name TEXT NOT NULL,
  code TEXT,                   -- Short code: "HOU", "SAV", "NYNJ"
  market TEXT,                 -- Freeform regional label: "Gulf Coast", "Southeast"

  -- Location
  address_line1 TEXT,
  city TEXT,
  state TEXT,
  zip TEXT,
  country TEXT DEFAULT 'US',

  -- Contact
  phone TEXT,
  email TEXT,

  -- Management
  manager_user_id UUID REFERENCES users(id) ON DELETE SET NULL,

  -- Status
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ,

  -- Unique code per tenant (when populated)
  CONSTRAINT branches_tenant_code_unique UNIQUE (tenant_id, code)
);

CREATE INDEX IF NOT EXISTS idx_branches_tenant
  ON branches(tenant_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_branches_tenant_active
  ON branches(tenant_id) WHERE deleted_at IS NULL AND status = 'active';

-- updated_at trigger
CREATE OR REPLACE FUNCTION set_branches_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_branches_updated_at ON branches;
CREATE TRIGGER trg_branches_updated_at
  BEFORE UPDATE ON branches
  FOR EACH ROW
  EXECUTE FUNCTION set_branches_updated_at();

-- RLS
ALTER TABLE branches ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS branches_select ON branches;
CREATE POLICY branches_select ON branches
  FOR SELECT USING (tenant_id = current_tenant_id() OR is_dd_admin());

DROP POLICY IF EXISTS branches_insert ON branches;
CREATE POLICY branches_insert ON branches
  FOR INSERT WITH CHECK (tenant_id = current_tenant_id() OR is_dd_admin());

DROP POLICY IF EXISTS branches_update ON branches;
CREATE POLICY branches_update ON branches
  FOR UPDATE
  USING (tenant_id = current_tenant_id() OR is_dd_admin())
  WITH CHECK (tenant_id = current_tenant_id() OR is_dd_admin());

DROP POLICY IF EXISTS branches_delete ON branches;
CREATE POLICY branches_delete ON branches
  FOR DELETE USING (tenant_id = current_tenant_id() OR is_dd_admin());

-- ──────────────────────────────────────────────────────────────
-- 2. user_branches junction (M:N)
-- ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS user_branches (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  branch_id UUID NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT user_branches_unique UNIQUE (user_id, branch_id)
);

CREATE INDEX IF NOT EXISTS idx_user_branches_user ON user_branches(user_id);
CREATE INDEX IF NOT EXISTS idx_user_branches_branch ON user_branches(branch_id);
CREATE INDEX IF NOT EXISTS idx_user_branches_tenant ON user_branches(tenant_id);

-- RLS
ALTER TABLE user_branches ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS user_branches_select ON user_branches;
CREATE POLICY user_branches_select ON user_branches
  FOR SELECT USING (tenant_id = current_tenant_id() OR is_dd_admin());

DROP POLICY IF EXISTS user_branches_insert ON user_branches;
CREATE POLICY user_branches_insert ON user_branches
  FOR INSERT WITH CHECK (tenant_id = current_tenant_id() OR is_dd_admin());

DROP POLICY IF EXISTS user_branches_update ON user_branches;
CREATE POLICY user_branches_update ON user_branches
  FOR UPDATE
  USING (tenant_id = current_tenant_id() OR is_dd_admin())
  WITH CHECK (tenant_id = current_tenant_id() OR is_dd_admin());

DROP POLICY IF EXISTS user_branches_delete ON user_branches;
CREATE POLICY user_branches_delete ON user_branches
  FOR DELETE USING (tenant_id = current_tenant_id() OR is_dd_admin());

-- ──────────────────────────────────────────────────────────────
-- 3. customer_branches junction (M:N)
-- ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS customer_branches (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  branch_id UUID NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT customer_branches_unique UNIQUE (customer_id, branch_id)
);

CREATE INDEX IF NOT EXISTS idx_customer_branches_customer ON customer_branches(customer_id);
CREATE INDEX IF NOT EXISTS idx_customer_branches_branch ON customer_branches(branch_id);
CREATE INDEX IF NOT EXISTS idx_customer_branches_tenant ON customer_branches(tenant_id);

-- RLS
ALTER TABLE customer_branches ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS customer_branches_select ON customer_branches;
CREATE POLICY customer_branches_select ON customer_branches
  FOR SELECT USING (tenant_id = current_tenant_id() OR is_dd_admin());

DROP POLICY IF EXISTS customer_branches_insert ON customer_branches;
CREATE POLICY customer_branches_insert ON customer_branches
  FOR INSERT WITH CHECK (tenant_id = current_tenant_id() OR is_dd_admin());

DROP POLICY IF EXISTS customer_branches_update ON customer_branches;
CREATE POLICY customer_branches_update ON customer_branches
  FOR UPDATE
  USING (tenant_id = current_tenant_id() OR is_dd_admin())
  WITH CHECK (tenant_id = current_tenant_id() OR is_dd_admin());

DROP POLICY IF EXISTS customer_branches_delete ON customer_branches;
CREATE POLICY customer_branches_delete ON customer_branches
  FOR DELETE USING (tenant_id = current_tenant_id() OR is_dd_admin());

-- ──────────────────────────────────────────────────────────────
-- 4. FK columns on existing tables
-- ──────────────────────────────────────────────────────────────
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS branch_id UUID REFERENCES branches(id);

ALTER TABLE drivers
  ADD COLUMN IF NOT EXISTS branch_id UUID REFERENCES branches(id);

CREATE INDEX IF NOT EXISTS idx_orders_branch
  ON orders(branch_id) WHERE branch_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_drivers_branch
  ON drivers(branch_id) WHERE branch_id IS NOT NULL;

NOTIFY pgrst, 'reload schema';

COMMIT;
