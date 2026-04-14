-- ============================================================
-- DrayageDirect: Phase 6d — Per Diem Free Day Pricing
-- Tiered per-diem pricing rules matched by Customer × SSL ×
-- Container Type × Load Type. When a load sits past its free
-- days, the matching rule's tiers will be applied (future
-- engine — this migration just stores the rules).
-- ============================================================

-- Parent rule table — matching criteria + flags
CREATE TABLE IF NOT EXISTS per_diem_rules (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT,

  -- Matching criteria (NULL = "any" for that field)
  customer_id UUID REFERENCES customers(id),
  container_owner_id UUID REFERENCES container_owners(id),
  container_type_id UUID REFERENCES container_types(id),
  load_type TEXT, -- 'import' | 'inbound' | 'export' | 'outbound' | 'road' | NULL (any)

  -- Calendar treatment
  include_holidays BOOLEAN NOT NULL DEFAULT true,  -- count holidays toward day number
  include_weekends BOOLEAN NOT NULL DEFAULT true,  -- count weekends toward day number

  -- State
  is_enabled BOOLEAN NOT NULL DEFAULT true,
  notes TEXT,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_per_diem_rules_tenant ON per_diem_rules(tenant_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_per_diem_rules_customer ON per_diem_rules(customer_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_per_diem_rules_owner ON per_diem_rules(container_owner_id) WHERE deleted_at IS NULL;

-- Tier table — ordered pricing tiers per rule
CREATE TABLE IF NOT EXISTS per_diem_rule_tiers (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  rule_id UUID NOT NULL REFERENCES per_diem_rules(id) ON DELETE CASCADE,
  from_day INTEGER NOT NULL,         -- inclusive, 1-based
  to_day INTEGER,                    -- inclusive; NULL = "and beyond"
  amount_cents INTEGER NOT NULL DEFAULT 0,
  sequence INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_per_diem_tiers_rule ON per_diem_rule_tiers(rule_id, sequence);
CREATE INDEX IF NOT EXISTS idx_per_diem_tiers_tenant ON per_diem_rule_tiers(tenant_id);

-- updated_at trigger
DROP TRIGGER IF EXISTS set_updated_at ON per_diem_rules;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON per_diem_rules
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

-- RLS
DO $$
DECLARE tbl TEXT;
BEGIN
  FOR tbl IN SELECT unnest(ARRAY['per_diem_rules','per_diem_rule_tiers']) LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', tbl);

    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', tbl || '_select', tbl);
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR SELECT USING (tenant_id = current_tenant_id() OR is_dd_admin())',
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
