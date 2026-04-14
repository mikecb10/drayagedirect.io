-- ============================================================
-- Migration 064: AR Module Expansion
-- ============================================================
-- Enhances the Accounts Receivable system with:
--   1. Invoice enhancements (balance tracking, consolidation, PDF)
--   2. Invoice ↔ Charge Set junction (M:M for consolidated invoices)
--   3. Credit Memos table
--   4. Payment Applications table (split-apply across invoices)
--   5. Payment enhancements (customer-level, unapplied tracking)
--   6. Invoice Combination Rule per customer
-- ============================================================

BEGIN;

-- ──────────────────────────────────────────────────────────────
-- 1. Enhance invoices table
-- ──────────────────────────────────────────────────────────────
ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS payment_terms_days INTEGER,
  ADD COLUMN IF NOT EXISTS balance_due_cents INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS is_consolidated BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS pdf_url TEXT,
  ADD COLUMN IF NOT EXISTS branch_id UUID REFERENCES branches(id);

-- ──────────────────────────────────────────────────────────────
-- 2. Invoice ↔ Charge Set junction (M:M)
-- ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS invoice_charge_sets (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  invoice_id UUID NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  charge_set_id UUID NOT NULL REFERENCES order_charge_sets(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT invoice_charge_sets_unique UNIQUE (tenant_id, invoice_id, charge_set_id)
);

CREATE INDEX IF NOT EXISTS idx_invoice_charge_sets_invoice
  ON invoice_charge_sets(invoice_id);
CREATE INDEX IF NOT EXISTS idx_invoice_charge_sets_charge_set
  ON invoice_charge_sets(charge_set_id);
CREATE INDEX IF NOT EXISTS idx_invoice_charge_sets_tenant
  ON invoice_charge_sets(tenant_id);

-- RLS
ALTER TABLE invoice_charge_sets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS invoice_charge_sets_select ON invoice_charge_sets;
CREATE POLICY invoice_charge_sets_select ON invoice_charge_sets
  FOR SELECT USING (tenant_id = current_tenant_id() OR is_dd_admin());

DROP POLICY IF EXISTS invoice_charge_sets_insert ON invoice_charge_sets;
CREATE POLICY invoice_charge_sets_insert ON invoice_charge_sets
  FOR INSERT WITH CHECK (tenant_id = current_tenant_id() OR is_dd_admin());

DROP POLICY IF EXISTS invoice_charge_sets_update ON invoice_charge_sets;
CREATE POLICY invoice_charge_sets_update ON invoice_charge_sets
  FOR UPDATE
  USING (tenant_id = current_tenant_id() OR is_dd_admin())
  WITH CHECK (tenant_id = current_tenant_id() OR is_dd_admin());

DROP POLICY IF EXISTS invoice_charge_sets_delete ON invoice_charge_sets;
CREATE POLICY invoice_charge_sets_delete ON invoice_charge_sets
  FOR DELETE USING (tenant_id = current_tenant_id() OR is_dd_admin());

-- ──────────────────────────────────────────────────────────────
-- 3. Credit Memos
-- ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS credit_memos (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  customer_id UUID NOT NULL REFERENCES customers(id),
  memo_number TEXT,
  amount_cents INTEGER NOT NULL,
  reason TEXT,
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'applied', 'void')),

  -- Which invoice this credit was issued against (optional)
  invoice_id UUID REFERENCES invoices(id),
  -- Which invoice this credit was applied to (set when status → applied)
  applied_to_invoice_id UUID REFERENCES invoices(id),
  applied_at TIMESTAMPTZ,

  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_credit_memos_tenant
  ON credit_memos(tenant_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_credit_memos_customer
  ON credit_memos(tenant_id, customer_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_credit_memos_invoice
  ON credit_memos(applied_to_invoice_id) WHERE applied_to_invoice_id IS NOT NULL;

-- updated_at trigger
CREATE OR REPLACE FUNCTION set_credit_memos_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_credit_memos_updated_at ON credit_memos;
CREATE TRIGGER trg_credit_memos_updated_at
  BEFORE UPDATE ON credit_memos
  FOR EACH ROW EXECUTE FUNCTION set_credit_memos_updated_at();

-- RLS
ALTER TABLE credit_memos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS credit_memos_select ON credit_memos;
CREATE POLICY credit_memos_select ON credit_memos
  FOR SELECT USING (tenant_id = current_tenant_id() OR is_dd_admin());

DROP POLICY IF EXISTS credit_memos_insert ON credit_memos;
CREATE POLICY credit_memos_insert ON credit_memos
  FOR INSERT WITH CHECK (tenant_id = current_tenant_id() OR is_dd_admin());

DROP POLICY IF EXISTS credit_memos_update ON credit_memos;
CREATE POLICY credit_memos_update ON credit_memos
  FOR UPDATE
  USING (tenant_id = current_tenant_id() OR is_dd_admin())
  WITH CHECK (tenant_id = current_tenant_id() OR is_dd_admin());

DROP POLICY IF EXISTS credit_memos_delete ON credit_memos;
CREATE POLICY credit_memos_delete ON credit_memos
  FOR DELETE USING (tenant_id = current_tenant_id() OR is_dd_admin());

-- ──────────────────────────────────────────────────────────────
-- 4. Payment Applications (split-apply one payment across invoices)
-- ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS payment_applications (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  payment_id UUID NOT NULL REFERENCES payments_received(id) ON DELETE CASCADE,
  invoice_id UUID NOT NULL REFERENCES invoices(id),
  amount_cents INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_payment_applications_payment
  ON payment_applications(payment_id);
CREATE INDEX IF NOT EXISTS idx_payment_applications_invoice
  ON payment_applications(invoice_id);
CREATE INDEX IF NOT EXISTS idx_payment_applications_tenant
  ON payment_applications(tenant_id);

-- RLS
ALTER TABLE payment_applications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS payment_applications_select ON payment_applications;
CREATE POLICY payment_applications_select ON payment_applications
  FOR SELECT USING (tenant_id = current_tenant_id() OR is_dd_admin());

DROP POLICY IF EXISTS payment_applications_insert ON payment_applications;
CREATE POLICY payment_applications_insert ON payment_applications
  FOR INSERT WITH CHECK (tenant_id = current_tenant_id() OR is_dd_admin());

DROP POLICY IF EXISTS payment_applications_update ON payment_applications;
CREATE POLICY payment_applications_update ON payment_applications
  FOR UPDATE
  USING (tenant_id = current_tenant_id() OR is_dd_admin())
  WITH CHECK (tenant_id = current_tenant_id() OR is_dd_admin());

DROP POLICY IF EXISTS payment_applications_delete ON payment_applications;
CREATE POLICY payment_applications_delete ON payment_applications
  FOR DELETE USING (tenant_id = current_tenant_id() OR is_dd_admin());

-- ──────────────────────────────────────────────────────────────
-- 5. Enhance payments_received
-- ──────────────────────────────────────────────────────────────
-- Make invoice_id nullable (payments can be recorded before linking to invoice)
ALTER TABLE payments_received
  ALTER COLUMN invoice_id DROP NOT NULL;

ALTER TABLE payments_received
  ADD COLUMN IF NOT EXISTS customer_id UUID REFERENCES customers(id),
  ADD COLUMN IF NOT EXISTS unapplied_cents INTEGER NOT NULL DEFAULT 0;

-- ──────────────────────────────────────────────────────────────
-- 6. Invoice Combination Rule per customer
-- ──────────────────────────────────────────────────────────────
ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS invoice_combination_rule TEXT NOT NULL DEFAULT 'by_load'
    CHECK (invoice_combination_rule IN ('manual', 'by_load', 'by_day', 'by_week', 'by_reference', 'all_completed'));

NOTIFY pgrst, 'reload schema';

COMMIT;
