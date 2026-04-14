-- ============================================================
-- Migration 050: Rail / Port Check-In Slip verification
-- ============================================================
--
-- Adds verification tracking for the "Cleared for Rail/Port Check-In"
-- workflow on Outbound + Export loads.
--
-- ## The workflow
--
--   1. Dispatcher creates an Outbound or Export load and enters the
--      prenote values from the broker (container #, seal #, piece
--      count, weight, reference #, final destination).
--   2. Driver picks up the loaded container at the shipper.
--   3. Driver uploads the BOL document via mobile app.
--   4. Dispatcher pulls up the load, compares the uploaded BOL to the
--      prenote values, and either:
--        - Verifies the slip (clicks "Cleared for Rail/Port Check-In")
--        - OR escalates to broker/customer if there's a mismatch
--   5. Once verified, the driver gets a "cleared" badge in their
--      mobile app and can drive to the rail/port with confidence
--      that the data on his slip matches what's actually in the
--      container.
--
-- This migration adds two columns to track verification:
--
--   rail_slip_verified_at  — timestamp of when the dispatcher clicked
--                            "Cleared". NULL means not yet verified.
--   rail_slip_verified_by  — user ID of the dispatcher who verified.
--
-- The slip data itself lives in the existing columns:
--   container_number, seal_number, piece_count, weight_lbs,
--   customer_reference, final_delivery_location_id
--
-- The verification is auto-cleared by the application layer whenever
-- ANY of those 6 fields changes. See the loads PUT handler for the
-- cascade logic. We don't enforce this at the DB level via trigger
-- because the application layer needs to log audit entries when the
-- cascade fires, and we'd rather have that logic in one place.
-- ============================================================

BEGIN;

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS rail_slip_verified_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS rail_slip_verified_by UUID REFERENCES users(id);

-- Index for finding all unverified Outbound/Export loads quickly,
-- which the dispatcher dashboard might want to surface as a worklist
-- ("loads waiting on slip verification").
CREATE INDEX IF NOT EXISTS idx_orders_unverified_slip
  ON orders (tenant_id, load_type)
  WHERE rail_slip_verified_at IS NULL
    AND load_type IN ('outbound', 'export');

COMMENT ON COLUMN orders.rail_slip_verified_at IS
  'Timestamp the dispatcher clicked "Cleared for Rail/Port Check-In". '
  'NULL means not yet verified. Auto-cleared by the application layer '
  'when any of the 6 slip fields changes (container #, seal #, piece '
  'count, weight, reference #, final delivery).';

COMMENT ON COLUMN orders.rail_slip_verified_by IS
  'User who verified the rail/port check-in slip. References users(id).';

NOTIFY pgrst, 'reload schema';

COMMIT;
