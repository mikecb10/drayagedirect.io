-- ============================================================
-- Migration 038: Source links on billing line items
-- ============================================================
-- Tracks which tariff and charge profile created each line item
-- so the UI can hyperlink back to them for easy editing.
-- ============================================================

ALTER TABLE order_charge_set_line_items ADD COLUMN IF NOT EXISTS source_tariff_id UUID REFERENCES tariffs(id) ON DELETE SET NULL;
ALTER TABLE order_charge_set_line_items ADD COLUMN IF NOT EXISTS source_profile_id UUID REFERENCES charge_profiles(id) ON DELETE SET NULL;
