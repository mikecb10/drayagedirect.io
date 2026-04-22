-- ============================================================
-- Migration 092: Load margin thresholds (tenant-configurable)
-- ============================================================
-- Adds three columns to `tenants` that configure the Load Margin %
-- color layer:
--   - margin_red_threshold    — at-or-below this pct = red bucket
--   - margin_yellow_threshold — above red, at-or-below this = yellow;
--                                above yellow = green
--   - margin_include_dry_runs — when FALSE, dry-run line items are
--                                excluded from both revenue and cost
--
-- Defaults: 15 / 30 / TRUE. A CHECK constraint enforces that
-- yellow > red so the bucket logic always has a non-empty yellow band.
-- ============================================================

BEGIN;

ALTER TABLE tenants
  ADD COLUMN margin_red_threshold    NUMERIC(5,2) NOT NULL DEFAULT 15.00,
  ADD COLUMN margin_yellow_threshold NUMERIC(5,2) NOT NULL DEFAULT 30.00,
  ADD COLUMN margin_include_dry_runs BOOLEAN      NOT NULL DEFAULT TRUE;

ALTER TABLE tenants
  ADD CONSTRAINT chk_margin_threshold_order
  CHECK (margin_yellow_threshold > margin_red_threshold);

NOTIFY pgrst, 'reload schema';

COMMIT;
