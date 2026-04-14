-- ============================================================
-- DrayageDirect: Phase 5a — Master Data Migration
-- Organizations, Contact Groups, Drivers extensions, Equipment
-- ============================================================

-- ============================================================
-- EXTEND customers TABLE (now "Organizations")
-- ============================================================

ALTER TABLE customers ADD COLUMN IF NOT EXISTS customer_types TEXT[] DEFAULT ARRAY['customer'];
ALTER TABLE customers ADD COLUMN IF NOT EXISTS profile_label TEXT;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS tracking_status TEXT;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS market TEXT;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS mc_number TEXT;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS country TEXT DEFAULT 'US';
ALTER TABLE customers ADD COLUMN IF NOT EXISTS receiver_email TEXT;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS quickbooks_email TEXT;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS quickbooks_company_field TEXT;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS company_domain TEXT;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS currency TEXT DEFAULT 'USD';
ALTER TABLE customers ADD COLUMN IF NOT EXISTS payment_term_method TEXT DEFAULT 'daily';
ALTER TABLE customers ADD COLUMN IF NOT EXISTS payment_terms_from TEXT DEFAULT 'invoice_date';
ALTER TABLE customers ADD COLUMN IF NOT EXISTS account_hold BOOLEAN DEFAULT false;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS office_hour_start TIME;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS office_hour_end TIME;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS main_contact_name TEXT;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS main_phone TEXT;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS secondary_contact_name TEXT;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS secondary_phone TEXT;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS sales_agent_id UUID REFERENCES users(id);
ALTER TABLE customers ADD COLUMN IF NOT EXISTS organization_subtype TEXT;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS portal_enabled BOOLEAN DEFAULT false;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS portal_admin_email TEXT;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS parent_organization_id UUID REFERENCES customers(id);
ALTER TABLE customers ADD COLUMN IF NOT EXISTS can_edit_load BOOLEAN DEFAULT false;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS tags TEXT[];

-- Index for customer type filtering
CREATE INDEX IF NOT EXISTS idx_customers_tenant_types ON customers USING GIN (tenant_id, customer_types) WHERE deleted_at IS NULL;

-- ============================================================
-- EXTEND drivers TABLE
-- ============================================================

-- Personal
ALTER TABLE drivers ADD COLUMN IF NOT EXISTS first_name TEXT;
ALTER TABLE drivers ADD COLUMN IF NOT EXISTS last_name TEXT;
ALTER TABLE drivers ADD COLUMN IF NOT EXISTS username TEXT;
ALTER TABLE drivers ADD COLUMN IF NOT EXISTS date_of_birth DATE;
ALTER TABLE drivers ADD COLUMN IF NOT EXISTS date_of_hire DATE;
ALTER TABLE drivers ADD COLUMN IF NOT EXISTS billing_email TEXT;
ALTER TABLE drivers ADD COLUMN IF NOT EXISTS home_branch_timezone TEXT;
ALTER TABLE drivers ADD COLUMN IF NOT EXISTS default_start_location TEXT;
ALTER TABLE drivers ADD COLUMN IF NOT EXISTS driver_tags TEXT[];
ALTER TABLE drivers ADD COLUMN IF NOT EXISTS profile_type TEXT;

-- Expiration dates
ALTER TABLE drivers ADD COLUMN IF NOT EXISTS medical_exp DATE;
ALTER TABLE drivers ADD COLUMN IF NOT EXISTS twic_exp DATE;
ALTER TABLE drivers ADD COLUMN IF NOT EXISTS sea_link_exp DATE;
ALTER TABLE drivers ADD COLUMN IF NOT EXISTS ocac_insurance_exp DATE;
ALTER TABLE drivers ADD COLUMN IF NOT EXISTS termination_date DATE;

