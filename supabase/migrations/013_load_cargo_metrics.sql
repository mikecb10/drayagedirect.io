-- ============================================================
-- DrayageDirect: Phase 6c+ — Load cargo metrics
-- Adds piece count, pallet count, and KG weight to orders.
-- (weight_lbs already exists from migration 001)
-- ============================================================

ALTER TABLE orders ADD COLUMN IF NOT EXISTS piece_count INTEGER;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS pallet_count INTEGER;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS weight_kg NUMERIC(10, 2);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS commodity_description TEXT;
