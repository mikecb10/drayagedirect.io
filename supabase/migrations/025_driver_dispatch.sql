-- ============================================================
-- Migration 025: Driver dispatch support
-- ============================================================

-- Add open_routing_on_dispatch preference (default true)
ALTER TABLE user_dispatcher_preferences
  ADD COLUMN IF NOT EXISTS open_routing_on_dispatch BOOLEAN NOT NULL DEFAULT true;
