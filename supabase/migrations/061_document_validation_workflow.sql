-- ============================================================
-- Migration 061: Document Validation Workflow
-- ============================================================
-- Adds:
--   1. attach_to_invoice flag on order_documents so dispatchers
--      can toggle which approved docs get attached to the invoice
--   2. validation_required_doc_types config on tenant_settings so
--      each tenant can choose which doc types need dispatcher
--      approval vs auto-approving on upload
-- ============================================================

BEGIN;

-- 1. Invoice attachment flag on permanent documents
ALTER TABLE order_documents
  ADD COLUMN IF NOT EXISTS attach_to_invoice BOOLEAN NOT NULL DEFAULT false;

-- 2. Per-tenant config: which doc types require dispatcher validation
-- Stored as a JSONB array of strings, e.g. ["POD","BOL","WEIGHT_TICKET"]
-- When a driver uploads a doc type in this list → status stays 'received'
-- until a dispatcher approves. Types NOT in the list auto-approve.
ALTER TABLE tenant_settings
  ADD COLUMN IF NOT EXISTS validation_required_doc_types JSONB DEFAULT '[]'::jsonb;

NOTIFY pgrst, 'reload schema';

COMMIT;
