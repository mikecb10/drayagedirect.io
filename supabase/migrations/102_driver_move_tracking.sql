-- ============================================================
-- Migration 102: Driver Move-Tracking Foundation
-- ============================================================
-- Builds on existing migration 036 driver-tracking scaffolding
-- (driver_location_pings, geofence_events, drive_segments, plus
-- drivers.last_latitude/longitude/last_location_at/etc.). Reuses
-- where the shape matches; adds only what's net-new for FU-085.
--
-- Net-new additions:
--   - driver_location_pings.move_id + .battery_pct (extend existing table)
--   - order_container_moves: tracking_status state machine + session +
--     last_ping_at + ping_count + eta_recompute_count
--   - order_routing_events: ETA cache columns
--   - drivers: 8 auth + consent columns
--   - move_tracking_session_history audit table
--   - driver_auth_attempts rate-limit table
--   - move_tracking feature flag
--
-- Re-used (no new schema): driver_location_pings (table from 036),
-- drivers.last_latitude/last_longitude/last_location_at/last_speed_mph/
-- last_heading/last_location_source (columns from 036), geofence_events
-- (table from 036, used by Phase 2).
--
-- Spec: docs/superpowers/specs/2026-04-24-driver-move-tracking-design.md
-- FU-085. PR 1 of 7.
-- ============================================================

BEGIN;

-- 1. Extend driver_location_pings (from migration 036) with move scoping +
--    battery telemetry. The existing table has the right shape:
--      - driver_id (NOT NULL) + order_id (nullable)
--      - latitude/longitude NUMERIC(10,7) with valid_latitude/longitude CHECKs
--      - source CHECK ('eld','mobile_app','manual')
--      - heading NUMERIC(5,1), speed_mph NUMERIC(5,1), accuracy_meters NUMERIC(7,1)
--      - eld_provider, eld_device_id (nullable; populated only for eld source)
--      - recorded_at + received_at
--      - RLS policies (pings_select, pings_insert)
--    We add per-move scoping for breadcrumb fetch + battery for the mobile
--    app's ping payload.
ALTER TABLE driver_location_pings
  ADD COLUMN IF NOT EXISTS move_id UUID REFERENCES order_container_moves(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS battery_pct INTEGER;

CREATE INDEX IF NOT EXISTS idx_driver_location_pings_move_recorded
  ON driver_location_pings(move_id, recorded_at DESC) WHERE move_id IS NOT NULL;

-- 2. Tracking session state on order_container_moves.
--    NOT adding current_lat/current_lng — drivers.last_latitude/last_longitude
--    (from migration 036) already serves "where is the driver now". A driver
--    works one in_transit/on_site move at a time, so per-driver denorm is
--    sufficient. last_ping_at IS added here for staleness detection without
--    a join (the stale-ping cron filters in_transit moves where last_ping_at
--    < now() - 10min).
ALTER TABLE order_container_moves
  ADD COLUMN IF NOT EXISTS tracking_status TEXT NOT NULL DEFAULT 'idle'
    CHECK (tracking_status IN ('idle','in_transit','on_site','paused','completed')),
  ADD COLUMN IF NOT EXISTS session_started_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS session_ended_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_ping_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS ping_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS eta_recompute_count INTEGER NOT NULL DEFAULT 0;

-- 3. ETA cache on order_routing_events
ALTER TABLE order_routing_events
  ADD COLUMN IF NOT EXISTS eta_arrival_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS eta_updated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS eta_distance_remaining_miles NUMERIC(7,2);

-- 4. Driver auth + consent on drivers (no overlap with 036's location columns)
ALTER TABLE drivers
  ADD COLUMN IF NOT EXISTS password_hash TEXT,
  ADD COLUMN IF NOT EXISTS password_set_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS password_must_change BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS session_min_iat TIMESTAMPTZ NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS location_tracking_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS tracking_consented_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS tracking_consent_version INTEGER,
  ADD COLUMN IF NOT EXISTS tracking_revoked_at TIMESTAMPTZ;

-- 5. Move-tracking session history (audit, mirrors B.1e pattern)
CREATE TABLE IF NOT EXISTS move_tracking_session_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  move_id UUID NOT NULL REFERENCES order_container_moves(id) ON DELETE CASCADE,
  from_status TEXT,
  to_status TEXT NOT NULL,
  transitioned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  actor_id UUID,
  actor_type TEXT NOT NULL CHECK (actor_type IN ('human','system','agent')),
  actor_context JSONB,
  note TEXT
);

CREATE INDEX IF NOT EXISTS idx_tracking_session_history_move
  ON move_tracking_session_history(move_id, transitioned_at DESC);

-- 6. Driver login attempts (rate-limit by username)
CREATE TABLE IF NOT EXISTS driver_auth_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID,
  username TEXT NOT NULL,
  ip_address INET,
  succeeded BOOLEAN NOT NULL,
  attempted_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_driver_auth_attempts_username_recent
  ON driver_auth_attempts(username, attempted_at DESC);

-- 7. Feature flag row.
--    NOTE: feature_flags table uses is_active (NOT default_enabled).
--    is_active=false registers globally-disabled; per-tenant
--    tenant_feature_flags rows opt individual tenants in.
INSERT INTO feature_flags (name, description, is_active)
VALUES ('move_tracking', 'Driver mobile move tracking with live ETA + breadcrumbs', false)
ON CONFLICT (name) DO NOTHING;

NOTIFY pgrst, 'reload schema';

COMMIT;
