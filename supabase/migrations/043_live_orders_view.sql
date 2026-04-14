-- ============================================================
-- Migration 043: live_orders VIEW for soft-delete safety
-- ============================================================
-- Adds a database view called `live_orders` that filters out
-- soft-deleted rows. This provides defense-in-depth: any future
-- query that uses `live_orders` instead of `orders` is guaranteed
-- to never see deleted loads — the filter is enforced at the DB
-- level and cannot be forgotten.
--
-- ## When to use which
--
--   live_orders  → 95% of queries. Anywhere you want only active
--                  loads (dispatcher board, AR, billing, tracking,
--                  routing, documents, etc.).
--
--   orders       → Only when you specifically need to include
--                  soft-deleted rows: the deleted-loads page, the
--                  restore endpoint, audit log lookups, the
--                  realtime subscription (so it can broadcast
--                  soft-delete UPDATE events).
--
-- ## Why a VIEW instead of an RLS policy?
--
-- 1. RLS is bypassed by the service role, which is what all
--    server-side API endpoints use. A VIEW's WHERE clause is part
--    of the view definition and applies to ALL roles, including
--    service role.
-- 2. RLS on `deleted_at IS NULL` would block Realtime from
--    broadcasting soft-delete events to subscribed clients,
--    breaking the multi-dispatcher sync that fires when one user
--    deletes a load.
--
-- ## Security
--
-- The view inherits the RLS policies from the underlying `orders`
-- table, so tenant isolation continues to work for any non-service
-- role queries (e.g., direct browser queries via the anon client).
-- ============================================================

-- Partial index makes the WHERE deleted_at IS NULL filter very fast.
-- Most queries also filter by tenant_id, so we include it in the index.
CREATE INDEX IF NOT EXISTS idx_orders_tenant_active
  ON orders (tenant_id)
  WHERE deleted_at IS NULL;

-- The live view itself
CREATE OR REPLACE VIEW live_orders AS
SELECT * FROM orders WHERE deleted_at IS NULL;

COMMENT ON VIEW live_orders IS
  'Filtered view of orders excluding soft-deleted rows. Use this for any query that should NOT see deleted loads. The orders table itself remains accessible for the deleted loads page, restore flow, audit lookups, and realtime subscriptions.';

-- Grant the same access as the underlying table
GRANT SELECT ON live_orders TO anon, authenticated, service_role;

-- ============================================================
-- Note: views inherit RLS policies from their base tables when
-- the view is created with `security_invoker = on` (default in
-- Postgres 15+). For older Postgres or if RLS isn't applied, we
-- can explicitly mark the view as security_invoker:
-- ============================================================
ALTER VIEW live_orders SET (security_invoker = on);
