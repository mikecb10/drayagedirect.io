-- ============================================================
-- DrayageDirect: Phase 6b — Container Owners (Steamship Lines)
-- Reference table for SSLs with SCAC codes. System rows seed
-- common SSLs visible to all tenants; tenants can add their own
-- custom entries (bonded carriers, regional SSLs, etc.).
-- ============================================================

CREATE TABLE IF NOT EXISTS container_owners (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE, -- NULL = system/global
  name TEXT NOT NULL,
  label TEXT,                  -- short display (often same as SCAC)
  scac_code TEXT,              -- 2-4 letter standard SCAC
  contact_name TEXT,
  phone TEXT,
  email TEXT,
  address_line1 TEXT,
  city TEXT,
  state TEXT,
  zip TEXT,
  country TEXT DEFAULT 'US',
  website TEXT,
  notes TEXT,
  is_system BOOLEAN NOT NULL DEFAULT false,
  is_enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_container_owners_tenant ON container_owners(tenant_id) WHERE is_enabled = true AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_container_owners_scac ON container_owners(scac_code) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_container_owners_system ON container_owners(is_system) WHERE is_system = true;

-- FK on orders so a load references its container owner
ALTER TABLE orders ADD COLUMN IF NOT EXISTS container_owner_id UUID REFERENCES container_owners(id);

-- Trigger: updated_at auto-update
DROP TRIGGER IF EXISTS set_updated_at ON container_owners;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON container_owners
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

-- RLS: system rows visible to all, tenant rows isolated
ALTER TABLE container_owners ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS container_owners_select ON container_owners;
CREATE POLICY container_owners_select ON container_owners FOR SELECT
  USING (is_system = true OR tenant_id = current_tenant_id() OR is_dd_admin());

DROP POLICY IF EXISTS container_owners_insert ON container_owners;
CREATE POLICY container_owners_insert ON container_owners FOR INSERT
  WITH CHECK (tenant_id = current_tenant_id() OR is_dd_admin());

DROP POLICY IF EXISTS container_owners_update ON container_owners;
CREATE POLICY container_owners_update ON container_owners FOR UPDATE
  USING (tenant_id = current_tenant_id() OR is_dd_admin())
  WITH CHECK (tenant_id = current_tenant_id() OR is_dd_admin());

DROP POLICY IF EXISTS container_owners_delete ON container_owners;
CREATE POLICY container_owners_delete ON container_owners FOR DELETE
  USING (tenant_id = current_tenant_id() OR is_dd_admin());

-- ============================================================
-- Seed system container owners (common ocean + intermodal SSLs)
-- ============================================================

INSERT INTO container_owners (name, label, scac_code, is_system)
SELECT * FROM (VALUES
  ('ACL (Atlantic Container Line)', 'ACL', 'ACLU', true),
  ('APL (American President Lines)', 'APL', 'APLU', true),
  ('ANL Singapore Pte. Ltd.', 'ANL', 'ANNU', true),
  ('BAL Container Line', 'BAL', 'BANQ', true),
  ('Bermuda Container Line', 'BERMUDA', 'BCLU', true),
  ('C U Lines Limited', 'CULL', 'CULU', true),
  ('CMA CGM America LLC', 'CMA-CGM', 'CMDU', true),
  ('COFC Logistics LLC', 'COFC', 'COFC', true),
  ('COSCO Shipping Lines', 'COSCO', 'COSU', true),
  ('Crowley Liner Services', 'CROWLEY', 'CMCU', true),
  ('Eimskip USA, Inc.', 'EIMSKIP', 'EIMU', true),
  ('Evergreen Marine Corporation', 'EVERGREEN', 'EGLV', true),
  ('Hamburg Sud North America', 'HAMBURG', 'SUDU', true),
  ('Hapag-Lloyd America', 'HAPAG', 'HLCU', true),
  ('HMM Co. Ltd. (Hyundai Merchant Marine)', 'HYUNDAI', 'HDMU', true),
  ('Iris Logistics, Inc.', 'IRIS', 'IRIS', true),
  ('Lihua Logistics', 'LIHUA', 'LHUA', true),
  ('MACS Maritime Carrier Shipping', 'MACS', 'MACS', true),
  ('Maersk Line', 'MAERSK', 'MAEU', true),
  ('Matson Navigation Company', 'MATSON', 'MATS', true),
  ('MSC (Mediterranean Shipping Company)', 'MSC', 'MSCU', true),
  ('National Shipping of America', 'NSA', 'NSAU', true),
  ('Ocean Network Express (ONE)', 'ONE', 'ONEY', true),
  ('Odyssey FoodTrans LLC', 'ODYSSEY', 'ODFT', true),
  ('OOCL (Orient Overseas Container Line)', 'OOCL', 'OOLU', true),
  ('Sarjak Container Line', 'SARJAK', 'SARJ', true),
  ('Schuyler Line Navigation Company', 'SLNC', 'SLNC', true),
  ('Seaboard Marine', 'SEABOARD', 'SMLU', true),
  ('Shanghai JinJiang Shipping', 'SJSG', 'SJSG', true),
  ('SM Line Corporation', 'SML', 'SMLU', true),
  ('Somers Isles Shipping', 'SIS', 'SIS', true),
  ('Swire Shipping', 'SWIRE', 'CHVW', true),
  ('Tiger Cool Express LLC', 'TIGER COOL', 'TCLZ', true),
  ('TOTE Maritime Puerto Rico', 'TOTE', 'TOTE', true),
  ('Transfar Shipping Pte Ltd', 'TRANSFAR', 'TRAF', true),
  ('Turkon Container Transportation', 'TURKON', 'TRKU', true),
  ('Wan Hai Lines', 'WAN HAI', 'WHLC', true),
  ('X-Press Container Line', 'XPRESS', 'XPCL', true),
  ('XPO Stacktrain LLC', 'XPO', 'XPOL', true),
  ('Yangming Marine Transport', 'YANGMING', 'YMLU', true),
  ('ZIM Integrated Shipping Services', 'ZIM', 'ZIMU', true),
  ('Korea Marine Transport (KMTC)', 'KMTC', 'KMTU', true),
  ('Sealead Shipping', 'SEALEAD', 'SL', true)
) AS t(name, label, scac_code, is_system)
WHERE NOT EXISTS (
  SELECT 1 FROM container_owners
  WHERE is_system = true AND container_owners.name = t.name
);
