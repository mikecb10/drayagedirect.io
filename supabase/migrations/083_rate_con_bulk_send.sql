-- ============================================================
-- Migration 083: Bulk rate-con claim RPC (2a.4b)
-- ============================================================
-- Mirror of migration 081's claim_invoices_for_send for
-- order_charge_sets. Adds the send_claimed_at column (the
-- charge-sets table has no in-flight-protection column today)
-- and a plural claim RPC that returns the successfully-claimed
-- subset — already-claimed rows are silently skipped so the
-- caller can dispatch whatever it owns.
--
-- Release semantics: the endpoint handles release inline via
-- plain UPDATE (no bulk release RPC). Status transition to
-- 'rate_con_sent' happens in the same UPDATE on the success
-- path.
-- ============================================================

BEGIN;

-- ── column: send_claimed_at ─────────────────────────────────
-- Nullable timestamp. Set by the claim RPC to now(); cleared by
-- the endpoint on success or failure. Stale claims (older than
-- 5 minutes) are re-claimable by the next caller.
ALTER TABLE order_charge_sets
  ADD COLUMN IF NOT EXISTS send_claimed_at TIMESTAMPTZ NULL;

-- ── claim_charge_sets_for_rate_con_send ─────────────────────
-- Signature: (p_charge_set_ids UUID[], p_tenant_id UUID)
--   -> TABLE (charge_set_id UUID)
--
-- Returns only the UUIDs that were successfully claimed; others
-- (wrong tenant, currently claimed within 5min) are silently
-- skipped so the caller can proceed with whatever subset is
-- available.
--
-- order_charge_sets has no deleted_at column today so no soft-
-- delete guard is needed. If one is added later, amend the
-- WHERE clause to match.
CREATE OR REPLACE FUNCTION claim_charge_sets_for_rate_con_send(
  p_charge_set_ids UUID[],
  p_tenant_id      UUID
)
RETURNS TABLE (charge_set_id UUID)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  RETURN QUERY
  UPDATE order_charge_sets cs
     SET send_claimed_at = now()
   WHERE cs.id = ANY(p_charge_set_ids)
     AND cs.tenant_id = p_tenant_id                -- tenant boundary
     AND (
       cs.send_claimed_at IS NULL
       OR cs.send_claimed_at < now() - interval '5 minutes'  -- stale-claim recovery
     )
  RETURNING cs.id;
END;
$$;

GRANT EXECUTE ON FUNCTION claim_charge_sets_for_rate_con_send(UUID[], UUID)
  TO service_role, authenticated;

NOTIFY pgrst, 'reload schema';

COMMIT;
