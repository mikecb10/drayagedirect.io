-- ============================================================
-- Migration 111: Load notify parties + customer defaults
-- ============================================================
-- Adds per-load notify parties (groups/contacts attached to a
-- specific load that get added to email umbrella recipients via
-- the new `load_notify_parties` role token).
--
-- Adds `default_notify_parties` JSONB column on customers so a
-- tenant can pre-configure the parties auto-populated when a new
-- load is created for that customer.
--
-- Builds on FU-043 (migration 099): the parties referenced are
-- organization_groups + organization_contacts, NOT the legacy
-- customer_contact_groups system (migration 002).
-- ============================================================

BEGIN;

CREATE TABLE IF NOT EXISTS load_notify_parties (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  load_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  party_type TEXT NOT NULL CHECK (party_type IN ('group', 'contact')),
  party_id UUID NOT NULL,
  source TEXT CHECK (source IS NULL OR source IN (
    'customer', 'pickup_location', 'delivery_location', 'return_location', 'other_org', 'default'
  )),
  source_organization_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by UUID,
  UNIQUE (tenant_id, load_id, party_type, party_id)
);

CREATE INDEX IF NOT EXISTS idx_load_notify_parties_load
  ON load_notify_parties (tenant_id, load_id);

CREATE INDEX IF NOT EXISTS idx_load_notify_parties_party
  ON load_notify_parties (party_type, party_id);

ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS default_notify_parties JSONB NOT NULL DEFAULT '[]'::jsonb;

NOTIFY pgrst, 'reload schema';

COMMIT;
