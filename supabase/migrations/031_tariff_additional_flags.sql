-- ============================================================
-- Migration 031: Add missing flag columns to tariffs table
-- ============================================================
-- Adds all load flags from FLAG_DEFS so tariff matching
-- can filter on any flag combination.
-- ============================================================

ALTER TABLE tariffs ADD COLUMN IF NOT EXISTS is_overheight BOOLEAN;
ALTER TABLE tariffs ADD COLUMN IF NOT EXISTS is_scale BOOLEAN;
ALTER TABLE tariffs ADD COLUMN IF NOT EXISTS is_ev BOOLEAN;
ALTER TABLE tariffs ADD COLUMN IF NOT EXISTS is_street_turn BOOLEAN;
ALTER TABLE tariffs ADD COLUMN IF NOT EXISTS is_oog BOOLEAN;
ALTER TABLE tariffs ADD COLUMN IF NOT EXISTS is_bonded BOOLEAN;
ALTER TABLE tariffs ADD COLUMN IF NOT EXISTS is_double BOOLEAN;
ALTER TABLE tariffs ADD COLUMN IF NOT EXISTS is_tanker BOOLEAN;

-- Allow multiple customer IDs and load types as arrays
-- (already JSONB in 026 but confirming structure)
COMMENT ON COLUMN tariffs.customer_ids IS 'JSONB array of customer UUIDs. Empty array = all customers.';
COMMENT ON COLUMN tariffs.load_types IS 'JSONB array of load type strings. Empty = all types.';
