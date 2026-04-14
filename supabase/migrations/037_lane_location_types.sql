-- ============================================================
-- Migration 037: Lane Location Type Support for Charge Profile Tiers
-- ============================================================
-- Adds origin/destination type and value fields so charge profiles
-- can match by Organization, City/State, or Zip Code — not just org IDs.
-- ============================================================

ALTER TABLE charge_profile_tiers ADD COLUMN IF NOT EXISTS origin_type TEXT DEFAULT 'org'; -- 'org' | 'city_state' | 'zip'
ALTER TABLE charge_profile_tiers ADD COLUMN IF NOT EXISTS origin_value TEXT; -- free text for city/state or zip
ALTER TABLE charge_profile_tiers ADD COLUMN IF NOT EXISTS dest_type TEXT DEFAULT 'org'; -- 'org' | 'city_state' | 'zip'
ALTER TABLE charge_profile_tiers ADD COLUMN IF NOT EXISTS dest_value TEXT; -- free text for city/state or zip
