-- ============================================================
-- Migration 074: tariff_advanced_routes
-- ============================================================
-- Advanced Route Matching (AR side). Stores a per-tariff route
-- template (moves + events + per-event location match) that the
-- tariff engine compares against a load's order_routing_events.
-- See docs/superpowers/specs/2026-04-17-advanced-route-matching-design.md
-- ============================================================

BEGIN;

CREATE TABLE IF NOT EXISTS tariff_advanced_routes (
  id                   UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id            UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  tariff_id            UUID NOT NULL REFERENCES tariffs(id) ON DELETE CASCADE,
  routing_template_id  UUID REFERENCES routing_templates(id),
  moves                JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tariff_id)
);

CREATE INDEX IF NOT EXISTS idx_tariff_advanced_routes_tenant
  ON tariff_advanced_routes(tenant_id);
CREATE INDEX IF NOT EXISTS idx_tariff_advanced_routes_tariff
  ON tariff_advanced_routes(tariff_id);

ALTER TABLE tariff_advanced_routes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tariff_advanced_routes_select ON tariff_advanced_routes;
CREATE POLICY tariff_advanced_routes_select ON tariff_advanced_routes FOR SELECT
  USING (tenant_id::text = current_setting('request.jwt.claims', true)::json ->> 'tenant_id');

DROP POLICY IF EXISTS tariff_advanced_routes_insert ON tariff_advanced_routes;
CREATE POLICY tariff_advanced_routes_insert ON tariff_advanced_routes FOR INSERT
  WITH CHECK (tenant_id::text = current_setting('request.jwt.claims', true)::json ->> 'tenant_id');

DROP POLICY IF EXISTS tariff_advanced_routes_update ON tariff_advanced_routes;
CREATE POLICY tariff_advanced_routes_update ON tariff_advanced_routes FOR UPDATE
  USING (tenant_id::text = current_setting('request.jwt.claims', true)::json ->> 'tenant_id');

DROP POLICY IF EXISTS tariff_advanced_routes_delete ON tariff_advanced_routes;
CREATE POLICY tariff_advanced_routes_delete ON tariff_advanced_routes FOR DELETE
  USING (tenant_id::text = current_setting('request.jwt.claims', true)::json ->> 'tenant_id');

NOTIFY pgrst, 'reload schema';

COMMIT;
