-- ============================================================
-- Migration 097: email_template_triggers.entity_type column
-- ============================================================
-- Generalizes status-change triggers to target orders, charge_sets,
-- or moves (not just orders). Existing rows default to 'order',
-- preserving their behavior post-migration.
--
-- Consumed by:
--   - lib/email-dispatch/status-change-fire.js (generalized firing)
--   - lib/email-dispatch/evaluators/status.js (polled evaluator)
--
-- Part of Stream B.1b (event spine generalization).
-- ============================================================

BEGIN;

ALTER TABLE email_template_triggers
  ADD COLUMN IF NOT EXISTS entity_type TEXT NOT NULL DEFAULT 'order';

ALTER TABLE email_template_triggers
  DROP CONSTRAINT IF EXISTS chk_trigger_entity_type;

ALTER TABLE email_template_triggers
  ADD CONSTRAINT chk_trigger_entity_type
  CHECK (entity_type IN ('order', 'charge_set', 'move'));

CREATE INDEX IF NOT EXISTS idx_triggers_tenant_kind_entity_event
  ON email_template_triggers (tenant_id, trigger_kind, entity_type, event_name)
  WHERE is_active = true;

NOTIFY pgrst, 'reload schema';

COMMIT;
