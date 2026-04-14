-- ============================================================
-- Migration 041: Live Presence Setting
-- ============================================================
-- Adds a tenant-level toggle for the dispatcher board's live
-- presence & cursors feature. Defaults to ON so the feature is
-- visible immediately after deployment. Tenant admins can turn
-- it off per-tenant via /settings/company.
-- ============================================================

ALTER TABLE tenant_settings
  ADD COLUMN IF NOT EXISTS live_presence_enabled BOOLEAN DEFAULT true;

COMMENT ON COLUMN tenant_settings.live_presence_enabled IS
  'When true, shows live avatars + cursors of other users on the dispatcher board.';
