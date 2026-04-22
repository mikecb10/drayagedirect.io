-- ============================================================
-- Migration 087: user_ar_preferences — v2 custom_tabs reset
-- ============================================================
-- Phase A of the AR filter-bar v2 redesign drops the per-section
-- `section` key from the custom_tabs JSONB shape (tabs become
-- globally scoped — applied across all AR sub-tabs). Existing rows
-- were created during v1 gate-walkthrough testing and carry the
-- stale shape; the user has approved wiping them.
--
-- New tab shape (v2):
--   { id, name, filters, created_at }
--
-- The custom_tabs column stays JSONB (no DDL change); this migration
-- is a data reset only.
-- ============================================================

BEGIN;

UPDATE user_ar_preferences
SET custom_tabs = '[]'::jsonb
WHERE custom_tabs IS NOT NULL AND custom_tabs != '[]'::jsonb;

NOTIFY pgrst, 'reload schema';

COMMIT;
