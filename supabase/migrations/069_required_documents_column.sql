-- ============================================================
-- Migration 069: Add required_documents column to customers
-- ============================================================
-- The OrganizationModal references required_documents but the
-- column was never created. Adds it as a JSONB array.
-- ============================================================

BEGIN;

ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS required_documents JSONB DEFAULT '[]'::jsonb;

NOTIFY pgrst, 'reload schema';

COMMIT;
