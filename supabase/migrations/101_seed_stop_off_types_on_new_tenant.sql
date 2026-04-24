-- ============================================================
-- Migration 101: Seed default stop-off types on new tenant provisioning
-- ============================================================
-- Migration 100 seeded the 4 default stop-off types (Fuel Stop, Driver
-- Break, Scale, Chassis Exchange) for every EXISTING tenant.
--
-- This migration extends the canonical `seed_new_tenant(p_tenant_id)`
-- RPC (defined in migration 001 and called from
-- pages/api/admin/tenants/index.js right after tenant INSERT) so NEW
-- tenants automatically receive the same 4 defaults.
--
-- We extend the existing RPC rather than add a trigger because:
--   1. `seed_new_tenant` is already the single canonical hook for
--      tenant-provisioning seeds (tenant_settings, accessorial_charges,
--      feature_flags).
--   2. Keeping all seed logic in one function preserves a single source
--      of truth and matches the codebase's established pattern.
--   3. ON CONFLICT (tenant_id, name) DO NOTHING keeps the function
--      idempotent — safe to re-run against tenants that already have
--      defaults (e.g. tenants seeded by migration 100).
-- ============================================================

BEGIN;

CREATE OR REPLACE FUNCTION seed_new_tenant(p_tenant_id UUID)
RETURNS VOID AS $$
BEGIN
  -- Create tenant_settings with defaults
  INSERT INTO tenant_settings (tenant_id)
  VALUES (p_tenant_id)
  ON CONFLICT (tenant_id) DO NOTHING;

  -- Seed default accessorial charges
  INSERT INTO accessorial_charges (tenant_id, name, code, default_amount_cents, is_billable, is_payable) VALUES
    (p_tenant_id, 'Pre-Pull',       'PP',  12500, true, true),
    (p_tenant_id, 'Chassis Split',  'CS',   9000, true, false),
    (p_tenant_id, 'Overweight',     'OW',  17500, true, true),
    (p_tenant_id, 'Drop & Pick',    'DP',  15000, true, true),
    (p_tenant_id, 'Liftgate',       'LG',   7500, true, false),
    (p_tenant_id, 'Detention',      'DT',   7500, true, true),
    (p_tenant_id, 'Per Diem',       'PD',  15000, true, false),
    (p_tenant_id, 'Hazmat',         'HZ',  35000, true, true),
    (p_tenant_id, 'Reefer',         'RF',  25000, true, true),
    (p_tenant_id, 'Tri-Axle',       'TA',  20000, true, true);

  -- Seed default stop-off types (migration 101)
  INSERT INTO stop_off_types (
    tenant_id, name, description,
    has_cargo_transfer, is_paid_to_driver, is_billable_to_customer,
    counts_toward_detention, requires_location_pick, sort_order
  ) VALUES
    (p_tenant_id, 'Fuel Stop',        'Driver refuels en route',                                false, false, false, false, true,  10),
    (p_tenant_id, 'Driver Break',     'Mandated rest or meal break',                            false, false, false, false, false, 20),
    (p_tenant_id, 'Scale',            'Weigh station / scale verification',                     false, false, true,  false, true,  30),
    (p_tenant_id, 'Chassis Exchange', 'Swap chassis mid-route (e.g., different size or owner)', false, true,  false, false, true,  40)
  ON CONFLICT (tenant_id, name) DO NOTHING;

  -- Enable feature flags based on subscription tier
  INSERT INTO tenant_feature_flags (tenant_id, feature_flag_id, enabled)
  SELECT p_tenant_id, ff.id, true
  FROM feature_flags ff
  JOIN tenants t ON t.id = p_tenant_id
  JOIN subscription_tiers st ON st.id = t.subscription_tier_id
  WHERE ff.tier_required IS NOT NULL
    AND CASE
      WHEN st.name = 'enterprise' THEN true
      WHEN st.name = 'pro' THEN ff.tier_required IN ('basic', 'pro')
      WHEN st.name = 'basic' THEN ff.tier_required = 'basic'
      ELSE false
    END;
END;
$$ LANGUAGE plpgsql;

NOTIFY pgrst, 'reload schema';

COMMIT;
