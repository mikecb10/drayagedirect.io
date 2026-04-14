-- ============================================================
-- Migration 044: ready_to_return_date → TIMESTAMPTZ
-- ============================================================
-- The column was originally added as DATE in migration 003. The
-- "Ready For Return" workflow now needs to capture the precise
-- moment a customer reports a container is empty (not just the
-- date), so dispatchers can audit when the status changed.
--
-- Existing DATE values are converted to midnight UTC timestamps.
-- The KPI engine continues to work because isInDateRange() always
-- extracts the date portion for filtering.
--
-- The column name is left as `ready_to_return_date` for backward
-- compat with existing API endpoints + indexes; the renaming
-- would create a much larger churn for minimal benefit.
--
-- Note: We have to DROP and recreate the `live_orders` view from
-- migration 043 because Postgres won't ALTER a column that's
-- referenced by a SELECT * view.
-- ============================================================

-- 1. Drop the dependent view (will be recreated below)
DROP VIEW IF EXISTS live_orders;

-- 2. Alter the column type
ALTER TABLE orders
  ALTER COLUMN ready_to_return_date TYPE TIMESTAMPTZ
  USING ready_to_return_date::TIMESTAMPTZ;

-- 3. Recreate the view (same definition as migration 043)
CREATE VIEW live_orders AS
SELECT * FROM orders WHERE deleted_at IS NULL;

ALTER VIEW live_orders SET (security_invoker = on);

GRANT SELECT ON live_orders TO anon, authenticated, service_role;

COMMENT ON VIEW live_orders IS
  'Filtered view of orders excluding soft-deleted rows. Use this for any query that should NOT see deleted loads. The orders table itself remains accessible for the deleted loads page, restore flow, audit lookups, and realtime subscriptions.';

COMMENT ON COLUMN orders.ready_to_return_date IS
  'Timestamp when the container was marked Ready For Return (customer reported empty). NULL means not yet ready.';
