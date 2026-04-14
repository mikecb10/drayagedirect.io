import { useEffect, useState } from 'react';
import { Plus } from 'lucide-react';
import Button from '../ui/Button';
import Input from '../ui/Input';
import Alert from '../ui/Alert';
import Badge from '../ui/Badge';
import Modal from '../ui/Modal';
import OrgPicker from '../ui/OrgPicker';
import { formatCents } from '../../lib/ar-utils';

export default function CreditMemosTab() {
  const [memos, setMemos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState({ customer_id: null, customer_label: '', amount: '', reason: '', notes: '' });
  const [saving, setSaving] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch('/api/tenant/ar/credit-memos');
      if (!res.ok) throw new Error('Failed to load');
      const data = await res.json();
      setMemos(data.credit_memos || []);
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }

  useEffect(() => { load(); }, []);

  async function handleCreate(e) {
    e.preventDefault();
    if (!form.customer_id || !form.amount) { setError('Customer and amount required'); return; }
    setSaving(true);
    try {
      const res = await fetch('/api/tenant/ar/credit-memos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customer_id: form.customer_id,
          amount_cents: Math.round(parseFloat(form.amount) * 100),
          reason: form.reason || null,
          notes: form.notes || null,
        }),
      });
      if (!res.ok) throw new Error('Failed to create');
      setModalOpen(false);
      setForm({ customer_id: null, customer_label: '', amount: '', reason: '', notes: '' });
      load();
    } catch (e) { setError(e.message); }
    finally { setSaving(false); }
  }

  async function handleAction(memoId, action, invoiceId) {
    try {
      const res = await fetch(`/api/tenant/ar/credit-memos/${memoId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, invoice_id: invoiceId }),
      });
      if (!res.ok) {
        const b = await res.json().catch(() => ({}));
        throw new Error(b.error || 'Failed');
      }
      load();
    } catch (e) { setError(e.message); }
  }

  const STATUS_BADGE = { draft: 'blue', applied: 'green', void: 'red' };

  return (
    <div className="space-y-5">
      {error && <Alert type="error" message={error} onClose={() => setError(null)} />}

      <div className="flex items-center justify-between">
        <div className="text-sm text-gray-500 dark:text-slate-400">{memos.length} credit memo{memos.length !== 1 ? 's' : ''}</div>
        <Button onClick={() => setModalOpen(true)}>
          <Plus className="w-4 h-4 mr-1 inline -mt-0.5" />
          New Credit Memo
        </Button>
      </div>

      <div className="rounded-xl border border-gray-200 dark:border-slate-800 bg-white dark:bg-slate-900">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 dark:border-slate-800 bg-gray-50/60 dark:bg-slate-800/40">
                <th className="text-left px-4 py-2.5 font-semibold text-gray-600 dark:text-slate-300 text-xs uppercase tracking-wide">Customer</th>
                <th className="text-right px-4 py-2.5 font-semibold text-gray-600 dark:text-slate-300 text-xs uppercase tracking-wide">Amount</th>
                <th className="text-left px-4 py-2.5 font-semibold text-gray-600 dark:text-slate-300 text-xs uppercase tracking-wide">Reason</th>
                <th className="text-left px-4 py-2.5 font-semibold text-gray-600 dark:text-slate-300 text-xs uppercase tracking-wide">Status</th>
                <th className="text-left px-4 py-2.5 font-semibold text-gray-600 dark:text-slate-300 text-xs uppercase tracking-wide">Applied To</th>
                <th className="text-left px-4 py-2.5 font-semibold text-gray-600 dark:text-slate-300 text-xs uppercase tracking-wide">Date</th>
                <th className="text-left px-4 py-2.5 font-semibold text-gray-600 dark:text-slate-300 text-xs uppercase tracking-wide">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50 dark:divide-slate-800">
              {loading ? (
                <tr><td colSpan={7} className="px-4 py-10 text-center text-gray-400 dark:text-slate-500">Loading...</td></tr>
              ) : memos.length === 0 ? (
                <tr><td colSpan={7} className="px-4 py-10 text-center text-gray-400 dark:text-slate-500">No credit memos yet.</td></tr>
              ) : (
                memos.map((m) => (
                  <tr key={m.id} className="hover:bg-gray-50 dark:hover:bg-slate-800/40">
                    <td className="px-4 py-2.5 text-xs text-gray-700 dark:text-slate-300">{m.customer?.name || '—'}</td>
                    <td className="px-4 py-2.5 text-right font-semibold text-gray-900 dark:text-slate-100">{formatCents(m.amount_cents)}</td>
                    <td className="px-4 py-2.5 text-xs text-gray-500 dark:text-slate-400">{m.reason || '—'}</td>
                    <td className="px-4 py-2.5"><Badge variant={STATUS_BADGE[m.status] || 'gray'}>{m.status}</Badge></td>
                    <td className="px-4 py-2.5 text-xs text-gray-500 dark:text-slate-400">
                      {m.applied_invoice?.invoice_number || '—'}
                    </td>
                    <td className="px-4 py-2.5 text-xs text-gray-500 dark:text-slate-400">
                      {m.created_at ? new Date(m.created_at).toLocaleDateString() : '—'}
                    </td>
                    <td className="px-4 py-2.5">
                      {m.status === 'draft' && (
                        <button onClick={() => { if (confirm('Void this credit memo?')) handleAction(m.id, 'void'); }}
                          className="text-[10px] font-semibold text-red-500 dark:text-red-400 hover:text-red-600 px-1.5 py-0.5 rounded hover:bg-red-50 dark:hover:bg-red-950/40">
                          Void
                        </button>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {modalOpen && (
        <Modal isOpen={true} onClose={() => setModalOpen(false)} title="New Credit Memo" size="md">
          <form onSubmit={handleCreate} className="space-y-4">
            <OrgPicker label="Customer" type="customer" value={form.customer_id} valueLabel={form.customer_label}
              onChange={(org) => setForm((f) => ({ ...f, customer_id: org?.id || null, customer_label: org?.name || '' }))} required />
            <Input label="Amount ($)" type="number" step="0.01" min="0.01" value={form.amount}
              onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))} required />
            <Input label="Reason" value={form.reason}
              onChange={(e) => setForm((f) => ({ ...f, reason: e.target.value }))} placeholder="e.g. Overcharge on load, billing dispute" />
            <Input label="Notes" value={form.notes}
              onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} />
            <div className="flex justify-end gap-2 pt-3 border-t border-gray-200 dark:border-slate-800">
              <Button variant="secondary" type="button" onClick={() => setModalOpen(false)}>Cancel</Button>
              <Button type="submit" loading={saving}>Create Credit Memo</Button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
