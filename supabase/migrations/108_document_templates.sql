-- ============================================================
-- 108_document_templates.sql
--
-- FU-035-A: per-tenant + per-customer document template overrides.
--
-- Cascade resolution (when rendering a Delivery Order or future
-- document type for a given load):
--   1. customer-specific template      (customer_id = load.bill_to)
--   2. tenant default                  (customer_id IS NULL)
--   3. system default                  (no row found → undefined)
--
-- The two partial unique indexes enforce:
--   - one tenant default per (tenant_id, document_type)
--   - one customer-specific override per (tenant_id, customer_id, document_type)
--
-- Plain UNIQUE constraints don't work here because Postgres treats
-- NULL as "not equal to NULL" — multiple `customer_id IS NULL` rows
-- would be allowed without the partial index.
--
-- section_config shape (validated by API on write, not by DB):
--   {
--     visibility: { section_id: bool, ... },
--     order:      [section_id, ...],
--     perSection: { section_id: { ... }, ... }
--   }
-- Any of the three keys may be omitted — the composer falls back to
-- registry defaults when omitted.
-- ============================================================

BEGIN;

CREATE TABLE IF NOT EXISTS document_templates (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  customer_id UUID REFERENCES customers(id) ON DELETE CASCADE, -- NULL = tenant-wide default
  document_type TEXT NOT NULL,
  section_config JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID REFERENCES users(id),
  updated_by UUID REFERENCES users(id)
);

-- One tenant default per (tenant, doc_type)
CREATE UNIQUE INDEX IF NOT EXISTS idx_doc_templates_tenant_default
  ON document_templates(tenant_id, document_type)
  WHERE customer_id IS NULL;

-- One customer-specific override per (tenant, customer, doc_type)
CREATE UNIQUE INDEX IF NOT EXISTS idx_doc_templates_per_customer
  ON document_templates(tenant_id, customer_id, document_type)
  WHERE customer_id IS NOT NULL;

-- Lookup index for the cascade resolver — keyed by tenant + doc_type.
-- The resolver reads up to 2 rows per call (the customer-specific +
-- the tenant default) and the existing unique indexes already cover
-- those exact lookups, so no additional index needed.

NOTIFY pgrst, 'reload schema';

COMMIT;
