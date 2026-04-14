-- ============================================================
-- Migration 045: Convert rigid enums on orders to TEXT
-- ============================================================
-- Two legacy enums from migration 001 are causing silent save failures
-- on the dispatcher board because the app's valid values have grown
-- beyond the hardcoded enum members:
--
--   1. container_size_enum ('20', '40', '40HC', '45') — the app now
--      uses '53', '48', and any custom codes tenants add via the
--      container_sizes reference table. Migration 020 patched in '53'
--      and '48' but any custom tenant code still fails.
--
--   2. order_status_enum ('pending', 'dispatched', 'in_transit',
--      'delivered', 'completed', 'cancelled') — the KPI engine,
--      routing handlers, and bulk actions all use 'available' and
--      'dropped' (added conceptually by migration 024, which forgot
--      to actually alter the column type).
--
-- Fix: convert both to plain TEXT. The source of truth for allowed
-- values now lives in the reference tables (container_sizes) and the
-- application-level VALID_STATUSES allowlist. FK constraints
-- (container_size_id) still enforce data integrity where it matters.
--
-- We have to drop the live_orders view that references orders.*,
-- then recreate it (same pattern as migration 044).
-- ============================================================

BEGIN;

-- 1. Drop the dependent view (will be recreated below)
DROP VIEW IF EXISTS live_orders;

-- 2. Convert orders.container_size from enum → TEXT
ALTER TABLE orders
  ALTER COLUMN container_size TYPE TEXT
  USING container_size::TEXT;

-- 3. Also convert rates.container_size if it exists (same enum, same problem)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'rates' AND column_name = 'container_size'
  ) THEN
    EXECUTE 'ALTER TABLE rates ALTER COLUMN container_size TYPE TEXT USING container_size::TEXT';
  END IF;
END $$;

-- 4. Convert orders.status from enum → TEXT so 'available' and 'dropped'
--    (and any future status additions) can be saved without needing to
--    alter the enum type. Drop the default first because it references the
--    enum, then re-add it with a text literal.
ALTER TABLE orders ALTER COLUMN status DROP DEFAULT;
ALTER TABLE orders
  ALTER COLUMN status TYPE TEXT
  USING status::TEXT;
ALTER TABLE orders ALTER COLUMN status SET DEFAULT 'pending';

-- 5. The order_status_history audit table also references this enum
--    (old_status and new_status columns). Convert those too so the audit
--    writes don't fail when a status value isn't in the original enum.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'order_status_history' AND column_name = 'new_status'
  ) THEN
    EXECUTE 'ALTER TABLE order_status_history ALTER COLUMN new_status TYPE TEXT USING new_status::TEXT';
    EXECUTE 'ALTER TABLE order_status_history ALTER COLUMN old_status TYPE TEXT USING old_status::TEXT';
  END IF;
END $$;

-- 6. Drop the now-orphaned enum types so they can't cause confusion later.
DROP TYPE IF EXISTS container_size_enum;
DROP TYPE IF EXISTS order_status_enum;

-- 7. Recreate the live_orders view (same definition as migration 043)
CREATE VIEW live_orders AS
SELECT * FROM orders WHERE deleted_at IS NULL;

ALTER VIEW live_orders SET (security_invoker = on);

GRANT SELECT ON live_orders TO anon, authenticated, service_role;

COMMENT ON VIEW live_orders IS
  'Filtered view of orders excluding soft-deleted rows. Use this for any query that should NOT see deleted loads. The orders table itself remains accessible for the deleted loads page, restore flow, audit lookups, and realtime subscriptions.';

COMMENT ON COLUMN orders.container_size IS
  'Denormalized snapshot of the container size code (e.g. "20", "40", "40HC", "53"). The authoritative list lives in the container_sizes reference table; orders.container_size_id is the FK.';

COMMENT ON COLUMN orders.status IS
  'Load lifecycle status. Valid values are enforced at the API layer (see VALID_STATUSES in pages/api/tenant/loads/index.js). Common values: pending, available, dispatched, in_transit, dropped, delivered, completed, cancelled.';

-- Tell PostgREST to reload its schema cache so the API picks up the new
-- column type immediately.
NOTIFY pgrst, 'reload schema';

COMMIT;
