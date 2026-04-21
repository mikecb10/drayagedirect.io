import { useEffect, useState } from 'react';
import {
  Search, FileText, Check, DollarSign, AlertCircle,
  RefreshCw, ExternalLink, Truck, CheckCircle2,
} from 'lucide-react';
import Alert from '../ui/Alert';
import { useOverlay } from '../../contexts/OverlayContext';
import { formatInvoiceNumber } from '../../lib/invoice-utils';
import BulkActionBar from './BulkActionBar';
import BulkGroupingModal from './BulkGroupingModal';
import BulkEmailQueue from './BulkEmailQueue';

const STATUS_BADGES = {
  draft: { label: 'Draft', cls: 'bg-gray-100 text-gray-700 dark:bg-slate-800 dark:text-slate-300' },
  rate_con_sent: { label: 'Rate Con Sent', cls: 'bg-cyan-100 text-cyan-700 dark:bg-cyan-950/40 dark:text-cyan-300' },
  unapproved: { label: 'Unapproved', cls: 'bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300' },
  approved: { label: 'Approved', cls: 'bg-blue-100 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300' },
  invoiced: { label: 'Invoiced', cls: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300' },
  billed: { label: 'Invoiced', cls: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300' },
  rebilling: { label: 'Rebilling', cls: 'bg-purple-100 text-purple-700 dark:bg-purple-950/40 dark:text-purple-300' },
  void: { label: 'Voided', cls: 'bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-300' },
};

function formatCents(cents) {
  if (cents == null) return '$0.00';
  return `$${(cents / 100).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`;
}

export default function BillingPipelineTab({ filters = {} }) {
  const { openOverlay } = useOverlay();
  const [chargeSets, setChargeSets] = useState([]);
  const [counts, setCounts] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState('');
  const [activeFilter, setActiveFilter] = useState(null);
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [lastClickedId, setLastClickedId] = useState(null);
  const [bulkAction, setBulkAction] = useState(null); // 'approve' | 'unapprove' | 'approve_invoice' | null
  const [toast, setToast] = useState(null); // { type, message } | null
  const [groupingModalInvoices, setGroupingModalInvoices] = useState(null); // Array | null
  const [queueState, setQueueState] = useState(null); // { kind, groups } | null
  // 2a.4b rate-con bulk state. Kept separate from groupingModalInvoices +
  // queueState so the invoice and rate-con flows coexist cleanly.
  const [groupingModalRateCons, setGroupingModalRateCons] = useState(null);
  const [rateConQueueState, setRateConQueueState] = useState(null);

  async function fetchAR({ silent = false } = {}) {
    if (!silent) setLoading(true);
    try {
      const params = new URLSearchParams();
      if (activeFilter && !['uncompleted_loads', 'completed_loads'].includes(activeFilter)) {
        params.set('status', activeFilter);
      }
      if (['uncompleted_loads', 'completed_loads'].includes(activeFilter)) {
        params.set('load_status', activeFilter === 'uncompleted_loads' ? 'uncompleted' : 'completed');
      }
      if (search) params.set('search', search);
      if (filters.customer_ids?.length) params.set('customer_ids', filters.customer_ids.join(','));
      if (filters.branch_ids?.length)   params.set('branch_ids',   filters.branch_ids.join(','));
      if (filters.from)                 params.set('from',         filters.from);
      if (filters.to)                   params.set('to',           filters.to);
      if (filters.reference_number)     params.set('reference_number', filters.reference_number);
      if (filters.load_types?.length)       params.set('load_types',       filters.load_types.join(','));
      if (filters.container_types?.length) params.set('container_types', filters.container_types.join(','));
      if (filters.container_sizes?.length) params.set('container_sizes', filters.container_sizes.join(','));
      if (filters.flags?.length) params.set('flags', filters.flags.join(','));
      if (filters.ssl_codes?.length) params.set('ssl_codes', filters.ssl_codes.join(','));
      if (filters.driver_ids?.length) params.set('driver_ids', filters.driver_ids.join(','));
      if (filters.customer_ids_exclude?.length)    params.set('customer_ids_exclude',    filters.customer_ids_exclude.join(','));
      if (filters.branch_ids_exclude?.length)      params.set('branch_ids_exclude',      filters.branch_ids_exclude.join(','));
      if (filters.load_types_exclude?.length)      params.set('load_types_exclude',      filters.load_types_exclude.join(','));
      if (filters.container_types_exclude?.length) params.set('container_types_exclude', filters.container_types_exclude.join(','));
      if (filters.container_sizes_exclude?.length) params.set('container_sizes_exclude', filters.container_sizes_exclude.join(','));
      if (filters.flags_exclude?.length)           params.set('flags_exclude',           filters.flags_exclude.join(','));
      if (filters.ssl_codes_exclude?.length)       params.set('ssl_codes_exclude',       filters.ssl_codes_exclude.join(','));
      if (filters.driver_ids_exclude?.length)      params.set('driver_ids_exclude',      filters.driver_ids_exclude.join(','));
      const res = await fetch(`/api/tenant/ar?${params}`);
      if (!res.ok) throw new Error('Failed to load');
      const data = await res.json();
      setChargeSets(data.charge_sets || []);
      // Defensive: drop any selected ids that no longer match the fetched list
      // (e.g., a bulk transition removed them from the current filter).
      setSelectedIds((prev) => {
        const visible = new Set((data.charge_sets || []).map((cs) => cs.id));
        const next = new Set();
        for (const id of prev) if (visible.has(id)) next.add(id);
        return next;
      });
      setCounts(data.counts || {});
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }

  useEffect(() => { fetchAR(); }, [activeFilter, filters]);

  // Selection is meaningful only within the currently displayed list.
  // When the filter or search changes, the list changes, so clear selection.
  useEffect(() => {
    setSelectedIds(new Set());
    setLastClickedId(null);
  }, [activeFilter, search]);

  // Toast auto-dismisses after 4 seconds
  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(id);
  }, [toast]);

  const visibleIds = chargeSets.map((cs) => cs.id);
  const allSelected = visibleIds.length > 0 && visibleIds.every((id) => selectedIds.has(id));
  const someSelected = visibleIds.some((id) => selectedIds.has(id)) && !allSelected;
  const selectedTotalCents = chargeSets
    .filter((cs) => selectedIds.has(cs.id))
    .reduce((a, cs) => a + (cs.total_cents || 0), 0);

  function toggleAll() {
    if (allSelected || someSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(visibleIds));
    }
  }

  function toggleRow(csId, event) {
    event.stopPropagation();
    if (event.shiftKey && lastClickedId) {
      const startIdx = visibleIds.indexOf(lastClickedId);
      const endIdx = visibleIds.indexOf(csId);
      if (startIdx >= 0 && endIdx >= 0) {
        const [a, b] = [Math.min(startIdx, endIdx), Math.max(startIdx, endIdx)];
        const rangeIds = visibleIds.slice(a, b + 1);
        setSelectedIds((prev) => {
          const next = new Set(prev);
          for (const id of rangeIds) next.add(id);
          return next;
        });
      }
    } else {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        if (next.has(csId)) next.delete(csId);
        else next.add(csId);
        return next;
      });
    }
    setLastClickedId(csId);
  }

  async function bulkStatusTransition(nextStatus, validFromStatuses) {
    const actionLabel = nextStatus === 'approved' ? 'approve' : 'unapprove';
    setBulkAction(actionLabel);

    const selected = chargeSets.filter((cs) => selectedIds.has(cs.id));
    const eligible = selected.filter((cs) => validFromStatuses.includes(cs.status));
    const skipped = selected.length - eligible.length;
    let succeeded = 0;
    let failed = 0;
    let firstError = null;

    for (const cs of eligible) {
      try {
        const res = await fetch(
          `/api/tenant/loads/${cs.order_id}/charge-sets/${cs.id}`,
          {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status: nextStatus }),
          }
        );
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error || `HTTP ${res.status}`);
        }
        succeeded++;
      } catch (e) {
        failed++;
        if (!firstError) firstError = e.message || 'Unknown error';
      }
    }

    setBulkAction(null);
    setSelectedIds(new Set());
    setLastClickedId(null);
    await fetchAR({ silent: true });

    const verb = nextStatus === 'approved' ? 'Approved' : 'Unapproved';
    const parts = [];
    if (succeeded > 0) parts.push(`${verb} ${succeeded}`);
    if (skipped > 0) parts.push(`skipped ${skipped} (ineligible status)`);
    if (failed > 0) parts.push(`${failed} failed`);

    // Fix I4: mixed results use warning, not success
    const kind = failed === 0 ? 'success' : succeeded === 0 ? 'error' : 'warning';
    const baseMessage = parts.join(' · ') || 'Nothing to do';
    const fullMessage = firstError ? `${baseMessage} — ${firstError}` : baseMessage;

    setToast({ type: kind, message: fullMessage });
  }

  async function handleBulkApprove() {
    await bulkStatusTransition('approved', ['draft', 'rate_con_sent', 'unapproved']);
  }

  async function handleBulkUnapprove() {
    await bulkStatusTransition('unapproved', ['draft', 'rate_con_sent', 'approved']);
  }

  async function handleBulkApproveAndInvoice() {
    setBulkAction('approve_invoice');
    const selected = chargeSets.filter((cs) => selectedIds.has(cs.id));

    // Phase 1 — transition any pre-approved statuses to 'approved' first.
    // The button is "Approve & Invoice", so the caller expects it to handle
    // both steps in one click. Mirror bulkStatusTransition's valid-from set.
    const toApprove = selected.filter((cs) =>
      ['draft', 'rate_con_sent', 'unapproved'].includes(cs.status)
    );
    const approvedIds = new Set(
      selected.filter((cs) => cs.status === 'approved').map((cs) => cs.id)
    );
    let approveFailed = 0;

    for (const cs of toApprove) {
      try {
        const res = await fetch(
          `/api/tenant/loads/${cs.order_id}/charge-sets/${cs.id}`,
          {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status: 'approved' }),
          }
        );
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error || `HTTP ${res.status}`);
        }
        approvedIds.add(cs.id);
      } catch (_e) {
        approveFailed++;
      }
    }

    // Phase 2 — invoice every approved row (pre-existing + newly approved).
    const toInvoice = selected.filter((cs) => approvedIds.has(cs.id));
    const ineligibleCount = selected.length - toInvoice.length - approveFailed;

    const created = [];
    let invoiceFailed = 0;
    let firstError = null;

    for (const cs of toInvoice) {
      try {
        const res = await fetch('/api/tenant/ar/invoices', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ charge_set_ids: [cs.id] }),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error || `HTTP ${res.status}`);
        }
        const data = await res.json();
        const inv = data.invoice;
        created.push({
          invoice_id: inv.id,
          invoice_number: inv.invoice_number,
          customer_id: inv.customer_id,
          customer_name: cs.order?.customer?.name ?? 'Unknown',
          reference_number: cs.order?.customer_reference ?? null,
          charge_set_id: cs.id,
          total_cents: inv.total_amount_cents ?? cs.total_cents ?? 0,
        });
      } catch (e) {
        invoiceFailed++;
        if (!firstError) firstError = e.message;
      }
    }

    setBulkAction(null);
    setSelectedIds(new Set());
    setLastClickedId(null);

    if (created.length === 0) {
      setToast({
        type: 'error',
        message:
          invoiceFailed > 0 ? `All ${invoiceFailed} invoice creations failed`
          : approveFailed > 0 ? `All ${approveFailed} approvals failed`
          : 'No eligible charge sets (all voided or already invoiced)',
      });
      return;
    }

    // Silent refetch so flipped charge sets disappear from current filter
    // before the modal opens (preserves ChargeSetCard unmount rule)
    await fetchAR({ silent: true });

    const parts = [`Invoiced ${created.length}`];
    if (ineligibleCount > 0) parts.push(`skipped ${ineligibleCount} (voided/invoiced)`);
    if (approveFailed > 0) parts.push(`${approveFailed} approve failed`);
    if (invoiceFailed > 0) parts.push(`${invoiceFailed} invoice failed`);
    const kind = (approveFailed === 0 && invoiceFailed === 0) ? 'success' : 'warning';
    const base = parts.join(' · ');
    setToast({ type: kind, message: firstError ? `${base} — ${firstError}` : base });

    setGroupingModalInvoices(created);
  }

  async function handleBulkSendRateCons() {
    const selected = chargeSets.filter((cs) => selectedIds.has(cs.id));
    if (selected.length === 0) return;

    // Build items in the shape BulkGroupingModal.computeGroups expects.
    // computeGroups keys on customer_id for the 'customer' grouping, on
    // customer_id + reference_number for 'reference', and on
    // (charge_set_id ?? invoice_id) for 'charge_set'. Fill invoice_id with
    // the charge-set's own id so the charge_set grouping works uniformly
    // with the shape existing invoice callers use.
    //
    // Field paths mirror handleBulkApproveAndInvoice: customer info comes
    // from cs.order.customer (nested join), reference_number from
    // cs.order.customer_reference (the customer's own PO/correlation; the
    // `reference_number` field name on orders doesn't exist in schema).
    const items = selected.map((cs) => ({
      id: cs.id,
      invoice_id: cs.id,
      charge_set_id: cs.id,
      customer_id: cs.order?.customer?.id ?? cs.order?.customer_id ?? null,
      customer_name: cs.order?.customer?.name ?? '(unknown customer)',
      reference_number: cs.order?.customer_reference ?? null,
      invoice_number: cs.charge_set_number ?? cs.id,
      charge_set_number: cs.charge_set_number ?? cs.id,
      total_cents: cs.total_cents ?? 0,
    }));

    setGroupingModalRateCons(items);
  }

  function handleExportCsv() {
    const selected = chargeSets.filter((cs) => selectedIds.has(cs.id));
    if (selected.length === 0) return;

    const rows = [
      ['Order #', 'Customer', 'Charge Set #', 'Status', 'Bill To', 'Total'],
      ...selected.map((cs) => [
        cs.order?.order_number || '',
        cs.order?.customer?.name || '',
        cs.charge_set_number || '',
        cs.status || '',
        cs.bill_to?.name || '',
        `$${((cs.total_cents || 0) / 100).toFixed(2)}`,
      ]),
    ];

    const escape = (v) => {
      const s = String(v ?? '');
      // CSV injection mitigation: values starting with =, +, -, @, tab, or CR
      // can be interpreted as formulas by Excel/Google Sheets. Prepend a
      // single quote to neutralize them. Then apply standard RFC 4180
      // quoting for commas, quotes, and newlines.
      const dangerous = /^[=+\-@\t\r]/.test(s);
      const safe = dangerous ? `'${s}` : s;
      const needsQuoting = dangerous || /[",\n]/.test(safe);
      return needsQuoting ? `"${safe.replace(/"/g, '""')}"` : safe;
    };
    const csv = rows.map((row) => row.map(escape).join(',')).join('\n');

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ar-billing-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    setToast({ type: 'success', message: `Exported ${selected.length} charge set${selected.length !== 1 ? 's' : ''} to CSV` });
  }

  function PipelineCard({ label, count, total_cents, icon: Icon, color, filterKey, active }) {
    const colorMap = {
      gray: { bg: 'bg-gray-50 dark:bg-slate-800/50', border: 'border-gray-200 dark:border-slate-700', text: 'text-gray-700 dark:text-slate-200', iconBg: 'bg-gray-100 text-gray-500 dark:bg-slate-800 dark:text-slate-400', activeBg: 'bg-gray-100 dark:bg-slate-800 ring-2 ring-gray-400 dark:ring-slate-500' },
      cyan: { bg: 'bg-cyan-50 dark:bg-cyan-950/30', border: 'border-cyan-200 dark:border-cyan-900/60', text: 'text-cyan-700 dark:text-cyan-300', iconBg: 'bg-cyan-100 text-cyan-600 dark:bg-cyan-950/50 dark:text-cyan-400', activeBg: 'bg-cyan-100 dark:bg-cyan-950/50 ring-2 ring-cyan-400' },
      amber: { bg: 'bg-amber-50 dark:bg-amber-950/30', border: 'border-amber-200 dark:border-amber-900/60', text: 'text-amber-700 dark:text-amber-300', iconBg: 'bg-amber-100 text-amber-600 dark:bg-amber-950/50 dark:text-amber-400', activeBg: 'bg-amber-100 dark:bg-amber-950/50 ring-2 ring-amber-400' },
      blue: { bg: 'bg-blue-50 dark:bg-blue-950/30', border: 'border-blue-200 dark:border-blue-900/60', text: 'text-blue-700 dark:text-blue-300', iconBg: 'bg-blue-100 text-blue-600 dark:bg-blue-950/50 dark:text-blue-400', activeBg: 'bg-blue-100 dark:bg-blue-950/50 ring-2 ring-blue-400' },
      emerald: { bg: 'bg-emerald-50 dark:bg-emerald-950/30', border: 'border-emerald-200 dark:border-emerald-900/60', text: 'text-emerald-700 dark:text-emerald-300', iconBg: 'bg-emerald-100 text-emerald-600 dark:bg-emerald-950/50 dark:text-emerald-400', activeBg: 'bg-emerald-100 dark:bg-emerald-950/50 ring-2 ring-emerald-400' },
      purple: { bg: 'bg-purple-50 dark:bg-purple-950/30', border: 'border-purple-200 dark:border-purple-900/60', text: 'text-purple-700 dark:text-purple-300', iconBg: 'bg-purple-100 text-purple-600 dark:bg-purple-950/50 dark:text-purple-400', activeBg: 'bg-purple-100 dark:bg-purple-950/50 ring-2 ring-purple-400' },
    };
    const c = colorMap[color] || colorMap.gray;
    return (
      <button type="button" onClick={() => setActiveFilter(active ? null : filterKey)}
        className={`rounded-xl border p-3 text-left transition-all flex-1 min-w-[120px] ${active ? c.activeBg + ' ' + c.border : c.bg + ' ' + c.border + ' hover:shadow-sm'}`}>
        <div className="flex items-center gap-2 mb-1">
          <div className={`w-6 h-6 rounded-lg flex items-center justify-center ${c.iconBg}`}>
            <Icon className="w-3.5 h-3.5" />
          </div>
          <span className={`text-lg font-bold ${c.text}`}>{count}</span>
        </div>
        <div className="text-[10px] font-semibold text-gray-500 dark:text-slate-400 uppercase tracking-wide">{label}</div>
        <div className="text-xs font-medium text-gray-600 dark:text-slate-300 mt-1">
          {formatCents(total_cents || 0)}
        </div>
      </button>
    );
  }

  return (
    <div className="space-y-5">
      {error && <Alert type="error" message={error} onClose={() => setError(null)} />}
      {toast && (
        <Alert
          type={toast.type}
          message={toast.message}
          onClose={() => setToast(null)}
        />
      )}

      {/* Pre-Invoice Pipeline */}
      <div className="rounded-xl border border-gray-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4">
        <div className="text-xs font-semibold text-gray-500 dark:text-slate-400 uppercase tracking-wide mb-3">Pre-Invoice Pipeline</div>
        <div className="flex gap-3 flex-wrap">
          <PipelineCard label="Uncompleted Loads" count={counts.uncompleted_loads?.count || 0} total_cents={counts.uncompleted_loads?.total_cents || 0} icon={Truck} color="gray" filterKey="uncompleted_loads" active={activeFilter === 'uncompleted_loads'} />
          <PipelineCard label="Completed Loads" count={counts.completed_loads?.count || 0} total_cents={counts.completed_loads?.total_cents || 0} icon={CheckCircle2} color="gray" filterKey="completed_loads" active={activeFilter === 'completed_loads'} />
          <PipelineCard label="Rate Con Sent" count={counts.rate_con_sent?.count || 0} total_cents={counts.rate_con_sent?.total_cents || 0} icon={FileText} color="cyan" filterKey="rate_con_sent" active={activeFilter === 'rate_con_sent'} />
          <PipelineCard label="Unapproved" count={counts.unapproved?.count || 0} total_cents={counts.unapproved?.total_cents || 0} icon={AlertCircle} color="amber" filterKey="unapproved" active={activeFilter === 'unapproved'} />
          <PipelineCard label="Approved" count={counts.approved?.count || 0} total_cents={counts.approved?.total_cents || 0} icon={Check} color="blue" filterKey="approved" active={activeFilter === 'approved'} />
        </div>
      </div>

      {/* Invoice Pipeline */}
      <div className="rounded-xl border border-gray-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4">
        <div className="text-xs font-semibold text-gray-500 dark:text-slate-400 uppercase tracking-wide mb-3">Invoice Pipeline</div>
        <div className="flex gap-3 flex-wrap">
          <PipelineCard label="Invoiced" count={counts.invoiced?.count || 0} total_cents={counts.invoiced?.total_cents || 0} icon={DollarSign} color="emerald" filterKey="invoiced" active={activeFilter === 'invoiced'} />
          <PipelineCard label="Rebilling" count={counts.rebilling?.count || 0} total_cents={counts.rebilling?.total_cents || 0} icon={RefreshCw} color="purple" filterKey="rebilling" active={activeFilter === 'rebilling'} />
        </div>
      </div>

      {/* Search */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 dark:text-slate-500" />
          <input type="text" placeholder="Search by load #, customer, charge set..." value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') fetchAR(); }}
            className="block w-full rounded-lg border border-gray-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-gray-900 dark:text-slate-100 placeholder-gray-400 dark:placeholder-slate-500 pl-9 pr-3 py-2 text-sm focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 dark:focus:ring-blue-900/40" />
        </div>
        {activeFilter && (
          <button type="button" onClick={() => setActiveFilter(null)}
            className="text-xs text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 font-medium">
            Clear Filter
          </button>
        )}
        <div className="ml-auto text-sm font-semibold text-gray-700 dark:text-slate-200">
          Total: {formatCents(counts.total_cents || 0)}
        </div>
      </div>

      {/* Charge Sets Table */}
      <div className="rounded-xl border border-gray-200 dark:border-slate-800 bg-white dark:bg-slate-900">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 dark:border-slate-800 bg-gray-50/60 dark:bg-slate-800/40">
                <th className="px-3 py-2 w-10">
                  <input
                    type="checkbox"
                    checked={allSelected}
                    ref={(el) => { if (el) el.indeterminate = someSelected; }}
                    onChange={toggleAll}
                    disabled={bulkAction != null}
                    aria-label="Select all visible charge sets"
                    className="rounded border-gray-300 dark:border-slate-600 text-blue-600 focus:ring-blue-500 cursor-pointer"
                  />
                </th>
                <th className="text-left px-4 py-2.5 font-semibold text-gray-600 dark:text-slate-300 text-xs uppercase tracking-wide">Load #</th>
                <th className="text-left px-4 py-2.5 font-semibold text-gray-600 dark:text-slate-300 text-xs uppercase tracking-wide">Customer</th>
                <th className="text-left px-4 py-2.5 font-semibold text-gray-600 dark:text-slate-300 text-xs uppercase tracking-wide">Charge Set</th>
                <th className="text-left px-4 py-2.5 font-semibold text-gray-600 dark:text-slate-300 text-xs uppercase tracking-wide">Invoice #</th>
                <th className="text-left px-4 py-2.5 font-semibold text-gray-600 dark:text-slate-300 text-xs uppercase tracking-wide">Status</th>
                <th className="text-center px-4 py-2.5 font-semibold text-gray-600 dark:text-slate-300 text-xs uppercase tracking-wide">Items</th>
                <th className="text-right px-4 py-2.5 font-semibold text-gray-600 dark:text-slate-300 text-xs uppercase tracking-wide">Total</th>
                <th className="text-left px-4 py-2.5 font-semibold text-gray-600 dark:text-slate-300 text-xs uppercase tracking-wide">Created</th>
                <th className="w-10"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50 dark:divide-slate-800">
              {loading ? (
                <tr><td colSpan={10} className="px-4 py-10 text-center text-gray-400 dark:text-slate-500">Loading...</td></tr>
              ) : chargeSets.length === 0 ? (
                <tr><td colSpan={10} className="px-4 py-10 text-center text-gray-400 dark:text-slate-500">
                  {activeFilter ? 'No charge sets match this filter.' : 'No charge sets found.'}
                </td></tr>
              ) : (
                chargeSets.map((cs) => {
                  const badge = STATUS_BADGES[cs.status] || STATUS_BADGES.draft;
                  return (
                    <tr key={cs.id}
                      className={`cursor-pointer ${
                        selectedIds.has(cs.id)
                          ? 'bg-blue-50 dark:bg-blue-950/40'
                          : 'hover:bg-gray-50 dark:hover:bg-slate-800/40'
                      }`}
                      onClick={() =>
                        openOverlay('load', {
                          loadId: cs.order_id,
                          tab: 'billing',
                          // Refetch the pipeline silently when the user closes
                          // the overlay so card positions update live without
                          // a visible loading flash.
                          onClose: () => fetchAR({ silent: true }),
                        })
                      }>
                      <td className="px-3 py-2.5 w-10" onClick={(e) => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          checked={selectedIds.has(cs.id)}
                          onChange={(e) => toggleRow(cs.id, e)}
                          onClick={(e) => e.stopPropagation()}
                          disabled={bulkAction != null}
                          aria-label={`Select charge set ${cs.charge_set_number || ''}`}
                          className="rounded border-gray-300 dark:border-slate-600 text-blue-600 focus:ring-blue-500 cursor-pointer"
                        />
                      </td>
                      <td className="px-4 py-2.5">
                        <span className="text-sm font-medium text-blue-600 dark:text-blue-400 hover:underline">
                          {cs.order?.order_number || '—'}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-xs text-gray-700 dark:text-slate-300">{cs.order?.customer?.name || '—'}</td>
                      <td className="px-4 py-2.5">
                        <span className="font-mono text-xs text-blue-600 dark:text-blue-400">{cs.charge_set_number}</span>
                      </td>
                      <td className="px-4 py-2.5">
                        {cs.invoice_number_base ? (
                          <div className="flex items-center gap-1.5">
                            <span className="font-mono text-xs font-semibold text-emerald-700 dark:text-emerald-300">
                              {formatInvoiceNumber(cs.invoice_number_base, cs.rebill_count)}
                            </span>
                            {cs.rebill_count > 0 && (
                              <span className="text-[9px] uppercase tracking-wide font-bold px-1 py-0.5 rounded bg-purple-100 text-purple-700 dark:bg-purple-950/40 dark:text-purple-300">
                                R{cs.rebill_count}
                              </span>
                            )}
                          </div>
                        ) : (
                          <span className="text-xs text-gray-300 dark:text-slate-600">—</span>
                        )}
                      </td>
                      <td className="px-4 py-2.5">
                        <span className={`text-[10px] uppercase tracking-wide font-semibold px-2 py-0.5 rounded-full ${badge.cls}`}>
                          {badge.label}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-center text-xs text-gray-600 dark:text-slate-300">{(cs.line_items || []).length}</td>
                      <td className="px-4 py-2.5 text-right font-semibold text-gray-900 dark:text-slate-100">{formatCents(cs.total_cents)}</td>
                      <td className="px-4 py-2.5 text-xs text-gray-500 dark:text-slate-400">
                        {cs.created_at ? new Date(cs.created_at).toLocaleDateString() : '—'}
                      </td>
                      <td className="px-2 py-2.5">
                        <ExternalLink className="w-3.5 h-3.5 text-gray-300 dark:text-slate-600" />
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      <BulkActionBar
        count={selectedIds.size}
        totalCents={selectedTotalCents}
        bulkAction={bulkAction}
        onApprove={handleBulkApprove}
        onUnapprove={handleBulkUnapprove}
        onApproveAndInvoice={handleBulkApproveAndInvoice}
        onSendRateCons={handleBulkSendRateCons}
        onExport={handleExportCsv}
        onClear={() => {
          setSelectedIds(new Set());
          setLastClickedId(null);
        }}
      />

      {groupingModalInvoices && (
        <BulkGroupingModal
          invoices={groupingModalInvoices}
          onCancel={() => setGroupingModalInvoices(null)}
          onContinue={({ kind, groups }) => {
            setGroupingModalInvoices(null);
            setQueueState({ kind, groups });
          }}
        />
      )}

      {queueState && (
        <BulkEmailQueue
          groups={queueState.groups}
          groupingKind={queueState.kind}
          onClose={() => {
            setQueueState(null);
            fetchAR({ silent: true });
          }}
          onAllSent={() => {
            setQueueState(null);
            fetchAR({ silent: true });
          }}
        />
      )}

      {groupingModalRateCons && (
        <BulkGroupingModal
          items={groupingModalRateCons}
          docType="rate_con"
          onCancel={() => setGroupingModalRateCons(null)}
          onContinue={({ kind, groups }) => {
            setGroupingModalRateCons(null);
            setRateConQueueState({ kind, groups });
          }}
        />
      )}

      {rateConQueueState && (
        <BulkEmailQueue
          groups={rateConQueueState.groups}
          groupingKind={rateConQueueState.kind}
          docType="rate_con"
          onClose={() => {
            setRateConQueueState(null);
            fetchAR({ silent: true });
          }}
          onAllSent={() => {
            setRateConQueueState(null);
            fetchAR({ silent: true });
          }}
        />
      )}
    </div>
  );
}
