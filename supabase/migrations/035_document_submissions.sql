-- ============================================================
-- Migration 035: Document Submissions / Validation Pipeline
-- ============================================================
-- Tracks documents uploaded by drivers via the mobile app.
-- Documents flow through: received → approved/rejected
-- Rejected docs prompt the driver to re-upload.
-- Approved docs are attached to the load's Documents tab.
-- ============================================================

CREATE TABLE IF NOT EXISTS document_submissions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

  -- What load/event is this for
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  routing_event_id UUID REFERENCES order_routing_events(id) ON DELETE SET NULL,

  -- Who uploaded it
  driver_id UUID REFERENCES drivers(id) ON DELETE SET NULL,
  uploaded_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,

  -- Document details
  document_type TEXT NOT NULL, -- POD, BOL, WEIGHT_TICKET, etc.
  file_name TEXT NOT NULL,
  file_url TEXT NOT NULL,
  file_size INTEGER, -- bytes
  mime_type TEXT,
  thumbnail_url TEXT,

  -- Validation status
  status TEXT NOT NULL DEFAULT 'received' CHECK (status IN ('received', 'approved', 'rejected')),
  reviewed_by UUID REFERENCES users(id),
  reviewed_at TIMESTAMPTZ,
  rejection_reason TEXT, -- Blurry, Wrong Document, Missing Signature, etc.
  rejection_note TEXT, -- optional free-text note

  -- Once approved, link to the load's permanent document record
  load_document_id UUID REFERENCES order_documents(id) ON DELETE SET NULL,

  -- Lifecycle requirement tracking
  -- Which routing event departure was this blocking?
  blocks_event_type TEXT, -- 'deliver' (POD) or 'pickup' (BOL)
  requirement_key TEXT, -- 'POD_AT_DELIVERY' or 'BOL_AT_LOADING' or general doc type

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_doc_submissions_tenant ON document_submissions(tenant_id);
CREATE INDEX IF NOT EXISTS idx_doc_submissions_order ON document_submissions(order_id);
CREATE INDEX IF NOT EXISTS idx_doc_submissions_status ON document_submissions(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_doc_submissions_driver ON document_submissions(driver_id);

-- RLS
ALTER TABLE document_submissions ENABLE ROW LEVEL SECURITY;
CREATE POLICY doc_submissions_select ON document_submissions FOR SELECT
  USING (tenant_id = current_tenant_id() OR is_dd_admin());
CREATE POLICY doc_submissions_insert ON document_submissions FOR INSERT
  WITH CHECK (tenant_id = current_tenant_id() OR is_dd_admin());
CREATE POLICY doc_submissions_update ON document_submissions FOR UPDATE
  USING (tenant_id = current_tenant_id() OR is_dd_admin());
CREATE POLICY doc_submissions_delete ON document_submissions FOR DELETE
  USING (tenant_id = current_tenant_id() OR is_dd_admin());

-- Notification tracking: unread count for sidebar badge
-- Uses a simple counter on tenant_settings to avoid expensive COUNT queries
ALTER TABLE tenant_settings ADD COLUMN IF NOT EXISTS pending_doc_count INTEGER DEFAULT 0;
