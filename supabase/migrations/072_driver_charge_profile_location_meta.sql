-- Migration 072 — Google Places metadata for driver charge profile locations
--
-- EventLocationPicker now uses Google Places Autocomplete so the user
-- selects a validated location instead of free text. We need to stash
-- the extra Google fields (place_id, lat, lon, country, formatted
-- address) so the engine/analytics can use them later for distance
-- math, API integrations, and canonicalization.
--
-- A single JSONB column per location slot keeps the schema flat and
-- forward-compatible — Google may add fields later, we don't want to
-- bump the schema every time.
--
-- The existing {type, id, value} columns stay as the primary matching
-- surface (string-equality on city_state/zip). Meta is metadata.

BEGIN;

ALTER TABLE driver_charge_profile_tiers
  ADD COLUMN IF NOT EXISTS event_location_meta JSONB,
  ADD COLUMN IF NOT EXISTS leg_from_location_meta JSONB,
  ADD COLUMN IF NOT EXISTS leg_to_location_meta JSONB;

COMMIT;

NOTIFY pgrst, 'reload schema';
