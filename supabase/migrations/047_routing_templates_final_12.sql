-- ============================================================
-- Migration 047: Routing Templates — final canonical 12-template list
-- ============================================================
--
-- Aligns the `routing_templates` table with the authoritative list of
-- 12 templates defined in lib/routing-template-seed.js. This migration:
--
--   1. Deletes templates that are no longer offered ("Shunt", "Hook with
--      Return", "Pick and Run + Gray Pool", "Prepull + Gray Pool").
--      Gray Pool templates are deferred — they need dedicated discussion
--      before they're re-introduced.
--   2. Inserts any missing templates from the canonical list so every
--      tenant gets the full picker options.
--   3. Ensures existing templates have the canonical names/descriptions.
--
-- Existing loads that reference removed template NAMES still work —
-- their routing events are already stored in order_routing_events, so
-- nothing about their behavior depends on the routing_templates row
-- continuing to exist.
-- ============================================================

BEGIN;

-- ------------------------------------------------------------
-- 1. Delete templates removed from the canonical list
-- ------------------------------------------------------------

DELETE FROM routing_templates
 WHERE is_system = true
   AND name IN (
     'Shunt',
     'Hook with Return',
     'Pick and Run + Gray Pool',
     'Prepull + Gray Pool'
   );

-- ------------------------------------------------------------
-- 2. Upsert the 12 canonical system templates
-- ------------------------------------------------------------
--
-- event_sequence is a denormalized JSONB snapshot — the actual event plans
-- live in lib/routing-template-seed.js and are resolved at seed time by
-- the name (not by the JSONB). We still store the event_sequence here so
-- legacy code paths that read it keep working.
-- ------------------------------------------------------------

-- Import / Inbound -------------------------------------------------

INSERT INTO routing_templates (name, description, load_type, event_sequence, is_system)
VALUES
  (
    'Pick and Run + Live Unload',
    'Pull from terminal, live unload at customer, return empty to terminal.',
    'import',
    '[{"type":"pull"},{"type":"deliver"},{"type":"return"}]'::jsonb,
    true
  ),
  (
    'Pick and Run + Drop & Hook',
    'Pull from terminal, deliver and drop at customer, hook later and return empty.',
    'import',
    '[{"type":"pull"},{"type":"deliver"},{"type":"drop"},{"type":"hook"},{"type":"return"}]'::jsonb,
    true
  ),
  (
    'Prepull + Live Unload',
    'Prepull to yard, later hook and deliver live, return empty.',
    'import',
    '[{"type":"pull"},{"type":"drop"},{"type":"hook"},{"type":"deliver"},{"type":"return"}]'::jsonb,
    true
  ),
  (
    'Prepull + Drop & Hook',
    'Prepull to yard, later hook, deliver and drop at customer, hook and return empty.',
    'import',
    '[{"type":"pull"},{"type":"drop"},{"type":"hook"},{"type":"deliver"},{"type":"drop"},{"type":"hook"},{"type":"return"}]'::jsonb,
    true
  )
ON CONFLICT DO NOTHING;

-- Export ------------------------------------------------------------

INSERT INTO routing_templates (name, description, load_type, event_sequence, is_system)
VALUES
  (
    'Export — Pick Empty + Live Load + Deliver',
    'Pick empty from terminal, live load at shipper, deliver loaded to port.',
    'export',
    '[{"type":"pull"},{"type":"deliver"},{"type":"return"}]'::jsonb,
    true
  ),
  (
    'Export — Pick Empty + Drop & Hook + Deliver',
    'Pick empty from terminal, drop empty at shipper, hook loaded later, deliver to port.',
    'export',
    '[{"type":"pull"},{"type":"deliver"},{"type":"drop"},{"type":"hook"},{"type":"return"}]'::jsonb,
    true
  ),
  (
    'Export — Hook Loaded + Deliver',
    'Hook a pre-loaded container at the shipper and deliver to port.',
    'export',
    '[{"type":"hook"},{"type":"return"}]'::jsonb,
    true
  ),
  (
    'Export — Pick Empty + Prepull + Deliver',
    'Pick empty from terminal, drop at yard, hook and deliver, return loaded to port.',
    'export',
    '[{"type":"pull"},{"type":"drop"},{"type":"hook"},{"type":"deliver"},{"type":"return"}]'::jsonb,
    true
  )
ON CONFLICT DO NOTHING;

-- Outbound / rail export -------------------------------------------

INSERT INTO routing_templates (name, description, load_type, event_sequence, is_system)
VALUES
  (
    'Outbound — Pick Empty + Live Load + Deliver to Rail',
    'Pick empty from terminal, live load at warehouse, deliver loaded to rail.',
    'outbound',
    '[{"type":"pull"},{"type":"deliver"},{"type":"return"}]'::jsonb,
    true
  ),
  (
    'Outbound — Hook Loaded + Deliver to Rail',
    'Hook a pre-loaded container and deliver to rail.',
    'outbound',
    '[{"type":"hook"},{"type":"return"}]'::jsonb,
    true
  )
ON CONFLICT DO NOTHING;

-- Domestic / single-leg --------------------------------------------

INSERT INTO routing_templates (name, description, load_type, event_sequence, is_system)
VALUES
  (
    'One Way Move',
    'Single leg road move — pickup at origin, deliver at destination.',
    'road',
    '[{"type":"pickup"},{"type":"deliver"}]'::jsonb,
    true
  )
ON CONFLICT DO NOTHING;

-- ------------------------------------------------------------
-- 3. Normalize descriptions for the canonical 12
-- ------------------------------------------------------------

UPDATE routing_templates
   SET description = 'Pull from terminal, live unload at customer, return empty to terminal.',
       event_sequence = '[{"type":"pull"},{"type":"deliver"},{"type":"return"}]'::jsonb
 WHERE is_system = true AND name = 'Pick and Run + Live Unload';

UPDATE routing_templates
   SET description = 'Pull from terminal, deliver and drop at customer, hook later and return empty.',
       event_sequence = '[{"type":"pull"},{"type":"deliver"},{"type":"drop"},{"type":"hook"},{"type":"return"}]'::jsonb
 WHERE is_system = true AND name = 'Pick and Run + Drop & Hook';

UPDATE routing_templates
   SET description = 'Prepull to yard, later hook and deliver live, return empty.',
       event_sequence = '[{"type":"pull"},{"type":"drop"},{"type":"hook"},{"type":"deliver"},{"type":"return"}]'::jsonb
 WHERE is_system = true AND name = 'Prepull + Live Unload';

UPDATE routing_templates
   SET description = 'Prepull to yard, later hook, deliver and drop at customer, hook and return empty.',
       event_sequence = '[{"type":"pull"},{"type":"drop"},{"type":"hook"},{"type":"deliver"},{"type":"drop"},{"type":"hook"},{"type":"return"}]'::jsonb
 WHERE is_system = true AND name = 'Prepull + Drop & Hook';

-- Tell PostgREST to reload its schema cache so the API picks up the new
-- rows without needing a restart.
NOTIFY pgrst, 'reload schema';

COMMIT;
