import { useEffect, useState } from 'react';
import { Plus, Send, CheckCircle2, XCircle, Search, FileText } from 'lucide-react';
import Button from '../ui/Button';
import Alert from '../ui/Alert';
import Badge from '../ui/Badge';
import Modal from '../ui/Modal';
import Select from '../ui/Select';
import { formatCents } from '../../lib/ar-utils';
import EmailComposeSlideOver from './EmailComposeSlideOver';
import { useEmailCompose } from '../../hooks/useEmailCompose';

const STATUS_BADGES = {
  draft: { variant: 'gray', label: 'Draft' },
  sent: { variant: 'blue', label: 'Sent' },
  paid: { variant: 'green', label: 'Paid' },
  overdue: { variant: 'red', label: 'Overdue' },
  void: { variant: 'red', label: 'Void' },
};

export default function InvoicesTab({ filters = {} }) {
  const emailCompose = useEmailCompose();
  const [invoices, setInvoices] = useState([]);
  const [stats, setStats] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [createOpen, setCreateOpen] = useState(false);

  // Create invoice state
  const [approvedSets, setApprovedSets] = useState([]);
  const [selectedSets, setSelectedSets] = useState([]);
  const [creating, setCreating] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (statusFilter) params.set('status', statusFilter);
      if (search) params.set('search', search);
      if (filters.customer_ids?.length) params.set('customer_ids', filters.customer_ids.join(','));
      if (filters.branch_ids?.length)   params.set('branch_ids',   filters.branch_ids.join(','));
      if (filters.from)                 params.set('from',         filters.from);
      if (filters.to)                   params.set('to',           filters.to);
      if (filters.reference_number)     params.set('reference_number', filters.reference_number);
      const res = await fetch(`/api/tenant/ar/invoices?${params}`);
      if (!res.ok) throw new Error('Failed to load invoices');
      const data = await res.json();
      setInvoices(data.invoices || []);
      setStats(data.stats || {});
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }

  useEffect(() => { load(); }, [statusFilter, filters]);

  async function openCreate() {
    setCreateOpen(true);
    setSelectedSets([]);
    // Fetch approved charge sets that aren't yet on an invoice
    try {
      const res = await fetch('/api/tenant/ar?status=approved');
      if (res.ok) {
        const data = await res.json();
        setApprovedSets(data.charge_sets || []);
      }
    } catch { /* ignore */ }
  }

  async function handleCreate() {
    if (selectedSets.length === 0) return;
    setCreating(true);
    try {
      const res = await fetch('/api/tenant/ar/invoices', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          charge_set_ids: selectedSets,
          is_consolidated: selectedSets.length > 1,
        }),
      });
      if (!res.ok) {
        const b = await res.json().catch(() => ({}));
        throw new Error(b.error || 'Failed to create invoice');
      }
      setCreateOpen(false);
      load();
    } catch (e) { setError(e.message); }
    finally { setCreating(false); }
  }

  async function updateStatus(invoiceId, status) {
    try {
      const res = await fetch(`/api/tenant/ar/invoices/${invoiceId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) {
        const b = await res.json().catch(() => ({}));
        throw new Error(b.error || 'Failed to update');
      }
      load();
    } catch (e) { setError(e.message); }
  }

  function toggleSet(id) {
    setSelectedSets((prev) =>
      prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id]
    );
  }

  return (
    <div className="space-y-5">
      {error && <Alert type="error" message={error} onClose={() => setError(null)} />}

      {/* Stats row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'Outstanding', value: formatCents(stats.total_outstanding_cents || 0), color: 'text-amber-600 dark:text-amber-400' },
          { label: 'Sent', value: stats.sent || 0, color: 'text-blue-600 dark:text-blue-400' },
          { label: 'Paid', value: stats.paid || 0, color: 'text-emerald-600 dark:text-emerald-400' },
          { label: 'Overdue', value: stats.overdue || 0, color: 'text-red-600 dark:text-red-400' },
        ].map((s) => (
          <div key={s.label} className="rounded-xl border border-gray-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-3">
            <div className="text-[10px] font-semibold text-gray-500 dark:text-slate-400 uppercase tracking-wide">{s.label}</div>
            <div className={`text-xl font-bold mt-0.5 ${s.color}`}>{s.value}</div>
          </div>
        ))}
      </div>

      {/* Controls */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 dark:text-slate-500" />
          <input type="text" placeholder="Search invoices..." value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') load(); }}
            className="block w-full rounded-lg border border-gray-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-gray-900 dark:text-slate-100 placeholder-gray-400 dark:placeholder-slate-500 pl-9 pr-3 py-2 text-sm focus:outline-none focus:border-blue-500" />
        </div>
        <Select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          placeholder="All Statuses"
          options={[
            { value: 'draft', label: 'Draft' },
            { value: 'sent', label: 'Sent' },
            { value: 'paid', label: 'Paid' },
            { value: 'overdue', label: 'Overdue' },
            { value: 'void', label: 'Void' },
          ]}
        />
        <div className="ml-auto">
          <Button onClick={openCreate}>
            <Plus className="w-4 h-4 mr-1 inline -mt-0.5" />
            Create Invoice
          </Button>
        </div>
      </div>

      {/* Invoices Table */}
      <div className="rounded-xl border border-gray-200 dark:border-slate-800 bg-white dark:bg-slate-900">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 dark:border-slate-800 bg-gray-50/60 dark:bg-slate-800/40">
                <th className="text-left px-4 py-2.5 font-semibold text-gray-600 dark:text-slate-300 text-xs uppercase tracking-wide">Invoice #</th>
                <th className="text-left px-4 py-2.5 font-semibold text-gray-600 dark:text-slate-300 text-xs uppercase tracking-wide">Customer</th>
                <th className="text-left px-4 py-2.5 font-semibold text-gray-600 dark:text-slate-300 text-xs uppercase tracking-wide">Status</th>
                <th className="text-right px-4 py-2.5 font-semibold text-gray-600 dark:text-slate-300 text-xs uppercase tracking-wide">Total</th>
                <th className="text-right px-4 py-2.5 font-semibold text-gray-600 dark:text-slate-300 text-xs uppercase tracking-wide">Balance</th>
                <th className="text-left px-4 py-2.5 font-semibold text-gray-600 dark:text-slate-300 text-xs uppercase tracking-wide">Due Date</th>
                <th className="text-left px-4 py-2.5 font-semibold text-gray-600 dark:text-slate-300 text-xs uppercase tracking-wide">Loads</th>
                <th className="text-left px-4 py-2.5 font-semibold text-gray-600 dark:text-slate-300 text-xs uppercase tracking-wide">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50 dark:divide-slate-800">
              {loading ? (
                <tr><td colSpan={8} className="px-4 py-10 text-center text-gray-400 dark:text-slate-500">Loading...</td></tr>
              ) : invoices.length === 0 ? (
                <tr><td colSpan={8} className="px-4 py-10 text-center text-gray-400 dark:text-slate-500">No invoices yet.</td></tr>
              ) : (
                invoices.map((inv) => {
                  const badge = STATUS_BADGES[inv.status] || STATUS_BADGES.draft;
                  const loadNums = (inv.charge_sets || [])
                    .map((jc) => jc.charge_set?.order?.order_number)
                    .filter(Boolean);
                  return (
                    <tr key={inv.id} className="hover:bg-gray-50 dark:hover:bg-slate-800/40">
                      <td className="px-4 py-2.5">
                        <span className="font-mono text-xs font-semibold text-blue-600 dark:text-blue-400">{inv.invoice_number}</span>
                        {inv.is_consolidated && (
                          <span className="ml-1.5 text-[9px] bg-blue-100 dark:bg-blue-950/40 text-blue-600 dark:text-blue-300 px-1 py-0.5 rounded font-bold">CONSOLIDATED</span>
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-xs text-gray-700 dark:text-slate-300">{inv.customer?.name || '—'}</td>
                      <td className="px-4 py-2.5"><Badge variant={badge.variant}>{badge.label}</Badge></td>
                      <td className="px-4 py-2.5 text-right font-semibold text-gray-900 dark:text-slate-100">{formatCents(inv.total_amount_cents)}</td>
                      <td className="px-4 py-2.5 text-right">
                        <span className={inv.balance_due_cents > 0 ? 'font-semibold text-amber-600 dark:text-amber-400' : 'text-emerald-600 dark:text-emerald-400'}>
                          {formatCents(inv.balance_due_cents)}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-xs text-gray-500 dark:text-slate-400">
                        {inv.due_date ? new Date(inv.due_date).toLocaleDateString() : '—'}
                      </td>
                      <td className="px-4 py-2.5 text-xs text-gray-500 dark:text-slate-400">
                        {loadNums.length > 0 ? loadNums.join(', ') : '—'}
                      </td>
                      <td className="px-4 py-2.5">
                        <div className="flex gap-1">
                          {inv.status === 'draft' && (
                            <button onClick={() => emailCompose.open('invoice', inv.id)}
                              className="text-[10px] font-semibold text-blue-600 dark:text-blue-400 hover:text-blue-700 px-1.5 py-0.5 rounded hover:bg-blue-50 dark:hover:bg-blue-950/40">
                              Send
                            </button>
                          )}
                          {inv.status === 'sent' && inv.balance_due_cents <= 0 && (
                            <button onClick={() => updateStatus(inv.id, 'paid')}
                              className="text-[10px] font-semibold text-emerald-600 dark:text-emerald-400 hover:text-emerald-700 px-1.5 py-0.5 rounded hover:bg-emerald-50 dark:hover:bg-emerald-950/40">
                              Mark Paid
                            </button>
                          )}
                          {['draft', 'sent'].includes(inv.status) && (
                            <button onClick={() => { if (confirm('Void this invoice?')) updateStatus(inv.id, 'void'); }}
                              className="text-[10px] font-semibold text-red-500 dark:text-red-400 hover:text-red-600 px-1.5 py-0.5 rounded hover:bg-red-50 dark:hover:bg-red-950/40">
                              Void
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      <EmailComposeSlideOver
        open={emailCompose.isOpen}
        onClose={emailCompose.close}
        docType={emailCompose.docType}
        contextId={emailCompose.contextId}
        onSent={() => load()}
        onSkipped={() => load()}
      />

      {/* Create Invoice Modal */}
      {createOpen && (
        <Modal isOpen={true} onClose={() => setCreateOpen(false)} title="Create Invoice" size="lg">
          <div className="space-y-4">
            <p className="text-sm text-gray-500 dark:text-slate-400">
              Select approved charge sets to include on this invoice. For consolidated invoices, select multiple sets from the same customer.
            </p>
            {approvedSets.length === 0 ? (
              <div className="py-6 text-center text-sm text-gray-400 dark:text-slate-500">
                No approved charge sets available for invoicing.
              </div>
            ) : (
              <div className="max-h-64 overflow-y-auto rounded-lg border border-gray-200 dark:border-slate-700 divide-y divide-gray-100 dark:divide-slate-800">
                {approvedSets.map((cs) => {
                  const checked = selectedSets.includes(cs.id);
                  return (
                    <label key={cs.id} className="flex items-center gap-3 px-3 py-2.5 hover:bg-gray-50 dark:hover:bg-slate-800/60 cursor-pointer">
                      <input type="checkbox" checked={checked} onChange={() => toggleSet(cs.id)} className="rounded text-blue-600" />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-xs font-medium text-blue-600 dark:text-blue-400">{cs.charge_set_number}</span>
                          <span className="text-xs text-gray-500 dark:text-slate-400">{cs.order?.order_number}</span>
                        </div>
                        <div className="text-[11px] text-gray-500 dark:text-slate-400 mt-0.5">
                          {cs.order?.customer?.name || '—'} · {(cs.line_items || []).length} items
                        </div>
                      </div>
                      <span className="text-sm font-semibold text-gray-900 dark:text-slate-100 shrink-0">
                        {formatCents(cs.total_cents)}
                      </span>
                    </label>
                  );
                })}
              </div>
            )}

            {selectedSets.length > 0 && (
              <div className="text-sm font-semibold text-gray-700 dark:text-slate-200">
                {selectedSets.length} charge set{selectedSets.length > 1 ? 's' : ''} selected · Total: {formatCents(
                  approvedSets.filter((cs) => selectedSets.includes(cs.id)).reduce((s, cs) => s + (cs.total_cents || 0), 0)
                )}
              </div>
            )}

            <div className="flex justify-end gap-2 pt-3 border-t border-gray-200 dark:border-slate-800">
              <Button variant="secondary" onClick={() => setCreateOpen(false)}>Cancel</Button>
              <Button onClick={handleCreate} loading={creating} disabled={selectedSets.length === 0}>
                Create Invoice
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
