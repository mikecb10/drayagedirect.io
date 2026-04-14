-- ============================================================
-- Migration 015: Routing Templates — align names with PortPro spec
-- ============================================================
--
-- The canonical PortPro template names use "Pick and Run" (lowercase "and")
-- and spell out "Live Unload" / "Drop & Hook" / "Gray Pool" explicitly.
-- Rename the existing system templates so they match the semantic plans in
-- lib/routing-template-seed.js.
--
-- We also remove two older system templates that don't match the spec
-- ("Pick and Run with Drop", "Hook with Return") — they were early stubs
-- and are now superseded by the 9 canonical templates.
-- ============================================================

-- Rename legacy templates
UPDATE routing_templates
   SET name = 'Pick and Run + Live Unload',
       description = 'Pull from terminal, live unload at customer, return empty.'
 WHERE is_system = true AND name = 'Pick And Run + Live';

UPDATE routing_templates
   SET name = 'Pick and Run + Drop & Hook',
       description = 'Pull from terminal, drop loaded at customer, hook empty, return empty.'
 WHERE is_system = true AND name = 'Pick And Run + Drop & Hook';

UPDATE routing_templates
   SET name = 'Prepull + Live Unload',
       description = 'Prepull to yard, later hook and deliver live, return empty.'
 WHERE is_system = true AND name = 'Prepull + Live';

UPDATE routing_templates
   SET description = 'Prepull to yard, then drop & hook at customer, return empty.'
 WHERE is_system = true AND name = 'Prepull + Drop & Hook';

UPDATE routing_templates
   SET name = 'Pick and Run + Gray Pool',
       description = 'Pick and deliver loaded, then pick up a gray pool container to return.'
 WHERE is_system = true AND name = 'Pick And Run + Gray Pool';

UPDATE routing_templates
   SET description = 'Prepull to yard, deliver loaded, then swap for a gray pool container to return.'
 WHERE is_system = true AND name = 'Prepull + Gray Pool';

UPDATE routing_templates
   SET description = 'Single leg road move — pickup to delivery.'
 WHERE is_system = true AND name = 'One Way Move';

UPDATE routing_templates
   SET description = 'Short-haul yard-to-yard or intra-yard move.'
 WHERE is_system = true AND name = 'Shunt';

-- Remove legacy stubs that don't appear in the PortPro spec
DELETE FROM routing_templates
 WHERE is_system = true
   AND name IN ('Pick and Run with Drop', 'Hook with Return');

-- ============================================================
-- DONE
-- ============================================================
