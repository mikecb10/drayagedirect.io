-- ============================================================
-- Migration 049: Routing Templates — final canonical 15-template list
-- ============================================================
--
-- Three things this migration does:
--
--   1. Delete the 6 legacy templates from migration 004:
--        - Inbound + Live
--        - Inbound + Drop & Hook
--        - Inbound Prepull + Live
--        - Outbound + Live Load
--        - Outbound + Drop & Hook
--        - Outbound Prepull Empty
--      These were stub templates from before the canonical list was
--      defined. They use different naming conventions, don't have the
--      deliver+drop pair pattern, and overlap conceptually with the
--      canonical templates added in 047.
--
--   2. Insert 4 NEW Inbound templates that mirror the canonical Import
--      templates but with rail-themed naming. Inbound is functionally
--      identical to Import (pull a loaded container from a terminal,
--      deliver to customer, return empty), but tenants want to track
--      ocean vs rail loads separately for billing/reporting.
--
--   3. Sync the JSONB event_sequence on the 4 Drop & Hook templates
--      (Pick and Run + Drop & Hook, Prepull + Drop & Hook, Inbound —
--      Pick and Run + Drop & Hook, Inbound — Prepull + Drop & Hook,
--      Export — Pick Empty + Drop & Hook + Deliver) so the picker
--      preview chips reflect the canonical deliver+drop pair pattern.
--      The actual seed code in lib/routing-template-seed.js was always
--      correct — this just brings the DB preview in line.
--
-- After this migration runs, the picker will show:
--   Import:   4 templates (Pick and Run x2, Prepull x2)
--   Inbound:  4 templates (Inbound — Pick and Run x2, Inbound — Prepull x2)
--   Export:   4 templates
--   Outbound: 2 templates
--   Road:     1 template (One Way Move)
-- ============================================================

BEGIN;

-- ------------------------------------------------------------
-- 1. Delete legacy templates from migration 004
-- ------------------------------------------------------------

DELETE FROM routing_templates
 WHERE is_system = true
   AND name IN (
     'Inbound + Live',
     'Inbound + Drop & Hook',
     'Inbound Prepull + Live',
     'Outbound + Live Load',
     'Outbound + Drop & Hook',
     'Outbound Prepull Empty'
   );

-- ------------------------------------------------------------
-- 2. Insert the 4 new canonical Inbound templates
-- ------------------------------------------------------------
--
-- We use a NOT EXISTS guard rather than ON CONFLICT because the
-- unique index from migration 048 is partial (`WHERE is_system = true`)
-- and partial-index ON CONFLICT inference can be finicky across
-- Postgres versions. The NOT EXISTS pattern is bulletproof and
-- equally idempotent — re-running this migration is a no-op.
-- ------------------------------------------------------------

INSERT INTO routing_templates (name, description, load_type, event_sequence, is_system)
SELECT * FROM (VALUES
  (
    'Inbound — Pick and Run + Live Unload',
    'Pull from rail terminal, live unload at customer, return empty to rail.',
    'inbound',
    '[{"type":"pull"},{"type":"deliver"},{"type":"return"}]'::jsonb,
    true
  ),
  (
    'Inbound — Pick and Run + Drop & Hook',
    'Pull from rail terminal, deliver and drop at customer, hook later and return empty.',
    'inbound',
    '[{"type":"pull"},{"type":"deliver"},{"type":"drop"},{"type":"hook"},{"type":"return"}]'::jsonb,
    true
  ),
  (
    'Inbound — Prepull + Live Unload',
    'Prepull from rail to yard, later hook and deliver live, return empty.',
    'inbound',
    '[{"type":"pull"},{"type":"drop"},{"type":"hook"},{"type":"deliver"},{"type":"return"}]'::jsonb,
    true
  ),
  (
    'Inbound — Prepull + Drop & Hook',
    'Prepull from rail to yard, later hook, deliver and drop at customer, hook and return empty.',
    'inbound',
    '[{"type":"pull"},{"type":"drop"},{"type":"hook"},{"type":"deliver"},{"type":"drop"},{"type":"hook"},{"type":"return"}]'::jsonb,
    true
  )
) AS new_templates(name, description, load_type, event_sequence, is_system)
WHERE NOT EXISTS (
  SELECT 1 FROM routing_templates rt
   WHERE rt.is_system = true
     AND rt.name = new_templates.name
);

-- ------------------------------------------------------------
-- 3. Sync the JSONB event_sequence on the canonical 5-event
--    Drop & Hook templates (forward-fix any old 4-event preview)
-- ------------------------------------------------------------

-- Pick and Run + Drop & Hook (import) — 5 events
UPDATE routing_templates
   SET event_sequence = '[{"type":"pull"},{"type":"deliver"},{"type":"drop"},{"type":"hook"},{"type":"return"}]'::jsonb
 WHERE is_system = true
   AND name = 'Pick and Run + Drop & Hook';

-- Prepull + Drop & Hook (import) — 7 events
UPDATE routing_templates
   SET event_sequence = '[{"type":"pull"},{"type":"drop"},{"type":"hook"},{"type":"deliver"},{"type":"drop"},{"type":"hook"},{"type":"return"}]'::jsonb
 WHERE is_system = true
   AND name = 'Prepull + Drop & Hook';

-- Export — Pick Empty + Drop & Hook + Deliver — 5 events with deliver+drop pair
UPDATE routing_templates
   SET event_sequence = '[{"type":"pull"},{"type":"deliver"},{"type":"drop"},{"type":"hook"},{"type":"return"}]'::jsonb
 WHERE is_system = true
   AND name = 'Export — Pick Empty + Drop & Hook + Deliver';

-- Tell PostgREST to reload its schema cache
NOTIFY pgrst, 'reload schema';

COMMIT;
