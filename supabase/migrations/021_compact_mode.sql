-- ============================================================
-- Migration 021: Add compact_mode to user preferences
-- ============================================================
ALTER TABLE user_dispatcher_preferences
  ADD COLUMN IF NOT EXISTS compact_mode BOOLEAN NOT NULL DEFAULT false;
