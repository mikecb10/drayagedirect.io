-- ============================================================
-- Migration 067: Driver Pay Rates (AP Pricing Engine)
-- ============================================================
-- Creates driver charge profiles, versions, tiers, tariffs,
-- and tariff charge set linkage — the AP equivalent of the
-- AR pricing engine (migrations 026/030/031).
--
-- Key AP-specific additions:
--   - driver_group_id scoping (instead of customer_ids)
--   - By Leg calculation mode with from/to location matching
--   - Percentage based on: driver_pay / ar_invoice / oo_benchmark
-- ============================================================

BEGIN;

-- ──────────────────────────────────────────────────────────────
-- 1. Driver Charge Profiles
-- ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS driver_charge_profiles (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  charge_name TEXT NOT NULL, -- AP charge code: LINE_HAUL, DETENTION, etc.
  description TEXT,
  driver_group_id UUID REFERENCES driver_groups(id) ON DELETE SET NULL, -- null = All Driver Groups
  unit_of_measure TEXT NOT NULL DEFAULT 'fixed',
  percentage_based_on TEXT, -- driver_pay | ar_invoice | oo_benchmark
  effective_date_basis TEXT, -- which date triggers evaluation
  calculation_mode TEXT NOT NULL DEFAULT 'by_event'
    CHECK (calculation_mode IN ('by_event', 'by_move', 'by_leg')),
  auto_add BOOLEAN NOT NULL DEFAULT false,
  conditions JSONB DEFAULT '[]'::jsonb,
  match_resolution TEXT DEFAULT 'first_match_wins',
  is_enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_driver_charge_profiles_tenant
  ON driver_charge_profiles(tenant_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_driver_charge_profiles_group
  ON driver_charge_profiles(driver_group_id) WHERE deleted_at IS NULL;

-- updated_at trigger
CREATE OR REPLACE FUNCTION set_driver_charge_profiles_updated_at()
RETURNS TRIGGER AS $$ BEGIN NEW.updated_at := now(); RETURN NEW; END; $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_driver_charge_profiles_updated_at ON driver_charge_profiles;
CREATE TRIGGER trg_driver_charge_profiles_updated_at
  BEFORE UPDATE ON driver_charge_profiles FOR EACH ROW
  EXECUTE FUNCTION set_driver_charge_profiles_updated_at();

-- RLS
ALTER TABLE driver_charge_profiles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS driver_charge_profiles_select ON driver_charge_profiles;
CREATE POLICY driver_charge_profiles_select ON driver_charge_profiles FOR SELECT USING (tenant_id = current_tenant_id() OR is_dd_admin());
DROP POLICY IF EXISTS driver_charge_profiles_insert ON driver_charge_profiles;
CREATE POLICY driver_charge_profiles_insert ON driver_charge_profiles FOR INSERT WITH CHECK (tenant_id = current_tenant_id() OR is_dd_admin());
DROP POLICY IF EXISTS driver_charge_profiles_update ON driver_charge_profiles;
CREATE POLICY driver_charge_profiles_update ON driver_charge_profiles FOR UPDATE USING (tenant_id = current_tenant_id() OR is_dd_admin()) WITH CHECK (tenant_id = current_tenant_id() OR is_dd_admin());
DROP POLICY IF EXISTS driver_charge_profiles_delete ON driver_charge_profiles;
CREATE POLICY driver_charge_profiles_delete ON driver_charge_profiles FOR DELETE USING (tenant_id = current_tenant_id() OR is_dd_admin());

-- ──────────────────────────────────────────────────────────────
-- 2. Driver Charge Profile Versions (date-ranged grouping)
-- ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS driver_charge_profile_versions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  driver_charge_profile_id UUID NOT NULL REFERENCES driver_charge_profiles(id) ON DELETE CASCADE,
  label TEXT DEFAULT 'Version 1',
  effective_from DATE,
  effective_to DATE,
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_dcpv_profile ON driver_charge_profile_versions(driver_charge_profile_id);

ALTER TABLE driver_charge_profile_versions ENABLE ROW LEVEL SECURITY;
-- Inherit access through parent profile (no separate tenant_id needed for this join table)
CREATE POLICY dcpv_select ON driver_charge_profile_versions FOR SELECT USING (true);
CREATE POLICY dcpv_insert ON driver_charge_profile_versions FOR INSERT WITH CHECK (true);
CREATE POLICY dcpv_update ON driver_charge_profile_versions FOR UPDATE USING (true) WITH CHECK (true);
CREATE POLICY dcpv_delete ON driver_charge_profile_versions FOR DELETE USING (true);

-- ──────────────────────────────────────────────────────────────
-- 3. Driver Charge Profile Tiers (the actual rate rows)
-- ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS driver_charge_profile_tiers (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  driver_charge_profile_id UUID NOT NULL REFERENCES driver_charge_profiles(id) ON DELETE CASCADE,
  version_id UUID REFERENCES driver_charge_profile_versions(id) ON DELETE CASCADE,

  -- Amounts
  amount_cents INTEGER NOT NULL DEFAULT 0,
  minimum_amount_cents INTEGER NOT NULL DEFAULT 0,
  free_units NUMERIC(10,2) NOT NULL DEFAULT 0,

  -- By Event fields
  event_type TEXT,
  event_time TEXT, -- arrived | departed
  event_location_id UUID REFERENCES customers(id),
  event_location_type TEXT, -- org | city_state | zip | profile_group
  event_location_value TEXT,

  -- By Move fields
  move_index INTEGER,
  move_events JSONB DEFAULT '[]'::jsonb,
  move_calc_from TEXT,
  move_calc_to TEXT,

  -- By Leg fields (AP-specific)
  leg_from TEXT, -- pick_up_container, deliver_container, etc.
  leg_from_location_id UUID REFERENCES customers(id),
  leg_from_location_type TEXT,
  leg_from_location_value TEXT,
  leg_to TEXT,
  leg_to_location_id UUID REFERENCES customers(id),
  leg_to_location_type TEXT,
  leg_to_location_value TEXT,

  -- Radius tiers (when UOM = radius_rate)
  radius_tiers JSONB DEFAULT '[]'::jsonb,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_dcpt_profile ON driver_charge_profile_tiers(driver_charge_profile_id);
CREATE INDEX IF NOT EXISTS idx_dcpt_version ON driver_charge_profile_tiers(version_id);
CREATE INDEX IF NOT EXISTS idx_dcpt_tenant ON driver_charge_profile_tiers(tenant_id);

ALTER TABLE driver_charge_profile_tiers ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS dcpt_select ON driver_charge_profile_tiers;
CREATE POLICY dcpt_select ON driver_charge_profile_tiers FOR SELECT USING (tenant_id = current_tenant_id() OR is_dd_admin());
DROP POLICY IF EXISTS dcpt_insert ON driver_charge_profile_tiers;
CREATE POLICY dcpt_insert ON driver_charge_profile_tiers FOR INSERT WITH CHECK (tenant_id = current_tenant_id() OR is_dd_admin());
DROP POLICY IF EXISTS dcpt_update ON driver_charge_profile_tiers;
CREATE POLICY dcpt_update ON driver_charge_profile_tiers FOR UPDATE USING (tenant_id = current_tenant_id() OR is_dd_admin()) WITH CHECK (tenant_id = current_tenant_id() OR is_dd_admin());
DROP POLICY IF EXISTS dcpt_delete ON driver_charge_profile_tiers;
CREATE POLICY dcpt_delete ON driver_charge_profile_tiers FOR DELETE USING (tenant_id = current_tenant_id() OR is_dd_admin());

-- ──────────────────────────────────────────────────────────────
-- 4. Driver Tariffs
-- ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS driver_tariffs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('active', 'pending', 'draft', 'expired')),
  driver_group_id UUID REFERENCES driver_groups(id) ON DELETE SET NULL, -- null = all groups
  priority INTEGER NOT NULL DEFAULT 0,
  effective_start DATE,
  effective_end DATE,
  matching_mode TEXT DEFAULT 'basic',
  load_types JSONB DEFAULT '[]'::jsonb,
  pickup_conditions JSONB DEFAULT '{}'::jsonb,
  delivery_conditions JSONB DEFAULT '{}'::jsonb,
  return_conditions JSONB DEFAULT '{}'::jsonb,
  container_type TEXT,
  container_size TEXT,
  ssl_id UUID REFERENCES container_owners(id),
  chassis_type TEXT,
  chassis_size TEXT,
  chassis_owner TEXT,
  -- Load flags
  is_hazmat BOOLEAN,
  is_overweight BOOLEAN,
  is_overheight BOOLEAN,
  is_liquor BOOLEAN,
  is_hot BOOLEAN,
  is_genset BOOLEAN,
  is_scale BOOLEAN,
  is_ev BOOLEAN,
  is_street_turn BOOLEAN,
  is_oog BOOLEAN,
  is_bonded BOOLEAN,
  is_double BOOLEAN,
  is_tanker BOOLEAN,
  is_enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_driver_tariffs_tenant
  ON driver_tariffs(tenant_id) WHERE is_enabled = true;
CREATE INDEX IF NOT EXISTS idx_driver_tariffs_priority
  ON driver_tariffs(tenant_id, priority DESC);

-- updated_at trigger
CREATE OR REPLACE FUNCTION set_driver_tariffs_updated_at()
RETURNS TRIGGER AS $$ BEGIN NEW.updated_at := now(); RETURN NEW; END; $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_driver_tariffs_updated_at ON driver_tariffs;
CREATE TRIGGER trg_driver_tariffs_updated_at
  BEFORE UPDATE ON driver_tariffs FOR EACH ROW
  EXECUTE FUNCTION set_driver_tariffs_updated_at();

ALTER TABLE driver_tariffs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS driver_tariffs_select ON driver_tariffs;
CREATE POLICY driver_tariffs_select ON driver_tariffs FOR SELECT USING (tenant_id = current_tenant_id() OR is_dd_admin());
DROP POLICY IF EXISTS driver_tariffs_insert ON driver_tariffs;
CREATE POLICY driver_tariffs_insert ON driver_tariffs FOR INSERT WITH CHECK (tenant_id = current_tenant_id() OR is_dd_admin());
DROP POLICY IF EXISTS driver_tariffs_update ON driver_tariffs;
CREATE POLICY driver_tariffs_update ON driver_tariffs FOR UPDATE USING (tenant_id = current_tenant_id() OR is_dd_admin()) WITH CHECK (tenant_id = current_tenant_id() OR is_dd_admin());
DROP POLICY IF EXISTS driver_tariffs_delete ON driver_tariffs;
CREATE POLICY driver_tariffs_delete ON driver_tariffs FOR DELETE USING (tenant_id = current_tenant_id() OR is_dd_admin());

-- ──────────────────────────────────────────────────────────────
-- 5. Driver Tariff Charge Sets (grouping within a tariff)
-- ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS driver_tariff_charge_sets (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  tariff_id UUID NOT NULL REFERENCES driver_tariffs(id) ON DELETE CASCADE,
  pay_to_mode TEXT NOT NULL DEFAULT 'load_driver'
    CHECK (pay_to_mode IN ('load_driver', 'specified')),
  pay_to_driver_id UUID REFERENCES drivers(id),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_dtcs_tariff ON driver_tariff_charge_sets(tariff_id);

ALTER TABLE driver_tariff_charge_sets ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS dtcs_select ON driver_tariff_charge_sets;
CREATE POLICY dtcs_select ON driver_tariff_charge_sets FOR SELECT USING (tenant_id = current_tenant_id() OR is_dd_admin());
DROP POLICY IF EXISTS dtcs_insert ON driver_tariff_charge_sets;
CREATE POLICY dtcs_insert ON driver_tariff_charge_sets FOR INSERT WITH CHECK (tenant_id = current_tenant_id() OR is_dd_admin());
DROP POLICY IF EXISTS dtcs_update ON driver_tariff_charge_sets;
CREATE POLICY dtcs_update ON driver_tariff_charge_sets FOR UPDATE USING (tenant_id = current_tenant_id() OR is_dd_admin()) WITH CHECK (tenant_id = current_tenant_id() OR is_dd_admin());
DROP POLICY IF EXISTS dtcs_delete ON driver_tariff_charge_sets;
CREATE POLICY dtcs_delete ON driver_tariff_charge_sets FOR DELETE USING (tenant_id = current_tenant_id() OR is_dd_admin());

-- ──────────────────────────────────────────────────────────────
-- 6. Driver Tariff Charge Set → Profile Junction
-- ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS driver_tariff_charge_set_profiles (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  charge_set_id UUID NOT NULL REFERENCES driver_tariff_charge_sets(id) ON DELETE CASCADE,
  driver_charge_profile_id UUID NOT NULL REFERENCES driver_charge_profiles(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT dtcsp_unique UNIQUE (charge_set_id, driver_charge_profile_id)
);

CREATE INDEX IF NOT EXISTS idx_dtcsp_cs ON driver_tariff_charge_set_profiles(charge_set_id);
CREATE INDEX IF NOT EXISTS idx_dtcsp_profile ON driver_tariff_charge_set_profiles(driver_charge_profile_id);

ALTER TABLE driver_tariff_charge_set_profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY dtcsp_select ON driver_tariff_charge_set_profiles FOR SELECT USING (true);
CREATE POLICY dtcsp_insert ON driver_tariff_charge_set_profiles FOR INSERT WITH CHECK (true);
CREATE POLICY dtcsp_update ON driver_tariff_charge_set_profiles FOR UPDATE USING (true) WITH CHECK (true);
CREATE POLICY dtcsp_delete ON driver_tariff_charge_set_profiles FOR DELETE USING (true);

NOTIFY pgrst, 'reload schema';

COMMIT;
