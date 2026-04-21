-- ============================================================
-- Migration 086: user_ar_preferences
-- ============================================================
-- Per-user AR filter preferences. One row per (tenant_id, user_id).
-- Stores custom_tabs: an array of named saved filter sets, each
-- scoped to a section ('billing' | 'invoices'). Click a custom tab
-- on the AR page → filter set is re-applied to that section.
--
-- custom_tabs shape (JSONB array):
--   [
--     {
--       "id": "<uuid>",
--       "section": "billing" | "invoices",
--       "name": "Overdue Jollygreens",
--       "filters": {
--         "customer_ids": ["<uuid>", ...],
--         "branch_ids": ["<uuid>", ...],
--         "from": "2026-01-01",  -- ISO date or null
--         "to": null
--       },
--       "created_at": "2026-04-21T00:00:00Z"
--     },
--     ...
--   ]
-- ============================================================

BEGIN;

CREATE TABLE user_ar_preferences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  custom_tabs JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(tenant_id, user_id)
);

CREATE INDEX idx_user_ar_prefs_user ON user_ar_preferences(user_id);

-- Row-level security: user sees/modifies only their own tenant+user row.
ALTER TABLE user_ar_preferences ENABLE ROW LEVEL SECURITY;

CREATE POLICY user_ar_prefs_self ON user_ar_preferences
  FOR ALL
  USING (
    tenant_id = current_setting('app.tenant_id', true)::uuid
    AND user_id = current_setting('app.user_id', true)::uuid
  )
  WITH CHECK (
    tenant_id = current_setting('app.tenant_id', true)::uuid
    AND user_id = current_setting('app.user_id', true)::uuid
  );

-- Touch updated_at on every UPDATE.
CREATE OR REPLACE FUNCTION user_ar_preferences_touch()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_user_ar_prefs_touch
  BEFORE UPDATE ON user_ar_preferences
  FOR EACH ROW EXECUTE FUNCTION user_ar_preferences_touch();

NOTIFY pgrst, 'reload schema';

COMMIT;
