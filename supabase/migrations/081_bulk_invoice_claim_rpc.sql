-- ============================================================
-- Migration 081: Bulk invoice claim RPC
-- ============================================================
-- Array overload of migration 080's claim_invoice_for_send for
-- bulk AR send (sub-project 2a.4). Returns the successfully-
-- claimed subset so the caller can dispatch only what it owns;
-- invoices already sent or currently claimed by another session
-- (within 5 min) are silently skipped.
--
-- Same row-level atomicity as 080: concurrent callers serialize
-- at Postgres's row lock, and the loser matches zero rows for
-- claims inside the freshness window.
--
-- Release semantics for bulk: the endpoint handles release
-- inline via plain UPDATE — no bulk release RPC is added.
-- ============================================================

BEGIN;

-- ── claim_invoices_for_send ──────────────────────────────────
-- Plural overload. Coexists with 080's single-UUID signature.
CREATE OR REPLACE FUNCTION claim_invoices_for_send(
  p_invoice_ids UUID[],
  p_tenant_id   UUID
)
RETURNS TABLE (invoice_id UUID)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  RETURN QUERY
  UPDATE invoices
     SET send_claimed_at = now()
   WHERE invoices.id = ANY(p_invoice_ids)
     AND invoices.tenant_id = p_tenant_id      -- tenant boundary
     AND invoices.deleted_at IS NULL           -- soft-delete guard
     AND invoices.sent_at IS NULL              -- not already sent
     AND (
       invoices.send_claimed_at IS NULL
       OR invoices.send_claimed_at < now() - interval '5 minutes'  -- stale-claim recovery
     )
  RETURNING invoices.id;
END;
$$;

GRANT EXECUTE ON FUNCTION claim_invoices_for_send(UUID[], UUID)
  TO service_role, authenticated;

NOTIFY pgrst, 'reload schema';

COMMIT;
