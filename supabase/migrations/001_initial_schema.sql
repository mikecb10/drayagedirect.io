-- ============================================================
-- DrayageDirect: Initial Schema Migration
-- Multi-tenant SaaS for intermodal/drayage trucking
-- ============================================================

-- Required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- ============================================================
-- CUSTOM TYPES
-- ============================================================

CREATE TYPE subscription_tier_enum AS ENUM ('basic', 'pro', 'enterprise');
CREATE TYPE tenant_status_enum AS ENUM ('active', 'suspended', 'cancelled');
CREATE TYPE user_role_enum AS ENUM ('super_admin', 'admin', 'user');
CREATE TYPE user_status_enum AS ENUM ('active', 'disabled');
CREATE TYPE permission_type_enum AS ENUM (
  'order_entry', 'dispatching', 'accounts_payable',
  'accounts_receivable', 'reporting', 'settings', 'all'
);
CREATE TYPE order_status_enum AS ENUM (
  'pending', 'dispatched', 'in_transit', 'delivered', 'completed', 'cancelled'
);
CREATE TYPE invoice_status_enum AS ENUM (
  'draft', 'sent', 'paid', 'overdue', 'void'
);
CREATE TYPE driver_pay_type_enum AS ENUM ('per_mile', 'flat', 'percentage');
CREATE TYPE driver_pay_status_enum AS ENUM ('pending', 'approved', 'paid');
CREATE TYPE location_type_enum AS ENUM ('terminal', 'warehouse', 'customer_location', 'rail_yard');
CREATE TYPE container_size_enum AS ENUM ('20', '40', '40HC', '45');
CREATE TYPE origin_dest_type_enum AS ENUM ('FIRMS', 'ZIP', 'city', 'address');
CREATE TYPE billing_email_type_enum AS ENUM ('invoice', 'rate_confirmation', 'statement');
CREATE TYPE customer_contact_role_enum AS ENUM ('billing', 'operations', 'dispatch', 'management', 'primary');
CREATE TYPE charge_type_enum AS ENUM ('linehaul', 'accessorial', 'fuel_surcharge', 'detention', 'per_diem', 'other');
CREATE TYPE rate_profile_status_enum AS ENUM ('active', 'expired', 'draft');

-- ============================================================
-- LAYER 1: PLATFORM / GLOBAL TABLES (no tenant_id)
-- ============================================================

