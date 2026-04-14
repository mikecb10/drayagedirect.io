-- ============================================================
-- Migration 042: QuickBooks-Compatible Invoice Numbers
-- ============================================================
-- Adds invoice number tracking to order_charge_sets so that when
-- a charge set's status transitions to 'invoiced', we can assign
-- a separate QuickBooks-compatible invoice number (distinct from
-- the internal charge_set_number used for dispatcher tracking).
--
-- Format: {SCAC3}{seq6}        e.g., ABC001001      (original)
--         {SCAC3}{seq6}R{n}    e.g., ABC001001R1    (first rebill)
--                                    ABC001001R9    (ninth rebill)
--
-- Max 11 characters — works with all QuickBooks products (QBO
-- Online allows up to 21, QB Desktop allows up to 11).
--
-- The "displayed" invoice number is computed from the base +
-- rebill_count so we don't have to store every rebill variant.
-- ============================================================

ALTER TABLE order_charge_sets
  ADD COLUMN IF NOT EXISTS invoice_number_base TEXT,
  ADD COLUMN IF NOT EXISTS rebill_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS invoiced_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_rebilled_at TIMESTAMPTZ;

-- Prevent duplicate invoice number bases within a tenant.
-- Partial index because most rows won't have an invoice number yet.
CREATE UNIQUE INDEX IF NOT EXISTS order_charge_sets_invoice_number_base_key
  ON order_charge_sets (tenant_id, invoice_number_base)
  WHERE invoice_number_base IS NOT NULL;

COMMENT ON COLUMN order_charge_sets.invoice_number_base IS
  'The 9-char QB-compatible invoice number base (e.g., ABC001001). Displayed number = base + "R" + rebill_count when rebill_count > 0.';

COMMENT ON COLUMN order_charge_sets.rebill_count IS
  'Number of times this invoice has been rebilled. 0 = original.';

-- ============================================================
-- next_invoice_seq(p_tenant_id UUID)
-- ============================================================
-- Returns the next raw integer sequence for invoice numbers.
-- Atomically increments tenant_settings.next_invoice_number
-- via UPDATE ... RETURNING so concurrent callers get unique values.
--
-- The existing next_invoice_number() function (which returns a
-- formatted "INV-001001" string) is left untouched for backward
-- compatibility with any legacy callers.
-- ============================================================
CREATE OR REPLACE FUNCTION next_invoice_seq(p_tenant_id UUID)
RETURNS INTEGER AS $$
DECLARE
  v_next INTEGER;
BEGIN
  UPDATE tenant_settings
  SET next_invoice_number = next_invoice_number + 1,
      updated_at = now()
  WHERE tenant_id = p_tenant_id
  RETURNING next_invoice_number - 1 INTO v_next;

  RETURN v_next;
END;
$$ LANGUAGE plpgsql;
