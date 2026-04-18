-- ============================================================
-- Migration 078: PDF archival infrastructure
-- ============================================================
-- Adds columns to track archived PDFs for invoices and rate
-- confirmations. Creates the `documents` Storage bucket with
-- tenant-scoped RLS so each tenant's PDFs are isolated.
--
-- Supports sub-project 2a.1 (PDF generation infrastructure).
-- ============================================================

BEGIN;

-- ── Columns ──────────────────────────────────────────────
-- Storage path (not signed URL). Signed URLs expire; we
-- regenerate them on demand when serving the document.
ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS pdf_url TEXT;

ALTER TABLE order_charge_sets
  ADD COLUMN IF NOT EXISTS rate_con_pdf_url TEXT;

-- ── Storage bucket ───────────────────────────────────────
-- Private bucket (public=false), PDFs only, 50MB cap per file.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'documents',
  'documents',
  false,
  52428800,
  ARRAY['application/pdf']
)
ON CONFLICT (id) DO NOTHING;

-- ── RLS policies ─────────────────────────────────────────
-- Path convention: {tenant_id}/{doc_type}/{id}.pdf
-- Policies check the first path segment against the caller's
-- tenant. Service role bypasses RLS anyway; these are
-- defense-in-depth for any future non-service-role access.

DROP POLICY IF EXISTS documents_tenant_select ON storage.objects;
CREATE POLICY documents_tenant_select ON storage.objects
  FOR SELECT USING (
    bucket_id = 'documents'
    AND (split_part(name, '/', 1))::uuid = current_tenant_id()
  );

DROP POLICY IF EXISTS documents_tenant_insert ON storage.objects;
CREATE POLICY documents_tenant_insert ON storage.objects
  FOR INSERT WITH CHECK (
    bucket_id = 'documents'
    AND (split_part(name, '/', 1))::uuid = current_tenant_id()
  );

DROP POLICY IF EXISTS documents_tenant_update ON storage.objects;
CREATE POLICY documents_tenant_update ON storage.objects
  FOR UPDATE USING (
    bucket_id = 'documents'
    AND (split_part(name, '/', 1))::uuid = current_tenant_id()
  );

DROP POLICY IF EXISTS documents_tenant_delete ON storage.objects;
CREATE POLICY documents_tenant_delete ON storage.objects
  FOR DELETE USING (
    bucket_id = 'documents'
    AND (split_part(name, '/', 1))::uuid = current_tenant_id()
  );

NOTIFY pgrst, 'reload schema';

COMMIT;
