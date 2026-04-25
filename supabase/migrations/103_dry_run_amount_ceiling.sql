-- ============================================================
-- Migration 103: Dry-run AR/AP amount ceiling CHECK
-- ============================================================
-- The dry-run engine (`lib/dry-run-engine.js`) already enforces a
-- 10,000,000-cents ($100,000) sanity ceiling on every manual or
-- computed amount via `MAX_AMOUNT_CENTS`. This migration mirrors
-- that ceiling at the database level so a future caller (RPC,
-- raw SQL, integration bypass) cannot insert an above-ceiling
-- value.
--
-- The lower bound (`>= 0`) was already enforced inline in
-- migration 088. This adds the upper bound to both columns.
--
-- Coupling note: if `MAX_AMOUNT_CENTS` in dry-run-engine.js
-- changes, this constraint must be updated to match.
-- ============================================================

BEGIN;

ALTER TABLE dry_run_attempts
  ADD CONSTRAINT chk_ar_amount_ceiling CHECK (ar_amount_cents <= 10000000),
  ADD CONSTRAINT chk_ap_amount_ceiling CHECK (ap_amount_cents <= 10000000);

NOTIFY pgrst, 'reload schema';

COMMIT;
