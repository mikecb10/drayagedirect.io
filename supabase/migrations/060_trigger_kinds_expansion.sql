-- ============================================================
-- Migration 060: Expand email_template_triggers.trigger_kind enum
-- ============================================================
-- The original migration 052 constrained trigger_kind to
-- ('evented', 'polled'), which was my first-pass model. The
-- drayage-specific trigger model needs 4 kinds to fit the way
-- dispatchers actually reason about automated emails:
--
--   'field_change' — fires when a watched column on the load
--                    transitions (Added / Removed / Updated).
--                    E.g. "when Container # is Added".
--
--   'notification' — fires when a boolean notification flips
--                    true. E.g. "when the dispatcher marks
--                    the load Ready to Return".
--
--   'event'        — composite named drayage events with their
--                    own condition sub-forms (Approaching
--                    Demurrage, Missing Information, etc.).
--
--   'status'       — fires when the load's order_status changes
--                    to a specific value, with a NOTIFY AFTER
--                    delay (e.g. "Dispatched + 30 minutes").
--
-- Safe to run: no existing rows to migrate (the e2e test cleaned
-- up all test triggers). If anyone has created real triggers
-- under the old 'evented'/'polled' kinds, this migration will
-- FAIL on the rewrite. We intentionally leave the constraint
-- drop+add as a single transaction so a failure here is obvious.
-- ============================================================

BEGIN;

-- Sanity check: refuse to run if any existing rows use the old kinds
-- so we don't silently corrupt real data.
DO $$
DECLARE
  legacy_count INT;
BEGIN
  SELECT COUNT(*) INTO legacy_count
  FROM email_template_triggers
  WHERE trigger_kind IN ('evented', 'polled');

  IF legacy_count > 0 THEN
    RAISE EXCEPTION 'Migration 060 aborted: % existing triggers still use the legacy evented/polled kinds. Clear them first, then re-run.', legacy_count;
  END IF;
END $$;

-- Drop the old constraint. The auto-generated name is
-- email_template_triggers_trigger_kind_check per PostgreSQL conventions.
ALTER TABLE email_template_triggers
  DROP CONSTRAINT IF EXISTS email_template_triggers_trigger_kind_check;

-- Add the new constraint with 4 kinds
ALTER TABLE email_template_triggers
  ADD CONSTRAINT email_template_triggers_trigger_kind_check
  CHECK (trigger_kind IN ('field_change', 'notification', 'event', 'status'));

NOTIFY pgrst, 'reload schema';

COMMIT;
