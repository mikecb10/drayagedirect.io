-- ============================================================
-- Migration 093: Payment supporting document
-- ============================================================
-- Adds two columns to `payments_received` so a supporting document
-- (check scan, wire confirmation PDF, ACH receipt) can be attached
-- at payment creation/edit time:
--
--   - document_url      — Storage path (bucket `documents`, path
--                          `{tenant_id}/payments/{payment_id}.{ext}`)
--   - document_filename — original user-provided filename, preserved
--                          for display and to pick the Content-Type
--                          on download
--
-- Both nullable. Optional attachment; existing rows unaffected.
-- ============================================================

BEGIN;

ALTER TABLE payments_received
  ADD COLUMN IF NOT EXISTS document_url      TEXT,
  ADD COLUMN IF NOT EXISTS document_filename TEXT;

NOTIFY pgrst, 'reload schema';

COMMIT;
