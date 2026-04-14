-- ============================================================
-- DrayageDirect: Carrier SCAC code for load numbering
-- Adds scac_code to tenant_settings so load numbers can use
-- the carrier's SCAC as a prefix instead of the generic "ORD".
-- ============================================================

ALTER TABLE tenant_settings
  ADD COLUMN IF NOT EXISTS scac_code TEXT;

-- Optional: enforce uppercase + trim on insert/update (2-4 char SCAC is standard)
-- We leave the column flexible here; validation happens in the API layer.
