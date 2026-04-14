-- ============================================================
-- DrayageDirect: Seed Data
-- Run after 001_initial_schema.sql
-- ============================================================

-- -----------------------------------------------------------
-- SUBSCRIPTION TIERS
-- -----------------------------------------------------------

INSERT INTO subscription_tiers (name, display_name, monthly_price_cents, annual_price_cents, max_users, max_drivers, max_orders_per_month, description) VALUES
  ('basic',      'Basic',      4900,   47000,  5,    10,   200,  'For small carriers getting started with drayage management'),
  ('pro',        'Pro',        9900,   95000,  25,   50,   1000, 'For growing carriers with full operations and team management'),
  ('enterprise', 'Enterprise', 19900,  191000, NULL, NULL, NULL, 'Unlimited usage, priority support, API access, and custom integrations');

-- -----------------------------------------------------------
-- FEATURE FLAGS
-- -----------------------------------------------------------

INSERT INTO feature_flags (name, description, tier_required) VALUES
  ('bulk_csv_upload',     'Upload quotes and orders via CSV file',                    'basic'),
  ('rate_management',     'Create and manage customer rate profiles',                 'basic'),
  ('order_management',    'Full order lifecycle management',                          'basic'),
  ('invoicing',           'Generate, send, and track invoices',                       'basic'),
  ('driver_management',   'Manage drivers, assignments, and driver pay',              'pro'),
  ('multi_user',          'Invite team members with role-based access control',       'pro'),
  ('accounts_receivable', 'AR aging reports, payment tracking, and statements',       'pro'),
  ('reporting_basic',     'Basic operational and financial reports',                   'pro'),
  ('api_access',          'REST API access for third-party integrations',             'enterprise'),
  ('custom_branding',     'Custom logo and branded invoices/documents',               'enterprise'),
  ('edi_integration',     'EDI 204/214/210 support for electronic data interchange', 'enterprise'),
  ('reporting_advanced',  'Advanced analytics and custom report builder',             'enterprise'),
  ('sso',                 'Single Sign-On via SAML/OIDC',                            'enterprise'),
  ('audit_log',           'Full tenant-level audit trail of all actions',             'enterprise');

-- -----------------------------------------------------------
-- FIRMS CODES
-- Loaded from existing firms_codes_with_coordinates.json
-- Use the seed script (supabase/scripts/seed_firms.js) to bulk insert
-- Below are a few representative entries as examples
-- -----------------------------------------------------------

-- NOTE: The full FIRMS dataset (745+ entries) should be loaded via the
-- seed script at supabase/scripts/seed_firms.js which reads from
-- public/data/firms_codes_with_coordinates.json and inserts into this table.

-- Example entries for verification:
INSERT INTO firms_codes (firms_code, name, facility_type, city, state, address, latitude, longitude) VALUES
  ('N035', 'AIR FREIGHT EXPRESS', 'TERMINAL', 'ATLANTA', 'GA', '8550 NW 61ST ST MIAMI, FLORIDA 33166', 25.8282405, -80.3365384),
  ('C324', 'PORTS AMERICA / SEAGIRT MARINE', 'TERMINAL', 'BALTIMORE', 'MD', '2600 BROENING HWY BALTIMORE, MARYLAND 21224', 39.2583695, -76.5375499),
  ('E416', 'APM TERMINALS', 'TERMINAL', 'LOS ANGELES', 'CA', '2500 NAVY WAY LOS ANGELES, CALIFORNIA 90731', 33.7454725, -118.2688069)
ON CONFLICT (firms_code) DO NOTHING;

-- -----------------------------------------------------------
-- ZIP CODES
-- The full US ZIP dataset (~42,000 entries) should be loaded via
-- supabase/scripts/seed_zips.js
-- Below are sample entries from existing data
-- -----------------------------------------------------------

INSERT INTO zip_codes (zip, city, state, latitude, longitude) VALUES
  ('07002', 'Bayonne', 'NJ', 40.6694, -74.1143),
  ('07114', 'Newark', 'NJ', 40.7191, -74.1742),
  ('10001', 'New York', 'NY', 40.7484, -73.9967),
  ('10004', 'New York', 'NY', 40.6989, -74.0381),
  ('11231', 'Brooklyn', 'NY', 40.6821, -73.9949),
  ('19148', 'Philadelphia', 'PA', 39.9136, -75.1505),
  ('21224', 'Baltimore', 'MD', 39.2765, -76.5497),
  ('23185', 'Williamsburg', 'VA', 37.2576, -76.7428),
  ('30301', 'Atlanta', 'GA', 33.8470, -84.3694),
  ('30354', 'Atlanta', 'GA', 33.6654, -84.3979),
  ('33010', 'Hialeah', 'FL', 25.8551, -80.2783),
  ('33166', 'Miami', 'FL', 25.8141, -80.3306),
  ('70094', 'Westwego', 'LA', 29.9088, -90.1365),
  ('77015', 'Houston', 'TX', 29.7544, -95.1596),
  ('77029', 'Houston', 'TX', 29.7236, -95.2656),
  ('90731', 'San Pedro', 'CA', 33.7289, -118.2830),
  ('90744', 'Wilmington', 'CA', 33.7864, -118.2659),
  ('90810', 'Long Beach', 'CA', 33.8176, -118.2124),
  ('98106', 'Seattle', 'WA', 47.5390, -122.3553),
  ('98421', 'Tacoma', 'WA', 47.2652, -122.4108)
ON CONFLICT (zip) DO NOTHING;
