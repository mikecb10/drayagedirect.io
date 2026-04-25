-- ============================================================
-- Migration 104: tenants.margin_palette — colorblind-friendly toggle
-- ============================================================
-- Adds a per-tenant choice between the default red/yellow/green
-- margin pill palette and a colorblind-friendly variant
-- (orange / yellow / blue — Wong-2011-style accessible palette).
--
-- The MarginBadge component reads this value via a small hook
-- and swaps the Tailwind class map. Closes FU-036.
-- ============================================================

BEGIN;

ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS margin_palette TEXT NOT NULL DEFAULT 'default'
    CHECK (margin_palette IN ('default', 'colorblind'));

NOTIFY pgrst, 'reload schema';

COMMIT;
