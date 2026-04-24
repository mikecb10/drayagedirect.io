-- ============================================================
-- Migration 099: Contact groups purpose + default-for-purpose
-- ============================================================
-- Adds `purpose` + `is_default_for_purpose` columns to
-- organization_groups so the AR recipient resolver can prefer
-- group members over legacy customer_billing_emails.
--
-- Backfills 4 default groups for every existing customer:
-- Billing, Operations, Dispatch, Rate Confirmation.
--
-- Part of FU-043 (contact groups email feature).
-- ============================================================

BEGIN;

ALTER TABLE organization_groups
  ADD COLUMN IF NOT EXISTS purpose TEXT;

ALTER TABLE organization_groups
  DROP CONSTRAINT IF EXISTS chk_org_groups_purpose;

ALTER TABLE organization_groups
  ADD CONSTRAINT chk_org_groups_purpose
  CHECK (purpose IS NULL OR purpose IN (
    'billing', 'operations', 'dispatch', 'rate_confirmation', 'management', 'custom'
  ));

ALTER TABLE organization_groups
  ADD COLUMN IF NOT EXISTS is_default_for_purpose BOOLEAN NOT NULL DEFAULT false;

CREATE UNIQUE INDEX IF NOT EXISTS idx_org_groups_default_purpose
  ON organization_groups (tenant_id, organization_id, purpose)
  WHERE is_default_for_purpose = true AND purpose IS NOT NULL;

-- Backfill 4 default groups per existing (non-deleted) organization.
-- NOT EXISTS guard makes this idempotent on re-run.
INSERT INTO organization_groups
  (tenant_id, organization_id, name, purpose, is_default_for_purpose, description)
SELECT
  c.tenant_id,
  c.id,
  defaults.group_name,
  defaults.purpose_value,
  true,
  defaults.default_description
FROM customers c
CROSS JOIN (VALUES
  ('Billing',            'billing',            'Default billing group -- receives invoice emails'),
  ('Operations',         'operations',         'Default operations group -- receives operational notifications'),
  ('Dispatch',           'dispatch',           'Default dispatch group -- receives dispatch notifications'),
  ('Rate Confirmation',  'rate_confirmation',  'Default rate-confirmation group -- receives rate con emails')
) AS defaults(group_name, purpose_value, default_description)
WHERE c.deleted_at IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM organization_groups g
    WHERE g.tenant_id = c.tenant_id
      AND g.organization_id = c.id
      AND g.purpose = defaults.purpose_value
      AND g.is_default_for_purpose = true
  );

NOTIFY pgrst, 'reload schema';

COMMIT;
