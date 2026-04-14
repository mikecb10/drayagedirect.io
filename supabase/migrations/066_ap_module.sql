-- ============================================================
-- Migration 066: Accounts Payable Module
-- ============================================================
-- Creates the full AP infrastructure:
--   1. settlement_periods — configurable pay cycles
--   2. driver_groups — group drivers by settlement period
--   3. driver_group_members — M:N junction
--   4. deduction_types — reusable deduction categories
--   5. driver_deductions — per-driver recurring configs
--   6. driver_settlements — grouped pay periods
--   7. driver_settlement_lines — links pay lines to settlements
--   8. driver_settlement_deductions — applied deductions
-- ============================================================

BEGIN;

-- ──────────────────────────────────────────────────────────────
-- 1. Settlement Periods
-- ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS settlement_periods (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  duration_type TEXT NOT NULL DEFAULT 'biweekly'
    CHECK (duration_type IN ('daily', 'weekly', 'biweekly', 'bimonthly', 'monthly', 'custom')),
  start_day_of_week INTEGER NOT NULL DEFAULT 0, -- 0=Sunday, 1=Monday, etc.
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_settlement_periods_tenant
  ON settlement_periods(tenant_id) WHERE deleted_at IS NULL;

ALTER TABLE settlement_periods ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS settlement_periods_select ON settlement_periods;
CREATE POLICY settlement_periods_select ON settlement_periods FOR SELECT USING (tenant_id = current_tenant_id() OR is_dd_admin());
DROP POLICY IF EXISTS settlement_periods_insert ON settlement_periods;
CREATE POLICY settlement_periods_insert ON settlement_periods FOR INSERT WITH CHECK (tenant_id = current_tenant_id() OR is_dd_admin());
DROP POLICY IF EXISTS settlement_periods_update ON settlement_periods;
CREATE POLICY settlement_periods_update ON settlement_periods FOR UPDATE USING (tenant_id = current_tenant_id() OR is_dd_admin()) WITH CHECK (tenant_id = current_tenant_id() OR is_dd_admin());
DROP POLICY IF EXISTS settlement_periods_delete ON settlement_periods;
CREATE POLICY settlement_periods_delete ON settlement_periods FOR DELETE USING (tenant_id = current_tenant_id() OR is_dd_admin());

-- ──────────────────────────────────────────────────────────────
-- 2. Driver Groups
-- ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS driver_groups (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  settlement_period_id UUID REFERENCES settlement_periods(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_driver_groups_tenant
  ON driver_groups(tenant_id) WHERE deleted_at IS NULL;

ALTER TABLE driver_groups ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS driver_groups_select ON driver_groups;
CREATE POLICY driver_groups_select ON driver_groups FOR SELECT USING (tenant_id = current_tenant_id() OR is_dd_admin());
DROP POLICY IF EXISTS driver_groups_insert ON driver_groups;
CREATE POLICY driver_groups_insert ON driver_groups FOR INSERT WITH CHECK (tenant_id = current_tenant_id() OR is_dd_admin());
DROP POLICY IF EXISTS driver_groups_update ON driver_groups;
CREATE POLICY driver_groups_update ON driver_groups FOR UPDATE USING (tenant_id = current_tenant_id() OR is_dd_admin()) WITH CHECK (tenant_id = current_tenant_id() OR is_dd_admin());
DROP POLICY IF EXISTS driver_groups_delete ON driver_groups;
CREATE POLICY driver_groups_delete ON driver_groups FOR DELETE USING (tenant_id = current_tenant_id() OR is_dd_admin());

-- ──────────────────────────────────────────────────────────────
-- 3. Driver Group Members (M:N)
-- ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS driver_group_members (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  driver_group_id UUID NOT NULL REFERENCES driver_groups(id) ON DELETE CASCADE,
  driver_id UUID NOT NULL REFERENCES drivers(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT driver_group_members_unique UNIQUE (driver_group_id, driver_id),
  CONSTRAINT driver_group_members_one_group_per_driver UNIQUE (tenant_id, driver_id)
);

CREATE INDEX IF NOT EXISTS idx_driver_group_members_group ON driver_group_members(driver_group_id);
CREATE INDEX IF NOT EXISTS idx_driver_group_members_driver ON driver_group_members(driver_id);

ALTER TABLE driver_group_members ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS driver_group_members_select ON driver_group_members;
CREATE POLICY driver_group_members_select ON driver_group_members FOR SELECT USING (tenant_id = current_tenant_id() OR is_dd_admin());
DROP POLICY IF EXISTS driver_group_members_insert ON driver_group_members;
CREATE POLICY driver_group_members_insert ON driver_group_members FOR INSERT WITH CHECK (tenant_id = current_tenant_id() OR is_dd_admin());
DROP POLICY IF EXISTS driver_group_members_update ON driver_group_members;
CREATE POLICY driver_group_members_update ON driver_group_members FOR UPDATE USING (tenant_id = current_tenant_id() OR is_dd_admin()) WITH CHECK (tenant_id = current_tenant_id() OR is_dd_admin());
DROP POLICY IF EXISTS driver_group_members_delete ON driver_group_members;
CREATE POLICY driver_group_members_delete ON driver_group_members FOR DELETE USING (tenant_id = current_tenant_id() OR is_dd_admin());

-- ──────────────────────────────────────────────────────────────
-- 4. Deduction Types
-- ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS deduction_types (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_deduction_types_tenant
  ON deduction_types(tenant_id) WHERE deleted_at IS NULL;

ALTER TABLE deduction_types ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS deduction_types_select ON deduction_types;
CREATE POLICY deduction_types_select ON deduction_types FOR SELECT USING (tenant_id = current_tenant_id() OR is_dd_admin());
DROP POLICY IF EXISTS deduction_types_insert ON deduction_types;
CREATE POLICY deduction_types_insert ON deduction_types FOR INSERT WITH CHECK (tenant_id = current_tenant_id() OR is_dd_admin());
DROP POLICY IF EXISTS deduction_types_update ON deduction_types;
CREATE POLICY deduction_types_update ON deduction_types FOR UPDATE USING (tenant_id = current_tenant_id() OR is_dd_admin()) WITH CHECK (tenant_id = current_tenant_id() OR is_dd_admin());
DROP POLICY IF EXISTS deduction_types_delete ON deduction_types;
CREATE POLICY deduction_types_delete ON deduction_types FOR DELETE USING (tenant_id = current_tenant_id() OR is_dd_admin());

-- ──────────────────────────────────────────────────────────────
-- 5. Driver Deductions (per-driver recurring configs)
-- ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS driver_deductions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  driver_id UUID NOT NULL REFERENCES drivers(id) ON DELETE CASCADE,
  deduction_type_id UUID NOT NULL REFERENCES deduction_types(id),
  description TEXT,
  unit_of_measure TEXT NOT NULL DEFAULT 'fixed'
    CHECK (unit_of_measure IN ('fixed', 'per_mile', 'per_load', 'percentage')),
  math TEXT NOT NULL DEFAULT 'subtract'
    CHECK (math IN ('add', 'subtract')),
  amount_cents INTEGER NOT NULL DEFAULT 0,
  is_enabled BOOLEAN NOT NULL DEFAULT true,
  is_recurring BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_driver_deductions_tenant
  ON driver_deductions(tenant_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_driver_deductions_driver
  ON driver_deductions(driver_id) WHERE deleted_at IS NULL;

ALTER TABLE driver_deductions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS driver_deductions_select ON driver_deductions;
CREATE POLICY driver_deductions_select ON driver_deductions FOR SELECT USING (tenant_id = current_tenant_id() OR is_dd_admin());
DROP POLICY IF EXISTS driver_deductions_insert ON driver_deductions;
CREATE POLICY driver_deductions_insert ON driver_deductions FOR INSERT WITH CHECK (tenant_id = current_tenant_id() OR is_dd_admin());
DROP POLICY IF EXISTS driver_deductions_update ON driver_deductions;
CREATE POLICY driver_deductions_update ON driver_deductions FOR UPDATE USING (tenant_id = current_tenant_id() OR is_dd_admin()) WITH CHECK (tenant_id = current_tenant_id() OR is_dd_admin());
DROP POLICY IF EXISTS driver_deductions_delete ON driver_deductions;
CREATE POLICY driver_deductions_delete ON driver_deductions FOR DELETE USING (tenant_id = current_tenant_id() OR is_dd_admin());

-- ──────────────────────────────────────────────────────────────
-- 6. Driver Settlements
-- ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS driver_settlements (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  settlement_number TEXT NOT NULL,
  driver_id UUID NOT NULL REFERENCES drivers(id),
  driver_group_id UUID REFERENCES driver_groups(id) ON DELETE SET NULL,
  settlement_period_id UUID REFERENCES settlement_periods(id) ON DELETE SET NULL,
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,

  driver_pay_cents INTEGER NOT NULL DEFAULT 0,
  deduction_cents INTEGER NOT NULL DEFAULT 0,
  net_pay_cents INTEGER NOT NULL DEFAULT 0,

  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'reviewed', 'finalized')),
  finalized_at TIMESTAMPTZ,
  finalized_by UUID REFERENCES users(id),
  pdf_url TEXT,
  notes TEXT,
  branch_id UUID REFERENCES branches(id),

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT driver_settlements_number_unique UNIQUE (tenant_id, settlement_number)
);

CREATE INDEX IF NOT EXISTS idx_driver_settlements_tenant
  ON driver_settlements(tenant_id);
CREATE INDEX IF NOT EXISTS idx_driver_settlements_driver
  ON driver_settlements(driver_id);
CREATE INDEX IF NOT EXISTS idx_driver_settlements_period
  ON driver_settlements(tenant_id, period_start, period_end);
CREATE INDEX IF NOT EXISTS idx_driver_settlements_status
  ON driver_settlements(tenant_id, status);

-- updated_at trigger
CREATE OR REPLACE FUNCTION set_driver_settlements_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_driver_settlements_updated_at ON driver_settlements;
CREATE TRIGGER trg_driver_settlements_updated_at
  BEFORE UPDATE ON driver_settlements FOR EACH ROW
  EXECUTE FUNCTION set_driver_settlements_updated_at();

ALTER TABLE driver_settlements ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS driver_settlements_select ON driver_settlements;
CREATE POLICY driver_settlements_select ON driver_settlements FOR SELECT USING (tenant_id = current_tenant_id() OR is_dd_admin());
DROP POLICY IF EXISTS driver_settlements_insert ON driver_settlements;
CREATE POLICY driver_settlements_insert ON driver_settlements FOR INSERT WITH CHECK (tenant_id = current_tenant_id() OR is_dd_admin());
DROP POLICY IF EXISTS driver_settlements_update ON driver_settlements;
CREATE POLICY driver_settlements_update ON driver_settlements FOR UPDATE USING (tenant_id = current_tenant_id() OR is_dd_admin()) WITH CHECK (tenant_id = current_tenant_id() OR is_dd_admin());
DROP POLICY IF EXISTS driver_settlements_delete ON driver_settlements;
CREATE POLICY driver_settlements_delete ON driver_settlements FOR DELETE USING (tenant_id = current_tenant_id() OR is_dd_admin());

-- ──────────────────────────────────────────────────────────────
-- 7. Driver Settlement Lines (links pay lines to settlements)
-- ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS driver_settlement_lines (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  settlement_id UUID NOT NULL REFERENCES driver_settlements(id) ON DELETE CASCADE,
  driver_pay_line_id UUID NOT NULL REFERENCES order_driver_pay_lines(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT driver_settlement_lines_unique UNIQUE (settlement_id, driver_pay_line_id)
);

CREATE INDEX IF NOT EXISTS idx_driver_settlement_lines_settlement ON driver_settlement_lines(settlement_id);
CREATE INDEX IF NOT EXISTS idx_driver_settlement_lines_pay_line ON driver_settlement_lines(driver_pay_line_id);

ALTER TABLE driver_settlement_lines ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS driver_settlement_lines_select ON driver_settlement_lines;
CREATE POLICY driver_settlement_lines_select ON driver_settlement_lines FOR SELECT USING (tenant_id = current_tenant_id() OR is_dd_admin());
DROP POLICY IF EXISTS driver_settlement_lines_insert ON driver_settlement_lines;
CREATE POLICY driver_settlement_lines_insert ON driver_settlement_lines FOR INSERT WITH CHECK (tenant_id = current_tenant_id() OR is_dd_admin());
DROP POLICY IF EXISTS driver_settlement_lines_update ON driver_settlement_lines;
CREATE POLICY driver_settlement_lines_update ON driver_settlement_lines FOR UPDATE USING (tenant_id = current_tenant_id() OR is_dd_admin()) WITH CHECK (tenant_id = current_tenant_id() OR is_dd_admin());
DROP POLICY IF EXISTS driver_settlement_lines_delete ON driver_settlement_lines;
CREATE POLICY driver_settlement_lines_delete ON driver_settlement_lines FOR DELETE USING (tenant_id = current_tenant_id() OR is_dd_admin());

-- ──────────────────────────────────────────────────────────────
-- 8. Driver Settlement Deductions (applied per settlement)
-- ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS driver_settlement_deductions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  settlement_id UUID NOT NULL REFERENCES driver_settlements(id) ON DELETE CASCADE,
  deduction_type_id UUID REFERENCES deduction_types(id),
  driver_deduction_id UUID REFERENCES driver_deductions(id), -- null if one-off
  description TEXT,
  amount_cents INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'unapproved'
    CHECK (status IN ('unapproved', 'approved', 'reviewed', 'finalized')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_settlement_deductions_settlement ON driver_settlement_deductions(settlement_id);
CREATE INDEX IF NOT EXISTS idx_settlement_deductions_tenant ON driver_settlement_deductions(tenant_id);

ALTER TABLE driver_settlement_deductions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS driver_settlement_deductions_select ON driver_settlement_deductions;
CREATE POLICY driver_settlement_deductions_select ON driver_settlement_deductions FOR SELECT USING (tenant_id = current_tenant_id() OR is_dd_admin());
DROP POLICY IF EXISTS driver_settlement_deductions_insert ON driver_settlement_deductions;
CREATE POLICY driver_settlement_deductions_insert ON driver_settlement_deductions FOR INSERT WITH CHECK (tenant_id = current_tenant_id() OR is_dd_admin());
DROP POLICY IF EXISTS driver_settlement_deductions_update ON driver_settlement_deductions;
CREATE POLICY driver_settlement_deductions_update ON driver_settlement_deductions FOR UPDATE USING (tenant_id = current_tenant_id() OR is_dd_admin()) WITH CHECK (tenant_id = current_tenant_id() OR is_dd_admin());
DROP POLICY IF EXISTS driver_settlement_deductions_delete ON driver_settlement_deductions;
CREATE POLICY driver_settlement_deductions_delete ON driver_settlement_deductions FOR DELETE USING (tenant_id = current_tenant_id() OR is_dd_admin());

NOTIFY pgrst, 'reload schema';

COMMIT;
