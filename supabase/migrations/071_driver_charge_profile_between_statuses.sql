-- Migration 071 — Driver Charge Profile calculation mode expansions
--
-- Three additions to driver_charge_profile_tiers:
--
--   1. between_statuses mode: new status_from / status_to TEXT columns
--      store the dispatcher-state endpoints for time-based pay calc.
--      The calculation_mode CHECK constraint on driver_charge_profiles
--      is also widened to include 'between_statuses'.
--
--   2. By Leg multi-select: leg_from_types / leg_to_types TEXT[] arrays
--      allow multiple leg types to match a single charge profile row.
--      Existing single-value leg_from / leg_to columns are preserved
--      so historical rows remain readable; new writes populate both the
--      array and (for backward compat) the first value of the array into
--      the single-value column.
--
--   3. move_events JSONB already exists (from migration 067) and was
--      never populated by the UI. Plan-A style client-side rewrite will
--      now persist arrays of {event_type, event_time, location_type,
--      location_id, location_value} entries into it. No schema change
--      needed here — column type is already compatible.

BEGIN;

-- 1. Between Statuses columns
ALTER TABLE driver_charge_profile_tiers
  ADD COLUMN IF NOT EXISTS status_from TEXT,
  ADD COLUMN IF NOT EXISTS status_to TEXT;

-- 2. By Leg multi-select arrays (alongside existing single-value cols)
ALTER TABLE driver_charge_profile_tiers
  ADD COLUMN IF NOT EXISTS leg_from_types TEXT[],
  ADD COLUMN IF NOT EXISTS leg_to_types TEXT[];

-- Backfill: copy existing single-value leg_from / leg_to into the new
-- arrays so pre-migration rows render consistently in the new UI.
UPDATE driver_charge_profile_tiers
SET leg_from_types = ARRAY[leg_from]
WHERE leg_from IS NOT NULL AND leg_from_types IS NULL;

UPDATE driver_charge_profile_tiers
SET leg_to_types = ARRAY[leg_to]
WHERE leg_to IS NOT NULL AND leg_to_types IS NULL;

-- 3. Widen the calculation_mode CHECK constraint on the parent table
-- (driver_charge_profiles) to include 'between_statuses'.
ALTER TABLE driver_charge_profiles
  DROP CONSTRAINT IF EXISTS driver_charge_profiles_calculation_mode_check;

ALTER TABLE driver_charge_profiles
  ADD CONSTRAINT driver_charge_profiles_calculation_mode_check
  CHECK (
    calculation_mode IS NULL
    OR calculation_mode IN ('by_event', 'by_move', 'by_leg', 'between_statuses')
  );

COMMIT;

NOTIFY pgrst, 'reload schema';
