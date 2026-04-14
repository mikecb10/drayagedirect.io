-- ============================================================
-- Migration 019: Add domestic container types for 53' containers
-- ============================================================
-- 53' containers are domestic (not ocean ISO) and use different type
-- classifications. These are common in US intermodal/drayage.
-- ============================================================

INSERT INTO container_types (code, label, description, is_system)
SELECT * FROM (VALUES
  ('DV',    'Dry Van',           '53-foot domestic dry van container', true),
  ('DV HC', 'Dry Van High Cube', '53-foot domestic dry van, extra tall', true),
  ('RF 53', 'Reefer 53',        '53-foot domestic refrigerated container', true),
  ('DM',    'Domestic',          'Generic domestic intermodal container', true),
  ('DM HC', 'Domestic High Cube','Domestic intermodal container, extra tall', true)
) AS t(code, label, description, is_system)
WHERE NOT EXISTS (
  SELECT 1 FROM container_types WHERE is_system = true AND container_types.code = t.code
);

-- Also ensure 53' container size exists (should already be there from 011)
INSERT INTO container_sizes (code, label, description, is_system)
SELECT '53', '53''', '53-foot domestic container', true
WHERE NOT EXISTS (SELECT 1 FROM container_sizes WHERE code = '53' AND is_system = true);

-- Verification
SELECT code, label FROM container_types WHERE code IN ('DV', 'DV HC', 'RF 53', 'DM', 'DM HC') ORDER BY code;
SELECT code, label FROM container_sizes WHERE code = '53';