-- Documents
ALTER TABLE drivers ADD COLUMN IF NOT EXISTS sealink_number TEXT;
ALTER TABLE drivers ADD COLUMN IF NOT EXISTS register_business_name TEXT;
ALTER TABLE drivers ADD COLUMN IF NOT EXISTS hst_number TEXT;
ALTER TABLE drivers ADD COLUMN IF NOT EXISTS social_security TEXT;
ALTER TABLE drivers ADD COLUMN IF NOT EXISTS tablet_number TEXT;
ALTER TABLE drivers ADD COLUMN IF NOT EXISTS eld_number TEXT;
ALTER TABLE drivers ADD COLUMN IF NOT EXISTS eld_connected BOOLEAN DEFAULT false;
ALTER TABLE drivers ADD COLUMN IF NOT EXISTS fuel_card TEXT;
ALTER TABLE drivers ADD COLUMN IF NOT EXISTS ez_pass TEXT;
ALTER TABLE drivers ADD COLUMN IF NOT EXISTS bank_account TEXT;
ALTER TABLE drivers ADD COLUMN IF NOT EXISTS routing_number TEXT;

-- Other
ALTER TABLE drivers ADD COLUMN IF NOT EXISTS emergency_contact_name TEXT;
ALTER TABLE drivers ADD COLUMN IF NOT EXISTS emergency_relation TEXT;
ALTER TABLE drivers ADD COLUMN IF NOT EXISTS emergency_phone TEXT;
ALTER TABLE drivers ADD COLUMN IF NOT EXISTS truck_owner TEXT;
ALTER TABLE drivers ADD COLUMN IF NOT EXISTS carrier_name TEXT;
ALTER TABLE drivers ADD COLUMN IF NOT EXISTS main_office_address TEXT;
ALTER TABLE drivers ADD COLUMN IF NOT EXISTS tshirt_size TEXT;
ALTER TABLE drivers ADD COLUMN IF NOT EXISTS permanent_address TEXT;

-- Preferences
ALTER TABLE drivers ADD COLUMN IF NOT EXISTS driver_shift TEXT DEFAULT 'day';
ALTER TABLE drivers ADD COLUMN IF NOT EXISTS preferred_states TEXT[];
ALTER TABLE drivers ADD COLUMN IF NOT EXISTS preferred_load_types TEXT[];
ALTER TABLE drivers ADD COLUMN IF NOT EXISTS min_miles INTEGER;
ALTER TABLE drivers ADD COLUMN IF NOT EXISTS max_miles INTEGER;
ALTER TABLE drivers ADD COLUMN IF NOT EXISTS restricted_locations TEXT[];
ALTER TABLE drivers ADD COLUMN IF NOT EXISTS preferred_event_types TEXT[];
ALTER TABLE drivers ADD COLUMN IF NOT EXISTS preferred_chassis_types TEXT[];
ALTER TABLE drivers ADD COLUMN IF NOT EXISTS preferred_container_types TEXT[];

-- Endorsements as JSONB
ALTER TABLE drivers ADD COLUMN IF NOT EXISTS endorsements JSONB DEFAULT '{}'::jsonb;

-- Financial
ALTER TABLE drivers ADD COLUMN IF NOT EXISTS hst_pct NUMERIC(5, 2);
ALTER TABLE drivers ADD COLUMN IF NOT EXISTS disable_driver_pay BOOLEAN DEFAULT false;
ALTER TABLE drivers ADD COLUMN IF NOT EXISTS hide_settlements BOOLEAN DEFAULT false;

-- Mobile permissions as JSONB
ALTER TABLE drivers ADD COLUMN IF NOT EXISTS mobile_permissions JSONB DEFAULT '{}'::jsonb;

-- Unique username per tenant (if set)
CREATE UNIQUE INDEX IF NOT EXISTS idx_drivers_tenant_username ON drivers(tenant_id, username) WHERE username IS NOT NULL AND deleted_at IS NULL;

-- ============================================================
-- NEW TABLE: customer_contact_groups
-- ============================================================

CREATE TABLE IF NOT EXISTS customer_contact_groups (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  purpose TEXT,
  is_default_for_purpose BOOLEAN NOT NULL DEFAULT false,
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, customer_id, name)
);

CREATE INDEX IF NOT EXISTS idx_contact_groups_tenant_customer ON customer_contact_groups(tenant_id, customer_id);

-- ============================================================
-- NEW TABLE: customer_contact_group_members
-- ============================================================

