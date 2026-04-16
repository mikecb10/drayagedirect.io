import { useEffect, useRef, useState } from 'react';
import {
  Upload,
  FileText,
  Image as ImageIcon,
  FileSpreadsheet,
  File as FileIcon,
  Trash2,
  Download,
  Loader2,
  CheckCircle2,
  XCircle,
  Clock,
  Paperclip,
  AlertTriangle,
} from 'lucide-react';
import Alert from '../../ui/Alert';
import Select from '../../ui/Select';
import Modal from '../../ui/Modal';
import Button from '../../ui/Button';

const DOCUMENT_TYPES = [
  // Common
  { value: 'bol', label: 'Bill of Lading (BOL)' },
  { value: 'pod', label: 'Proof of Delivery (POD)' },
  { value: 'rate_confirmation', label: 'Rate Confirmation' },
  { value: 'invoice', label: 'Invoice' },
  { value: 'weight_ticket', label: 'Weight Ticket' },
  // Terminal & Gate
  { value: 'tir', label: 'TIR' },
  { value: 'delivery_order', label: 'Delivery Order' },
  { value: 'scale_ticket', label: 'Scale Ticket' },
  { value: 'dock_receipt', label: 'Dock Receipt' },
  { value: 'packing_slip', label: 'Packing Slip' },
  // Equipment & Inspection
  { value: 'inspection_sheet', label: 'Inspection Sheet' },
  { value: 'container_photo', label: 'Container Photo' },
  // Financial
  { value: 'receipt', label: 'Receipt' },
  { value: 'lumper_receipt', label: 'Lumper Receipt' },
  { value: 'vendor_invoice', label: 'Vendor Invoice' },
  { value: 'toll_receipt', label: 'Toll Receipt' },
  // Hazmat & Compliance
  { value: 'customs_form', label: 'Customs Form' },
  { value: 'haz_mat', label: 'Hazmat Document' },
  { value: 'bond_paperwork', label: 'Bond Paperwork' },
  // General
  { value: 'photo', label: 'Photo' },
  { value: 'other', label: 'Other' },
];

const REJECTION_REASONS = [
  { value: 'blurry', label: 'Blurry / Unreadable' },
  { value: 'wrong_document', label: 'Wrong Document Type' },
  { value: 'incomplete', label: 'Incomplete / Cut Off' },
  { value: 'wrong_load', label: 'Wrong Load' },
  { value: 'missing_signature', label: 'Missing Signature' },
  { value: 'other', label: 'Other' },
];

function iconFor(mimeType) {
  if (!mimeType) return FileIcon;
  if (mimeType.startsWith('image/')) return ImageIcon;
  if (mimeType.includes('pdf')) return FileText;
  if (mimeType.includes('sheet') || mimeType.includes('excel') || mimeType.includes('csv'))
    return FileSpreadsheet;
  return FileIcon;
}

