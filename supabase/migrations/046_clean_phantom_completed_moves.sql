-- ============================================================
-- Migration 046: Clean up phantom-completed container moves
-- ============================================================
-- A legacy bug in the /routing complete_load endpoint stamped every move
-- on a load with completed_at + status='completed' whenever a user
-- clicked "Complete Load", INCLUDING empty moves that had no driver,
-- no events, and no started_at.
--
-- Worse, the old uncomplete_load endpoint only reopened moves where
-- started_at IS NOT NULL — which meant any empty move that got auto-
-- completed this way was permanently stuck showing a "Completed" pill
-- in the routing tab, with no UI path to un-complete it.
--
-- The backend bug itself is now fixed (complete_load only touches
-- started moves; uncomplete_load reopens everything). But any existing
-- loads with stuck phantom completions need a one-time cleanup.
--
-- This migration resets any move where:
--   - completed_at IS NOT NULL (it's marked completed)
--   - AND started_at IS NULL (it was never actually started)
--   - AND it has no routing events with arrived_at or departed_at
--     (no real progress of any kind)
--
-- These conditions describe "a completely empty move that somehow got
-- a completed_at stamp". Safe to reset to pending.
-- ============================================================

BEGIN;

UPDATE order_container_moves m
SET
  completed_at = NULL,
  status = 'pending'
WHERE
  m.completed_at IS NOT NULL
  AND m.started_at IS NULL
  AND NOT EXISTS (
    SELECT 1
    FROM order_routing_events e
    WHERE e.move_id = m.id
      AND (e.arrived_at IS NOT NULL OR e.departed_at IS NOT NULL)
  );

-- PostgREST schema cache reload (harmless even though no columns changed,
-- follows the project migration convention so the API picks up any
-- cached row-count changes immediately).
NOTIFY pgrst, 'reload schema';

COMMIT;
