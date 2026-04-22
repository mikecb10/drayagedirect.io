-- Migration 089: routing event distance persistence + silent-$0 safety net
--
-- Adds estimated_miles + distance_is_manual to order_routing_events.
-- Adds needs_distance flag to charge line items + driver pay lines.
-- Creates trigger_sync_order_estimated_miles that rolls up the sum
-- into orders.estimated_miles on any event INSERT/UPDATE/DELETE.

BEGIN;

-- 1. New columns on order_routing_events
ALTER TABLE order_routing_events
  ADD COLUMN IF NOT EXISTS estimated_miles NUMERIC(8,2),
  ADD COLUMN IF NOT EXISTS distance_is_manual BOOLEAN NOT NULL DEFAULT false;

-- 2. needs_distance flag on the AR charge line items table
ALTER TABLE order_charge_set_line_items
  ADD COLUMN IF NOT EXISTS needs_distance BOOLEAN NOT NULL DEFAULT false;

-- 3. needs_distance flag on the AP driver pay lines table
ALTER TABLE order_driver_pay_lines
  ADD COLUMN IF NOT EXISTS needs_distance BOOLEAN NOT NULL DEFAULT false;

-- 4. Trigger function: recompute orders.estimated_miles from the sum of
--    estimated_miles across all routing events for the affected order.
--    The CASE distinguishes two cases so the engine's gate works correctly:
--      - ALL events have NULL distance (legacy / pre-migration) → store NULL
--        → engine treats as unresolved → safety-net gate triggers.
--      - At least one event has a distance value (even 0) → store sum
--        → engine proceeds with the sum (legitimately zero-mile loads
--        return $0 per_mile without triggering the gate).
CREATE OR REPLACE FUNCTION trigger_sync_order_estimated_miles()
RETURNS TRIGGER AS $$
DECLARE
  affected_order_id UUID;
  new_total NUMERIC(8,2);
BEGIN
  affected_order_id := COALESCE(NEW.order_id, OLD.order_id);
  SELECT
    CASE
      WHEN COUNT(*) FILTER (WHERE estimated_miles IS NOT NULL) = 0 THEN NULL
      ELSE COALESCE(SUM(estimated_miles), 0)
    END
    INTO new_total
    FROM order_routing_events
    WHERE order_id = affected_order_id;
  UPDATE orders
    SET estimated_miles = new_total,
        updated_at = now()
    WHERE id = affected_order_id;
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

-- 5. Attach trigger
DROP TRIGGER IF EXISTS trg_sync_order_estimated_miles ON order_routing_events;
CREATE TRIGGER trg_sync_order_estimated_miles
  AFTER INSERT OR UPDATE OR DELETE ON order_routing_events
  FOR EACH ROW EXECUTE FUNCTION trigger_sync_order_estimated_miles();

-- 6. Refresh PostgREST schema cache
NOTIFY pgrst, 'reload schema';

COMMIT;