-- DD internal employees
CREATE TABLE dd_employees (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'support' CHECK (role IN ('super_admin', 'admin', 'support')),
  is_active BOOLEAN NOT NULL DEFAULT true,
  last_login_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Subscription tier definitions
CREATE TABLE subscription_tiers (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name subscription_tier_enum NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  monthly_price_cents INTEGER NOT NULL,
  annual_price_cents INTEGER NOT NULL,
  max_users INTEGER,
  max_drivers INTEGER,
  max_orders_per_month INTEGER,
  description TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Trucking carrier tenants (the "instances")
CREATE TABLE tenants (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  status tenant_status_enum NOT NULL DEFAULT 'active',
  subscription_tier_id UUID NOT NULL REFERENCES subscription_tiers(id),
  contact_email TEXT NOT NULL,
  contact_phone TEXT,
  address_line1 TEXT,
  address_city TEXT,
  address_state TEXT,
  address_zip TEXT,
  mc_number TEXT,
  dot_number TEXT,
  logo_url TEXT,
  trial_ends_at TIMESTAMPTZ,
  suspended_at TIMESTAMPTZ,
  suspended_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);

CREATE INDEX idx_tenants_slug ON tenants(slug);
CREATE INDEX idx_tenants_status ON tenants(status) WHERE deleted_at IS NULL;

-- Feature flag definitions
CREATE TABLE feature_flags (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL UNIQUE,
  description TEXT,
  tier_required subscription_tier_enum,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Per-tenant feature flag overrides
CREATE TABLE tenant_feature_flags (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  feature_flag_id UUID NOT NULL REFERENCES feature_flags(id) ON DELETE CASCADE,
  enabled BOOLEAN NOT NULL DEFAULT true,
  user_id UUID,  -- NULL = all users, specific UUID = per-user override
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, feature_flag_id, user_id)
);

CREATE INDEX idx_tenant_feature_flags_tenant ON tenant_feature_flags(tenant_id);

-- Account lockout tracking
CREATE TABLE account_lockouts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  email TEXT NOT NULL,
  user_type TEXT NOT NULL CHECK (user_type IN ('dd_employee', 'tenant_user')),
  tenant_id UUID REFERENCES tenants(id),
  failed_attempts INTEGER NOT NULL DEFAULT 0,
  locked_at TIMESTAMPTZ,
  last_failed_at TIMESTAMPTZ,
  unlocked_by UUID REFERENCES dd_employees(id),
  unlocked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_account_lockouts_email ON account_lockouts(email);

-- DD admin audit log
CREATE TABLE admin_audit_log (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  dd_employee_id UUID NOT NULL REFERENCES dd_employees(id),
  action TEXT NOT NULL,
  target_tenant_id UUID REFERENCES tenants(id),
  target_user_id UUID,
  details JSONB,
  ip_address INET,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_admin_audit_log_employee ON admin_audit_log(dd_employee_id);
CREATE INDEX idx_admin_audit_log_tenant ON admin_audit_log(target_tenant_id);
CREATE INDEX idx_admin_audit_log_created ON admin_audit_log(created_at DESC);

-- ============================================================
-- LAYER 2: SHARED REFERENCE DATA (read-only for tenants)
-- ============================================================

CREATE TABLE firms_codes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  firms_code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  facility_type TEXT NOT NULL DEFAULT 'TERMINAL',
  address TEXT,
  city TEXT NOT NULL,
  state TEXT NOT NULL,
  zip TEXT,
  latitude NUMERIC(10, 7),
  longitude NUMERIC(10, 7),
  port_name TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_firms_codes_code ON firms_codes(firms_code);
CREATE INDEX idx_firms_codes_city_state ON firms_codes(city, state);
CREATE INDEX idx_firms_codes_code_upper ON firms_codes(upper(firms_code));

CREATE TABLE zip_codes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  zip TEXT NOT NULL UNIQUE,
  city TEXT NOT NULL,
  state TEXT NOT NULL,
  county TEXT,
  latitude NUMERIC(10, 7) NOT NULL,
  longitude NUMERIC(10, 7) NOT NULL,
  timezone TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_zip_codes_zip ON zip_codes(zip);
CREATE INDEX idx_zip_codes_city_state ON zip_codes(city, state);

-- ============================================================
-- LAYER 3: TENANT-SCOPED TABLES (all have tenant_id + RLS)
-- ============================================================

-- -----------------------------------------------------------
-- USERS & AUTH
-- -----------------------------------------------------------

CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  auth_uid TEXT UNIQUE,
  email TEXT NOT NULL,
  name TEXT NOT NULL,
  phone TEXT,
  age INTEGER,
  hire_date DATE,
  role user_role_enum NOT NULL DEFAULT 'user',
  status user_status_enum NOT NULL DEFAULT 'active',
  temp_password_flag BOOLEAN NOT NULL DEFAULT false,
  password_change_required BOOLEAN NOT NULL DEFAULT false,
  login_attempts INTEGER NOT NULL DEFAULT 0,
  locked_at TIMESTAMPTZ,
  last_login_at TIMESTAMPTZ,
  avatar_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ,
  UNIQUE (tenant_id, email)
);

CREATE INDEX idx_users_tenant ON users(tenant_id);
CREATE INDEX idx_users_tenant_email ON users(tenant_id, email);
CREATE INDEX idx_users_auth_uid ON users(auth_uid);
CREATE INDEX idx_users_tenant_role ON users(tenant_id, role) WHERE deleted_at IS NULL;

CREATE TABLE user_permissions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  permission_type permission_type_enum NOT NULL,
  granted_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, user_id, permission_type)
);

CREATE INDEX idx_user_permissions_tenant_user ON user_permissions(tenant_id, user_id);

CREATE TABLE user_invites (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  role user_role_enum NOT NULL DEFAULT 'user',
  invited_by UUID NOT NULL REFERENCES users(id),
  token TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  accepted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_user_invites_tenant ON user_invites(tenant_id);
CREATE INDEX idx_user_invites_token ON user_invites(token);

-- -----------------------------------------------------------
-- CUSTOMER MANAGEMENT
-- -----------------------------------------------------------

CREATE TABLE customers (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  short_name TEXT,
  customer_type TEXT CHECK (customer_type IN ('shipper', 'consignee', 'bco', 'freight_forwarder', 'other')),
  billing_email TEXT,
  phone TEXT,
  address_line1 TEXT,
  address_line2 TEXT,
  city TEXT,
  state TEXT,
  zip TEXT,
  payment_terms INTEGER NOT NULL DEFAULT 30,
  credit_limit_cents INTEGER,
  tax_id TEXT,
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'on_hold')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);

