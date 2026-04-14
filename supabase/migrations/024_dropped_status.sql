-- ============================================================
-- Migration 024: Add 'dropped' and 'available' to load statuses
-- ============================================================
-- 'dropped' = container has been dropped (at yard or customer)
-- 'available' = container available for pickup (released, LFD set)
-- These are needed for KPI card filter logic.
-- ============================================================

-- Note: orders.status is a TEXT column, not an enum,
-- so no ALTER TYPE needed — just update the valid values
-- in the API's VALID_STATUSES array.
-- This migration is a no-op for the DB but documents the change.

-- Verify current status distribution
SELECT status, COUNT(*) FROM orders WHERE deleted_at IS NULL GROUP BY status ORDER BY status;
