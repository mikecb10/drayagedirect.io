-- ============================================================
-- 107_umbrella_one_way_to_road.sql
--
-- FU-086: `email_umbrellas.load_types` (TEXT[]) had a stray
-- `'one_way'` value that was never a real load type — it only
-- existed in the umbrellas page's hardcoded LOAD_TYPE_OPTIONS
-- (since the page was written before lib/constants/load-types.js
-- centralized the catalog at FU-079). The order POST endpoint
-- has never accepted `'one_way'`, so any umbrella row with that
-- value in its load_types array could never match a real load
-- — silent dead config.
--
-- Pre-flight count (run 2026-04-26): 1 row affected
--   (id 7c20b459-ee33-4b54-ab5a-60de0861c765).
--
-- Translation: `'one_way'` is drayage-colloquial for "OTR
-- non-intermodal", which is exactly what the central catalog
-- calls `'road'`. Replace in-place; dedupe in case `'road'`
-- was already present alongside.
--
-- Companion code change (same commit): the umbrellas editor
-- page now imports LOAD_TYPES from lib/constants/load-types.js
-- instead of declaring its own list, so this kind of drift
-- can't recur. The new dropdown also exposes `road`,
-- `bill_only`, and `chassis_reposition` which were previously
-- unselectable.
-- ============================================================

BEGIN;

UPDATE email_umbrellas
SET load_types = (
  SELECT ARRAY(SELECT DISTINCT unnest(array_replace(load_types, 'one_way', 'road')))
)
WHERE 'one_way' = ANY(load_types);

COMMIT;
