-- ============================================================
-- Migration 033: Tenant Branding — Logo + Display Name
-- ============================================================
-- Adds small logo (icon, sidebar collapsed) and large logo
-- (sidebar expanded) fields to tenant_settings.
-- ============================================================

ALTER TABLE tenant_settings ADD COLUMN IF NOT EXISTS logo_small_url TEXT; -- Icon-size logo (sidebar collapsed, ~32x32)
ALTER TABLE tenant_settings ADD COLUMN IF NOT EXISTS logo_large_url TEXT; -- Full logo (sidebar expanded, ~160x40)
