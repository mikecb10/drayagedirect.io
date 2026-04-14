-- ============================================================
-- DrayageDirect: Phase 6c — Equipment Reference Data
-- container_types, container_sizes, chassis_types, chassis_sizes
-- All 4 tables follow the same pattern: system rows visible to all
-- tenants, tenant-owned rows isolated, with code + label + description.
-- ============================================================

-- ============================================================
-- container_types
-- ============================================================
CREATE TABLE IF NOT EXISTS container_types (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  label TEXT NOT NULL,
  description TEXT,
  is_system BOOLEAN NOT NULL DEFAULT false,
  is_enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_container_types_tenant ON container_types(tenant_id) WHERE is_enabled = true AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_container_types_system ON container_types(is_system) WHERE is_system = true;

-- ============================================================
-- container_sizes
-- ============================================================
CREATE TABLE IF NOT EXISTS container_sizes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  label TEXT NOT NULL,
  description TEXT,
  is_system BOOLEAN NOT NULL DEFAULT false,
  is_enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_container_sizes_tenant ON container_sizes(tenant_id) WHERE is_enabled = true AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_container_sizes_system ON container_sizes(is_system) WHERE is_system = true;

-- ============================================================
-- chassis_types
-- ============================================================
CREATE TABLE IF NOT EXISTS chassis_types (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  label TEXT NOT NULL,
  description TEXT,
  is_system BOOLEAN NOT NULL DEFAULT false,
  is_enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_chassis_types_tenant ON chassis_types(tenant_id) WHERE is_enabled = true AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_chassis_types_system ON chassis_types(is_system) WHERE is_system = true;

-- ============================================================
-- chassis_sizes
-- ============================================================
CREATE TABLE IF NOT EXISTS chassis_sizes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  label TEXT NOT NULL,
  description TEXT,
  is_system BOOLEAN NOT NULL DEFAULT false,
  is_enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_chassis_sizes_tenant ON chassis_sizes(tenant_id) WHERE is_enabled = true AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_chassis_sizes_system ON chassis_sizes(is_system) WHERE is_system = true;

-- ============================================================
-- FKs on orders (keep existing TEXT columns as snapshot fallback)
-- ============================================================
ALTER TABLE orders ADD COLUMN IF NOT EXISTS container_type_id UUID REFERENCES container_types(id);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS container_size_id UUID REFERENCES container_sizes(id);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS chassis_type_id UUID REFERENCES chassis_types(id);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS chassis_size_id UUID REFERENCES chassis_sizes(id);

-- ============================================================
-- Triggers
-- ============================================================
DO $$
DECLARE tbl TEXT;
BEGIN
  FOR tbl IN SELECT unnest(ARRAY['container_types','container_sizes','chassis_types','chassis_sizes']) LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS set_updated_at ON %I', tbl);
    EXECUTE format('CREATE TRIGGER set_updated_at BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at()', tbl);
  END LOOP;
END; $$;

-- ============================================================
-- RLS + policies
-- ============================================================
DO $$
DECLARE tbl TEXT;
BEGIN
  FOR tbl IN SELECT unnest(ARRAY['container_types','container_sizes','chassis_types','chassis_sizes']) LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', tbl);

    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', tbl || '_select', tbl);
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR SELECT USING (is_system = true OR tenant_id = current_tenant_id() OR is_dd_admin())',
      tbl || '_select', tbl
    );

    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', tbl || '_insert', tbl);
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR INSERT WITH CHECK (tenant_id = current_tenant_id() OR is_dd_admin())',
      tbl || '_insert', tbl
    );

    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', tbl || '_update', tbl);
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR UPDATE USING (tenant_id = current_tenant_id() OR is_dd_admin()) WITH CHECK (tenant_id = current_tenant_id() OR is_dd_admin())',
      tbl || '_update', tbl
    );

    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', tbl || '_delete', tbl);
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR DELETE USING (tenant_id = current_tenant_id() OR is_dd_admin())',
      tbl || '_delete', tbl
    );
  END LOOP;
END; $$;

