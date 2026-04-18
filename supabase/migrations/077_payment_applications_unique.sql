-- ============================================================
-- Migration 077: Unique constraint on payment_applications
-- ============================================================
-- The apply-payment endpoint checks invoice balance before inserting
-- a `payment_applications` row, but there's no atomic guard against
-- two concurrent calls both passing the balance check before either
-- updates `balance_due_cents`. A rapid double-click (or client retry)
-- can create duplicate application rows and over-reduce the balance
-- below zero.
--
-- Adding a unique constraint on (tenant_id, payment_id, invoice_id)
-- makes the second insert fail deterministically at the DB layer, so
-- the endpoint can catch the error and return a clean 409.
--
-- QA finding #29 — surfaced during 2026-04-17 AR pipeline validation.
-- ============================================================

BEGIN;

-- Adding UNIQUE is safe because we've verified no existing duplicates
-- in the tenant under test. If a prod tenant had dupes, this would
-- fail loudly — which is the right outcome (surface the problem).
ALTER TABLE payment_applications
  ADD CONSTRAINT payment_applications_unique_pair
  UNIQUE (tenant_id, payment_id, invoice_id);

NOTIFY pgrst, 'reload schema';

COMMIT;
