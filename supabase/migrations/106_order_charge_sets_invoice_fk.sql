-- ============================================================
-- 106_order_charge_sets_invoice_fk.sql
--
-- FU-111: Add the FK from order_charge_sets.invoice_id to
-- invoices(id). This column has been a plain UUID with no
-- constraint since migration 003, which made
-- pages/api/tenant/loads/[id]/charge-sets/index.js's PostgREST
-- nested join `invoice:invoices!invoice_id(...)` 500 with
-- "Could not find a relationship between 'order_charge_sets'
-- and 'invoices' in the schema cache".
--
-- Pre-flight orphan check (run 2026-04-26): 0 rows. ALTER
-- applies cleanly without data fix-up.
--
-- ON DELETE SET NULL chosen over RESTRICT because the existing
-- rollback paths in pages/api/tenant/ar/invoices/index.js
-- already null out invoice_id before deleting the invoice, so
-- SET NULL matches that lifecycle and is a safety net for any
-- future code path that forgets the manual cleanup. A charge
-- set without an invoice is already a valid state (every
-- charge set starts there).
--
-- Note: DDL was applied live to Supabase via SQL Editor on
-- 2026-04-26 before this file was committed. This file exists
-- so future fresh-database setups via the migrations folder
-- include the same constraint.
-- ============================================================

BEGIN;

ALTER TABLE order_charge_sets
  ADD CONSTRAINT order_charge_sets_invoice_id_fkey
  FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_charge_sets_invoice_id
  ON order_charge_sets(invoice_id) WHERE invoice_id IS NOT NULL;

NOTIFY pgrst, 'reload schema';

COMMIT;
