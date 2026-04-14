-- ============================================================
-- Migration 054: Add 'manage_system_emails' Permission
-- ============================================================
-- The Email System (Phase 1) gates all template/umbrella/trigger
-- editing behind a dedicated granular permission separate from
-- the generic SETTINGS permission. This lets tenants grant a
-- dispatch lead the ability to tweak email automation without
-- giving them full settings access.
--
-- Also re-establishes a handful of granular permission keys that
-- have been added incrementally so the reference matches what
-- the permissions picker displays.
-- ============================================================

BEGIN;

-- ──────────────────────────────────────────────────────────────
-- Add the new enum value.
--
-- Note: ALTER TYPE ... ADD VALUE cannot run inside an explicit
-- transaction block by default in PostgreSQL < 12. Since Supabase
-- is on 15+ we're fine, but we use IF NOT EXISTS so re-running
-- is safe.
-- ──────────────────────────────────────────────────────────────
ALTER TYPE permission_type_enum ADD VALUE IF NOT EXISTS 'manage_system_emails';

NOTIFY pgrst, 'reload schema';

COMMIT;
