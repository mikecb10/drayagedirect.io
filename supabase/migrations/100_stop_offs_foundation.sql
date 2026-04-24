-- ============================================================
-- Migration 100: Stop-Offs + Chassis Splits Foundation
-- ============================================================
-- Foundation for B.1f (stop-offs feature) and B.1g (chassis splits
-- feature). Adds:
--   1. stop_off_types catalog (tenant-scoped CRUD target)
--   2. routing_event_status enum (applies to ALL routing events)
--   3. stop_off_type_id + event_status columns on order_routing_events
--   4. Backfill event_status from existing timestamps
--   5. order_routing_event_status_history audit table
--   6. Seeded defaults (Fuel Stop, Driver Break, Scale, Chassis Exchange)
--      for every existing tenant
-- ============================================================

BEGIN;

-- 1. Stop-off types catalog
CREATE TABLE IF NOT EXISTS stop_off_types (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  has_cargo_transfer BOOLEAN NOT NULL DEFAULT false,
  is_paid_to_driver BOOLEAN NOT NULL DEFAULT false,
  is_billable_to_customer BOOLEAN NOT NULL DEFAULT false,
  counts_toward_detention BOOLEAN NOT NULL DEFAULT false,
  requires_location_pick BOOLEAN NOT NULL DEFAULT true,
  is_active BOOLEAN NOT NULL DEFAULT true,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID REFERENCES users(id),
  UNIQUE (tenant_id, name)
);

CREATE INDEX IF NOT EXISTS idx_stop_off_types_tenant_active
  ON stop_off_types(tenant_id, sort_order) WHERE is_active = true;

-- 2. Routing-event status enum
DO $$ BEGIN
  CREATE TYPE routing_event_status AS ENUM ('pending', 'arrived', 'departed', 'skipped');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 3. Extend order_routing_events
ALTER TABLE order_routing_events
  ADD COLUMN IF NOT EXISTS stop_off_type_id UUID REFERENCES stop_off_types(id),
  ADD COLUMN IF NOT EXISTS event_status routing_event_status NOT NULL DEFAULT 'pending';

CREATE INDEX IF NOT EXISTS idx_routing_events_stop_off_type
  ON order_routing_events(stop_off_type_id) WHERE stop_off_type_id IS NOT NULL;

-- 4. Backfill event_status from existing timestamps (idempotent)
UPDATE order_routing_events
SET event_status =
  CASE
    WHEN departed_at IS NOT NULL THEN 'departed'::routing_event_status
    WHEN arrived_at  IS NOT NULL THEN 'arrived'::routing_event_status
    ELSE 'pending'::routing_event_status
  END
WHERE event_status = 'pending';

-- 5. Routing-event status history (audit trail per B.1a pattern)
CREATE TABLE IF NOT EXISTS order_routing_event_status_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  event_id UUID NOT NULL REFERENCES order_routing_events(id) ON DELETE CASCADE,
  from_status routing_event_status,
  to_status   routing_event_status NOT NULL,
  transitioned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  actor_id   UUID REFERENCES users(id),
  actor_type TEXT NOT NULL CHECK (actor_type IN ('human', 'system', 'agent')),
  actor_context JSONB,
  note TEXT
);

CREATE INDEX IF NOT EXISTS idx_event_status_history_event
  ON order_routing_event_status_history(event_id, transitioned_at DESC);

-- 6. Seed defaults for every existing tenant
INSERT INTO stop_off_types (
  tenant_id, name, description,
  has_cargo_transfer, is_paid_to_driver, is_billable_to_customer,
  counts_toward_detention, requires_location_pick, sort_order
)
SELECT
  t.id, v.name, v.description,
  v.has_cargo_transfer, v.is_paid_to_driver, v.is_billable_to_customer,
  v.counts_toward_detention, v.requires_location_pick, v.sort_order
FROM tenants t
CROSS JOIN (VALUES
  ('Fuel Stop',        'Driver refuels en route',                                false, false, false, false, true,  10),
  ('Driver Break',     'Mandated rest or meal break',                            false, false, false, false, false, 20),
  ('Scale',            'Weigh station / scale verification',                     false, false, true,  false, true,  30),
  ('Chassis Exchange', 'Swap chassis mid-route (e.g., different size or owner)', false, true,  false, false, true,  40)
) AS v(name, description, has_cargo_transfer, is_paid_to_driver, is_billable_to_customer, counts_toward_detention, requires_location_pick, sort_order)
ON CONFLICT (tenant_id, name) DO NOTHING;

NOTIFY pgrst, 'reload schema';

COMMIT;
