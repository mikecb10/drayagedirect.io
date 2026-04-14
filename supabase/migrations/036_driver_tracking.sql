-- ============================================================
-- Migration 036: Driver GPS Tracking & Location Pings
-- ============================================================
-- Stores real-time GPS pings from drivers via:
--   1. ELD API integration (primary)
--   2. DrayageDirect mobile app (secondary)
--   3. Manual updates (fallback)
--
-- Also tracks geofence enter/exit events and drive segments.
-- ============================================================

-- GPS location pings — high-frequency, append-only
CREATE TABLE IF NOT EXISTS driver_location_pings (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  driver_id UUID NOT NULL REFERENCES drivers(id) ON DELETE CASCADE,
  order_id UUID REFERENCES orders(id) ON DELETE SET NULL,

  -- Location
  latitude NUMERIC(10, 7) NOT NULL,
  longitude NUMERIC(10, 7) NOT NULL,
  heading NUMERIC(5, 1), -- degrees 0-360
  speed_mph NUMERIC(5, 1),
  accuracy_meters NUMERIC(7, 1),

  -- Source priority: eld > mobile_app > manual
  source TEXT NOT NULL DEFAULT 'mobile_app' CHECK (source IN ('eld', 'mobile_app', 'manual')),
  eld_provider TEXT, -- e.g. 'samsara', 'keeptruckin', 'omnitracs'
  eld_device_id TEXT,

  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(), -- when the GPS reading was taken
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(), -- when our server got it

  CONSTRAINT valid_latitude CHECK (latitude BETWEEN -90 AND 90),
  CONSTRAINT valid_longitude CHECK (longitude BETWEEN -180 AND 180)
);

-- Partition-friendly index for time-range queries
CREATE INDEX IF NOT EXISTS idx_pings_driver_time ON driver_location_pings(tenant_id, driver_id, recorded_at DESC);
CREATE INDEX IF NOT EXISTS idx_pings_order ON driver_location_pings(order_id, recorded_at DESC);

-- Geofence events — when a driver enters/exits an org's geofence
CREATE TABLE IF NOT EXISTS geofence_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  driver_id UUID NOT NULL REFERENCES drivers(id) ON DELETE CASCADE,
  order_id UUID REFERENCES orders(id) ON DELETE SET NULL,
  organization_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  routing_event_id UUID REFERENCES order_routing_events(id) ON DELETE SET NULL,

  -- Event type
  event_type TEXT NOT NULL CHECK (event_type IN ('enter', 'exit')),

  -- Location at the moment of enter/exit
  latitude NUMERIC(10, 7) NOT NULL,
  longitude NUMERIC(10, 7) NOT NULL,

  -- Source
  source TEXT NOT NULL DEFAULT 'mobile_app' CHECK (source IN ('eld', 'mobile_app', 'manual')),

  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_geofence_events_order ON geofence_events(order_id, recorded_at DESC);
CREATE INDEX IF NOT EXISTS idx_geofence_events_driver ON geofence_events(driver_id, recorded_at DESC);

-- Drive segments — computed from pings, represents a leg of travel
CREATE TABLE IF NOT EXISTS drive_segments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  driver_id UUID NOT NULL REFERENCES drivers(id) ON DELETE CASCADE,
  order_id UUID REFERENCES orders(id) ON DELETE SET NULL,
  routing_event_id UUID REFERENCES order_routing_events(id) ON DELETE SET NULL,

  -- Segment type
  segment_type TEXT NOT NULL CHECK (segment_type IN ('driving', 'dwell', 'idle')),

  -- Start/end
  started_at TIMESTAMPTZ NOT NULL,
  ended_at TIMESTAMPTZ,
  duration_minutes INTEGER,

  -- Driving stats (only for 'driving' segments)
  distance_miles NUMERIC(8, 2),
  avg_speed_mph NUMERIC(5, 1),
  max_speed_mph NUMERIC(5, 1),

  -- Location info
  start_lat NUMERIC(10, 7),
  start_lng NUMERIC(10, 7),
  end_lat NUMERIC(10, 7),
  end_lng NUMERIC(10, 7),
  start_location_name TEXT,
  end_location_name TEXT,

  -- Route trace (array of [lat, lng] points for map polyline)
  route_trace JSONB DEFAULT '[]'::jsonb,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_drive_segments_order ON drive_segments(order_id, started_at DESC);

-- Driver's current/last known location (denormalized for fast queries)
-- Updated on every ping — avoids scanning the pings table
ALTER TABLE drivers ADD COLUMN IF NOT EXISTS last_latitude NUMERIC(10, 7);
ALTER TABLE drivers ADD COLUMN IF NOT EXISTS last_longitude NUMERIC(10, 7);
ALTER TABLE drivers ADD COLUMN IF NOT EXISTS last_location_at TIMESTAMPTZ;
ALTER TABLE drivers ADD COLUMN IF NOT EXISTS last_location_source TEXT;
ALTER TABLE drivers ADD COLUMN IF NOT EXISTS last_speed_mph NUMERIC(5, 1);
ALTER TABLE drivers ADD COLUMN IF NOT EXISTS last_heading NUMERIC(5, 1);

-- ELD connection info on driver profile
ALTER TABLE drivers ADD COLUMN IF NOT EXISTS eld_provider TEXT; -- samsara, keeptruckin, etc.
ALTER TABLE drivers ADD COLUMN IF NOT EXISTS eld_device_id TEXT;
ALTER TABLE drivers ADD COLUMN IF NOT EXISTS eld_connected BOOLEAN DEFAULT false;

-- RLS
ALTER TABLE driver_location_pings ENABLE ROW LEVEL SECURITY;
CREATE POLICY pings_select ON driver_location_pings FOR SELECT
  USING (tenant_id = current_tenant_id() OR is_dd_admin());
CREATE POLICY pings_insert ON driver_location_pings FOR INSERT
  WITH CHECK (tenant_id = current_tenant_id() OR is_dd_admin());

ALTER TABLE geofence_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY geofence_events_select ON geofence_events FOR SELECT
  USING (tenant_id = current_tenant_id() OR is_dd_admin());
CREATE POLICY geofence_events_insert ON geofence_events FOR INSERT
  WITH CHECK (tenant_id = current_tenant_id() OR is_dd_admin());

ALTER TABLE drive_segments ENABLE ROW LEVEL SECURITY;
CREATE POLICY drive_segments_select ON drive_segments FOR SELECT
  USING (tenant_id = current_tenant_id() OR is_dd_admin());
CREATE POLICY drive_segments_insert ON drive_segments FOR INSERT
  WITH CHECK (tenant_id = current_tenant_id() OR is_dd_admin());
