-- ============================================================
-- Migration 098: actor_type foundation
-- ============================================================
-- Adds actor_type column to every table that records an action.
-- Values: 'human' (real user), 'system' (automation — trigger-fire,
-- cron), 'agent' (future AI agent runtime, Stream C).
--
-- All existing rows default to 'human' via DEFAULT. Forward data
-- stamps accurately from the moment code is deployed.
--
-- Additionally adds agent_metadata JSONB to tenant_audit_log for
-- future Stream C intent/outcome/token/cost data. No current writer.
--
-- Part of Stream B.1d (actor-type foundation). Closes FU-067.
-- ============================================================

BEGIN;

-- tenant_audit_log: actor_type + agent_metadata
ALTER TABLE tenant_audit_log
  ADD COLUMN IF NOT EXISTS actor_type TEXT NOT NULL DEFAULT 'human';
ALTER TABLE tenant_audit_log
  DROP CONSTRAINT IF EXISTS chk_tenant_audit_log_actor_type;
ALTER TABLE tenant_audit_log
  ADD CONSTRAINT chk_tenant_audit_log_actor_type
  CHECK (actor_type IN ('human', 'system', 'agent'));
ALTER TABLE tenant_audit_log
  ADD COLUMN IF NOT EXISTS agent_metadata JSONB;

-- admin_audit_log: actor_type
ALTER TABLE admin_audit_log
  ADD COLUMN IF NOT EXISTS actor_type TEXT NOT NULL DEFAULT 'human';
ALTER TABLE admin_audit_log
  DROP CONSTRAINT IF EXISTS chk_admin_audit_log_actor_type;
ALTER TABLE admin_audit_log
  ADD CONSTRAINT chk_admin_audit_log_actor_type
  CHECK (actor_type IN ('human', 'system', 'agent'));

-- email_trigger_log: actor_type
ALTER TABLE email_trigger_log
  ADD COLUMN IF NOT EXISTS actor_type TEXT NOT NULL DEFAULT 'human';
ALTER TABLE email_trigger_log
  DROP CONSTRAINT IF EXISTS chk_email_trigger_log_actor_type;
ALTER TABLE email_trigger_log
  ADD CONSTRAINT chk_email_trigger_log_actor_type
  CHECK (actor_type IN ('human', 'system', 'agent'));

-- order_status_history: actor_type
ALTER TABLE order_status_history
  ADD COLUMN IF NOT EXISTS actor_type TEXT NOT NULL DEFAULT 'human';
ALTER TABLE order_status_history
  DROP CONSTRAINT IF EXISTS chk_order_status_history_actor_type;
ALTER TABLE order_status_history
  ADD CONSTRAINT chk_order_status_history_actor_type
  CHECK (actor_type IN ('human', 'system', 'agent'));

-- order_charge_sets_status_history: actor_type
ALTER TABLE order_charge_sets_status_history
  ADD COLUMN IF NOT EXISTS actor_type TEXT NOT NULL DEFAULT 'human';
ALTER TABLE order_charge_sets_status_history
  DROP CONSTRAINT IF EXISTS chk_cs_status_history_actor_type;
ALTER TABLE order_charge_sets_status_history
  ADD CONSTRAINT chk_cs_status_history_actor_type
  CHECK (actor_type IN ('human', 'system', 'agent'));

-- order_container_moves_status_history: actor_type
ALTER TABLE order_container_moves_status_history
  ADD COLUMN IF NOT EXISTS actor_type TEXT NOT NULL DEFAULT 'human';
ALTER TABLE order_container_moves_status_history
  DROP CONSTRAINT IF EXISTS chk_move_status_history_actor_type;
ALTER TABLE order_container_moves_status_history
  ADD CONSTRAINT chk_move_status_history_actor_type
  CHECK (actor_type IN ('human', 'system', 'agent'));

NOTIFY pgrst, 'reload schema';

COMMIT;
