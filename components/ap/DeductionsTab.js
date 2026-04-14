import { useEffect, useState } from 'react';
import { AlertCircle, Check, CheckCircle2, Lock } from 'lucide-react';
import Alert from '../ui/Alert';
import Badge from '../ui/Badge';

function formatCents(c) {
  if (c == null) return '$0.00';
  return `$${(c / 100).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`;
}

export default function DeductionsTab() {
  const [deductions, setDeductions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [activeFilter, setActiveFilter] = useState(null);

  async function load() {
    setLoading(true);
    try {
      // Fetch settlement deductions across all settlements
      const res = await fetch('/api/tenant/ap/driver-deductions');
      if (!res.ok) throw new Error('Failed to load');
      const data = await res.json();
      setDeductions(data.driver_deductions || []);
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }

  useEffect(() => { load(); }, []);

  const STATUS_BADGES = {
    unapproved: { label: 'Unapproved', variant: 'amber' },
    approved: { label: 'Approved', variant: 'blue' },
    reviewed: { label: 'Reviewed', variant: 'purple' },
    finalized: { label: 'Finalized', variant: 'green' },
  };

  // Pipeline counts from driver deductions (enabled/disabled)
  const enabledCount = deductions.filter((d) => d.is_enabled).length;
  const disabledCount = deductions.filter((d) => !d.is_enabled).length;
  const totalCents = deductions.filter((d) => d.is_enabled).reduce((s, d) => s + (d.amount_cents || 0), 0);

  return (
    <div className="space-y-5">
      {error && <Alert type="error" message={error} onClose={() => setError(null)} />}

      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-xl border border-gray-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-3">
          <div className="text-[10px] font-semibold text-gray-500 dark:text-slate-400 uppercase tracking-wide">Active Deductions</div>
          <div className="text-xl font-bold text-emerald-600 dark:text-emerald-400 mt-0.5">{enabledCount}</div>
        </div>
        <div className="rounded-xl border border-gray-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-3">
          <div className="text-[10px] font-semibold text-gray-500 dark:text-slate-400 uppercase tracking-wide">Disabled</div>
          <div className="text-xl font-bold text-gray-600 dark:text-slate-400 mt-0.5">{disabledCount}</div>
        </div>
        <div className="rounded-xl border border-gray-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-3">
          <div className="text-[10px] font-semibold text-gray-500 dark:text-slate-400 uppercase tracking-wide">Total Per Period</div>
          <div className="text-xl font-bold text-red-600 dark:text-red-400 mt-0.5">{formatCents(totalCents)}</div>
        </div>
      </div>

      {/* Table */}
      <div className="rounded-xl border border-gray-200 dark:border-slate-800 bg-white dark:bg-slate-900">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 dark:border-slate-800 bg-gray-50/60 dark:bg-slate-800/40">
                {['Driver', 'Type', 'Description', 'UOM', 'Math', 'Amount', 'Recurring', 'Status'].map((h) => (
                  <th key={h} className="text-left px-4 py-2.5 font-semibold text-gray-600 dark:text-slate-300 text-xs uppercase tracking-wide">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50 dark:divide-slate-800">
              {loading ? (
                <tr><td colSpan={8} className="px-4 py-10 text-center text-gray-400 dark:text-slate-500">Loading...</td></tr>
              ) : deductions.length === 0 ? (
                <tr><td colSpan={8} className="px-4 py-10 text-center text-gray-400 dark:text-slate-500">No deductions configured. Set up driver deductions in Settlement Settings.</td></tr>
              ) : (
                deductions.map((d) => (
                  <tr key={d.id} className={`hover:bg-gray-50 dark:hover:bg-slate-800/40 ${!d.is_enabled ? 'opacity-50' : ''}`}>
                    <td className="px-4 py-2.5 text-xs font-medium text-gray-900 dark:text-slate-100">{d.driver?.name || '—'}</td>
                    <td className="px-4 py-2.5 text-xs text-gray-700 dark:text-slate-300">{d.deduction_type?.name || '—'}</td>
                    <td className="px-4 py-2.5 text-xs text-gray-500 dark:text-slate-400">{d.description || '—'}</td>
                    <td className="px-4 py-2.5 text-xs text-gray-500 dark:text-slate-400 capitalize">{(d.unit_of_measure || 'fixed').replace('_', ' ')}</td>
                    <td className="px-4 py-2.5 text-xs">
                      <span className={d.math === 'subtract' ? 'text-red-600 dark:text-red-400' : 'text-emerald-600 dark:text-emerald-400'}>
                        {d.math === 'subtract' ? '−' : '+'}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 font-semibold text-gray-900 dark:text-slate-100">{formatCents(d.amount_cents)}</td>
                    <td className="px-4 py-2.5">
                      <Badge variant={d.is_recurring ? 'blue' : 'gray'}>{d.is_recurring ? 'Yes' : 'No'}</Badge>
                    </td>
                    <td className="px-4 py-2.5">
                      <Badge variant={d.is_enabled ? 'green' : 'gray'}>{d.is_enabled ? 'Enabled' : 'Disabled'}</Badge>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