-- ============================================================
-- Seed container_types (from PortPro screenshots)
-- ============================================================
INSERT INTO container_types (code, label, description, is_system)
SELECT * FROM (VALUES
  ('DD',    'Double Door',                'Standard container with double doors on both ends', true),
  ('DR HC', 'Dry High Cube',              'Standard dry goods container, extra tall', true),
  ('DR ST', 'Dry Standard',               'Standard dry goods container', true),
  ('FR',    'Flat Rack',                  'Open-sided container for oversized cargo', true),
  ('FR HC', 'Flat Rack High Cube',        'Tall flat rack', true),
  ('FR ST', 'Flat Rack Standard',         'Standard flat rack', true),
  ('GP HC', 'General Purpose High Cube',  'Generic tall container', true),
  ('GP ST', 'General Purpose Standard',   'Generic standard container', true),
  ('HC',    'High Cube',                  'Extra tall container', true),
  ('HG HC', 'Hanger High Cube',           'Tall garment hanger container', true),
  ('HG ST', 'Hanger Standard',            'Standard garment hanger container', true),
  ('HH',    'Half Height',                'Half-height open top container', true),
  ('HT HC', 'Hardtop High Cube',          'Tall hardtop container', true),
  ('HT ST', 'Hardtop Standard',           'Standard hardtop container', true),
  ('IC',    'Insulated',                  'Insulated non-refrigerated container', true),
  ('OT',    'Open Top',                   'Open top container for top loading', true),
  ('OT HC', 'Open Top High Cube',         'Tall open top container', true),
  ('OT ST', 'Open Top Standard',          'Standard open top container', true),
  ('PL',    'Platform',                   'Flat platform container', true),
  ('PL HC', 'Platform High Cube',         'Tall platform', true),
  ('PL ST', 'Platform Standard',          'Standard platform', true),
  ('PW',    'Pallet Wide',                'Extra wide pallet container', true),
  ('RF',    'Reefer',                     'Refrigerated container', true),
  ('RF HC', 'Reefer High Cube',           'Tall refrigerated container', true),
  ('RF ST', 'Reefer Standard',            'Standard refrigerated container', true),
  ('ST',    'Standard',                   'Standard dry container', true),
  ('TK',    'Tank',                       'Tank container for liquids', true),
  ('TK HC', 'Tank High Cube',             'Tall tank container', true),
  ('TK ST', 'Tank Standard',              'Standard tank container', true),
  ('VT HC', 'Vented High Cube',           'Tall ventilated container', true),
  ('VT ST', 'Vented Standard',            'Standard ventilated container', true)
) AS t(code, label, description, is_system)
WHERE NOT EXISTS (
  SELECT 1 FROM container_types WHERE is_system = true AND container_types.code = t.code
);

-- ============================================================
-- Seed container_sizes
-- ============================================================
INSERT INTO container_sizes (code, label, description, is_system)
SELECT * FROM (VALUES
  ('20',   '20''',    'ISO 20-foot container', true),
  ('40',   '40''',    'ISO 40-foot container', true),
  ('40HC', '40'' HC', '40-foot high cube', true),
  ('45',   '45''',    '45-foot container', true),
  ('53',   '53''',    '53-foot domestic container', true)
) AS t(code, label, description, is_system)
WHERE NOT EXISTS (
  SELECT 1 FROM container_sizes WHERE is_system = true AND container_sizes.code = t.code
);

-- ============================================================
-- Seed chassis_types
-- ============================================================
INSERT INTO chassis_types (code, label, description, is_system)
SELECT * FROM (VALUES
  ('STD',      'Standard',              'Standard single-axle chassis', true),
  ('TRI',      'Tri-Axle',              'Three-axle chassis for heavy loads', true),
  ('AG',       'Air & Gas',             'Air ride and gas specialty chassis', true),
  ('COMBO',    'Combo Tandem',          'Tandem combo chassis', true),
  ('EXT',      'Extendable',            'Extendable-frame chassis', true),
  ('GN',       'Gooseneck',             'Gooseneck chassis for low-height loading', true),
  ('LGN',      'Lightweight Gooseneck', 'Lightweight gooseneck chassis', true),
  ('LOW',      'Lowboy',                'Lowboy flatbed chassis', true),
  ('ROLL',     'Roll Trailer',          'Roll-on/roll-off trailer', true),
  ('SLD',      'Slider',                'Slider chassis (adjustable axle position)', true),
  ('SPRD',     'Spreadaxle',            'Spread-axle chassis', true),
  ('QUAD',     'Quad-Axle',             'Four-axle heavy-duty chassis', true)
) AS t(code, label, description, is_system)
WHERE NOT EXISTS (
  SELECT 1 FROM chassis_types WHERE is_system = true AND chassis_types.code = t.code
);

-- ============================================================
-- Seed chassis_sizes
-- ============================================================
INSERT INTO chassis_sizes (code, label, description, is_system)
SELECT * FROM (VALUES
  ('20',        '20''',          'Fits 20-foot containers', true),
  ('40',        '40''',          'Fits 40-foot containers', true),
  ('45',        '45''',          'Fits 45-foot containers', true),
  ('48',        '48''',          '48-foot chassis', true),
  ('53',        '53''',          '53-foot chassis', true),
  ('20-40',     '20-40''',       'Convertible 20/40-foot chassis', true),
  ('40-45',     '40/45''',       'Fits 40 or 45-foot containers', true),
  ('20-40-45',  '20/40/45''',    'Universal 20/40/45-foot chassis', true),
  ('48-53',     '48/53''',       '48 or 53-foot chassis', true),
  ('40-53',     '40/53''',       '40 or 53-foot chassis', true),
  ('23.5',      '23.5''',        'Specialty 23.5-foot chassis', true)
) AS t(code, label, description, is_system)
WHERE NOT EXISTS (
  SELECT 1 FROM chassis_sizes WHERE is_system = true AND chassis_sizes.code = t.code
);
