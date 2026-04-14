import { useEffect, useState, useMemo } from 'react';
import {
  FileCheck, FileX, FileClock, Search, Eye, Check, X, ExternalLink,
  ChevronDown, FileText, Image as ImageIcon, Clock,
} from 'lucide-react';
import TenantLayout from '../../components/tenant/TenantLayout';
import ModuleHeader from '../../components/ui/ModuleHeader';
import Button from '../../components/ui/Button';
import Alert from '../../components/ui/Alert';
import Modal from '../../components/ui/Modal';
import { PERMISSIONS } from '../../lib/permissions';
import { useOverlay } from '../../contexts/OverlayContext';

const REJECTION_REASONS = [
  'Blurry / Unreadable',
  'Wrong Document Type',
  'Missing Signature',
  'Wrong Load',
  'Incomplete Document',
  'Damaged / Cut Off',
  'Other',
];

// Auto-build labels from the constants file + lifecycle types
import { REQUIRED_DOCUMENT_TYPES } from '../../lib/org-form-config';
const DOC_TYPE_LABELS = {
  POD: 'Proof of Delivery',
  BOL: 'Bill of Lading',
  POD_AT_DELIVERY: 'POD (at Delivery)',
  BOL_AT_LOADING: 'BOL (at Loading)',
  ...REQUIRED_DOCUMENT_TYPES.reduce((acc, d) => { acc[d.value] = d.label; return acc; }, {}),
};

const STATUS_CONFIG = {
  received: { label: 'Received', icon: FileClock, color: 'text-amber-600', bg: 'bg-amber-50', border: 'border-amber-200', badge: 'bg-amber-100 text-amber-700' },
  rejected: { label: 'Needs Re-upload', icon: FileX, color: 'text-red-600', bg: 'bg-red-50', border: 'border-red-200', badge: 'bg-red-100 text-red-700' },
  approved: { label: 'Approved', icon: FileCheck, color: 'text-green-600', bg: 'bg-green-50', border: 'border-green-200', badge: 'bg-green-100 text-green-700' },
};

