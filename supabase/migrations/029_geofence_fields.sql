-- ============================================================
-- Migration 029: Geofence fields on organizations
-- ============================================================
ALTER TABLE customers ADD COLUMN IF NOT EXISTS geofence_type TEXT; -- 'circle' | 'polygon' | null
ALTER TABLE customers ADD COLUMN IF NOT EXISTS geofence_data JSONB; -- {center:{lat,lng}, radius_meters} or {points:[{lat,lng}]}
