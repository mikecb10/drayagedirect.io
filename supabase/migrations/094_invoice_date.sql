-- ============================================================
-- Migration 094: Invoice issue date
-- ============================================================
-- Adds `invoice_date DATE` to the invoices table. Until now the
-- "invoice date" the UI displays was derived from `created_at` (or
-- left blank). Making it a first-class column lets operators:
--   - see the invoice's issue date independent of when the row was
--     inserted (useful for backdating or future-dating)
--   - edit it (e.g., to align a month-end close) without touching
--     created_at audit timestamps
--   - drive due-date recalculation off a business-meaningful anchor
--
-- Backfill: existing rows get their invoice_date set to
-- created_at::date so nothing flips to NULL post-migration.
--
-- Default on new rows = CURRENT_DATE, so any INSERT that forgets to
-- set invoice_date explicitly still gets a sane value.
-- ============================================================

BEGIN;

ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS invoice_date DATE NOT NULL DEFAULT CURRENT_DATE;

-- Backfill rows that existed before the default kicked in. The ADD
-- COLUMN with DEFAULT above actually populates existing rows with
-- CURRENT_DATE at migration time, not each row's original creation
-- date — correct it to created_at::date so aging reports stay honest.
UPDATE invoices
   SET invoice_date = created_at::date
 WHERE invoice_date = CURRENT_DATE
   AND created_at::date < CURRENT_DATE;

NOTIFY pgrst, 'reload schema';

COMMIT;
