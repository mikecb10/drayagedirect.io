-- ============================================================
-- Migration 026: Tariffs & Charge Profiles Pricing Engine
-- ============================================================
-- Full pricing hierarchy:
--   Charge Profiles (reusable, independent)
--     └── Tiers (date-ranged pricing rows)
--   Tariffs (matching conditions)
--     └── Tariff Charge Sets (Bill To + tags)
--           └── Links to Charge Profiles (by reference)
--           └── One-off Charge Items
-- ============================================================

-- ============================================================
-- CHARGE PROFILES (reusable building blocks)
-- ============================================================
CREATE TABLE IF NOT EXISTS charge_profiles (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  charge_name TEXT NOT NULL,  -- LINE_HAUL, FUEL, CHASSIS, DETENTION, etc.
  description TEXT,
  tag TEXT,
  unit_of_measure TEXT NOT NULL DEFAULT 'fixed',
  auto_add BOOLEAN NOT NULL DEFAULT false,
  effective_date_basis TEXT DEFAULT 'CURRENT_DATE',
  -- Charge calculation mode: by_lane, between_statuses, by_event, by_move
  calculation_mode TEXT DEFAULT 'by_lane',
  -- Conditions/rules for when this charge fires (JSONB for flexibility)
  conditions JSONB DEFAULT '[]'::jsonb,
  -- When multiple conditions match: first_match_wins, highest_rate, lowest_rate, stack_combine
  match_resolution TEXT DEFAULT 'first_match_wins',
  -- Link to existing profile (for inheritance)
  linked_profile_id UUID REFERENCES charge_profiles(id),
  is_enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_charge_profiles_tenant ON charge_profiles(tenant_id) WHERE is_enabled = true;

-- Charge profile tiers (date-ranged pricing rows)
CREATE TABLE IF NOT EXISTS charge_profile_tiers (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  charge_profile_id UUID NOT NULL REFERENCES charge_profiles(id) ON DELETE CASCADE,
  version_label TEXT, -- "Version 1", "Q2 2026", etc.
  start_date DATE,
  end_date DATE,
  amount_cents INTEGER NOT NULL DEFAULT 0,
  minimum_amount_cents INTEGER DEFAULT 0,
  free_units NUMERIC DEFAULT 0,
  -- For "between statuses" mode
  from_status TEXT,
  to_status TEXT,
  -- For "by lane" mode
  pickup_location_id UUID REFERENCES customers(id),
  delivery_location_id UUID REFERENCES customers(id),
  return_location_id UUID REFERENCES customers(id),
  -- For "by event" mode
  event_type TEXT,
  -- For "by move" mode
  move_index INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_charge_profile_tiers_profile ON charge_profile_tiers(charge_profile_id);

-- ============================================================
-- TARIFFS (matching conditions + charge sets)
-- ============================================================
CREATE TABLE IF NOT EXISTS tariffs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('active', 'pending', 'draft', 'expired')),
  effective_start DATE,
  effective_end DATE,
  -- Matching mode
  matching_mode TEXT NOT NULL DEFAULT 'basic' CHECK (matching_mode IN ('basic', 'advanced_route')),
  route_template JSONB, -- for advanced mode: ordered stop types
  -- Primary matching conditions
  load_types JSONB DEFAULT '[]'::jsonb, -- array of load type strings
  terminal_id UUID REFERENCES system_terminals(id),
  customer_ids JSONB DEFAULT '[]'::jsonb, -- array of customer UUIDs, empty = all
  -- Location conditions (JSONB for flexibility: {ids:[], cities:[], zips:[], all:true})
  pickup_conditions JSONB DEFAULT '{"all":true}'::jsonb,
  delivery_conditions JSONB DEFAULT '{"all":true}'::jsonb,
  return_conditions JSONB DEFAULT '{}'::jsonb,
  -- Optional narrowing conditions
  container_type TEXT,
  container_size TEXT,
  ssl_id UUID REFERENCES container_owners(id),
  csr_user_id UUID REFERENCES users(id),
  chassis_type TEXT,
  chassis_size TEXT,
  chassis_owner TEXT,
  -- Load flag conditions
  is_hazmat BOOLEAN,
  is_overweight BOOLEAN,
  is_liquor BOOLEAN,
  is_hot BOOLEAN,
  is_genset BOOLEAN,
  -- Priority for matching (higher = more specific = wins)
  priority INTEGER NOT NULL DEFAULT 0,
  is_enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tariffs_tenant ON tariffs(tenant_id) WHERE is_enabled = true;
CREATE INDEX IF NOT EXISTS idx_tariffs_status ON tariffs(tenant_id, status);

-- ============================================================
-- TARIFF CHARGE SETS (Bill To grouping within a tariff)
-- ============================================================
CREATE TABLE IF NOT EXISTS tariff_charge_sets (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  tariff_id UUID NOT NULL REFERENCES tariffs(id) ON DELETE CASCADE,
  bill_to_mode TEXT NOT NULL DEFAULT 'load_customer' CHECK (bill_to_mode IN ('load_customer', 'specified')),
  bill_to_customer_id UUID REFERENCES customers(id), -- only when mode = specified
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tariff_charge_sets_tariff ON tariff_charge_sets(tariff_id);

-- Tags on charge sets
CREATE TABLE IF NOT EXISTS tariff_charge_set_tags (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  charge_set_id UUID NOT NULL REFERENCES tariff_charge_sets(id) ON DELETE CASCADE,
  tag TEXT NOT NULL,
  UNIQUE (charge_set_id, tag)
);

-- Link: charge set → charge profiles (by reference)
CREATE TABLE IF NOT EXISTS tariff_charge_set_profiles (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  charge_set_id UUID NOT NULL REFERENCES tariff_charge_sets(id) ON DELETE CASCADE,
  charge_profile_id UUID NOT NULL REFERENCES charge_profiles(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (charge_set_id, charge_profile_id)
);

-- One-off charge items (not from a saved profile)
CREATE TABLE IF NOT EXISTS tariff_charge_items (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  charge_set_id UUID NOT NULL REFERENCES tariff_charge_sets(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  charge_name TEXT,
  unit_of_measure TEXT NOT NULL DEFAULT 'fixed',
  amount_cents INTEGER NOT NULL DEFAULT 0,
  minimum_amount_cents INTEGER DEFAULT 0,
  free_units NUMERIC DEFAULT 0,
  conditions JSONB DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- RLS
-- ============================================================
ALTER TABLE charge_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE charge_profile_tiers ENABLE ROW LEVEL SECURITY;
ALTER TABLE tariffs ENABLE ROW LEVEL SECURITY;
ALTER TABLE tariff_charge_sets ENABLE ROW LEVEL SECURITY;
ALTER TABLE tariff_charge_set_tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE tariff_charge_set_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE tariff_charge_items ENABLE ROW LEVEL SECURITY;

-- Charge profiles
CREATE POLICY charge_profiles_select ON charge_profiles FOR SELECT
  USING (tenant_id = current_tenant_id() OR is_dd_admin());
CREATE POLICY charge_profiles_insert ON charge_profiles FOR INSERT
  WITH CHECK (tenant_id = current_tenant_id() OR is_dd_admin());
CREATE POLICY charge_profiles_update ON charge_profiles FOR UPDATE
  USING (tenant_id = current_tenant_id() OR is_dd_admin());
CREATE POLICY charge_profiles_delete ON charge_profiles FOR DELETE
  USING (tenant_id = current_tenant_id() OR is_dd_admin());

-- Charge profile tiers (cascade from profile)
CREATE POLICY charge_profile_tiers_all ON charge_profile_tiers FOR ALL
  USING (true);

-- Tariffs
CREATE POLICY tariffs_select ON tariffs FOR SELECT
  USING (tenant_id = current_tenant_id() OR is_dd_admin());
CREATE POLICY tariffs_insert ON tariffs FOR INSERT
  WITH CHECK (tenant_id = current_tenant_id() OR is_dd_admin());
CREATE POLICY tariffs_update ON tariffs FOR UPDATE
  USING (tenant_id = current_tenant_id() OR is_dd_admin());
CREATE POLICY tariffs_delete ON tariffs FOR DELETE
  USING (tenant_id = current_tenant_id() OR is_dd_admin());

-- Tariff charge sets (cascade from tariff)
CREATE POLICY tariff_charge_sets_all ON tariff_charge_sets FOR ALL
  USING (tenant_id = current_tenant_id() OR is_dd_admin());

-- Tags, profiles links, items (cascade from charge set)
CREATE POLICY tariff_charge_set_tags_all ON tariff_charge_set_tags FOR ALL USING (true);
CREATE POLICY tariff_charge_set_profiles_all ON tariff_charge_set_profiles FOR ALL USING (true);
CREATE POLICY tariff_charge_items_all ON tariff_charge_items FOR ALL USING (true);

-- ============================================================
-- SEED: Standard charge names
-- ============================================================
-- These aren't a separate table — they're just the common values
-- for the charge_name field on charge_profiles. The UI will show
-- them as a dropdown with the ability to add custom ones.
-- ============================================================
