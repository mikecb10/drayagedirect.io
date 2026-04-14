-- ============================================================
-- Migration 032: Granular Permissions System
-- ============================================================
-- Adds granular_permissions JSONB array to users table for
-- fine-grained RBAC. System roles provide defaults, but
-- each user can have custom overrides.
-- ============================================================

-- Add granular permissions column (JSONB array of permission keys)
ALTER TABLE users ADD COLUMN IF NOT EXISTS granular_permissions JSONB DEFAULT '[]'::jsonb;

-- Add system_role for the predefined role templates
-- (separate from the existing role enum which is super_admin/admin/user)
ALTER TABLE users ADD COLUMN IF NOT EXISTS system_role TEXT DEFAULT 'custom';

-- Add first_name / last_name for the PP-style user form
-- (users table currently has a single 'name' field)
ALTER TABLE users ADD COLUMN IF NOT EXISTS first_name TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_name TEXT;

-- Backfill first_name from name
UPDATE users SET first_name = split_part(name, ' ', 1) WHERE first_name IS NULL AND name IS NOT NULL;
UPDATE users SET last_name = CASE
  WHEN position(' ' in name) > 0 THEN substring(name from position(' ' in name) + 1)
  ELSE NULL
END WHERE last_name IS NULL AND name IS NOT NULL;

-- Index for permission lookups
CREATE INDEX IF NOT EXISTS idx_users_system_role ON users(tenant_id, system_role) WHERE deleted_at IS NULL;
