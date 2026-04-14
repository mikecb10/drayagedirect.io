-- ============================================================
-- DrayageDirect: Phase 5b-1 — Loads Foundation Migration
-- Extends orders table + new loads-related tables + seed routing templates
-- ============================================================

-- ============================================================
-- EXTEND orders TABLE
-- ============================================================

-- Load type + routing
ALTER TABLE orders ADD COLUMN IF NOT EXISTS load_type TEXT DEFAULT 'import'; -- import | export | road | bill_only
ALTER TABLE orders ADD COLUMN IF NOT EXISTS routing_template_id UUID;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS routing_template_name TEXT;

-- Location foreign keys (Organizations)
ALTER TABLE orders ADD COLUMN IF NOT EXISTS pickup_location_id UUID REFERENCES customers(id);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_location_id UUID REFERENCES customers(id);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS return_location_id UUID REFERENCES customers(id);

-- Drayage-specific dates (pickup_date, delivery_date, cutoff_date, last_free_day exist in 001)
ALTER TABLE orders ADD COLUMN IF NOT EXISTS vessel_eta DATE;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS discharge_date DATE;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS outgate_date DATE;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS empty_date DATE;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS per_diem_free_day DATE;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS ingate_date DATE;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS ready_to_return_date DATE;

-- Container / equipment extras
ALTER TABLE orders ADD COLUMN IF NOT EXISTS container_type TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS steamship_line_scac TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS chassis_size TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS chassis_type TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS chassis_owner TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS genset_number TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS genset_temperature NUMERIC(5,2);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS genset_route TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS genset_scac TEXT;

-- Equipment / cargo flags (is_hazmat, is_overweight exist in 001)
ALTER TABLE orders ADD COLUMN IF NOT EXISTS is_overheight BOOLEAN DEFAULT false;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS is_liquor BOOLEAN DEFAULT false;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS is_hot BOOLEAN DEFAULT false;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS is_genset BOOLEAN DEFAULT false;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS is_scale BOOLEAN DEFAULT false;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS is_ev BOOLEAN DEFAULT false;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS is_street_turn BOOLEAN DEFAULT false;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS is_oog BOOLEAN DEFAULT false;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS is_bonded BOOLEAN DEFAULT false;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS is_double BOOLEAN DEFAULT false;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS is_tanker BOOLEAN DEFAULT false;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS is_bill_only BOOLEAN DEFAULT false;

-- Reference numbers (bill_of_lading, booking_number, po_numbers, customer_reference, seal_number exist in 001)
ALTER TABLE orders ADD COLUMN IF NOT EXISTS house_bol TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS vessel_name TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS voyage_number TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS shipment_number TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS pickup_number TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS appointment_number TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS return_number TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS reservation_number TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_reference TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS work_order TEXT;

