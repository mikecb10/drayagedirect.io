-- ============================================================
-- Migration 096: charge_set + container_move status history
-- ============================================================
-- Adds audit-trail tables for status transitions on
-- order_charge_sets and order_container_moves, mirroring the
-- shape of order_status_history (from migration 001). These tables
-- are written by the new transition helpers at
-- lib/charge-sets/transition.js and lib/routing/moves/transition.js.
--
-- Tables are valuable independent of the upcoming event spine
-- (Stream B.1b) — they answer "when did X become Y?" questions
-- that today are unanswerable.
--
-- old_status / new_status are TEXT (not enum) on purpose: history
-- tables outlive enum evolution. Source tables keep their enum
-- columns; history is more permissive by design.
-- ============================================================

BEGIN;

CREATE TABLE IF NOT EXISTS order_charge_sets_status_history (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  charge_set_id UUID NOT NULL REFERENCES order_charge_sets(id) ON DELETE CASCADE,
  old_status TEXT,
  new_status TEXT NOT NULL,
  changed_by UUID REFERENCES users(id),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_charge_set_status_history_tenant_cs
  ON order_charge_sets_status_history(tenant_id, charge_set_id);

CREATE TABLE IF NOT EXISTS order_container_moves_status_history (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  move_id UUID NOT NULL REFERENCES order_container_moves(id) ON DELETE CASCADE,
  old_status TEXT,
  new_status TEXT NOT NULL,
  changed_by UUID REFERENCES users(id),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_move_status_history_tenant_move
  ON order_container_moves_status_history(tenant_id, move_id);

NOTIFY pgrst, 'reload schema';

COMMIT;
