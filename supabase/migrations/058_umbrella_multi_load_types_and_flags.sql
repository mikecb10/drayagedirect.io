-- ============================================================
-- Migration 058: Umbrella Multi-Load-Types + Extended Flag Set
-- ============================================================
-- Two changes to email_umbrellas based on user feedback on the
-- umbrella editor UI:
--
-- 1. Load type becomes multi-select — a single umbrella can now
--    apply to Import AND Export simultaneously, rather than being
--    restricted to one load type. Schema change: load_type TEXT
--    becomes load_types TEXT[]. Matching semantics at trigger time
--    change from `load.load_type = umbrella.load_type` to
--    `load.load_type = ANY(umbrella.load_types)` when the array is
--    non-empty (empty = match any).
--
-- 2. Flag set expands from 6 to 14 boolean filter columns to
--    mirror the full set of is_* flags on the orders table:
--    hazmat, overweight, liquor, hot, genset, oog  (existing)
--    overheight, scale, ev, street_turn, bonded, double, tanker,
--    bill_only  (new in this migration)
--
-- The specificity_score trigger function is updated to count all
-- 27 filter columns (was 19). BEFORE INSERT/UPDATE trigger already
-- in place from migration 052 — CREATE OR REPLACE swaps the
-- function under it transparently.
-- ============================================================

BEGIN;

-- ──────────────────────────────────────────────────────────────
-- 1. Add load_types TEXT[] column (non-null default empty array)
-- ──────────────────────────────────────────────────────────────
ALTER TABLE email_umbrellas
  ADD COLUMN IF NOT EXISTS load_types TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

-- ──────────────────────────────────────────────────────────────
-- 2. Backfill load_types from the old single load_type column
--    (only on rows where load_types is still empty and load_type
--    is populated).
--
--    IMPORTANT: We wrap this in a DO block that checks
--    information_schema FIRST. If a prior run of this migration
--    already dropped the load_type column, we skip the backfill
--    entirely so the migration stays idempotent and safe to
--    re-run from any partial state.
-- ──────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'email_umbrellas'
      AND column_name = 'load_type'
  ) THEN
    UPDATE email_umbrellas
    SET load_types = ARRAY[load_type]
    WHERE load_type IS NOT NULL
      AND cardinality(load_types) = 0;
  END IF;
END $$;

-- ──────────────────────────────────────────────────────────────
-- 3. Add the 8 new flag columns (tri-state BOOLEAN: NULL = any)
-- ──────────────────────────────────────────────────────────────
ALTER TABLE email_umbrellas
  ADD COLUMN IF NOT EXISTS overheight BOOLEAN,
  ADD COLUMN IF NOT EXISTS scale BOOLEAN,
  ADD COLUMN IF NOT EXISTS ev BOOLEAN,
  ADD COLUMN IF NOT EXISTS street_turn BOOLEAN,
  ADD COLUMN IF NOT EXISTS bonded BOOLEAN,
  ADD COLUMN IF NOT EXISTS double BOOLEAN,
  ADD COLUMN IF NOT EXISTS tanker BOOLEAN,
  ADD COLUMN IF NOT EXISTS bill_only BOOLEAN;

-- ──────────────────────────────────────────────────────────────
-- 4. Rewrite the specificity function to account for load_types
--    array and the 8 new flag columns. Existing BEFORE trigger
--    installed in 052 transparently picks up the replacement.
-- ──────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION compute_email_umbrella_specificity()
RETURNS TRIGGER AS $$
BEGIN
  NEW.specificity_score := (
    -- load_types counts 1 if any entry present, not N
    (CASE WHEN NEW.load_types IS NOT NULL AND cardinality(NEW.load_types) > 0 THEN 1 ELSE 0 END) +
    -- Org FKs
    (CASE WHEN NEW.customer_id IS NOT NULL THEN 1 ELSE 0 END) +
    (CASE WHEN NEW.pickup_location_id IS NOT NULL THEN 1 ELSE 0 END) +
    (CASE WHEN NEW.delivery_location_id IS NOT NULL THEN 1 ELSE 0 END) +
    (CASE WHEN NEW.return_location_id IS NOT NULL THEN 1 ELSE 0 END) +
    -- Equipment reference
    (CASE WHEN NEW.container_type IS NOT NULL THEN 1 ELSE 0 END) +
    (CASE WHEN NEW.container_size IS NOT NULL THEN 1 ELSE 0 END) +
    (CASE WHEN NEW.ssl IS NOT NULL THEN 1 ELSE 0 END) +
    (CASE WHEN NEW.csr IS NOT NULL THEN 1 ELSE 0 END) +
    (CASE WHEN NEW.route_id IS NOT NULL THEN 1 ELSE 0 END) +
    (CASE WHEN NEW.chassis_type IS NOT NULL THEN 1 ELSE 0 END) +
    (CASE WHEN NEW.chassis_size IS NOT NULL THEN 1 ELSE 0 END) +
    (CASE WHEN NEW.chassis_owner IS NOT NULL THEN 1 ELSE 0 END) +
    -- Existing 6 flags
    (CASE WHEN NEW.hazmat IS NOT NULL THEN 1 ELSE 0 END) +
    (CASE WHEN NEW.overweight IS NOT NULL THEN 1 ELSE 0 END) +
    (CASE WHEN NEW.liquor IS NOT NULL THEN 1 ELSE 0 END) +
    (CASE WHEN NEW.hot IS NOT NULL THEN 1 ELSE 0 END) +
    (CASE WHEN NEW.genset IS NOT NULL THEN 1 ELSE 0 END) +
    (CASE WHEN NEW.oog IS NOT NULL THEN 1 ELSE 0 END) +
    -- 8 new flags from migration 058
    (CASE WHEN NEW.overheight IS NOT NULL THEN 1 ELSE 0 END) +
    (CASE WHEN NEW.scale IS NOT NULL THEN 1 ELSE 0 END) +
    (CASE WHEN NEW.ev IS NOT NULL THEN 1 ELSE 0 END) +
    (CASE WHEN NEW.street_turn IS NOT NULL THEN 1 ELSE 0 END) +
    (CASE WHEN NEW.bonded IS NOT NULL THEN 1 ELSE 0 END) +
    (CASE WHEN NEW.double IS NOT NULL THEN 1 ELSE 0 END) +
    (CASE WHEN NEW.tanker IS NOT NULL THEN 1 ELSE 0 END) +
    (CASE WHEN NEW.bill_only IS NOT NULL THEN 1 ELSE 0 END)
  );
  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ──────────────────────────────────────────────────────────────
-- 5. Drop the legacy load_type column. Safe because:
--    - The specificity function no longer references it
--    - The API will be updated in the same release to read/write
--      load_types instead
--    - Backfill above preserved the data in load_types
-- ──────────────────────────────────────────────────────────────
ALTER TABLE email_umbrellas
  DROP COLUMN IF EXISTS load_type;

-- ──────────────────────────────────────────────────────────────
-- 6. Force the trigger to run on all existing rows so their
--    specificity_score reflects the new formula (which now counts
--    load_types and the 8 new flags). Cheapest way to fire BEFORE
--    UPDATE on every row is a no-op SET.
-- ──────────────────────────────────────────────────────────────
UPDATE email_umbrellas
SET updated_at = updated_at;

NOTIFY pgrst, 'reload schema';

COMMIT;
