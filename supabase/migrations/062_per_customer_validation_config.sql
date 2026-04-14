-- ============================================================
-- Migration 062: Per-customer document validation config
-- ============================================================
-- Adds validation_required_doc_types JSONB to customers so each
-- customer/organization can specify which document types require
-- dispatcher approval when uploaded by a driver. Types not in
-- this list auto-approve. Falls back to the tenant-level config
-- in tenant_settings.validation_required_doc_types when empty.
-- ============================================================

BEGIN;

ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS validation_required_doc_types JSONB DEFAULT '[]'::jsonb;

COMMENT ON COLUMN customers.validation_required_doc_types IS
  'Array of document type strings that require dispatcher validation when uploaded by a driver for loads belonging to this customer. e.g. ["POD","BOL"]. Empty = fall back to tenant-level setting.';

NOTIFY pgrst, 'reload schema';

COMMIT;
