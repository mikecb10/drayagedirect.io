-- ============================================================
-- Migration 051: Tenant-Wide Format Preferences
-- ============================================================
-- Single source of truth for how values are rendered across
-- emails, PDFs, exports, and the UI. Per-tenant preferences
-- override application defaults; per-template overrides (later
-- in Phase 1 of the Email System) override tenant preferences.
--
-- Keyed 1:1 with tenants so we can UPSERT freely and seed
-- a row for every tenant on signup.
-- ============================================================

BEGIN;

-- ──────────────────────────────────────────────────────────────
-- tenant_format_preferences
--
-- NOTE: date/time/timezone live in tenant_settings already, but
-- those cover UI display only. The fields here capture the full
-- formatting contract used by the email variable resolver and
-- any future PDF rendering — currency symbol, phone shape,
-- address compose format, number precision, weight units, etc.
--
-- On read: the email variable resolver does
--   tenant_format_preferences.<field> ?? application_default
--   ?? tenant_settings.<field> for the legacy 3 fields.
-- ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tenant_format_preferences (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL UNIQUE REFERENCES tenants(id) ON DELETE CASCADE,

  -- ── Dates ──
  -- Canonical date format token ('MM/DD/YYYY' | 'DD/MM/YYYY' | 'YYYY-MM-DD' | 'MMM D, YYYY' | 'D MMM YYYY')
  date_format TEXT NOT NULL DEFAULT 'MM/DD/YYYY',
  -- When true, renders as "Apr 11, 2026" style regardless of date_format token
  date_use_long_month BOOLEAN NOT NULL DEFAULT false,
  -- Suffix appended to empty date values ("—" | "N/A" | "TBD" | "")
  date_empty_placeholder TEXT NOT NULL DEFAULT '—',

  -- ── Times ──
  -- '12h' | '24h'
  time_format TEXT NOT NULL DEFAULT '12h',
  -- IANA timezone used to render timestamps (e.g. 'America/New_York')
  -- Falls back to tenant_settings.timezone if NULL
  timezone TEXT,
  -- When true, appends the abbreviated timezone ("EDT", "PDT") to rendered times
  time_show_timezone BOOLEAN NOT NULL DEFAULT true,

  -- ── Currency ──
  currency_code TEXT NOT NULL DEFAULT 'USD',
  -- '$' | 'US$' | 'USD' | '' (none)
  currency_symbol TEXT NOT NULL DEFAULT '$',
  -- Placement: 'prefix' ($1,234.56) | 'suffix' (1,234.56 $) | 'code_suffix' (1,234.56 USD)
  currency_position TEXT NOT NULL DEFAULT 'prefix',
  -- Thousands separator char (',', '.', ' ', '')
  currency_thousands TEXT NOT NULL DEFAULT ',',
  -- Decimal separator char ('.', ',')
  currency_decimal TEXT NOT NULL DEFAULT '.',
  -- Number of decimal places for currency rendering
  currency_decimal_places INT NOT NULL DEFAULT 2,
  -- How to show negatives: 'minus' (-$1,234.56) | 'parens' (($1,234.56)) | 'red_minus'
  currency_negative_style TEXT NOT NULL DEFAULT 'minus',

  -- ── Numbers (non-currency: piece counts, weights, counts) ──
  number_thousands TEXT NOT NULL DEFAULT ',',
  number_decimal TEXT NOT NULL DEFAULT '.',

  -- ── Weight ──
  -- 'lbs' | 'kg' — weight values in the DB are stored as lbs internally;
  -- the resolver converts on render if this is 'kg'.
  weight_unit TEXT NOT NULL DEFAULT 'lbs',
  weight_decimal_places INT NOT NULL DEFAULT 0,
  weight_show_unit BOOLEAN NOT NULL DEFAULT true,

  -- ── Distance ──
  -- 'mi' | 'km'
  distance_unit TEXT NOT NULL DEFAULT 'mi',

  -- ── Phone numbers ──
  -- '(555) 123-4567' | '555-123-4567' | '555.123.4567' | '+1 555 123 4567' | 'raw'
  phone_format TEXT NOT NULL DEFAULT '(###) ###-####',
  phone_country_default TEXT NOT NULL DEFAULT 'US',

  -- ── Addresses ──
  -- 'single_line' (1 Main St, Anytown, CA 90210)
  -- 'multi_line'  (1 Main St\nAnytown, CA 90210)
  -- 'company_first' (Acme Corp\n1 Main St\nAnytown, CA 90210)
  address_format TEXT NOT NULL DEFAULT 'single_line',
  -- When rendering org names + city/state, this controls the separator
  -- ' — ' vs ' - ' vs ' | '
  address_name_separator TEXT NOT NULL DEFAULT ' — ',

  -- ── Container numbers ──
  -- 'grouped' (ABCD 123456-7) | 'compact' (ABCD1234567) | 'spaced' (ABCD 123456 7)
  container_number_format TEXT NOT NULL DEFAULT 'compact',

  -- ── Empty values ──
  -- How to render NULL/missing values that the variable resolver encounters
  empty_placeholder TEXT NOT NULL DEFAULT '—',
  -- When true, email sends abort if any required variable is empty
  -- (false by default — emails render with the placeholder)
  strict_empty_mode BOOLEAN NOT NULL DEFAULT false,

  -- ── Casing ──
  -- 'upper' | 'title' | 'as_entered' — applied to organization names
  organization_name_case TEXT NOT NULL DEFAULT 'as_entered',
  -- Same for location names (terminals, warehouses)
  location_name_case TEXT NOT NULL DEFAULT 'as_entered',

  -- ── Default email signature (HTML, rendered at the bottom of every send) ──
  -- Optional; if set, appended automatically unless the template opts out
  default_signature_html TEXT,
  default_signature_enabled BOOLEAN NOT NULL DEFAULT false,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tenant_format_prefs_tenant
  ON tenant_format_preferences(tenant_id);

-- ──────────────────────────────────────────────────────────────
-- Auto-updated_at trigger
-- ──────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION set_tenant_format_preferences_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_tenant_format_preferences_updated_at
  ON tenant_format_preferences;
CREATE TRIGGER trg_tenant_format_preferences_updated_at
  BEFORE UPDATE ON tenant_format_preferences
  FOR EACH ROW
  EXECUTE FUNCTION set_tenant_format_preferences_updated_at();

-- ──────────────────────────────────────────────────────────────
-- RLS
-- ──────────────────────────────────────────────────────────────
ALTER TABLE tenant_format_preferences ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tfp_select ON tenant_format_preferences;
CREATE POLICY tfp_select ON tenant_format_preferences
  FOR SELECT
  USING (tenant_id = current_tenant_id() OR is_dd_admin());

DROP POLICY IF EXISTS tfp_insert ON tenant_format_preferences;
CREATE POLICY tfp_insert ON tenant_format_preferences
  FOR INSERT
  WITH CHECK (tenant_id = current_tenant_id() OR is_dd_admin());

DROP POLICY IF EXISTS tfp_update ON tenant_format_preferences;
CREATE POLICY tfp_update ON tenant_format_preferences
  FOR UPDATE
  USING (tenant_id = current_tenant_id() OR is_dd_admin());

DROP POLICY IF EXISTS tfp_delete ON tenant_format_preferences;
CREATE POLICY tfp_delete ON tenant_format_preferences
  FOR DELETE
  USING (is_dd_admin());

-- ──────────────────────────────────────────────────────────────
-- Backfill: seed one row per existing tenant using the defaults
-- so existing tenants don't need to visit the settings page
-- before sending their first formatted email.
-- ──────────────────────────────────────────────────────────────
INSERT INTO tenant_format_preferences (tenant_id)
SELECT id FROM tenants
WHERE deleted_at IS NULL
ON CONFLICT (tenant_id) DO NOTHING;

-- ──────────────────────────────────────────────────────────────
-- Auto-seed on tenant creation: whenever a new tenant row is
-- inserted, create a matching tenant_format_preferences row with
-- the application defaults.
-- ──────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION seed_tenant_format_preferences()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO tenant_format_preferences (tenant_id)
  VALUES (NEW.id)
  ON CONFLICT (tenant_id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_seed_tenant_format_preferences ON tenants;
CREATE TRIGGER trg_seed_tenant_format_preferences
  AFTER INSERT ON tenants
  FOR EACH ROW
  EXECUTE FUNCTION seed_tenant_format_preferences();

NOTIFY pgrst, 'reload schema';

COMMIT;