export default function DocumentValidation() {
  const { openOverlay } = useOverlay();
  const [submissions, setSubmissions] = useState([]);
  const [counts, setCounts] = useState({ received: 0, approved: 0, rejected: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState('');
  const [activeTab, setActiveTab] = useState('received');

  // Preview modal
  const [previewDoc, setPreviewDoc] = useState(null);
  // Reject modal
  const [rejectDoc, setRejectDoc] = useState(null);
  const [rejectReason, setRejectReason] = useState('');
  const [rejectNote, setRejectNote] = useState('');
  const [actionLoading, setActionLoading] = useState(false);

  async function fetchSubmissions() {
    setLoading(true);
    try {
      const res = await fetch('/api/tenant/document-submissions');
      if (!res.ok) throw new Error('Failed to load');
      const data = await res.json();
      setSubmissions(data.submissions || []);
      setCounts(data.counts || { received: 0, approved: 0, rejected: 0 });
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }

  useEffect(() => { fetchSubmissions(); }, []);

  const filtered = useMemo(() => {
    let list = submissions.filter((s) => s.status === activeTab);
    if (search) {
      const q = search.toLowerCase();
      list = list.filter((s) =>
        s.order?.order_number?.toLowerCase().includes(q) ||
        s.document_type.toLowerCase().includes(q) ||
        s.file_name.toLowerCase().includes(q) ||
        getDriverName(s).toLowerCase().includes(q)
      );
    }
    return list;
  }, [submissions, activeTab, search]);

  function getDriverName(sub) {
    if (sub.driver) {
      return `${sub.driver.first_name || ''} ${sub.driver.last_name || ''}`.trim() || sub.driver.name || 'Unknown';
    }
    return 'Manual Upload';
  }

  function getDocLabel(type) {
    return DOC_TYPE_LABELS[type] || type;
  }

  function timeAgo(dateStr) {
    const diff = Date.now() - new Date(dateStr).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'Just now';
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  }

  async function handleApprove(id) {
    setActionLoading(true);
    try {
      const res = await fetch(`/api/tenant/document-submissions/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'approve' }),
      });
      if (!res.ok) throw new Error('Failed to approve');

      // Fire the document_validation notification trigger so any
      // configured email templates get dispatched automatically.
      const doc = submissions.find((s) => s.id === id);
      if (doc?.order_id) {
        fetch('/api/tenant/emails/fire-notification', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ load_id: doc.order_id, event_name: 'document_validation' }),
        }).catch((e) => console.error('document_validation notification:', e));
      }

      await fetchSubmissions();
    } catch (e) { setError(e.message); }
    finally { setActionLoading(false); }
  }

  async function handleReject() {
    if (!rejectDoc) return;
    setActionLoading(true);
    try {
      const res = await fetch(`/api/tenant/document-submissions/${rejectDoc.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'reject', rejection_reason: rejectReason, rejection_note: rejectNote }),
      });
      if (!res.ok) throw new Error('Failed to reject');
      setRejectDoc(null);
      setRejectReason('');
      setRejectNote('');
      await fetchSubmissions();
    } catch (e) { setError(e.message); }
    finally { setActionLoading(false); }
  }

  const isImage = (mime) => mime?.startsWith('image/');

  return (
    <TenantLayout title="Document Validation" requiredPermission={[PERMISSIONS.ORDER_ENTRY, PERMISSIONS.ALL]}>
      <div className="space-y-4">
        <ModuleHeader
          title="Document Validation"
          description="Review documents uploaded by drivers. Approve to attach to the load, or reject to request a re-upload."
        />

        {error && <Alert type="error" message={error} onClose={() => setError(null)} />}

        {/* Status tabs with counts */}
        <div className="flex items-center gap-1 border-b border-gray-200 dark:border-slate-800">
          {['received', 'rejected', 'approved'].map((status) => {
            const cfg = STATUS_CONFIG[status];
            const Icon = cfg.icon;
            const count = counts[status];
            return (
              <button key={status} onClick={() => setActiveTab(status)}
                className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                  activeTab === status
                    ? 'border-blue-600 text-blue-700 dark:text-blue-300'
                    : 'border-transparent text-gray-500 dark:text-slate-400 hover:text-gray-700 dark:hover:text-slate-200 hover:border-gray-300 dark:hover:border-slate-700'
                }`}>
                <Icon className={`w-4 h-4 ${activeTab === status ? 'text-blue-600 dark:text-blue-400' : cfg.color}`} />
                {cfg.label}
                {count > 0 && (
                  <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${
                    activeTab === status ? 'bg-blue-100 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300' : cfg.badge
                  }`}>
                    {count}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Search */}
        <div className="relative max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 dark:text-slate-500" />
          <input type="text" placeholder="Search by load #, driver, doc type..." value={search} onChange={(e) => setSearch(e.target.value)}
            className="block w-full rounded-lg border border-gray-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-gray-900 dark:text-slate-100 placeholder-gray-400 dark:placeholder-slate-500 pl-9 pr-3 py-2 text-sm focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 dark:focus:ring-blue-900/40" />
        </div>

        {/* Document cards */}
        {loading ? (
          <div className="py-20 text-center text-gray-400 dark:text-slate-500">Loading...</div>
        ) : filtered.length === 0 ? (
          <div className="py-20 text-center text-gray-400 dark:text-slate-500">
            <FileText className="w-10 h-10 mx-auto mb-3 text-gray-300 dark:text-slate-600" />
            <p className="text-sm">
              {activeTab === 'received' ? 'No documents waiting for review.' :
               activeTab === 'rejected' ? 'No rejected documents.' :
               'No approved documents yet.'}
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {filtered.map((sub) => (
              <div key={sub.id} className={`rounded-xl border ${STATUS_CONFIG[sub.status].border} bg-white dark:bg-slate-900 shadow-sm hover:shadow-md transition-shadow`}>
                {/* Document preview area */}
                <div className="relative h-40 bg-gray-100 dark:bg-slate-800 rounded-t-xl overflow-hidden cursor-pointer group"
                  onClick={() => setPreviewDoc(sub)}>
                  {isImage(sub.mime_type) && sub.file_url ? (
                    <img src={sub.thumbnail_url || sub.file_url} alt={sub.file_name}
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform" />
                  ) : (
                    <div className="flex items-center justify-center h-full">
                      <FileText className="w-12 h-12 text-gray-300 dark:text-slate-600" />
                    </div>
                  )}
                  <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors flex items-center justify-center">
                    <Eye className="w-6 h-6 text-white opacity-0 group-hover:opacity-100 transition-opacity" />
                  </div>
                  {/* Doc type badge */}
                  <span className={`absolute top-2 left-2 text-[10px] font-semibold px-2 py-0.5 rounded ${STATUS_CONFIG[sub.status].badge}`}>
                    {getDocLabel(sub.document_type)}
                  </span>
                </div>

                {/* Details */}
                <div className="p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <button onClick={() => openOverlay('load', { loadId: sub.order_id, tab: 'documents' })}
                      className="text-sm font-medium text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 hover:underline flex items-center gap-1">
                      {sub.order?.order_number || 'Unknown Load'}
                      <ExternalLink className="w-3 h-3" />
                    </button>
                    <span className="text-[10px] text-gray-400 dark:text-slate-500 flex items-center gap-1">
                      <Clock className="w-3 h-3" /> {timeAgo(sub.created_at)}
                    </span>
                  </div>

                  <div className="flex items-center gap-2 text-xs text-gray-600 dark:text-slate-300">
                    <span className="font-medium">{getDriverName(sub)}</span>
                    <span className="text-gray-300 dark:text-slate-600">·</span>
                    <span className="truncate">{sub.file_name}</span>
                  </div>

                  {/* Rejection info */}
                  {sub.status === 'rejected' && sub.rejection_reason && (
                    <div className="rounded bg-red-50 border border-red-100 px-2 py-1.5 text-[11px] text-red-700">
                      <strong>Reason:</strong> {sub.rejection_reason}
                      {sub.rejection_note && <div className="mt-0.5 text-red-600">{sub.rejection_note}</div>}
                    </div>
                  )}

                  {/* Approved by info */}
                  {sub.status === 'approved' && sub.reviewer && (
                    <div className="text-[11px] text-green-700">
                      Approved by {sub.reviewer.name} · {new Date(sub.reviewed_at).toLocaleDateString()}
                    </div>
                  )}

                  {/* Action buttons — only for 'received' status */}
                  {sub.status === 'received' && (
                    <div className="flex gap-2 pt-1">
                      <Button onClick={() => handleApprove(sub.id)} loading={actionLoading} className="flex-1 !py-1.5 !text-xs">
                        <Check className="w-3.5 h-3.5 mr-1 inline" /> Approve
                      </Button>
                      <Button variant="secondary" onClick={() => { setRejectDoc(sub); setRejectReason(''); setRejectNote(''); }}
                        className="flex-1 !py-1.5 !text-xs !text-red-600 !border-red-200 hover:!bg-red-50">
                        <X className="w-3.5 h-3.5 mr-1 inline" /> Reject
                      </Button>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Document Preview Modal */}
      <Modal isOpen={!!previewDoc} onClose={() => setPreviewDoc(null)}
        title={previewDoc ? `${getDocLabel(previewDoc.document_type)} — ${previewDoc.order?.order_number}` : ''} size="xl">
        {previewDoc && (
          <div className="space-y-4">
            {isImage(previewDoc.mime_type) ? (
              <img src={previewDoc.file_url} alt={previewDoc.file_name} className="w-full rounded-lg" />
            ) : (
              <div className="rounded-lg border border-gray-200 dark:border-slate-700 bg-gray-50 dark:bg-slate-800 p-8 text-center">
                <FileText className="w-16 h-16 mx-auto text-gray-300 dark:text-slate-600 mb-3" />
                <p className="text-sm text-gray-500 dark:text-slate-400">{previewDoc.file_name}</p>
                <a href={previewDoc.file_url} target="_blank" rel="noopener noreferrer"
                  className="text-sm text-blue-600 dark:text-blue-400 hover:underline mt-2 inline-block">
                  Open in new tab →
                </a>
              </div>
            )}
            <div className="flex items-center justify-between text-xs text-gray-500 dark:text-slate-400">
              <span>Uploaded by {getDriverName(previewDoc)} · {timeAgo(previewDoc.created_at)}</span>
              <span>{previewDoc.file_size ? `${(previewDoc.file_size / 1024).toFixed(0)} KB` : ''}</span>
            </div>
            {previewDoc.status === 'received' && (
              <div className="flex gap-3 pt-2 border-t border-gray-200 dark:border-slate-800">
                <Button onClick={() => { handleApprove(previewDoc.id); setPreviewDoc(null); }} className="flex-1">
                  <Check className="w-4 h-4 mr-1 inline" /> Approve
                </Button>
                <Button variant="secondary" onClick={() => { setRejectDoc(previewDoc); setPreviewDoc(null); }}
                  className="flex-1 !text-red-600 !border-red-200 hover:!bg-red-50">
                  <X className="w-4 h-4 mr-1 inline" /> Reject
                </Button>
              </div>
            )}
          </div>
        )}
      </Modal>

      {/* Reject Modal */}
      <Modal isOpen={!!rejectDoc} onClose={() => setRejectDoc(null)} title="Reject Document" size="md">
        <div className="space-y-4">
          <p className="text-sm text-gray-600">
            The driver will be notified to re-upload <strong>{rejectDoc ? getDocLabel(rejectDoc.document_type) : ''}</strong> for
            load <strong>{rejectDoc?.order?.order_number}</strong>.
          </p>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Rejection Reason *</label>
            <select value={rejectReason} onChange={(e) => setRejectReason(e.target.value)}
              className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm">
              <option value="">Select reason...</option>
              {REJECTION_REASONS.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Note to Driver (optional)</label>
            <textarea value={rejectNote} onChange={(e) => setRejectNote(e.target.value)} rows={2}
              placeholder="e.g. Please retake the photo — the signature is cut off on the right side"
              className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <Button variant="secondary" onClick={() => setRejectDoc(null)}>Cancel</Button>
            <Button onClick={handleReject} loading={actionLoading} disabled={!rejectReason}
              className="!bg-red-600 hover:!bg-red-700">
              Reject & Notify Driver
            </Button>
          </div>
        </div>
      </Modal>
    </TenantLayout>
  );
}
