-- ============================================================
-- Migration 022: Per-tenant sort ordering for reference data
-- ============================================================
-- Each tenant can drag-reorder reference data items (container
-- types, sizes, chassis types, sizes) so frequently used entries
-- appear first in pickers and tables. System rows stay untouched.
-- ============================================================

CREATE TABLE IF NOT EXISTS tenant_reference_sort_orders (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  resource TEXT NOT NULL,
  item_id UUID NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, resource, item_id)
);

CREATE INDEX IF NOT EXISTS idx_ref_sort_orders_tenant ON tenant_reference_sort_orders(tenant_id, resource);

-- RLS
ALTER TABLE tenant_reference_sort_orders ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ref_sort_orders_select ON tenant_reference_sort_orders;
CREATE POLICY ref_sort_orders_select ON tenant_reference_sort_orders FOR SELECT
  USING (tenant_id = current_tenant_id() OR is_dd_admin());

DROP POLICY IF EXISTS ref_sort_orders_insert ON tenant_reference_sort_orders;
CREATE POLICY ref_sort_orders_insert ON tenant_reference_sort_orders FOR INSERT
  WITH CHECK (tenant_id = current_tenant_id() OR is_dd_admin());

DROP POLICY IF EXISTS ref_sort_orders_update ON tenant_reference_sort_orders;
CREATE POLICY ref_sort_orders_update ON tenant_reference_sort_orders FOR UPDATE
  USING (tenant_id = current_tenant_id() OR is_dd_admin());

DROP POLICY IF EXISTS ref_sort_orders_delete ON tenant_reference_sort_orders;
CREATE POLICY ref_sort_orders_delete ON tenant_reference_sort_orders FOR DELETE
  USING (tenant_id = current_tenant_id() OR is_dd_admin());
