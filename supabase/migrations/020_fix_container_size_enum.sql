-- ============================================================
-- Migration 020: Add 53' to container_size_enum
-- ============================================================
-- The original enum only had 20, 40, 40HC, 45. Missing 53' which
-- is the standard domestic intermodal container size in the US.
-- Also adding 48 (less common but used in some domestic lanes).
-- ============================================================

ALTER TYPE container_size_enum ADD VALUE IF NOT EXISTS '53';
ALTER TYPE container_size_enum ADD VALUE IF NOT EXISTS '48';
