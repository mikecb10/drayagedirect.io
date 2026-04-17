-- ============================================================
-- Migration 075: driver_tariff_advanced_routes
-- ============================================================
-- Advanced Route Matching (AP side). Mirror of tariff_advanced_routes
-- but FK'd to driver_tariffs(id). Consumed by the same shared matcher
-- (lib/advanced-route-matcher.js).
-- See docs/superpowers/specs/2026-04-17-advanced-route-matching-design.md
-- ============================================================

BEGIN;

CREATE TABLE IF NOT EXISTS driver_tariff_advanced_routes (
  id                   UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id            UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  driver_tariff_id     UUID NOT NULL REFERENCES driver_tariffs(id) ON DELETE CASCADE,
  routing_template_id  UUID REFERENCES routing_templates(id),
  moves                JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (driver_tariff_id)
);

CREATE INDEX IF NOT EXISTS idx_driver_tariff_advanced_routes_tenant
  ON driver_tariff_advanced_routes(tenant_id);
CREATE INDEX IF NOT EXISTS idx_driver_tariff_advanced_routes_tariff
  ON driver_tariff_advanced_routes(driver_tariff_id);

ALTER TABLE driver_tariff_advanced_routes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS driver_tariff_advanced_routes_select ON driver_tariff_advanced_routes;
CREATE POLICY driver_tariff_advanced_routes_select ON driver_tariff_advanced_routes FOR SELECT
  USING (tenant_id::text = current_setting('request.jwt.claims', true)::json ->> 'tenant_id');

DROP POLICY IF EXISTS driver_tariff_advanced_routes_insert ON driver_tariff_advanced_routes;
CREATE POLICY driver_tariff_advanced_routes_insert ON driver_tariff_advanced_routes FOR INSERT
  WITH CHECK (tenant_id::text = current_setting('request.jwt.claims', true)::json ->> 'tenant_id');

DROP POLICY IF EXISTS driver_tariff_advanced_routes_update ON driver_tariff_advanced_routes;
CREATE POLICY driver_tariff_advanced_routes_update ON driver_tariff_advanced_routes FOR UPDATE
  USING (tenant_id::text = current_setting('request.jwt.claims', true)::json ->> 'tenant_id');

DROP POLICY IF EXISTS driver_tariff_advanced_routes_delete ON driver_tariff_advanced_routes;
CREATE POLICY driver_tariff_advanced_routes_delete ON driver_tariff_advanced_routes FOR DELETE
  USING (tenant_id::text = current_setting('request.jwt.claims', true)::json ->> 'tenant_id');

NOTIFY pgrst, 'reload schema';

COMMIT;
