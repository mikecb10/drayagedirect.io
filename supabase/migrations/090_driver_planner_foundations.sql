-- Migration 090: Driver Planner foundations
--
-- Additive schema changes supporting the new Driver Planner tab on the
-- dispatcher module. Spec: docs/superpowers/specs/2026-04-22-driver-planner-design.md
--
-- - order_container_moves: ensure status enum includes all 6 v1 values;
--   add scheduled_date + sort_order for the planner grid
-- - orders: add container_at_port boolean + empty_ready_for_return_at timestamp
--   driving the right-rail bucket eligibility
-- - drivers: add eld_snapshot jsonb as empty backing store for a future
--   ELD/HOS integration (Samsara/Motive/Geotab)

BEGIN;

-- 1. order_container_moves.status — normalize to the 6 v1 values
--    If a CHECK constraint already exists with a different value set, drop it first.
ALTER TABLE order_container_moves
  DROP CONSTRAINT IF EXISTS order_container_moves_status_check;

ALTER TABLE order_container_moves
  ADD CONSTRAINT order_container_moves_status_check
  CHECK (status IN ('unassigned', 'pending', 'dispatched', 'in_progress', 'completed', 'cancelled'));

-- Backfill any legacy NULL or foreign values to 'unassigned' (if driver_id is null) or 'pending'
UPDATE order_container_moves
   SET status = CASE WHEN driver_id IS NULL THEN 'unassigned' ELSE 'pending' END
 WHERE status IS NULL
    OR status NOT IN ('unassigned', 'pending', 'dispatched', 'in_progress', 'completed', 'cancelled');

-- 2. order_container_moves.scheduled_date + sort_order
ALTER TABLE order_container_moves
  ADD COLUMN IF NOT EXISTS scheduled_date date;

ALTER TABLE order_container_moves
  ADD COLUMN IF NOT EXISTS sort_order integer;

-- Backfill scheduled_date from the earliest routing event's scheduled_at for each move
UPDATE order_container_moves m
   SET scheduled_date = sub.min_date
  FROM (
    SELECT move_id, MIN(scheduled_at)::date AS min_date
      FROM order_routing_events
     WHERE scheduled_at IS NOT NULL
     GROUP BY move_id
  ) sub
 WHERE m.id = sub.move_id
   AND m.scheduled_date IS NULL;

-- Composite index for the grid query
CREATE INDEX IF NOT EXISTS idx_ocm_planner_grid
  ON order_container_moves (tenant_id, driver_id, scheduled_date, sort_order);

-- Secondary index for the right-rail (unassigned pool)
CREATE INDEX IF NOT EXISTS idx_ocm_unassigned_pool
  ON order_container_moves (tenant_id, status, move_type)
  WHERE driver_id IS NULL;

-- 3. orders: container_at_port + empty_ready_for_return_at
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS container_at_port boolean NOT NULL DEFAULT false;

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS empty_ready_for_return_at timestamptz;

-- Bucket eligibility often checks these together with move_type via joins;
-- a supporting index on orders is sufficient:
CREATE INDEX IF NOT EXISTS idx_orders_container_at_port
  ON orders (tenant_id, container_at_port)
  WHERE container_at_port = true;

-- 4. drivers.eld_snapshot — empty JSONB backing store
ALTER TABLE drivers
  ADD COLUMN IF NOT EXISTS eld_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMIT;

NOTIFY pgrst, 'reload schema';
