-- ============================================================
-- Migration 030: Charge Profile Schema Enhancements
-- ============================================================
-- Adds fields to support the full charge profile specification:
--   - Percentage Based On (references another charge code)
--   - Tags (array, tenant-global, reusable across profiles)
--   - Versions (date-ranged groups of pricing rows)
--   - By Move event pairs with calc from/to timing
--   - Event location flexibility
--   - Radius rate tiers
-- ============================================================

-- New fields on charge_profiles
ALTER TABLE charge_profiles ADD COLUMN IF NOT EXISTS percentage_based_on TEXT; -- charge code when UOM = percentage
ALTER TABLE charge_profiles ADD COLUMN IF NOT EXISTS tags TEXT[] DEFAULT '{}'; -- replaces single 'tag' column

-- Create a versions layer between profiles and tiers
CREATE TABLE IF NOT EXISTS charge_profile_versions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  charge_profile_id UUID NOT NULL REFERENCES charge_profiles(id) ON DELETE CASCADE,
  label TEXT, -- "Version 1", "Q2 2026", etc.
  effective_from DATE,
  effective_to DATE,
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cpv_profile ON charge_profile_versions(charge_profile_id);

-- Add version_id to tiers (nullable for backward compat)
ALTER TABLE charge_profile_tiers ADD COLUMN IF NOT EXISTS version_id UUID REFERENCES charge_profile_versions(id) ON DELETE CASCADE;

-- New fields on charge_profile_tiers for event location flexibility
ALTER TABLE charge_profile_tiers ADD COLUMN IF NOT EXISTS event_location_id UUID REFERENCES customers(id);
ALTER TABLE charge_profile_tiers ADD COLUMN IF NOT EXISTS event_location_type TEXT; -- 'org' | 'city_state' | 'zip' | 'profile' | 'profile_group'
ALTER TABLE charge_profile_tiers ADD COLUMN IF NOT EXISTS event_location_value TEXT; -- free text for city/state, zip, etc.

-- By Move: multiple event/location pairs stored as JSONB array
-- Each entry: { event, event_time, location_id, location_type, location_value }
ALTER TABLE charge_profile_tiers ADD COLUMN IF NOT EXISTS move_events JSONB DEFAULT '[]'::jsonb;
ALTER TABLE charge_profile_tiers ADD COLUMN IF NOT EXISTS move_calc_from TEXT; -- 'first_event_arrived' | 'first_event_departed'
ALTER TABLE charge_profile_tiers ADD COLUMN IF NOT EXISTS move_calc_to TEXT;   -- 'last_event_arrived' | 'last_event_departed' | 'last_event_completed'

-- Radius Rate: distance-based tiers stored as JSONB array
-- Each entry: { amount_cents, start_distance, end_distance, rate_type, percentage_based_on }
ALTER TABLE charge_profile_tiers ADD COLUMN IF NOT EXISTS radius_tiers JSONB DEFAULT '[]'::jsonb;

-- RLS for new table
ALTER TABLE charge_profile_versions ENABLE ROW LEVEL SECURITY;
CREATE POLICY charge_profile_versions_all ON charge_profile_versions FOR ALL USING (true);

-- Tenant-global tags table for autocomplete/reuse
CREATE TABLE IF NOT EXISTS charge_profile_tags (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, name)
);

CREATE INDEX IF NOT EXISTS idx_cpt_tenant ON charge_profile_tags(tenant_id);

ALTER TABLE charge_profile_tags ENABLE ROW LEVEL SECURITY;
CREATE POLICY charge_profile_tags_select ON charge_profile_tags FOR SELECT
  USING (tenant_id = current_tenant_id() OR is_dd_admin());
CREATE POLICY charge_profile_tags_insert ON charge_profile_tags FOR INSERT
  WITH CHECK (tenant_id = current_tenant_id() OR is_dd_admin());
CREATE POLICY charge_profile_tags_delete ON charge_profile_tags FOR DELETE
  USING (tenant_id = current_tenant_id() OR is_dd_admin());
