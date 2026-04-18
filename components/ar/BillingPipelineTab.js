import { useEffect, useState } from 'react';
import {
  Search, FileText, Check, DollarSign, Clock, AlertCircle,
  RefreshCw, ExternalLink, Truck, CheckCircle2,
} from 'lucide-react';
import Alert from '../ui/Alert';
import { useOverlay } from '../../contexts/OverlayContext';
import { formatInvoiceNumber } from '../../lib/invoice-utils';

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

export default function BillingPipelineTab() {
  const { openOverlay } = useOverlay();
  const [chargeSets, setChargeSets] = useState([]);
  const [counts, setCounts] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState('');
  const [activeFilter, setActiveFilter] = useState(null);
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [lastClickedId, setLastClickedId] = useState(null);

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
      const res = await fetch(`/api/tenant/ar?${params}`);
      if (!res.ok) throw new Error('Failed to load');
      const data = await res.json();
      setChargeSets(data.charge_sets || []);
      setCounts(data.counts || {});
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }

  useEffect(() => { fetchAR(); }, [activeFilter]);

  // Selection is meaningful only within the currently displayed list.
  // When the filter or search changes, the list changes, so clear selection.
  useEffect(() => {
    setSelectedIds(new Set());
    setLastClickedId(null);
  }, [activeFilter, search]);

  const visibleIds = chargeSets.map((cs) => cs.id);
  const allSelected = visibleIds.length > 0 && visibleIds.every((id) => selectedIds.has(id));
  const someSelected = visibleIds.some((id) => selectedIds.has(id)) && !allSelected;

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
    </div>
  );
}
