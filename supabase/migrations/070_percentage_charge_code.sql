-- Migration 070: Add percentage_charge_code to driver charge profiles
--
-- When a driver charge profile uses UOM = percentage and percentage_based_on
-- is 'ar_invoice' or 'driver_pay', we need to know WHICH specific charge code
-- (LINE_HAUL, FUEL, CHASSIS, etc.) the percentage should be calculated from.
--
-- Also adds the same column to AR charge_profiles for consistency.

BEGIN;

-- Driver charge profiles: which charge code to base the percentage on
ALTER TABLE driver_charge_profiles
  ADD COLUMN IF NOT EXISTS percentage_charge_code TEXT;

-- AR charge profiles: same addition for consistency
ALTER TABLE charge_profiles
  ADD COLUMN IF NOT EXISTS percentage_charge_code TEXT;

COMMIT;

NOTIFY pgrst, 'reload schema';