CREATE INDEX idx_customers_tenant ON customers(tenant_id);
CREATE INDEX idx_customers_tenant_name ON customers(tenant_id, name);
CREATE INDEX idx_customers_tenant_status ON customers(tenant_id, status) WHERE deleted_at IS NULL;
CREATE INDEX idx_customers_name_trgm ON customers USING gin (name gin_trgm_ops);

CREATE TABLE customer_contacts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  role customer_contact_role_enum NOT NULL DEFAULT 'primary',
  is_primary BOOLEAN NOT NULL DEFAULT false,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_customer_contacts_tenant_customer ON customer_contacts(tenant_id, customer_id);

CREATE TABLE customer_billing_emails (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  email_type billing_email_type_enum NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, customer_id, email, email_type)
);

CREATE INDEX idx_customer_billing_emails_tenant_customer ON customer_billing_emails(tenant_id, customer_id);

-- -----------------------------------------------------------
-- RATE MANAGEMENT
-- -----------------------------------------------------------

CREATE TABLE rate_profiles (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  customer_id UUID REFERENCES customers(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  effective_date DATE NOT NULL,
  expiration_date DATE,
  status rate_profile_status_enum NOT NULL DEFAULT 'draft',
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);

CREATE INDEX idx_rate_profiles_tenant ON rate_profiles(tenant_id);
CREATE INDEX idx_rate_profiles_tenant_customer ON rate_profiles(tenant_id, customer_id);
CREATE INDEX idx_rate_profiles_tenant_active_dates ON rate_profiles(tenant_id, effective_date, expiration_date)
  WHERE status = 'active' AND deleted_at IS NULL;

CREATE TABLE rates (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  rate_profile_id UUID NOT NULL REFERENCES rate_profiles(id) ON DELETE CASCADE,
  origin_type origin_dest_type_enum NOT NULL,
  origin_value TEXT NOT NULL,
  destination_type origin_dest_type_enum NOT NULL,
  destination_value TEXT NOT NULL,
  container_size container_size_enum NOT NULL,
  rate_amount_cents INTEGER NOT NULL,
  rate_per_mile_cents INTEGER,
  min_charge_cents INTEGER,
  fuel_surcharge_pct NUMERIC(5, 2) DEFAULT 0,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_rates_tenant_profile ON rates(tenant_id, rate_profile_id);
CREATE INDEX idx_rates_tenant_origin ON rates(tenant_id, origin_type, origin_value);
CREATE INDEX idx_rates_tenant_dest ON rates(tenant_id, destination_type, destination_value);

CREATE TABLE accessorial_charges (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  code TEXT,
  description TEXT,
  default_amount_cents INTEGER NOT NULL,
  is_billable BOOLEAN NOT NULL DEFAULT true,
  is_payable BOOLEAN NOT NULL DEFAULT false,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, name)
);

CREATE INDEX idx_accessorial_charges_tenant ON accessorial_charges(tenant_id);

-- -----------------------------------------------------------
-- DRIVERS (created before orders for FK)
-- -----------------------------------------------------------

CREATE TABLE drivers (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  phone TEXT,
  email TEXT,
  license_number TEXT,
  license_state TEXT,
  license_expiry DATE,
  truck_number TEXT,
  trailer_number TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'on_leave')),
  pay_type driver_pay_type_enum NOT NULL DEFAULT 'flat',
  pay_rate_cents INTEGER,
  pay_percentage NUMERIC(5, 2),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);

CREATE INDEX idx_drivers_tenant ON drivers(tenant_id);
CREATE INDEX idx_drivers_tenant_active ON drivers(tenant_id) WHERE status = 'active' AND deleted_at IS NULL;

-- -----------------------------------------------------------
-- ORDERS / LOADS
-- -----------------------------------------------------------