CREATE INDEX IF NOT EXISTS idx_orders_tenant_status ON orders(tenant_id, status) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_orders_tenant_customer ON orders(tenant_id, customer_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_orders_tenant_pickup ON orders(tenant_id, pickup_date);

-- ============================================================
-- NEW TABLE: routing_templates (seeded reference data)
-- ============================================================

CREATE TABLE IF NOT EXISTS routing_templates (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE, -- NULL = global/system template
  name TEXT NOT NULL,
  description TEXT,
  load_type TEXT,
  event_sequence JSONB NOT NULL DEFAULT '[]'::jsonb,
  is_system BOOLEAN NOT NULL DEFAULT false,
  is_enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_routing_templates_tenant ON routing_templates(tenant_id) WHERE is_enabled = true;
CREATE INDEX IF NOT EXISTS idx_routing_templates_system ON routing_templates(is_system) WHERE is_system = true;

-- ============================================================
-- NEW TABLE: order_container_moves
-- ============================================================

CREATE TABLE IF NOT EXISTS order_container_moves (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  sequence INTEGER NOT NULL DEFAULT 0,
  move_type TEXT,
  driver_id UUID REFERENCES drivers(id),
  truck_id UUID REFERENCES equipment_trucks(id),
  chassis_id UUID REFERENCES equipment_chassis(id),
  status TEXT DEFAULT 'pending',
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_container_moves_tenant_order ON order_container_moves(tenant_id, order_id);

-- ============================================================
-- NEW TABLE: order_routing_events
-- ============================================================

CREATE TABLE IF NOT EXISTS order_routing_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  move_id UUID REFERENCES order_container_moves(id) ON DELETE CASCADE,
  sequence INTEGER NOT NULL DEFAULT 0,
  event_type TEXT NOT NULL,
  location_id UUID REFERENCES customers(id),
  location_name TEXT,
  address TEXT,
  city TEXT,
  state TEXT,
  zip TEXT,
  scheduled_at TIMESTAMPTZ,
  started_at TIMESTAMPTZ,
  arrived_at TIMESTAMPTZ,
  departed_at TIMESTAMPTZ,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_routing_events_tenant_order ON order_routing_events(tenant_id, order_id);
CREATE INDEX IF NOT EXISTS idx_routing_events_move ON order_routing_events(move_id);

-- ============================================================
-- NEW TABLE: order_holds
-- ============================================================

CREATE TABLE IF NOT EXISTS order_holds (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  hold_type TEXT NOT NULL, -- freight | custom | terminal | fees_storage | carrier | other
  status TEXT NOT NULL DEFAULT 'hold', -- hold | released
  note TEXT,
  updated_by UUID REFERENCES users(id),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, order_id, hold_type)
);

CREATE INDEX IF NOT EXISTS idx_holds_tenant_order ON order_holds(tenant_id, order_id);

-- ============================================================
-- NEW TABLE: order_charge_sets
-- ============================================================

CREATE TABLE IF NOT EXISTS order_charge_sets (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  charge_set_number TEXT NOT NULL,
  bill_to_customer_id UUID REFERENCES customers(id),
  status TEXT NOT NULL DEFAULT 'draft', -- draft | unapproved | approved | billed | rebilling
  subtotal_cents INTEGER DEFAULT 0,
  total_cents INTEGER DEFAULT 0,
  invoice_id UUID,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, charge_set_number)
);

CREATE INDEX IF NOT EXISTS idx_charge_sets_tenant_order ON order_charge_sets(tenant_id, order_id);

-- ============================================================
-- NEW TABLE: order_charge_set_line_items
-- ============================================================

CREATE TABLE IF NOT EXISTS order_charge_set_line_items (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  charge_set_id UUID NOT NULL REFERENCES order_charge_sets(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  unit_of_measure TEXT,
  unit_count NUMERIC(10,2) DEFAULT 1,
  free_units NUMERIC(10,2) DEFAULT 0,
  per_unit_price_cents INTEGER DEFAULT 0,
  total_cents INTEGER DEFAULT 0,
  is_auto BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_charge_line_items_tenant_set ON order_charge_set_line_items(tenant_id, charge_set_id);

-- ============================================================
-- NEW TABLE: order_notes (audience-segmented)
-- ============================================================

CREATE TABLE IF NOT EXISTS order_notes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  audience TEXT NOT NULL, -- driver | billing | yard | load | terminal
  charge_set_id UUID REFERENCES order_charge_sets(id) ON DELETE SET NULL,
  body TEXT NOT NULL,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_order_notes_tenant_order ON order_notes(tenant_id, order_id);

-- ============================================================
-- NEW TABLE: order_documents
-- ============================================================

CREATE TABLE IF NOT EXISTS order_documents (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  charge_set_id UUID REFERENCES order_charge_sets(id) ON DELETE SET NULL,
  document_type TEXT,
  file_name TEXT NOT NULL,
  file_url TEXT NOT NULL,
  file_size INTEGER,
  mime_type TEXT,
  uploaded_by UUID REFERENCES users(id),
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_order_documents_tenant_order ON order_documents(tenant_id, order_id);

-- ============================================================
-- TRIGGERS: updated_at auto-update
-- ============================================================

DO $$
DECLARE
  tbl TEXT;
BEGIN
  FOR tbl IN
    SELECT unnest(ARRAY[
      'order_container_moves',
      'order_routing_events',
      'order_holds',
      'order_charge_sets',
      'order_notes'
    ])
  LOOP
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
-- ROW LEVEL SECURITY + POLICIES (mirror 001/002 pattern)
-- ============================================================

DO $$
DECLARE
  tbl TEXT;
BEGIN
  FOR tbl IN
    SELECT unnest(ARRAY[
      'order_container_moves',
      'order_routing_events',
      'order_holds',
      'order_charge_sets',
      'order_charge_set_line_items',
      'order_notes',
      'order_documents'
    ])
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', tbl);

    EXECUTE format(
      'DROP POLICY IF EXISTS %I ON %I',
      'tenant_isolation_select_' || tbl, tbl
    );
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR SELECT
       USING (tenant_id = current_tenant_id() OR is_dd_admin())',
      'tenant_isolation_select_' || tbl, tbl
    );

    EXECUTE format(
      'DROP POLICY IF EXISTS %I ON %I',
      'tenant_isolation_insert_' || tbl, tbl
    );
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR INSERT
       WITH CHECK (tenant_id = current_tenant_id() OR is_dd_admin())',
      'tenant_isolation_insert_' || tbl, tbl
    );

    EXECUTE format(
      'DROP POLICY IF EXISTS %I ON %I',
      'tenant_isolation_update_' || tbl, tbl
    );
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR UPDATE
       USING (tenant_id = current_tenant_id() OR is_dd_admin())
       WITH CHECK (tenant_id = current_tenant_id() OR is_dd_admin())',
      'tenant_isolation_update_' || tbl, tbl
    );

    EXECUTE format(
      'DROP POLICY IF EXISTS %I ON %I',
      'tenant_isolation_delete_' || tbl, tbl
    );
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR DELETE
       USING (tenant_id = current_tenant_id() OR is_dd_admin())',
      'tenant_isolation_delete_' || tbl, tbl
    );
  END LOOP;
