import React, { useEffect, useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import Alert from '../ui/Alert';
import StatsCards from '../ui/StatsCards';
import { formatCents } from '../../lib/ar-utils';

export default function AgingTab({ filters = {} }) {
  const [data, setData] = useState({ customers: [], totals: {} });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [expanded, setExpanded] = useState(new Set());

  async function load() {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (filters.customer_ids?.length)         params.set('customer_ids', filters.customer_ids.join(','));
      if (filters.customer_ids_exclude?.length) params.set('customer_ids_exclude', filters.customer_ids_exclude.join(','));
      if (filters.invoiced_from) params.set('invoiced_from', filters.invoiced_from);
      if (filters.invoiced_to)   params.set('invoiced_to',   filters.invoiced_to);

      const qs = params.toString();
      const res = await fetch(`/api/tenant/ar/aging${qs ? `?${qs}` : ''}`);
      if (!res.ok) throw new Error('Failed to load aging data');
      const d = await res.json();
      setData(d);
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }

  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [filters]);

  function toggleExpand(customerId) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(customerId)) next.delete(customerId);
      else next.add(customerId);
      return next;
    });
  }

  const totals = data.totals || {};

  return (
    <div className="space-y-5">
      {error && <Alert type="error" message={error} onClose={() => setError(null)} />}

      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        {[
          { label: 'Total Outstanding', value: totals.total, color: 'text-gray-900 dark:text-slate-100' },
          { label: 'Current (0-30)', value: totals.current, color: 'text-emerald-600 dark:text-emerald-400' },
          { label: '31-60 Days', value: totals['1_30'], color: 'text-amber-600 dark:text-amber-400' },
          { label: '61-90 Days', value: totals['31_60'], color: 'text-orange-600 dark:text-orange-400' },
          { label: '90+ Days', value: totals['90_plus'], color: 'text-red-600 dark:text-red-400' },
        ].map((s) => (
          <div key={s.label} className="rounded-xl border border-gray-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-3">
            <div className="text-[10px] font-semibold text-gray-500 dark:text-slate-400 uppercase tracking-wide">{s.label}</div>
            <div className={`text-lg font-bold mt-0.5 ${s.color}`}>{formatCents(s.value || 0)}</div>
          </div>
        ))}
      </div>

      {/* Aging table by customer */}
      <div className="rounded-xl border border-gray-200 dark:border-slate-800 bg-white dark:bg-slate-900">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 dark:border-slate-800 bg-gray-50/60 dark:bg-slate-800/40">
                <th className="text-left px-4 py-2.5 font-semibold text-gray-600 dark:text-slate-300 text-xs uppercase tracking-wide w-8"></th>
                <th className="text-left px-4 py-2.5 font-semibold text-gray-600 dark:text-slate-300 text-xs uppercase tracking-wide">Customer</th>
                <th className="text-right px-4 py-2.5 font-semibold text-gray-600 dark:text-slate-300 text-xs uppercase tracking-wide">Current</th>
                <th className="text-right px-4 py-2.5 font-semibold text-gray-600 dark:text-slate-300 text-xs uppercase tracking-wide">1-30</th>
                <th className="text-right px-4 py-2.5 font-semibold text-gray-600 dark:text-slate-300 text-xs uppercase tracking-wide">31-60</th>
                <th className="text-right px-4 py-2.5 font-semibold text-gray-600 dark:text-slate-300 text-xs uppercase tracking-wide">61-90</th>
                <th className="text-right px-4 py-2.5 font-semibold text-gray-600 dark:text-slate-300 text-xs uppercase tracking-wide">90+</th>
                <th className="text-right px-4 py-2.5 font-semibold text-gray-600 dark:text-slate-300 text-xs uppercase tracking-wide">Total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50 dark:divide-slate-800">
              {loading ? (
                <tr><td colSpan={8} className="px-4 py-10 text-center text-gray-400 dark:text-slate-500">Loading...</td></tr>
              ) : (data.customers || []).length === 0 ? (
                <tr><td colSpan={8} className="px-4 py-10 text-center text-gray-400 dark:text-slate-500">No outstanding invoices.</td></tr>
              ) : (
                (data.customers || []).map((cust) => {
                  const isExpanded = expanded.has(cust.customer_id);
                  return (
                    <React.Fragment key={cust.customer_id}>
                      <tr
                        className="hover:bg-gray-50 dark:hover:bg-slate-800/40 cursor-pointer"
                        onClick={() => toggleExpand(cust.customer_id)}
                      >
                        <td className="px-4 py-2.5">
                          {isExpanded
                            ? <ChevronDown className="w-4 h-4 text-gray-400 dark:text-slate-500" />
                            : <ChevronRight className="w-4 h-4 text-gray-400 dark:text-slate-500" />}
                        </td>
                        <td className="px-4 py-2.5 font-semibold text-gray-900 dark:text-slate-100">{cust.customer_name}</td>
                        <td className="px-4 py-2.5 text-right text-gray-700 dark:text-slate-300">{cust.current ? formatCents(cust.current) : '—'}</td>
                        <td className="px-4 py-2.5 text-right text-gray-700 dark:text-slate-300">{cust['1_30'] ? formatCents(cust['1_30']) : '—'}</td>
                        <td className="px-4 py-2.5 text-right text-amber-600 dark:text-amber-400">{cust['31_60'] ? formatCents(cust['31_60']) : '—'}</td>
                        <td className="px-4 py-2.5 text-right text-orange-600 dark:text-orange-400">{cust['61_90'] ? formatCents(cust['61_90']) : '—'}</td>
                        <td className="px-4 py-2.5 text-right text-red-600 dark:text-red-400">{cust['90_plus'] ? formatCents(cust['90_plus']) : '—'}</td>
                        <td className="px-4 py-2.5 text-right font-bold text-gray-900 dark:text-slate-100">{formatCents(cust.total)}</td>
                      </tr>
                      {/* Expanded invoice rows */}
                      {isExpanded && (cust.invoices || []).map((inv) => (
                        <tr key={inv.id} className="bg-gray-50/50 dark:bg-slate-800/20">
                          <td className="px-4 py-2"></td>
                          <td className="px-4 py-2 pl-10 text-xs">
                            <span className="font-mono text-blue-600 dark:text-blue-400">{inv.invoice_number}</span>
                            <span className="text-gray-400 dark:text-slate-500 ml-2">Due: {new Date(inv.due_date).toLocaleDateString()}</span>
                            {inv.days_overdue > 0 && (
                              <span className="text-red-500 dark:text-red-400 ml-2">{inv.days_overdue}d overdue</span>
                            )}
                          </td>
                          <td colSpan={5}></td>
                          <td className="px-4 py-2 text-right text-xs font-semibold text-gray-700 dark:text-slate-300">
                            {formatCents(inv.balance_due_cents)}
                          </td>
                        </tr>
                      ))}
                    </React.Fragment>
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