CREATE TABLE orders (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  order_number TEXT NOT NULL,
  customer_id UUID NOT NULL REFERENCES customers(id),
  status order_status_enum NOT NULL DEFAULT 'pending',

  -- Origin
  origin_firms_code TEXT,
  origin_address TEXT,
  origin_city TEXT,
  origin_state TEXT,
  origin_zip TEXT,
  origin_lat NUMERIC(10, 7),
  origin_lon NUMERIC(10, 7),

  -- Destination
  destination_address TEXT,
  destination_city TEXT,
  destination_state TEXT,
  destination_zip TEXT,
  destination_lat NUMERIC(10, 7),
  destination_lon NUMERIC(10, 7),

  -- Container
  container_number TEXT,
  container_size container_size_enum,
  seal_number TEXT,
  chassis_number TEXT,
  weight_lbs INTEGER,
  is_overweight BOOLEAN NOT NULL DEFAULT false,
  is_hazmat BOOLEAN NOT NULL DEFAULT false,

  -- Dates
  pickup_date DATE,
  delivery_date DATE,
  cutoff_date TIMESTAMPTZ,
  last_free_day DATE,
  actual_pickup_at TIMESTAMPTZ,
  actual_delivery_at TIMESTAMPTZ,

  -- References
  bill_of_lading TEXT,
  booking_number TEXT,
  po_numbers TEXT[],
  customer_reference TEXT,
  steamship_line TEXT,

  -- Distance
  estimated_miles NUMERIC(8, 2),
  actual_miles NUMERIC(8, 2),

  -- Financial
  total_charges_cents INTEGER NOT NULL DEFAULT 0,
  total_driver_pay_cents INTEGER NOT NULL DEFAULT 0,
  profit_cents INTEGER GENERATED ALWAYS AS (total_charges_cents - total_driver_pay_cents) STORED,

  -- Assignment
  driver_id UUID REFERENCES drivers(id),
  dispatcher_id UUID REFERENCES users(id),
  dispatched_at TIMESTAMPTZ,

  -- Metadata
  notes TEXT,
  internal_notes TEXT,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ,
  UNIQUE (tenant_id, order_number)
);

CREATE INDEX idx_orders_tenant ON orders(tenant_id);
CREATE INDEX idx_orders_tenant_status ON orders(tenant_id, status) WHERE deleted_at IS NULL;
CREATE INDEX idx_orders_tenant_customer ON orders(tenant_id, customer_id);
CREATE INDEX idx_orders_tenant_driver ON orders(tenant_id, driver_id);
CREATE INDEX idx_orders_tenant_pickup_date ON orders(tenant_id, pickup_date);
CREATE INDEX idx_orders_tenant_order_number ON orders(tenant_id, order_number);
CREATE INDEX idx_orders_tenant_status_pickup ON orders(tenant_id, status, pickup_date DESC) WHERE deleted_at IS NULL;
CREATE INDEX idx_orders_tenant_bol ON orders(tenant_id, bill_of_lading) WHERE bill_of_lading IS NOT NULL;
CREATE INDEX idx_orders_tenant_container ON orders(tenant_id, container_number) WHERE container_number IS NOT NULL;

