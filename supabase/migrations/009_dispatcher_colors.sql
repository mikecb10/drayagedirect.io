-- ============================================================
-- DrayageDirect: Phase 6a — Tenant-customizable Dispatcher Colors
-- Per-state row background + per-load-type accent stripe
-- ============================================================

ALTER TABLE tenant_settings
  ADD COLUMN IF NOT EXISTS state_colors JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE tenant_settings
  ADD COLUMN IF NOT EXISTS load_type_colors JSONB NOT NULL DEFAULT '{}'::jsonb;
