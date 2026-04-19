-- ============================================================
-- Migration 080: claim_invoice_for_send() + release RPCs
-- ============================================================
-- Fixes a race condition in the AR invoice-send endpoint
-- (pages/api/tenant/ar/invoices/[invoiceId]/send-email.js).
--
-- Prior flow (vulnerable):
--   1. SELECT status, sent_at FROM invoices WHERE id=...
--   2. If sent_at IS NULL → render PDF → dispatch SendGrid → UPDATE sent_at
--
-- Under two concurrent POST requests for the same invoice id, both
-- reads at step 1 can observe sent_at IS NULL before either UPDATE
-- lands. The result: two SendGrid dispatches, or a race on the final
-- UPDATE. The tenant sees the invoice go out twice.
--
-- Fix: an atomic claim-and-release pattern using a new
-- `send_claimed_at` column on invoices.
--
--   claim_invoice_for_send(invoice_id, tenant_id)
--     Atomic UPDATE ... WHERE sent_at IS NULL AND
--       (send_claimed_at IS NULL OR send_claimed_at < now() - '5 min'::interval)
--     RETURNING row. If no row returned → another request owns the
--     claim (or the invoice was already sent) → endpoint returns 409.
--     The 5-minute freshness window lets stale claims (crashed
--     mid-dispatch) release automatically; normal dispatch completes
--     well within that window.
--
--   release_invoice_claim(invoice_id, tenant_id, success)
--     If success=true: sets sent_at=now() and status='sent'.
--     If success=false: clears send_claimed_at so the invoice can be
--     retried.
--
-- Rate-con endpoint is intentionally re-sendable (see
-- send-rate-con-email.js comment: "no already sent guard"), so no
-- parallel RPC is added for it.
-- ============================================================

BEGIN;

-- ── New column: send_claimed_at ──────────────────────────────
ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS send_claimed_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_invoices_send_claimed_at
  ON invoices(send_claimed_at)
  WHERE send_claimed_at IS NOT NULL;

-- ── Drop prior shapes so signature changes don't error ───────
DROP FUNCTION IF EXISTS claim_invoice_for_send(UUID, UUID);
DROP FUNCTION IF EXISTS release_invoice_claim(UUID, UUID, BOOLEAN);

-- ── claim_invoice_for_send ───────────────────────────────────
CREATE OR REPLACE FUNCTION claim_invoice_for_send(
  p_invoice_id UUID,
  p_tenant_id  UUID
)
RETURNS TABLE (
  id              UUID,
  invoice_number  TEXT,
  status          invoice_status_enum,
  customer_id     UUID,
  sent_at         TIMESTAMPTZ,
  claim_ok        BOOLEAN,
  claim_reason    TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_claimed invoices%ROWTYPE;
  v_existing invoices%ROWTYPE;
BEGIN
  -- Atomic claim. Only succeeds if:
  --   a) the invoice exists, not deleted, matches tenant
  --   b) it has not already been sent (sent_at IS NULL)
  --   c) there is no live claim (send_claimed_at NULL or stale > 5 min)
  -- Concurrent callers serialize at Postgres's row lock; the loser
  -- sees the winner's send_claimed_at inside the freshness window
  -- and matches zero rows.
  UPDATE invoices
     SET send_claimed_at = now()
   WHERE invoices.id = p_invoice_id
     AND invoices.tenant_id = p_tenant_id
     AND invoices.deleted_at IS NULL
     AND invoices.sent_at IS NULL
     AND (
       invoices.send_claimed_at IS NULL
       OR invoices.send_claimed_at < now() - interval '5 minutes'
     )
  RETURNING * INTO v_claimed;

  IF FOUND THEN
    RETURN QUERY SELECT
      v_claimed.id, v_claimed.invoice_number, v_claimed.status,
      v_claimed.customer_id, v_claimed.sent_at,
      TRUE, NULL::TEXT;
    RETURN;
  END IF;

  -- No row updated — diagnose why so the endpoint can return the
  -- right HTTP code (404 vs 409). Read-only after the failed claim.
  SELECT * INTO v_existing
    FROM invoices
   WHERE invoices.id = p_invoice_id
     AND invoices.tenant_id = p_tenant_id
     AND invoices.deleted_at IS NULL;

  IF NOT FOUND THEN
    RETURN QUERY SELECT
      NULL::UUID, NULL::TEXT, NULL::invoice_status_enum,
      NULL::UUID, NULL::TIMESTAMPTZ,
      FALSE, 'not_found'::TEXT;
    RETURN;
  END IF;

  IF v_existing.sent_at IS NOT NULL THEN
    RETURN QUERY SELECT
      v_existing.id, v_existing.invoice_number, v_existing.status,
      v_existing.customer_id, v_existing.sent_at,
      FALSE, 'already_sent'::TEXT;
    RETURN;
  END IF;

  -- Must be a live claim held by another request.
  RETURN QUERY SELECT
    v_existing.id, v_existing.invoice_number, v_existing.status,
    v_existing.customer_id, v_existing.sent_at,
    FALSE, 'send_in_progress'::TEXT;
END;
$$;

-- ── release_invoice_claim ────────────────────────────────────
CREATE OR REPLACE FUNCTION release_invoice_claim(
  p_invoice_id UUID,
  p_tenant_id  UUID,
  p_success    BOOLEAN
)
RETURNS TIMESTAMPTZ
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_now TIMESTAMPTZ := now();
BEGIN
  IF p_success THEN
    UPDATE invoices
       SET sent_at = v_now,
           status = 'sent',
           send_claimed_at = NULL
     WHERE invoices.id = p_invoice_id
       AND invoices.tenant_id = p_tenant_id;
    RETURN v_now;
  ELSE
    UPDATE invoices
       SET send_claimed_at = NULL
     WHERE invoices.id = p_invoice_id
       AND invoices.tenant_id = p_tenant_id;
    RETURN NULL;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION claim_invoice_for_send(UUID, UUID)
  TO service_role, authenticated;
GRANT EXECUTE ON FUNCTION release_invoice_claim(UUID, UUID, BOOLEAN)
  TO service_role, authenticated;

NOTIFY pgrst, 'reload schema';

COMMIT;