function formatBytes(bytes) {
  if (!bytes) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(d) {
  if (!d) return '';
  try {
    return new Date(d).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  } catch {
    return d;
  }
}

/**
 * Documents Tab — unified view of document submissions (pending
 * validation) AND approved documents (order_documents) for a single load.
 *
 * Sections:
 *   1. Upload bar (direct upload to order_documents)
 *   2. Received / Pending Validation (from document_submissions table)
 *   3. Rejected Documents (from document_submissions with status='rejected')
 *   4. Approved Documents (from order_documents table) with invoice toggles
 */
export default function DocumentsTab({ load }) {
  const fileRef = useRef(null);
  const [documents, setDocuments] = useState([]);
  const [submissions, setSubmissions] = useState([]);
  const [rejectedSubmissions, setRejectedSubmissions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState(null);
  const [actionError, setActionError] = useState(null);
  const [docType, setDocType] = useState('other');
  const [rejectDoc, setRejectDoc] = useState(null);
  const [rejectReason, setRejectReason] = useState('');
  const [rejectNote, setRejectNote] = useState('');

  async function loadAll() {
    if (!load?.id) return;
    setLoading(true);
    setError(null);
    try {
      const [docsRes, subsReceivedRes, subsRejectedRes] = await Promise.all([
        fetch(`/api/tenant/loads/${load.id}/documents`),
        fetch(`/api/tenant/document-submissions?order_id=${load.id}&status=received`),
        fetch(`/api/tenant/document-submissions?order_id=${load.id}&status=rejected`),
      ]);
      if (!docsRes.ok) throw new Error('Failed to load documents');
      const docsData = await docsRes.json();
      setDocuments(docsData.documents || []);

      if (subsReceivedRes.ok) {
        const subsData = await subsReceivedRes.json();
        setSubmissions(
          (subsData.submissions || []).filter((s) => s.status === 'received')
        );
      }
      if (subsRejectedRes.ok) {
        const rejData = await subsRejectedRes.json();
        setRejectedSubmissions(
          (rejData.submissions || []).filter((s) => s.status === 'rejected')
        );
      }
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load?.id]);

  function readFileAsBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  async function handleFileSelect(e) {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;
    setUploading(true);
    setError(null);
    try {
      for (const file of files) {
        if (file.size > 25 * 1024 * 1024) {
          throw new Error(`${file.name} exceeds 25MB limit`);
        }
        const base64 = await readFileAsBase64(file);
        const res = await fetch(`/api/tenant/loads/${load.id}/documents`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            file_name: file.name,
            file_base64: base64,
            mime_type: file.type,
            document_type: docType,
          }),
        });
        if (!res.ok) {
          const b = await res.json().catch(() => ({}));
          throw new Error(b.error || `Failed to upload ${file.name}`);
        }
      }
      await loadAll();
      if (fileRef.current) fileRef.current.value = '';
    } catch (e) {
      setError(e.message);
    } finally {
      setUploading(false);
    }
  }

  async function handleDelete(docId) {
    if (!confirm('Delete this document? This cannot be undone.')) return;
    try {
      const res = await fetch(`/api/tenant/loads/${load.id}/documents/${docId}`, {
        method: 'DELETE',
      });
      if (!res.ok) throw new Error('Failed to delete document');
      await loadAll();
    } catch (e) {
      setError(e.message);
    }
  }

  async function handleApprove(submissionId) {
    setActionError(null);
    try {
      const res = await fetch(`/api/tenant/document-submissions/${submissionId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'approve' }),
      });
      if (!res.ok) throw new Error('Failed to approve');

      // Fire the document_validation notification trigger
      fetch('/api/tenant/emails/fire-notification', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ load_id: load.id, event_name: 'document_validation' }),
      }).catch(() => {});

      await loadAll();
    } catch (e) {
      setActionError(e.message);
    }
  }

  async function handleReject() {
    if (!rejectDoc) return;
    setActionError(null);
    try {
      const res = await fetch(`/api/tenant/document-submissions/${rejectDoc.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'reject',
          rejection_reason: rejectReason,
          rejection_note: rejectNote,
        }),
      });
      if (!res.ok) throw new Error('Failed to reject');
      setRejectDoc(null);
      setRejectReason('');
      setRejectNote('');
      await loadAll();
    } catch (e) {
      setActionError(e.message);
    }
  }

  async function handleToggleInvoice(docId, currentValue) {
    setActionError(null);
    try {
      const res = await fetch(`/api/tenant/loads/${load.id}/documents/${docId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ attach_to_invoice: !currentValue }),
      });
      if (!res.ok) throw new Error('Failed to update');
      setDocuments((prev) =>
        prev.map((d) =>
          d.id === docId ? { ...d, attach_to_invoice: !currentValue } : d
        )
      );
    } catch (e) {
      setActionError(e.message);
    }
  }

  return (
    <div className="space-y-4">
      {error && <Alert type="error" message={error} />}
      {actionError && <Alert type="error" message={actionError} />}

      {/* Upload bar */}
      <div className="rounded-xl border border-dashed border-gray-300 dark:border-slate-600 bg-gray-50 dark:bg-slate-900 p-5">
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
          <div className="flex-1">
            <div className="text-section-title text-strong">Upload Documents</div>
            <div className="text-helper text-muted mt-0.5">
              BOL, POD, rate confirmations, photos. Max 25MB per file.
            </div>
          </div>
          <div className="flex items-end gap-2 w-full sm:w-auto">
            <Select
              label="Type"
              value={docType}
              onChange={(e) => setDocType(e.target.value)}
              options={DOCUMENT_TYPES}
              className="w-40"
            />
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={uploading}
              className="rounded-lg bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 dark:disabled:bg-slate-600 text-white px-4 py-2.5 text-sm font-medium transition-colors"
            >
              {uploading ? (
                <>
                  <Loader2 className="w-4 h-4 inline -mt-0.5 mr-1.5 animate-spin" />
                  Uploading...
                </>
              ) : (
                <>
                  <Upload className="w-4 h-4 inline -mt-0.5 mr-1.5" />
                  Choose Files
                </>
              )}
            </button>
            <input
              ref={fileRef}
              type="file"
              multiple
              className="hidden"
              onChange={handleFileSelect}
            />
          </div>
        </div>
      </div>

      {/* ── Received / Pending Validation ── */}
      {submissions.length > 0 && (
        <div className="rounded-xl border border-amber-200 dark:border-amber-900/60 bg-amber-50/40 dark:bg-amber-950/20">
          <div className="px-4 py-3 border-b border-amber-200 dark:border-amber-900/60 flex items-center gap-2">
            <Clock className="w-4 h-4 text-amber-600 dark:text-amber-400" />
            <div className="text-sm font-semibold text-amber-900 dark:text-amber-200">
              Pending Validation
            </div>
            <span className="text-xs text-amber-700 dark:text-amber-300 ml-auto">
              {submissions.length} {submissions.length === 1 ? 'document' : 'documents'} awaiting review
            </span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-4">
            {submissions.map((sub) => {
              const Icon = iconFor(sub.mime_type);
              return (
                <div
                  key={sub.id}
                  className="rounded-lg border border-amber-200 dark:border-amber-900/60 bg-white dark:bg-slate-900 p-3"
                >
                  <div className="flex items-start gap-3">
                    {sub.thumbnail_url ? (
                      <img
                        src={sub.thumbnail_url}
                        alt=""
                        className="w-12 h-12 rounded-lg object-cover border border-gray-200 dark:border-slate-700 shrink-0"
                      />
                    ) : (
                      <div className="rounded-lg bg-amber-50 dark:bg-amber-950/40 p-2 shrink-0">
                        <Icon className="w-5 h-5 text-amber-600 dark:text-amber-400" strokeWidth={1.75} />
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="text-body font-medium text-strong truncate">
                        {sub.file_name}
                      </div>
                      <div className="text-[11px] text-gray-500 dark:text-slate-400 mt-0.5">
                        {sub.document_type?.toUpperCase()} · {formatBytes(sub.file_size)} · {formatDate(sub.created_at)}
                      </div>
                      {sub.driver && (
                        <div className="text-[11px] text-gray-400 dark:text-slate-500 mt-0.5">
                          Uploaded by {sub.driver.name || `${sub.driver.first_name || ''} ${sub.driver.last_name || ''}`.trim()}
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="flex gap-2 mt-3 pt-3 border-t border-amber-100 dark:border-amber-900/40">
                    <button
                      type="button"
                      onClick={() => handleApprove(sub.id)}
                      className="flex-1 inline-flex items-center justify-center gap-1 text-xs font-semibold text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/40 hover:bg-emerald-100 dark:hover:bg-emerald-950/60 border border-emerald-200 dark:border-emerald-900/60 rounded-lg py-1.5 transition-colors"
                    >
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      Approve
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setRejectDoc(sub);
                        setRejectReason('');
                        setRejectNote('');
                      }}
                      className="flex-1 inline-flex items-center justify-center gap-1 text-xs font-semibold text-rose-700 dark:text-rose-300 bg-rose-50 dark:bg-rose-950/40 hover:bg-rose-100 dark:hover:bg-rose-950/60 border border-rose-200 dark:border-rose-900/60 rounded-lg py-1.5 transition-colors"
                    >
                      <XCircle className="w-3.5 h-3.5" />
                      Reject
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Rejected Documents ── */}
      {rejectedSubmissions.length > 0 && (
        <div className="rounded-xl border border-rose-200 dark:border-rose-900/60 bg-rose-50/30 dark:bg-rose-950/20">
          <div className="px-4 py-3 border-b border-rose-200 dark:border-rose-900/60 flex items-center gap-2">
            <XCircle className="w-4 h-4 text-rose-600 dark:text-rose-400" />
            <div className="text-sm font-semibold text-rose-900 dark:text-rose-200">
              Rejected
            </div>
            <span className="text-xs text-rose-700 dark:text-rose-300 ml-auto">
              {rejectedSubmissions.length} {rejectedSubmissions.length === 1 ? 'document' : 'documents'}
            </span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-4">
            {rejectedSubmissions.map((sub) => {
              const Icon = iconFor(sub.mime_type);
              const reasonCfg = REJECTION_REASONS.find((r) => r.value === sub.rejection_reason);
              return (
                <div
                  key={sub.id}
                  className="rounded-lg border border-rose-200 dark:border-rose-900/60 bg-white dark:bg-slate-900 p-3"
                >
                  <div className="flex items-start gap-3">
                    {sub.thumbnail_url ? (
                      <img
                        src={sub.thumbnail_url}
                        alt=""
                        className="w-12 h-12 rounded-lg object-cover border border-gray-200 dark:border-slate-700 shrink-0 opacity-60"
                      />
                    ) : (
                      <div className="rounded-lg bg-rose-50 dark:bg-rose-950/40 p-2 shrink-0">
                        <Icon className="w-5 h-5 text-rose-400 dark:text-rose-500" strokeWidth={1.75} />
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="text-body font-medium text-strong truncate">
                        {sub.file_name}
                      </div>
                      <div className="text-[11px] text-gray-500 dark:text-slate-400 mt-0.5">
                        {sub.document_type?.toUpperCase()} · {formatBytes(sub.file_size)} · {formatDate(sub.created_at)}
                      </div>
                      {sub.driver && (
                        <div className="text-[11px] text-gray-400 dark:text-slate-500 mt-0.5">
                          Uploaded by {sub.driver.name || `${sub.driver.first_name || ''} ${sub.driver.last_name || ''}`.trim()}
                        </div>
                      )}
                    </div>
                  </div>
                  {/* Rejection info */}
                  <div className="mt-2.5 px-2.5 py-2 rounded-lg bg-rose-50 dark:bg-rose-950/30 border border-rose-100 dark:border-rose-900/40">
                    <div className="flex items-center gap-1.5">
                      <AlertTriangle className="w-3 h-3 text-rose-500 dark:text-rose-400 shrink-0" />
                      <span className="text-[11px] font-semibold text-rose-700 dark:text-rose-300">
                        {reasonCfg?.label || sub.rejection_reason || 'Rejected'}
                      </span>
                    </div>
                    {sub.rejection_note && (
                      <div className="text-[11px] text-rose-600 dark:text-rose-400 mt-1 leading-relaxed">
                        {sub.rejection_note}
                      </div>
                    )}
                    <div className="text-[10px] text-rose-400 dark:text-rose-500 mt-1">
                      {sub.reviewer?.name ? `by ${sub.reviewer.name}` : ''}{' '}
                      {sub.reviewed_at && `· ${formatDate(sub.reviewed_at)}`}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Approved Documents ── */}
      <div className="rounded-xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-900">
        <div className="px-4 py-3 border-b border-gray-100 dark:border-slate-800 flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
          <div className="text-section-title text-strong">Approved Documents</div>
          <span className="text-xs text-gray-400 dark:text-slate-500 ml-auto">
            {loading ? '...' : `${documents.length} ${documents.length === 1 ? 'file' : 'files'}`}
          </span>
        </div>

        {loading ? (
          <div className="px-4 py-10 text-center text-sm text-gray-400 dark:text-slate-500">Loading...</div>
        ) : documents.length === 0 ? (
          <div className="px-4 py-10 text-center text-sm text-gray-400 dark:text-slate-500">
            No approved documents yet. Upload files above or approve pending submissions.
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 p-4">
            {documents.map((doc) => {
              const Icon = iconFor(doc.mime_type);
              const typeCfg = DOCUMENT_TYPES.find((t) => t.value === doc.document_type);
              return (
                <div
                  key={doc.id}
                  className="rounded-lg border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-900 hover:border-gray-300 dark:hover:border-slate-600 transition-colors p-3"
                >
                  <div className="flex items-start gap-3">
                    <div className="rounded-lg bg-blue-50 dark:bg-blue-950/40 p-2 shrink-0">
                      <Icon className="w-5 h-5 text-blue-600 dark:text-blue-400" strokeWidth={1.75} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div
                        className="text-body font-medium text-strong truncate"
                        title={doc.file_name}
                      >
                        {doc.file_name}
                      </div>
                      <div className="text-[11px] text-gray-500 dark:text-slate-400 mt-0.5 flex flex-wrap gap-x-2">
                        <span>{typeCfg?.label || doc.document_type}</span>
                        <span>·</span>
                        <span>{formatBytes(doc.file_size)}</span>
                      </div>
                      <div className="text-[11px] text-gray-400 dark:text-slate-500 mt-0.5">
                        {formatDate(doc.uploaded_at)}
                        {doc.uploader?.name && ` · ${doc.uploader.name}`}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 mt-3 pt-3 border-t border-gray-100 dark:border-slate-800">
                    {/* Invoice attachment toggle */}
                    <button
                      type="button"
                      onClick={() => handleToggleInvoice(doc.id, doc.attach_to_invoice)}
                      className={`inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-1 rounded-lg border transition-colors ${
                        doc.attach_to_invoice
                          ? 'text-blue-700 dark:text-blue-300 bg-blue-50 dark:bg-blue-950/40 border-blue-200 dark:border-blue-900/60'
                          : 'text-gray-400 dark:text-slate-500 bg-white dark:bg-slate-900 border-gray-200 dark:border-slate-700 hover:text-blue-600 dark:hover:text-blue-400 hover:border-blue-300 dark:hover:border-blue-800'
                      }`}
                      title={doc.attach_to_invoice ? 'Attached to invoice — click to detach' : 'Click to attach to invoice'}
                    >
                      <Paperclip className="w-3 h-3" />
                      {doc.attach_to_invoice ? 'On Invoice' : 'Attach'}
                    </button>
                    <div className="flex-1" />
                    {doc.signed_url && (
                      <a
                        href={doc.signed_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs font-medium text-blue-600 dark:text-blue-400 hover:text-blue-700 py-1"
                      >
                        <Download className="w-3.5 h-3.5 inline -mt-0.5 mr-1" />
                        Download
                      </a>
                    )}
                    <button
                      onClick={() => handleDelete(doc.id)}
                      className="text-xs font-medium text-gray-400 dark:text-slate-500 hover:text-red-600 px-2 py-1"
                      title="Delete"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Reject modal */}
      {rejectDoc && (
        <Modal isOpen={true} onClose={() => setRejectDoc(null)} title="Reject Document" size="md">
          <div className="space-y-4">
            <div className="text-xs text-gray-500 dark:text-slate-400">
              Rejecting <strong className="text-gray-700 dark:text-slate-200">{rejectDoc.file_name}</strong>. The driver will need to re-upload.
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-700 dark:text-slate-300 mb-1.5">
                Reason <span className="text-rose-500">*</span>
              </label>
              <select
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                className="block w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm text-gray-900 dark:text-slate-100 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
              >
                <option value="">— Select reason —</option>
                {REJECTION_REASONS.map((r) => (
                  <option key={r.value} value={r.value}>
                    {r.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-700 dark:text-slate-300 mb-1.5">
                Note (optional)
              </label>
              <textarea
                value={rejectNote}
                onChange={(e) => setRejectNote(e.target.value)}
                rows={3}
                placeholder="Additional details for the driver..."
                className="block w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm text-gray-900 dark:text-slate-100 placeholder-gray-400 dark:placeholder-slate-500 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
              />
            </div>
            <div className="flex items-center justify-end gap-2 pt-2 border-t border-gray-200 dark:border-slate-800">
              <Button variant="secondary" onClick={() => setRejectDoc(null)}>
                Cancel
              </Button>
              <Button variant="danger" onClick={handleReject} disabled={!rejectReason}>
                <XCircle className="w-3.5 h-3.5 mr-1.5" />
                Reject Document
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
