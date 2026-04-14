-- ============================================================
-- Migration 034: Required Documents for Mobile Completion
-- ============================================================
-- Adds required_documents JSONB array to customers (organizations).
-- When a document type is listed here, the driver's mobile app
-- will not allow marking the load as "Completed" until the
-- required document types have been uploaded.
-- Dispatchers can still manually complete loads without docs.
-- ============================================================

ALTER TABLE customers ADD COLUMN IF NOT EXISTS required_documents JSONB DEFAULT '[]'::jsonb;

COMMENT ON COLUMN customers.required_documents IS 'Array of document type strings required for mobile completion. e.g. ["POD", "BOL", "Weight Ticket"]';
