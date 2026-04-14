-- ============================================================
-- DrayageDirect: Phase 6c+ — Tenant Reference Data Overrides
-- Lets each tenant enable/disable system-seeded reference rows
-- without modifying the shared system rows themselves.
-- ============================================================

CREATE TABLE IF NOT EXISTS tenant_reference_toggles (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  resource TEXT NOT NULL, -- 'container_types' | 'container_sizes' | 'chassis_types' | 'chassis_sizes' | 'container_owners'
  item_id UUID NOT NULL,  -- references the ID in the source reference table
  enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, resource, item_id)
);

CREATE INDEX IF NOT EXISTS idx_tenant_ref_toggles_tenant_resource
  ON tenant_reference_toggles(tenant_id, resource);

-- Trigger
DROP TRIGGER IF EXISTS set_updated_at ON tenant_reference_toggles;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON tenant_reference_toggles
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

-- RLS
ALTER TABLE tenant_reference_toggles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_reference_toggles_select ON tenant_reference_toggles;
CREATE POLICY tenant_reference_toggles_select ON tenant_reference_toggles FOR SELECT
  USING (tenant_id = current_tenant_id() OR is_dd_admin());

DROP POLICY IF EXISTS tenant_reference_toggles_insert ON tenant_reference_toggles;
CREATE POLICY tenant_reference_toggles_insert ON tenant_reference_toggles FOR INSERT
  WITH CHECK (tenant_id = current_tenant_id() OR is_dd_admin());

DROP POLICY IF EXISTS tenant_reference_toggles_update ON tenant_reference_toggles;
CREATE POLICY tenant_reference_toggles_update ON tenant_reference_toggles FOR UPDATE
  USING (tenant_id = current_tenant_id() OR is_dd_admin())
  WITH CHECK (tenant_id = current_tenant_id() OR is_dd_admin());

DROP POLICY IF EXISTS tenant_reference_toggles_delete ON tenant_reference_toggles;
CREATE POLICY tenant_reference_toggles_delete ON tenant_reference_toggles FOR DELETE
  USING (tenant_id = current_tenant_id() OR is_dd_admin());
