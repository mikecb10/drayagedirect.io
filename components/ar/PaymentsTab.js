import { useEffect, useState } from 'react';
import { Plus, Search } from 'lucide-react';
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

export default function PaymentsTab() {
  const [payments, setPayments] = useState([]);
  const [stats, setStats] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState({
    customer_id: null, customer_label: '', amount: '', payment_method: 'check',
    payment_date: new Date().toISOString().split('T')[0], reference_number: '', notes: '',
  });
  const [saving, setSaving] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch('/api/tenant/ar/payments');
      if (!res.ok) throw new Error('Failed to load');
      const data = await res.json();
      setPayments(data.payments || []);
      setStats(data.stats || {});
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }

  useEffect(() => { load(); }, []);

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
      if (!res.ok) {
        const b = await res.json().catch(() => ({}));
        throw new Error(b.error || 'Failed to record payment');
      }
      setModalOpen(false);
      setForm({ customer_id: null, customer_label: '', amount: '', payment_method: 'check', payment_date: new Date().toISOString().split('T')[0], reference_number: '', notes: '' });
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
          <div className="text-xl font-bold text-blue-600 dark:text-blue-400 mt-0.5">{stats.total || 0}</div>
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
                    <td className="px-4 py-2.5 font-mono text-xs text-gray-900 dark:text-slate-100">{p.reference_number || '—'}</td>
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
            <Input label="Notes" value={form.notes}
              onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} />
            <div className="flex justify-end gap-2 pt-3 border-t border-gray-200 dark:border-slate-800">
              <Button variant="secondary" type="button" onClick={() => setModalOpen(false)}>Cancel</Button>
              <Button type="submit" loading={saving}>Record Payment</Button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
