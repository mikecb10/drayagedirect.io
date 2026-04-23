-- ============================================================
-- Migration 095: Invoice rebill lineage
-- ============================================================
-- Tracks the rebill pivot directly on the invoices table so an
-- accountant can see on any invoice:
--   - Was this invoice rebilled? When? By whom?
--   - If so, which newer invoice replaced it?
--   - Is this invoice itself a rebill of a prior invoice?
--
-- Why columns (not a separate events table):
--   The accountant's day-to-day need is "open invoice, see lineage".
--   Columns satisfy that with a single row read. A historical-events
--   table (every send/resend/void/rebill) is a reasonable future
--   upgrade — when that happens, backfill the table from these
--   columns + tenant_audit_log. Not needed today.
--
-- Nullable fields:
--   rebilled_at           TIMESTAMPTZ — when user clicked Rebill on
--                                       this invoice (pivot moment)
--   rebilled_by_user_id   UUID        — who clicked it
--   rebilled_to_invoice_id UUID       — the replacement invoice, set
--                                       later when the rebilled
--                                       charge sets get re-invoiced
--   rebilled_from_invoice_id UUID     — points back at the original
--                                       when THIS invoice is the
--                                       replacement. Mirror of
--                                       rebilled_to on the original.
-- ============================================================

BEGIN;

ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS rebilled_at              TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS rebilled_by_user_id      UUID REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS rebilled_to_invoice_id   UUID REFERENCES invoices(id),
  ADD COLUMN IF NOT EXISTS rebilled_from_invoice_id UUID REFERENCES invoices(id);

-- Index for reporting: "show me all rebills in Q4"
CREATE INDEX IF NOT EXISTS idx_invoices_tenant_rebilled
  ON invoices (tenant_id, rebilled_at)
  WHERE rebilled_at IS NOT NULL;

NOTIFY pgrst, 'reload schema';

COMMIT;
