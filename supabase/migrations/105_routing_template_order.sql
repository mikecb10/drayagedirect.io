-- ============================================================
-- Migration 105: routing_template_order
-- ============================================================
-- Per-user ordering of routing template chips in the New Load
-- creation modal. Empty array = use default (DB) order. Any
-- template id not present in the array auto-appends at the end
-- on render — so admin-added templates surface for users who
-- have customized their order.
-- ============================================================

BEGIN;

ALTER TABLE user_dispatcher_preferences
  ADD COLUMN IF NOT EXISTS routing_template_order TEXT[] NOT NULL DEFAULT '{}';

NOTIFY pgrst, 'reload schema';

COMMIT;
