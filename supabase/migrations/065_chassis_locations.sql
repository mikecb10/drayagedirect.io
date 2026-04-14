-- ============================================================
-- Migration 065: Chassis Location Fields on Orders
-- ============================================================
-- Adds hook_chassis_location_id and terminate_chassis_location_id
-- to the orders table. When NULL, the system assumes:
--   - Hook chassis = same location as container pickup
--   - Terminate chassis = same location as container return
-- This default behavior is handled in routing logic (future).
-- ============================================================

BEGIN;

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS hook_chassis_location_id UUID REFERENCES customers(id),
  ADD COLUMN IF NOT EXISTS terminate_chassis_location_id UUID REFERENCES customers(id);

CREATE INDEX IF NOT EXISTS idx_orders_hook_chassis
  ON orders(hook_chassis_location_id) WHERE hook_chassis_location_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_orders_terminate_chassis
  ON orders(terminate_chassis_location_id) WHERE terminate_chassis_location_id IS NOT NULL;

NOTIFY pgrst, 'reload schema';

COMMIT;
