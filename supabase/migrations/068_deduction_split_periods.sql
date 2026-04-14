-- ============================================================
-- Migration 068: Deduction Split Periods
-- ============================================================
-- Adds columns for splitting a total deduction amount across
-- multiple settlement periods. When split_periods > 0, the
-- amount_cents represents the per-period amount, and the system
-- tracks how many periods have been applied.
-- ============================================================

BEGIN;

ALTER TABLE driver_deductions
  ADD COLUMN IF NOT EXISTS total_amount_cents INTEGER,
  ADD COLUMN IF NOT EXISTS split_periods INTEGER,
  ADD COLUMN IF NOT EXISTS periods_applied INTEGER NOT NULL DEFAULT 0;

NOTIFY pgrst, 'reload schema';

COMMIT;