CREATE TABLE IF NOT EXISTS customer_contact_group_members (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  group_id UUID NOT NULL REFERENCES customer_contact_groups(id) ON DELETE CASCADE,
  contact_id UUID NOT NULL REFERENCES customer_contacts(id) ON DELETE CASCADE,
  added_by UUID REFERENCES users(id),
  added_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, group_id, contact_id)
);

CREATE INDEX IF NOT EXISTS idx_group_members_tenant_group ON customer_contact_group_members(tenant_id, group_id);
CREATE INDEX IF NOT EXISTS idx_group_members_tenant_contact ON customer_contact_group_members(tenant_id, contact_id);

-- ============================================================
-- NEW TABLE: equipment_trucks
-- ============================================================

CREATE TABLE IF NOT EXISTS equipment_trucks (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  truck_number TEXT NOT NULL,
  truck_owner TEXT,
  license_plate TEXT,
  license_plate_state TEXT,
  vin TEXT,
  address TEXT,
  year INTEGER,
  make TEXT,
  model TEXT,
  annual_inspection_date DATE,
  registration_exp DATE,
  inspection_exp DATE,
  hut_exp DATE,
  itd_number TEXT,
  use_for_pre_appointment BOOLEAN DEFAULT false,
  is_enabled BOOLEAN NOT NULL DEFAULT true,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ,
  UNIQUE (tenant_id, truck_number)
);

CREATE INDEX IF NOT EXISTS idx_trucks_tenant_enabled ON equipment_trucks(tenant_id) WHERE is_enabled = true AND deleted_at IS NULL;

-- ============================================================
-- NEW TABLE: equipment_chassis
-- ============================================================

CREATE TABLE IF NOT EXISTS equipment_chassis (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  chassis_number TEXT NOT NULL,
  chassis_owner TEXT,
  chassis_type TEXT,
  chassis_size TEXT,
  license_plate TEXT,
  license_plate_state TEXT,
  vin TEXT,
  registration_exp DATE,
  inspection_exp DATE,
  gps_device_id TEXT,
  is_enabled BOOLEAN NOT NULL DEFAULT true,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ,
  UNIQUE (tenant_id, chassis_number)
);

CREATE INDEX IF NOT EXISTS idx_chassis_tenant_enabled ON equipment_chassis(tenant_id) WHERE is_enabled = true AND deleted_at IS NULL;

-- ============================================================
-- NEW TABLE: equipment_trailers
-- ============================================================

CREATE TABLE IF NOT EXISTS equipment_trailers (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  trailer_number TEXT NOT NULL,
  trailer_owner TEXT,
  trailer_type TEXT,
  license_plate TEXT,
  license_plate_state TEXT,
  vin TEXT,
  registration_exp DATE,
  inspection_exp DATE,
  is_enabled BOOLEAN NOT NULL DEFAULT true,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ,
  UNIQUE (tenant_id, trailer_number)
);

CREATE INDEX IF NOT EXISTS idx_trailers_tenant_enabled ON equipment_trailers(tenant_id) WHERE is_enabled = true AND deleted_at IS NULL;

-- ============================================================
-- TRIGGERS: updated_at auto-update
-- ============================================================

DO $$
DECLARE
  tbl TEXT;
BEGIN
  FOR tbl IN
    SELECT unnest(ARRAY[
      'customer_contact_groups',
      'equipment_trucks',
      'equipment_chassis',
      'equipment_trailers'
    ])
  LOOP
    -- Drop existing trigger if present (idempotent)
    EXECUTE format('DROP TRIGGER IF EXISTS set_updated_at ON %I', tbl);
    EXECUTE format(
      'CREATE TRIGGER set_updated_at BEFORE UPDATE ON %I
       FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at()',
      tbl
    );
  END LOOP;
END;
$$;

-- ============================================================
-- ROW LEVEL SECURITY + POLICIES (mirror 001 pattern)
-- ============================================================

DO $$
DECLARE
  tbl TEXT;
BEGIN
  FOR tbl IN
    SELECT unnest(ARRAY[
      'customer_contact_groups',
      'customer_contact_group_members',
      'equipment_trucks',
      'equipment_chassis',
      'equipment_trailers'
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

-- ============================================================
-- DONE
-- ============================================================
