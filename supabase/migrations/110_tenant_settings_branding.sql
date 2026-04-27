-- 110_tenant_settings_branding.sql
-- Adds branding columns to tenant_settings for printed-document headers.
-- All columns nullable; tenants populate via SQL Editor for now (future
-- Company Info settings page will provide UI).

BEGIN;

ALTER TABLE tenant_settings
  ADD COLUMN IF NOT EXISTS address_line1 TEXT,
  ADD COLUMN IF NOT EXISTS address_line2 TEXT,
  ADD COLUMN IF NOT EXISTS city TEXT,
  ADD COLUMN IF NOT EXISTS state TEXT,
  ADD COLUMN IF NOT EXISTS zip TEXT,
  ADD COLUMN IF NOT EXISTS phone TEXT,
  ADD COLUMN IF NOT EXISTS website TEXT;

NOTIFY pgrst, 'reload schema';

COMMIT;