CREATE TABLE order_charges (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  accessorial_charge_id UUID REFERENCES accessorial_charges(id),
  description TEXT NOT NULL,
  charge_type charge_type_enum NOT NULL,
  amount_cents INTEGER NOT NULL,
  is_billable BOOLEAN NOT NULL DEFAULT true,
  is_payable BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_order_charges_tenant_order ON order_charges(tenant_id, order_id);

CREATE TABLE order_status_history (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  old_status order_status_enum,
  new_status order_status_enum NOT NULL,
  changed_by UUID REFERENCES users(id),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_order_status_history_tenant_order ON order_status_history(tenant_id, order_id);

-- -----------------------------------------------------------
-- DRIVER PAY
-- -----------------------------------------------------------

CREATE TABLE driver_pay (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  driver_id UUID NOT NULL REFERENCES drivers(id),
  order_id UUID NOT NULL REFERENCES orders(id),
  amount_cents INTEGER NOT NULL,
  pay_type driver_pay_type_enum NOT NULL,
  status driver_pay_status_enum NOT NULL DEFAULT 'pending',
  approved_by UUID REFERENCES users(id),
  approved_at TIMESTAMPTZ,
  paid_date DATE,
  check_number TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_driver_pay_tenant_driver ON driver_pay(tenant_id, driver_id);
CREATE INDEX idx_driver_pay_tenant_status ON driver_pay(tenant_id, status);
CREATE INDEX idx_driver_pay_tenant_order ON driver_pay(tenant_id, order_id);

-- -----------------------------------------------------------
-- BILLING / INVOICING
-- -----------------------------------------------------------

CREATE TABLE invoices (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  invoice_number TEXT NOT NULL,
  customer_id UUID NOT NULL REFERENCES customers(id),
  status invoice_status_enum NOT NULL DEFAULT 'draft',
  subtotal_cents INTEGER NOT NULL DEFAULT 0,
  tax_cents INTEGER NOT NULL DEFAULT 0,
  total_amount_cents INTEGER NOT NULL DEFAULT 0,
  due_date DATE NOT NULL,
  sent_to_emails TEXT[],
  sent_at TIMESTAMPTZ,
  paid_at TIMESTAMPTZ,
  void_reason TEXT,
  notes TEXT,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ,
  UNIQUE (tenant_id, invoice_number)
);

CREATE INDEX idx_invoices_tenant ON invoices(tenant_id);
CREATE INDEX idx_invoices_tenant_customer ON invoices(tenant_id, customer_id);
CREATE INDEX idx_invoices_tenant_status ON invoices(tenant_id, status) WHERE deleted_at IS NULL;
CREATE INDEX idx_invoices_tenant_due_date ON invoices(tenant_id, due_date);
CREATE INDEX idx_invoices_tenant_unpaid ON invoices(tenant_id, due_date)
  WHERE status IN ('sent', 'overdue') AND deleted_at IS NULL;

CREATE TABLE invoice_orders (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  invoice_id UUID NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  order_id UUID NOT NULL REFERENCES orders(id),
  UNIQUE (tenant_id, invoice_id, order_id)
);

CREATE INDEX idx_invoice_orders_tenant_invoice ON invoice_orders(tenant_id, invoice_id);
CREATE INDEX idx_invoice_orders_tenant_order ON invoice_orders(tenant_id, order_id);

CREATE TABLE invoice_line_items (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  invoice_id UUID NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  order_id UUID REFERENCES orders(id),
  description TEXT NOT NULL,
  charge_type charge_type_enum NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 1,
  unit_amount_cents INTEGER NOT NULL,
  total_amount_cents INTEGER NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_invoice_line_items_tenant_invoice ON invoice_line_items(tenant_id, invoice_id);

CREATE TABLE payments_received (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  invoice_id UUID NOT NULL REFERENCES invoices(id),
  amount_cents INTEGER NOT NULL,
  payment_method TEXT CHECK (payment_method IN ('check', 'ach', 'wire', 'credit_card', 'cash', 'other')),
  payment_date DATE NOT NULL,
  reference_number TEXT,
  notes TEXT,
  recorded_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_payments_received_tenant ON payments_received(tenant_id);
CREATE INDEX idx_payments_received_tenant_invoice ON payments_received(tenant_id, invoice_id);

-- -----------------------------------------------------------
-- LOCATIONS (tenant-scoped custom locations)
-- -----------------------------------------------------------

CREATE TABLE locations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  location_type location_type_enum NOT NULL DEFAULT 'warehouse',
  address TEXT,
  city TEXT,
  state TEXT,
  zip TEXT,
  firms_code TEXT,
  latitude NUMERIC(10, 7),
  longitude NUMERIC(10, 7),
  contact_name TEXT,
  contact_phone TEXT,
  notes TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_locations_tenant ON locations(tenant_id);
CREATE INDEX idx_locations_tenant_type ON locations(tenant_id, location_type);

-- -----------------------------------------------------------
-- TENANT AUDIT LOG
-- -----------------------------------------------------------

CREATE TABLE tenant_audit_log (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id),
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id UUID,
  old_values JSONB,
  new_values JSONB,
  ip_address INET,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_tenant_audit_log_tenant ON tenant_audit_log(tenant_id);
CREATE INDEX idx_tenant_audit_log_tenant_entity ON tenant_audit_log(tenant_id, entity_type, entity_id);
CREATE INDEX idx_tenant_audit_log_created ON tenant_audit_log(tenant_id, created_at DESC);

-- -----------------------------------------------------------
-- TENANT SETTINGS
-- -----------------------------------------------------------

CREATE TABLE tenant_settings (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE UNIQUE,
  company_display_name TEXT,
  default_payment_terms INTEGER DEFAULT 30,
  invoice_prefix TEXT DEFAULT 'INV',
  order_prefix TEXT DEFAULT 'ORD',
  next_invoice_number INTEGER DEFAULT 1001,
  next_order_number INTEGER DEFAULT 1001,
  default_fuel_surcharge_pct NUMERIC(5, 2) DEFAULT 0,
  labor_fee_cents INTEGER DEFAULT 0,
  quote_validity_days INTEGER DEFAULT 30,
  timezone TEXT DEFAULT 'America/New_York',
  date_format TEXT DEFAULT 'MM/DD/YYYY',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- FUNCTIONS
-- ============================================================

-- Auto-update updated_at trigger
CREATE OR REPLACE FUNCTION trigger_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply updated_at trigger to all relevant tables
DO $$
DECLARE
  tbl TEXT;
BEGIN
  FOR tbl IN
    SELECT unnest(ARRAY[
      'dd_employees', 'subscription_tiers', 'tenants', 'feature_flags',
      'tenant_feature_flags', 'account_lockouts', 'firms_codes',
      'users', 'user_permissions', 'customers', 'customer_contacts',
      'customer_billing_emails', 'rate_profiles', 'rates',
      'accessorial_charges', 'orders', 'order_charges', 'drivers',
      'driver_pay', 'invoices', 'invoice_line_items', 'payments_received',
      'locations', 'tenant_settings'
    ])
  LOOP
    EXECUTE format(
      'CREATE TRIGGER set_updated_at BEFORE UPDATE ON %I
       FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at()',
      tbl
    );
  END LOOP;
END;
$$;

-- Generate next order number for a tenant
CREATE OR REPLACE FUNCTION next_order_number(p_tenant_id UUID)
RETURNS TEXT AS $$
DECLARE
  v_prefix TEXT;
  v_next INTEGER;
BEGIN
  UPDATE tenant_settings
  SET next_order_number = next_order_number + 1,
      updated_at = now()
  WHERE tenant_id = p_tenant_id
  RETURNING order_prefix, next_order_number - 1 INTO v_prefix, v_next;

  RETURN v_prefix || '-' || LPAD(v_next::TEXT, 6, '0');
END;
$$ LANGUAGE plpgsql;

-- Generate next invoice number for a tenant
CREATE OR REPLACE FUNCTION next_invoice_number(p_tenant_id UUID)
RETURNS TEXT AS $$
DECLARE
  v_prefix TEXT;
  v_next INTEGER;
BEGIN
  UPDATE tenant_settings
  SET next_invoice_number = next_invoice_number + 1,
      updated_at = now()
  WHERE tenant_id = p_tenant_id
  RETURNING invoice_prefix, next_invoice_number - 1 INTO v_prefix, v_next;

  RETURN v_prefix || '-' || LPAD(v_next::TEXT, 6, '0');
END;
$$ LANGUAGE plpgsql;

-- Seed default data for a new tenant
CREATE OR REPLACE FUNCTION seed_new_tenant(p_tenant_id UUID)
RETURNS VOID AS $$
BEGIN
  -- Create tenant_settings with defaults
  INSERT INTO tenant_settings (tenant_id)
  VALUES (p_tenant_id)
  ON CONFLICT (tenant_id) DO NOTHING;

  -- Seed default accessorial charges
  INSERT INTO accessorial_charges (tenant_id, name, code, default_amount_cents, is_billable, is_payable) VALUES
    (p_tenant_id, 'Pre-Pull',       'PP',  12500, true, true),
    (p_tenant_id, 'Chassis Split',  'CS',   9000, true, false),
    (p_tenant_id, 'Overweight',     'OW',  17500, true, true),
    (p_tenant_id, 'Drop & Pick',    'DP',  15000, true, true),
    (p_tenant_id, 'Liftgate',       'LG',   7500, true, false),
    (p_tenant_id, 'Detention',      'DT',   7500, true, true),
    (p_tenant_id, 'Per Diem',       'PD',  15000, true, false),
    (p_tenant_id, 'Hazmat',         'HZ',  35000, true, true),
    (p_tenant_id, 'Reefer',         'RF',  25000, true, true),
    (p_tenant_id, 'Tri-Axle',       'TA',  20000, true, true);

  -- Enable feature flags based on subscription tier
  INSERT INTO tenant_feature_flags (tenant_id, feature_flag_id, enabled)
  SELECT p_tenant_id, ff.id, true
  FROM feature_flags ff
  JOIN tenants t ON t.id = p_tenant_id
  JOIN subscription_tiers st ON st.id = t.subscription_tier_id
  WHERE ff.tier_required IS NOT NULL
    AND CASE
      WHEN st.name = 'enterprise' THEN true
      WHEN st.name = 'pro' THEN ff.tier_required IN ('basic', 'pro')
      WHEN st.name = 'basic' THEN ff.tier_required = 'basic'
      ELSE false
    END;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================

-- Helper: get current tenant from JWT or session variable
CREATE OR REPLACE FUNCTION current_tenant_id()
RETURNS UUID AS $$
BEGIN
  RETURN COALESCE(
    (current_setting('request.jwt.claims', true)::json->>'tenant_id')::UUID,
    (current_setting('app.current_tenant', true))::UUID
  );
EXCEPTION
  WHEN OTHERS THEN RETURN NULL;
END;
$$ LANGUAGE plpgsql STABLE;

-- Helper: check if current session is a DD admin
CREATE OR REPLACE FUNCTION is_dd_admin()
RETURNS BOOLEAN AS $$
BEGIN
  RETURN COALESCE(
    (current_setting('app.is_dd_admin', true))::BOOLEAN,
    false
  );
EXCEPTION
  WHEN OTHERS THEN RETURN false;
END;
$$ LANGUAGE plpgsql STABLE;

-- Enable RLS and create policies on all tenant-scoped tables
DO $$
DECLARE
  tbl TEXT;
BEGIN
  FOR tbl IN
    SELECT unnest(ARRAY[
      'users', 'user_permissions', 'user_invites',
      'customers', 'customer_contacts', 'customer_billing_emails',
      'rate_profiles', 'rates', 'accessorial_charges',
      'orders', 'order_charges', 'order_status_history',
      'drivers', 'driver_pay',
      'invoices', 'invoice_orders', 'invoice_line_items', 'payments_received',
      'locations', 'tenant_audit_log', 'tenant_settings'
    ])
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', tbl);

    EXECUTE format(
      'CREATE POLICY %I ON %I FOR SELECT
       USING (tenant_id = current_tenant_id() OR is_dd_admin())',
      'tenant_isolation_select_' || tbl, tbl
    );

    EXECUTE format(
      'CREATE POLICY %I ON %I FOR INSERT
       WITH CHECK (tenant_id = current_tenant_id() OR is_dd_admin())',
      'tenant_isolation_insert_' || tbl, tbl
    );

    EXECUTE format(
      'CREATE POLICY %I ON %I FOR UPDATE
       USING (tenant_id = current_tenant_id() OR is_dd_admin())
       WITH CHECK (tenant_id = current_tenant_id() OR is_dd_admin())',
      'tenant_isolation_update_' || tbl, tbl
    );

    EXECUTE format(
      'CREATE POLICY %I ON %I FOR DELETE
       USING (tenant_id = current_tenant_id() OR is_dd_admin())',
      'tenant_isolation_delete_' || tbl, tbl
    );
  END LOOP;
END;
$$;

-- RLS for shared reference tables (read-only for all, write for DD admins)
ALTER TABLE firms_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE zip_codes ENABLE ROW LEVEL SECURITY;

CREATE POLICY firms_codes_read_all ON firms_codes FOR SELECT USING (true);
CREATE POLICY firms_codes_admin_write ON firms_codes FOR INSERT WITH CHECK (is_dd_admin());
CREATE POLICY firms_codes_admin_update ON firms_codes FOR UPDATE USING (is_dd_admin());
CREATE POLICY firms_codes_admin_delete ON firms_codes FOR DELETE USING (is_dd_admin());

CREATE POLICY zip_codes_read_all ON zip_codes FOR SELECT USING (true);
CREATE POLICY zip_codes_admin_write ON zip_codes FOR INSERT WITH CHECK (is_dd_admin());
CREATE POLICY zip_codes_admin_update ON zip_codes FOR UPDATE USING (is_dd_admin());
CREATE POLICY zip_codes_admin_delete ON zip_codes FOR DELETE USING (is_dd_admin());
