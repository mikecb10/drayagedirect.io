-- ============================================================
-- Migration 018: Export routing templates + time format setting
-- ============================================================

-- 1. Add export routing templates
-- ============================================================
INSERT INTO routing_templates (name, description, load_type, event_sequence, is_system)
SELECT * FROM (VALUES
  ('Export — Pick Empty + Live Load + Deliver',
   'Pick up empty from terminal, live load at shipper, deliver loaded to port.',
   'export',
   '[{"type":"pull","label":"Pick Empty from Terminal"},{"type":"deliver","label":"Live Load at Shipper"},{"type":"deliver","label":"Deliver to Port"}]'::jsonb,
   true),
  ('Export — Pick Empty + Drop & Hook + Deliver',
   'Pick up empty, drop at shipper, hook loaded, deliver to port.',
   'export',
   '[{"type":"pull","label":"Pick Empty from Terminal"},{"type":"drop","label":"Drop Empty at Shipper"},{"type":"hook","label":"Hook Loaded from Shipper"},{"type":"deliver","label":"Deliver to Port"}]'::jsonb,
   true),
  ('Export — Hook Loaded + Deliver',
   'Hook pre-loaded container from shipper, deliver to port.',
   'export',
   '[{"type":"hook","label":"Hook Loaded"},{"type":"deliver","label":"Deliver to Port"}]'::jsonb,
   true),
  ('Export — Pick Empty + Prepull + Deliver',
   'Pick up empty, drop at yard, later hook and deliver to shipper, then port.',
   'export',
   '[{"type":"pull","label":"Pick Empty from Terminal"},{"type":"drop","label":"Drop at Yard"},{"type":"hook","label":"Hook from Yard"},{"type":"deliver","label":"Live Load at Shipper"},{"type":"deliver","label":"Deliver to Port"}]'::jsonb,
   true)
) AS t(name, description, load_type, event_sequence, is_system)
WHERE NOT EXISTS (
  SELECT 1 FROM routing_templates WHERE is_system = true AND routing_templates.name = t.name
);

-- Also re-add the outbound templates (same patterns as export but for rail)
INSERT INTO routing_templates (name, description, load_type, event_sequence, is_system)
SELECT * FROM (VALUES
  ('Outbound — Pick Empty + Live Load + Deliver to Rail',
   'Pick up empty, live load at warehouse, deliver to rail terminal.',
   'outbound',
   '[{"type":"pull","label":"Pick Empty"},{"type":"deliver","label":"Live Load at Warehouse"},{"type":"deliver","label":"Deliver to Rail Terminal"}]'::jsonb,
   true),
  ('Outbound — Hook Loaded + Deliver to Rail',
   'Hook pre-loaded container, deliver to rail terminal.',
   'outbound',
   '[{"type":"hook","label":"Hook Loaded"},{"type":"deliver","label":"Deliver to Rail Terminal"}]'::jsonb,
   true)
) AS t(name, description, load_type, event_sequence, is_system)
WHERE NOT EXISTS (
  SELECT 1 FROM routing_templates WHERE is_system = true AND routing_templates.name = t.name
);

-- 2. Add time_format to tenant_settings
-- ============================================================
ALTER TABLE tenant_settings ADD COLUMN IF NOT EXISTS time_format TEXT NOT NULL DEFAULT '12h'
  CHECK (time_format IN ('12h', '24h'));

-- ============================================================
-- Verification
-- ============================================================
SELECT name, load_type FROM routing_templates WHERE is_system = true ORDER BY load_type, name;
