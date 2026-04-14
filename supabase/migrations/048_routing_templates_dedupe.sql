-- ============================================================
-- Migration 048: Dedupe routing_templates + add UNIQUE constraint
-- ============================================================
--
-- Migration 047 used `INSERT ... ON CONFLICT DO NOTHING` to upsert the
-- 12 canonical templates, but the routing_templates table has no
-- UNIQUE constraint on (name, is_system), so the conflict clause was
-- a no-op and every run of 047 inserted brand-new duplicate rows.
--
-- This migration:
--   1. Deletes duplicate system templates, keeping only the oldest
--      row per name (the one created earliest, by created_at).
--   2. Adds a partial UNIQUE index on (name) WHERE is_system = true
--      so future inserts can't create duplicate system templates.
--      We use a partial index because tenant-owned templates (where
--      tenant_id IS NOT NULL and is_system = false) legitimately
--      can have name collisions across tenants.
--
-- After this migration runs, re-running migration 047 is safe — the
-- ON CONFLICT clause will actually trigger.
-- ============================================================

BEGIN;

-- ------------------------------------------------------------
-- 1. Delete duplicate system templates, keeping the oldest of each name
-- ------------------------------------------------------------
--
-- Strategy: for each (name) group of system templates, find the row
-- with the smallest created_at and delete everything else with the
-- same name.
--
-- We use a CTE that ranks rows within each name group by created_at,
-- then delete every row with rank > 1.
-- ------------------------------------------------------------

WITH ranked AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY name
      ORDER BY created_at ASC, id ASC
    ) AS rn
  FROM routing_templates
  WHERE is_system = true
)
DELETE FROM routing_templates
 WHERE id IN (
   SELECT id FROM ranked WHERE rn > 1
 );

-- ------------------------------------------------------------
-- 2. Add a partial UNIQUE index on (name) WHERE is_system = true
-- ------------------------------------------------------------

CREATE UNIQUE INDEX IF NOT EXISTS routing_templates_system_name_unique
  ON routing_templates (name)
  WHERE is_system = true;

NOTIFY pgrst, 'reload schema';

COMMIT;
