-- ============================================================
-- Migration 088: Dry Run feature
-- ============================================================
-- Adds a first-class `dry_run_attempts` table that records a leg
-- attempt that didn't complete its operational goal. Derived line
-- items land in `order_charge_set_line_items` (AR) and
-- `order_driver_pay_lines` (AP) via FK cascade.
--
-- Also adds `is_dry_run` opt-in flags on `charge_profiles` and
-- `driver_charge_profiles` so tenants can mark existing profiles
-- as dry-run-eligible without creating duplicates.
-- ============================================================

BEGIN;

-- 1. Parent table
CREATE TABLE dry_run_attempts (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                 uuid NOT NULL REFERENCES tenants(id),
  order_id                  uuid NOT NULL REFERENCES orders(id),
  event_id                  uuid NULL REFERENCES order_routing_events(id) ON DELETE RESTRICT,
  driver_id                 uuid NOT NULL REFERENCES drivers(id),
  occurred_at               timestamptz NOT NULL DEFAULT now(),
  rate_source               text NOT NULL CHECK (rate_source IN ('preset','manual')),
  charge_profile_id         uuid NULL REFERENCES charge_profiles(id),
  driver_charge_profile_id  uuid NULL REFERENCES driver_charge_profiles(id),
  rate_method               text NOT NULL CHECK (rate_method IN ('fixed','per_mile')),
  miles                     numeric(10,2) NULL,
  ar_amount_cents           integer NOT NULL CHECK (ar_amount_cents >= 0),
  ap_amount_cents           integer NOT NULL CHECK (ap_amount_cents >= 0),
  notes                     text NULL,
  created_by                uuid NOT NULL REFERENCES users(id),
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now(),
  deleted_at                timestamptz NULL,

  -- Q2 invariant: preset requires both profile IDs, manual forbids them
  CONSTRAINT chk_preset_has_profiles CHECK (
    (rate_source = 'preset' AND charge_profile_id IS NOT NULL AND driver_charge_profile_id IS NOT NULL) OR
    (rate_source = 'manual' AND charge_profile_id IS NULL AND driver_charge_profile_id IS NULL)
  ),

  -- Q3 invariant: per_mile requires miles > 0
  CONSTRAINT chk_per_mile_requires_miles CHECK (
    rate_method = 'fixed' OR (rate_method = 'per_mile' AND miles IS NOT NULL AND miles > 0)
  )
);

-- 2. Indexes powering leg-card list, load rollups, driver reporting
CREATE INDEX idx_dry_run_attempts_tenant_event  ON dry_run_attempts (tenant_id, event_id)  WHERE deleted_at IS NULL;
CREATE INDEX idx_dry_run_attempts_tenant_order  ON dry_run_attempts (tenant_id, order_id)  WHERE deleted_at IS NULL;
CREATE INDEX idx_dry_run_attempts_tenant_driver ON dry_run_attempts (tenant_id, driver_id) WHERE deleted_at IS NULL;

-- 3. FK columns on derived line-item tables (cascade on parent hard-delete;
--    soft-delete of parent is handled by app code, not FK)
ALTER TABLE order_charge_set_line_items
  ADD COLUMN dry_run_attempt_id uuid NULL REFERENCES dry_run_attempts(id) ON DELETE CASCADE;

ALTER TABLE order_driver_pay_lines
  ADD COLUMN dry_run_attempt_id uuid NULL REFERENCES dry_run_attempts(id) ON DELETE CASCADE;

CREATE INDEX idx_charge_set_li_dry_run ON order_charge_set_line_items (dry_run_attempt_id) WHERE dry_run_attempt_id IS NOT NULL;
CREATE INDEX idx_driver_pay_li_dry_run ON order_driver_pay_lines      (dry_run_attempt_id) WHERE dry_run_attempt_id IS NOT NULL;

-- 4. Opt-in flags on existing profile tables
ALTER TABLE charge_profiles        ADD COLUMN is_dry_run boolean NOT NULL DEFAULT false;
ALTER TABLE driver_charge_profiles ADD COLUMN is_dry_run boolean NOT NULL DEFAULT false;

-- 5. Updated-at trigger (reuse existing tenant convention)
CREATE TRIGGER trg_dry_run_attempts_updated_at
  BEFORE UPDATE ON dry_run_attempts
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

NOTIFY pgrst, 'reload schema';

COMMIT;
