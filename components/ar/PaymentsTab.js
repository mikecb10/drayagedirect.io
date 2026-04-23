import { useEffect, useState } from 'react';
import { Plus, Search, FileText, Upload, X } from 'lucide-react';
import Button from '../ui/Button';
import Input from '../ui/Input';
import Select from '../ui/Select';
import DatePicker from '../ui/DatePicker';
import Alert from '../ui/Alert';
import Badge from '../ui/Badge';
import Modal from '../ui/Modal';
import OrgPicker from '../ui/OrgPicker';
import { formatCents } from '../../lib/ar-utils';

const METHOD_BADGES = {
  check: 'blue', ach: 'green', wire: 'purple', credit_card: 'amber', cash: 'gray', other: 'gray',
};

export default function PaymentsTab({ filters = {} }) {
  const [payments, setPayments] = useState([]);
  const [stats, setStats] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState({
    customer_id: null, customer_label: '', amount: '', payment_method: 'check',
    payment_date: new Date().toISOString().split('T')[0], reference_number: '', notes: '',
  });
  const [docFile, setDocFile] = useState(null); // File | null — optional supporting doc to upload after payment create
  const [saving, setSaving] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (filters.customer_ids?.length)         params.set('customer_ids', filters.customer_ids.join(','));
      if (filters.customer_ids_exclude?.length) params.set('customer_ids_exclude', filters.customer_ids_exclude.join(','));
      if (filters.from) params.set('from', filters.from);
      if (filters.to)   params.set('to',   filters.to);
      if (filters.reference_number) params.set('reference_number', filters.reference_number);

      const qs = params.toString();
      const res = await fetch(`/api/tenant/ar/payments${qs ? `?${qs}` : ''}`);
      if (!res.ok) throw new Error('Failed to load');
      const data = await res.json();
      setPayments(data.payments || []);
      setStats(data.stats || {});
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }

  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [filters]);

  async function handleSave(e) {
    e.preventDefault();
    if (!form.customer_id) { setError('Customer is required'); return; }
    if (!form.amount || parseFloat(form.amount) <= 0) { setError('Amount must be positive'); return; }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch('/api/tenant/ar/payments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customer_id: form.customer_id,
          amount_cents: Math.round(parseFloat(form.amount) * 100),
          payment_method: form.payment_method,
          payment_date: form.payment_date,
          reference_number: form.reference_number || null,
          notes: form.notes || null,
        }),
      });
      // Consume the response body exactly once. A Response can only be read
      // one time — any branch that reads it must share the same parsed object
      // so later code (the doc-upload step) doesn't see "body used already".
      const createdBody = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(createdBody.error || 'Failed to record payment');
      }
      // Two-step upload: create the payment first (JSON POST above), then
      // if a supporting doc was attached, multipart POST it to
      // /payments/[id]/document. Decouples create from upload so a failed
      // upload doesn't block the payment record — user sees a warning and
      // can retry via edit. Endpoint accepts .pdf/.png/.jpg/.jpeg, 10MB max.
      if (docFile) {
        const newPaymentId = createdBody.payment?.id || createdBody.id;
        if (newPaymentId) {
          const fd = new FormData();
          fd.append('file', docFile);
          const upRes = await fetch(`/api/tenant/ar/payments/${newPaymentId}/document`, {
            method: 'POST',
            body: fd,
          });
          if (!upRes.ok) {
            const b = await upRes.json().catch(() => ({}));
            // Non-fatal: payment is already recorded. Surface a warning.
            setError(`Payment recorded, but document upload failed: ${b.error || upRes.status}`);
          }
        } else {
          // Shouldn't happen under normal flow (POST returns 201 with
          // { payment: {...} }) but surface so a silent skip doesn't mask
          // the failure.
          setError('Payment recorded, but could not determine new payment id for document upload.');
        }
      }
      setModalOpen(false);
      setForm({ customer_id: null, customer_label: '', amount: '', payment_method: 'check', payment_date: new Date().toISOString().split('T')[0], reference_number: '', notes: '' });
      setDocFile(null);
      load();
    } catch (e) { setError(e.message); }
    finally { setSaving(false); }
  }

  return (
    <div className="space-y-5">
      {error && <Alert type="error" message={error} onClose={() => setError(null)} />}

      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-xl border border-gray-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-3">
          <div className="text-[10px] font-semibold text-gray-500 dark:text-slate-400 uppercase tracking-wide">Total Received</div>
          <div className="text-xl font-bold text-emerald-600 dark:text-emerald-400 mt-0.5">{formatCents(stats.total_cents || 0)}</div>
        </div>
        <div className="rounded-xl border border-gray-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-3">
          <div className="text-[10px] font-semibold text-gray-500 dark:text-slate-400 uppercase tracking-wide">Unapplied</div>
          <div className="text-xl font-bold text-amber-600 dark:text-amber-400 mt-0.5">{formatCents(stats.unapplied_cents || 0)}</div>
        </div>
        <div className="rounded-xl border border-gray-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-3">
          <div className="text-[10px] font-semibold text-gray-500 dark:text-slate-400 uppercase tracking-wide">Payments</div>
          <div className="text-xl font-bold text-blue-600 dark:text-blue-400 mt-0.5">{stats.count || 0}</div>
        </div>
      </div>

      <div className="flex items-center justify-between">
        <div className="text-sm text-gray-500 dark:text-slate-400">{payments.length} payment{payments.length !== 1 ? 's' : ''}</div>
        <Button onClick={() => setModalOpen(true)}>
          <Plus className="w-4 h-4 mr-1 inline -mt-0.5" />
          Record Payment
        </Button>
      </div>

      <div className="rounded-xl border border-gray-200 dark:border-slate-800 bg-white dark:bg-slate-900">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 dark:border-slate-800 bg-gray-50/60 dark:bg-slate-800/40">
                <th className="text-left px-4 py-2.5 font-semibold text-gray-600 dark:text-slate-300 text-xs uppercase tracking-wide">Reference</th>
                <th className="text-left px-4 py-2.5 font-semibold text-gray-600 dark:text-slate-300 text-xs uppercase tracking-wide">Customer</th>
                <th className="text-right px-4 py-2.5 font-semibold text-gray-600 dark:text-slate-300 text-xs uppercase tracking-wide">Amount</th>
                <th className="text-left px-4 py-2.5 font-semibold text-gray-600 dark:text-slate-300 text-xs uppercase tracking-wide">Method</th>
                <th className="text-left px-4 py-2.5 font-semibold text-gray-600 dark:text-slate-300 text-xs uppercase tracking-wide">Date</th>
                <th className="text-right px-4 py-2.5 font-semibold text-gray-600 dark:text-slate-300 text-xs uppercase tracking-wide">Unapplied</th>
                <th className="text-left px-4 py-2.5 font-semibold text-gray-600 dark:text-slate-300 text-xs uppercase tracking-wide">Applied To</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50 dark:divide-slate-800">
              {loading ? (
                <tr><td colSpan={7} className="px-4 py-10 text-center text-gray-400 dark:text-slate-500">Loading...</td></tr>
              ) : payments.length === 0 ? (
                <tr><td colSpan={7} className="px-4 py-10 text-center text-gray-400 dark:text-slate-500">No payments recorded yet.</td></tr>
              ) : (
                payments.map((p) => (
                  <tr key={p.id} className="hover:bg-gray-50 dark:hover:bg-slate-800/40">
                    <td className="px-4 py-2.5 font-mono text-xs text-gray-900 dark:text-slate-100">
                      <div className="inline-flex items-center gap-1.5">
                        {p.reference_number || '—'}
                        {p.document_url && (
                          <a
                            href={`/api/tenant/ar/payments/${p.id}/document?redirect=1`}
                            target="_blank"
                            rel="noopener noreferrer"
                            title={p.document_filename || 'Supporting document'}
                            className="inline-flex items-center text-blue-600 dark:text-blue-400 hover:text-blue-700"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <FileText className="w-3.5 h-3.5" />
                          </a>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-2.5 text-xs text-gray-700 dark:text-slate-300">{p.customer?.name || '—'}</td>
                    <td className="px-4 py-2.5 text-right font-semibold text-gray-900 dark:text-slate-100">{formatCents(p.amount_cents)}</td>
                    <td className="px-4 py-2.5">
                      <Badge variant={METHOD_BADGES[p.payment_method] || 'gray'}>
                        {(p.payment_method || 'other').replace('_', ' ')}
                      </Badge>
                    </td>
                    <td className="px-4 py-2.5 text-xs text-gray-500 dark:text-slate-400">
                      {p.payment_date ? new Date(p.payment_date).toLocaleDateString() : '—'}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <span className={p.unapplied_cents > 0 ? 'text-amber-600 dark:text-amber-400 font-semibold' : 'text-emerald-600 dark:text-emerald-400'}>
                        {formatCents(p.unapplied_cents)}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-xs text-gray-500 dark:text-slate-400">
                      {(p.applications || []).map((a) => a.applied_invoice?.invoice_number).filter(Boolean).join(', ') || '—'}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {modalOpen && (
        <Modal isOpen={true} onClose={() => setModalOpen(false)} title="Record Payment" size="md">
          <form onSubmit={handleSave} className="space-y-4">
            <OrgPicker
              label="Customer"
              type="customer"
              value={form.customer_id}
              valueLabel={form.customer_label}
              onChange={(org) => setForm((f) => ({ ...f, customer_id: org?.id || null, customer_label: org?.name || '' }))}
              required
            />
            <Input label="Amount ($)" type="number" step="0.01" min="0.01" value={form.amount}
              onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))} required />
            <Select label="Payment Method" value={form.payment_method}
              onChange={(e) => setForm((f) => ({ ...f, payment_method: e.target.value }))}
              options={[
                { value: 'check', label: 'Check' },
                { value: 'ach', label: 'ACH' },
                { value: 'wire', label: 'Wire' },
                { value: 'credit_card', label: 'Credit Card' },
                { value: 'cash', label: 'Cash' },
                { value: 'other', label: 'Other' },
              ]} />
            <DatePicker label="Payment Date" value={form.payment_date}
              onChange={(e) => setForm((f) => ({ ...f, payment_date: e.target.value }))} required />
            <Input label="Reference / Check #" value={form.reference_number}
              onChange={(e) => setForm((f) => ({ ...f, reference_number: e.target.value }))} placeholder="e.g. Check #4521" />
            <div>
              <label className="block text-xs font-semibold text-gray-700 dark:text-slate-300 mb-1">
                Supporting Document <span className="text-gray-400 dark:text-slate-500 font-normal">(optional)</span>
              </label>
              {docFile ? (
                <div className="flex items-center gap-2 rounded-lg border border-emerald-300 dark:border-emerald-900/50 bg-emerald-50 dark:bg-emerald-950/20 px-3 py-2">
                  <FileText className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
                  <div className="flex-1 min-w-0 text-xs">
                    <div className="font-medium text-emerald-900 dark:text-emerald-200 truncate">{docFile.name}</div>
                    <div className="text-[11px] text-emerald-700 dark:text-emerald-400">{(docFile.size / 1024).toFixed(1)} KB</div>
                  </div>
                  <button type="button" onClick={() => setDocFile(null)} aria-label="Remove attachment"
                    className="text-emerald-700 dark:text-emerald-400 hover:text-emerald-900">
                    <X className="w-4 h-4" />
                  </button>
                </div>
              ) : (
                <label className="flex items-center gap-2 rounded-lg border border-dashed border-gray-300 dark:border-slate-700 bg-gray-50 dark:bg-slate-900 px-3 py-3 text-xs text-gray-500 dark:text-slate-400 cursor-pointer hover:border-blue-400 dark:hover:border-blue-600">
                  <Upload className="w-4 h-4" />
                  <span>Upload a check scan, wire confirmation, or ACH receipt (PDF, PNG, JPG · max 10 MB)</span>
                  <input type="file" accept=".pdf,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg" className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (!f) return;
                      if (f.size > 10 * 1024 * 1024) {
                        setError('File too large — 10 MB max');
                        return;
                      }
                      setDocFile(f);
                    }}
                  />
                </label>
              )}
            </div>
            <Input label="Notes" value={form.notes}
              onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} />
            <div className="flex justify-end gap-2 pt-3 border-t border-gray-200 dark:border-slate-800">
              <Button variant="secondary" type="button" onClick={() => { setModalOpen(false); setDocFile(null); }}>Cancel</Button>
              <Button type="submit" loading={saving}>Record Payment</Button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
