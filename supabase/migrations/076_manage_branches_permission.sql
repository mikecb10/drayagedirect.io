-- ============================================================
-- Migration 076: Add 'manage_branches' Permission
-- ============================================================
-- `MANAGE_BRANCHES` has existed in lib/permissions.js as a granular
-- permission constant, but the enum value was never added to the
-- database, so attempts to grant it via user_permissions failed with
-- `invalid input value for enum permission_type_enum`.
--
-- The Settings Permissions Gating feature (spec 2026-04-17) uses
-- `MANAGE_BRANCHES | ALL` as the requiredPermission on the Branches
-- settings item. Without this migration, only super_admin and ALL
-- users would ever see Branches — MANAGE_BRANCHES grants would be
-- rejected at insert time.
--
-- Mirrors the pattern used by migration 054 for manage_system_emails.
-- ============================================================

BEGIN;

-- Add the new enum value. IF NOT EXISTS makes re-runs safe.
ALTER TYPE permission_type_enum ADD VALUE IF NOT EXISTS 'manage_branches';

NOTIFY pgrst, 'reload schema';

COMMIT;
