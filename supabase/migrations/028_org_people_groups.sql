-- ============================================================
-- Migration 028: Organization People & Groups
-- ============================================================
-- People = individual contacts under an organization
-- Groups = custom named collections for bulk email sends
-- ============================================================

CREATE TABLE IF NOT EXISTS organization_contacts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  first_name TEXT NOT NULL,
  last_name TEXT,
  email TEXT,
  phone TEXT,
  title TEXT,
  department TEXT,
  is_primary BOOLEAN NOT NULL DEFAULT false,
  is_active BOOLEAN NOT NULL DEFAULT true,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_org_contacts_org ON organization_contacts(tenant_id, organization_id);

CREATE TABLE IF NOT EXISTS organization_groups (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_org_groups_org ON organization_groups(tenant_id, organization_id);

CREATE TABLE IF NOT EXISTS organization_group_members (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  group_id UUID NOT NULL REFERENCES organization_groups(id) ON DELETE CASCADE,
  contact_id UUID NOT NULL REFERENCES organization_contacts(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (group_id, contact_id)
);

-- RLS
ALTER TABLE organization_contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE organization_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE organization_group_members ENABLE ROW LEVEL SECURITY;

CREATE POLICY org_contacts_select ON organization_contacts FOR SELECT USING (tenant_id = current_tenant_id() OR is_dd_admin());
CREATE POLICY org_contacts_insert ON organization_contacts FOR INSERT WITH CHECK (tenant_id = current_tenant_id() OR is_dd_admin());
CREATE POLICY org_contacts_update ON organization_contacts FOR UPDATE USING (tenant_id = current_tenant_id() OR is_dd_admin());
CREATE POLICY org_contacts_delete ON organization_contacts FOR DELETE USING (tenant_id = current_tenant_id() OR is_dd_admin());

CREATE POLICY org_groups_select ON organization_groups FOR SELECT USING (tenant_id = current_tenant_id() OR is_dd_admin());
CREATE POLICY org_groups_insert ON organization_groups FOR INSERT WITH CHECK (tenant_id = current_tenant_id() OR is_dd_admin());
CREATE POLICY org_groups_update ON organization_groups FOR UPDATE USING (tenant_id = current_tenant_id() OR is_dd_admin());
CREATE POLICY org_groups_delete ON organization_groups FOR DELETE USING (tenant_id = current_tenant_id() OR is_dd_admin());

CREATE POLICY org_group_members_all ON organization_group_members FOR ALL USING (true);