END;
$$;

-- routing_templates RLS: system rows visible to all tenants, tenant rows isolated
ALTER TABLE routing_templates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS routing_templates_select ON routing_templates;
CREATE POLICY routing_templates_select ON routing_templates FOR SELECT
  USING (is_system = true OR tenant_id = current_tenant_id() OR is_dd_admin());

DROP POLICY IF EXISTS routing_templates_insert ON routing_templates;
CREATE POLICY routing_templates_insert ON routing_templates FOR INSERT
  WITH CHECK (tenant_id = current_tenant_id() OR is_dd_admin());

DROP POLICY IF EXISTS routing_templates_update ON routing_templates;
CREATE POLICY routing_templates_update ON routing_templates FOR UPDATE
  USING (tenant_id = current_tenant_id() OR is_dd_admin())
  WITH CHECK (tenant_id = current_tenant_id() OR is_dd_admin());

DROP POLICY IF EXISTS routing_templates_delete ON routing_templates;
CREATE POLICY routing_templates_delete ON routing_templates FOR DELETE
  USING (tenant_id = current_tenant_id() OR is_dd_admin());

-- ============================================================
-- SEED SYSTEM ROUTING TEMPLATES (10 patterns)
-- ============================================================

INSERT INTO routing_templates (name, description, load_type, event_sequence, is_system)
SELECT * FROM (VALUES
  ('Pick And Run + Live',
   'Pick container from terminal, deliver live, return empty',
   'import',
   '[{"type":"pull","label":"Pull from Terminal"},{"type":"deliver","label":"Live Deliver"},{"type":"return","label":"Return Empty"}]'::jsonb,
   true),
  ('Pick And Run + Drop & Hook',
   'Pick container, drop loaded, hook empty, return',
   'import',
   '[{"type":"pull","label":"Pull from Terminal"},{"type":"drop","label":"Drop Loaded"},{"type":"hook","label":"Hook Empty"},{"type":"return","label":"Return Empty"}]'::jsonb,
   true),
  ('Prepull + Live',
   'Prepull to yard, deliver live later',
   'import',
   '[{"type":"pull","label":"Pull from Terminal"},{"type":"drop","label":"Drop at Yard"},{"type":"hook","label":"Hook from Yard"},{"type":"deliver","label":"Live Deliver"},{"type":"return","label":"Return Empty"}]'::jsonb,
   true),
  ('Prepull + Drop & Hook',
   'Prepull to yard, then drop & hook delivery',
   'import',
   '[{"type":"pull","label":"Pull from Terminal"},{"type":"drop","label":"Drop at Yard"},{"type":"hook","label":"Hook from Yard"},{"type":"drop","label":"Drop Loaded"},{"type":"hook","label":"Hook Empty"},{"type":"return","label":"Return Empty"}]'::jsonb,
   true),
  ('One Way Move',
   'Single leg road transport',
   'road',
   '[{"type":"pickup","label":"Pickup"},{"type":"deliver","label":"Deliver"}]'::jsonb,
   true),
  ('Shunt',
   'Short-haul yard move',
   'road',
   '[{"type":"pickup","label":"Pickup"},{"type":"deliver","label":"Deliver"}]'::jsonb,
   true),
  ('Pick And Run + Gray Pool',
   'Pick using gray pool chassis',
   'import',
   '[{"type":"pull","label":"Pull from Terminal"},{"type":"deliver","label":"Live Deliver"},{"type":"return","label":"Return Empty"}]'::jsonb,
   true),
  ('Prepull + Gray Pool',
   'Prepull using gray pool chassis',
   'import',
   '[{"type":"pull","label":"Pull from Terminal"},{"type":"drop","label":"Drop at Yard"},{"type":"hook","label":"Hook from Yard"},{"type":"deliver","label":"Live Deliver"},{"type":"return","label":"Return Empty"}]'::jsonb,
   true),
  ('Pick and Run with Drop',
   'Pick and deliver as drop',
   'import',
   '[{"type":"pull","label":"Pull from Terminal"},{"type":"drop","label":"Drop Loaded"},{"type":"return","label":"Return Empty"}]'::jsonb,
   true),
  ('Hook with Return',
   'Hook pre-loaded container and deliver to port',
   'export',
   '[{"type":"hook","label":"Hook Loaded"},{"type":"deliver","label":"Deliver to Port"}]'::jsonb,
   true)
) AS t(name, description, load_type, event_sequence, is_system)
WHERE NOT EXISTS (
  SELECT 1 FROM routing_templates WHERE is_system = true AND routing_templates.name = t.name
);

-- ============================================================
-- DONE
-- ============================================================
