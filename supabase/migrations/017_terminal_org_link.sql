-- ============================================================
-- Migration 017: Link organizations to system terminals
-- ============================================================
-- When a user picks a system terminal in the OrgPicker, we auto-create
-- a corresponding organization record so the orders FK constraint is
-- satisfied. This column tracks which system terminal an org was
-- imported from, preventing duplicates.
-- ============================================================

ALTER TABLE customers ADD COLUMN IF NOT EXISTS source_terminal_id UUID REFERENCES system_terminals(id);

CREATE INDEX IF NOT EXISTS idx_customers_source_terminal ON customers(source_terminal_id) WHERE source_terminal_id IS NOT NULL;
