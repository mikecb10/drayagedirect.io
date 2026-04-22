-- Migration 091: Add assigned_at to order_container_moves
--
-- Follow-on to migration 090. The Driver Planner's MoveCell displays an
-- "Assigned: MM/DD HH:mm" timestamp to help dispatchers see when a move
-- was assigned to a driver, and the assign endpoint needs somewhere to
-- write that value. Separate migration because 090 was already applied
-- to the live DB before this gap was caught.

BEGIN;

ALTER TABLE order_container_moves
  ADD COLUMN IF NOT EXISTS assigned_at timestamptz;

COMMIT;

NOTIFY pgrst, 'reload schema';
