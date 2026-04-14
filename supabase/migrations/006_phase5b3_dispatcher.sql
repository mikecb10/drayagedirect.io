-- ============================================================
-- DrayageDirect: Phase 5b-3 — Advanced Dispatcher Board
-- 13 new orders columns + user_dispatcher_preferences table
-- ============================================================

-- New orders columns
ALTER TABLE orders ADD COLUMN IF NOT EXISTS available_date DATE;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS container_eta TIMESTAMPTZ;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS csr_user_id UUID REFERENCES users(id);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_apt_from TIMESTAMPTZ;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_apt_to TIMESTAMPTZ;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS pickup_apt_from TIMESTAMPTZ;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS pickup_apt_to TIMESTAMPTZ;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS return_apt_from TIMESTAMPTZ;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS return_apt_to TIMESTAMPTZ;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS gray_chassis_number TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS gray_container_number TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS ref_container_number TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS terminal_status TEXT;

-- User dispatcher preferences table
CREATE TABLE IF NOT EXISTS user_dispatcher_preferences (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  column_order TEXT[] NOT NULL DEFAULT '{}',
  hidden_columns TEXT[] NOT NULL DEFAULT '{}',
  frozen_columns TEXT[] NOT NULL DEFAULT ARRAY['order_number','customer','container_number','status'],
  saved_filters JSONB NOT NULL DEFAULT '{}'::jsonb,
  row_density TEXT NOT NULL DEFAULT 'comfortable',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_dispatcher_prefs_tenant_user ON user_dispatcher_preferences(tenant_id, user_id);

-- Trigger
DROP TRIGGER IF EXISTS set_updated_at ON user_dispatcher_preferences;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON user_dispatcher_preferences
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

-- RLS
ALTER TABLE user_dispatcher_preferences ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation_select_user_dispatcher_preferences ON user_dispatcher_preferences;
CREATE POLICY tenant_isolation_select_user_dispatcher_preferences ON user_dispatcher_preferences FOR SELECT
  USING (tenant_id = current_tenant_id() OR is_dd_admin());

DROP POLICY IF EXISTS tenant_isolation_insert_user_dispatcher_preferences ON user_dispatcher_preferences;
CREATE POLICY tenant_isolation_insert_user_dispatcher_preferences ON user_dispatcher_preferences FOR INSERT
  WITH CHECK (tenant_id = current_tenant_id() OR is_dd_admin());

DROP POLICY IF EXISTS tenant_isolation_update_user_dispatcher_preferences ON user_dispatcher_preferences;
CREATE POLICY tenant_isolation_update_user_dispatcher_preferences ON user_dispatcher_preferences FOR UPDATE
  USING (tenant_id = current_tenant_id() OR is_dd_admin())
  WITH CHECK (tenant_id = current_tenant_id() OR is_dd_admin());

DROP POLICY IF EXISTS tenant_isolation_delete_user_dispatcher_preferences ON user_dispatcher_preferences;
CREATE POLICY tenant_isolation_delete_user_dispatcher_preferences ON user_dispatcher_preferences FOR DELETE
  USING (tenant_id = current_tenant_id() OR is_dd_admin());
