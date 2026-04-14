-- ============================================================
-- DrayageDirect: Phase 5b-2b — Driver Pay Lines
-- ============================================================

CREATE TABLE IF NOT EXISTS order_driver_pay_lines (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  driver_id UUID REFERENCES drivers(id),
  line_type TEXT NOT NULL DEFAULT 'line_haul', -- line_haul | detention | fuel_surcharge | layover | bonus | other
  description TEXT,
  from_location TEXT,
  to_location TEXT,
  amount_cents INTEGER NOT NULL DEFAULT 0,
  hours NUMERIC(6,2),
  miles NUMERIC(8,2),
  worked_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'drafted', -- drafted | unapproved | approved | reviewed | finalized
  notes TEXT,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_driver_pay_tenant_order ON order_driver_pay_lines(tenant_id, order_id);
CREATE INDEX IF NOT EXISTS idx_driver_pay_driver ON order_driver_pay_lines(driver_id);

-- Trigger
DROP TRIGGER IF EXISTS set_updated_at ON order_driver_pay_lines;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON order_driver_pay_lines
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

-- RLS
ALTER TABLE order_driver_pay_lines ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation_select_order_driver_pay_lines ON order_driver_pay_lines;
CREATE POLICY tenant_isolation_select_order_driver_pay_lines ON order_driver_pay_lines FOR SELECT
  USING (tenant_id = current_tenant_id() OR is_dd_admin());

DROP POLICY IF EXISTS tenant_isolation_insert_order_driver_pay_lines ON order_driver_pay_lines;
CREATE POLICY tenant_isolation_insert_order_driver_pay_lines ON order_driver_pay_lines FOR INSERT
  WITH CHECK (tenant_id = current_tenant_id() OR is_dd_admin());

DROP POLICY IF EXISTS tenant_isolation_update_order_driver_pay_lines ON order_driver_pay_lines;
CREATE POLICY tenant_isolation_update_order_driver_pay_lines ON order_driver_pay_lines FOR UPDATE
  USING (tenant_id = current_tenant_id() OR is_dd_admin())
  WITH CHECK (tenant_id = current_tenant_id() OR is_dd_admin());

DROP POLICY IF EXISTS tenant_isolation_delete_order_driver_pay_lines ON order_driver_pay_lines;
CREATE POLICY tenant_isolation_delete_order_driver_pay_lines ON order_driver_pay_lines FOR DELETE
  USING (tenant_id = current_tenant_id() OR is_dd_admin());
