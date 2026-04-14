-- ============================================================
-- DrayageDirect: Phase 5b-3 Polish — Resizable columns
-- Adds column_widths JSONB to user_dispatcher_preferences
-- ============================================================

ALTER TABLE user_dispatcher_preferences
  ADD COLUMN IF NOT EXISTS column_widths JSONB NOT NULL DEFAULT '{}'::jsonb;
