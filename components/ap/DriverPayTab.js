import { useEffect, useState } from 'react';
import { Search, Plus, FileText, AlertCircle, Check, CheckCircle2, Lock, ChevronLeft, ChevronRight, Calendar } from 'lucide-react';
import Alert from '../ui/Alert';
import Badge from '../ui/Badge';
import Select from '../ui/Select';
import DatePicker from '../ui/DatePicker';
import { useOverlay } from '../../contexts/OverlayContext';

// Helpers for date range presets
function getWeekRange(offset = 0) {
  const now = new Date();
  const day = now.getDay();
  const start = new Date(now);
  start.setDate(now.getDate() - day + (offset * 7));
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  return { from: fmt(start), to: fmt(end), label: offset === 0 ? 'This Week' : offset === -1 ? 'Last Week' : `${fmt(start)} – ${fmt(end)}` };
}

function getMonthRange(offset = 0) {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth() + offset, 1);
  const end = new Date(now.getFullYear(), now.getMonth() + offset + 1, 0);
  const monthName = start.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  return { from: fmt(start), to: fmt(end), label: offset === 0 ? 'This Month' : offset === -1 ? 'Last Month' : monthName };
}

function fmt(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function formatDateShort(d) {
  if (!d) return '';
  return new Date(d + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function formatCents(c) {
  if (c == null) return '$0.00';
  return `$${(c / 100).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`;
}

const STATUS_BADGES = {
  drafted: { label: 'Drafted', variant: 'gray' },
  unapproved: { label: 'Unapproved', variant: 'amber' },
  approved: { label: 'Approved', variant: 'blue' },
  reviewed: { label: 'Reviewed', variant: 'purple' },
  finalized: { label: 'Finalized', variant: 'green' },
};

export default function DriverPayTab() {
  const { openOverlay } = useOverlay();
  const [lines, setLines] = useState([]);
  const [stats, setStats] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [activeFilter, setActiveFilter] = useState(null);

  // Date range state
  const initWeek = getWeekRange(0);
  const [rangeMode, setRangeMode] = useState('week'); // week | month | custom
  const [rangeOffset, setRangeOffset] = useState(0);
  const [dateFrom, setDateFrom] = useState(initWeek.from);
  const [dateTo, setDateTo] = useState(initWeek.to);
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');

  // Recompute date range when mode/offset changes
  useEffect(() => {
    if (rangeMode === 'week') {
      const r = getWeekRange(rangeOffset);
      setDateFrom(r.from);
      setDateTo(r.to);
    } else if (rangeMode === 'month') {
      const r = getMonthRange(rangeOffset);
      setDateFrom(r.from);
      setDateTo(r.to);
    }
    // custom mode uses customFrom/customTo directly
  }, [rangeMode, rangeOffset]);

  function applyCustomRange() {
    if (customFrom && customTo) {
      setDateFrom(customFrom);
      setDateTo(customTo);
    }
  }

  function getRangeLabel() {
    if (rangeMode === 'week') return getWeekRange(rangeOffset).label;
    if (rangeMode === 'month') return getMonthRange(rangeOffset).label;
    return 'Custom';
  }

  async function load() {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (activeFilter) params.set('status', activeFilter);
      if (dateFrom) params.set('from', dateFrom);
      if (dateTo) params.set('to', dateTo + 'T23:59:59');
      const res = await fetch(`/api/tenant/ap/driver-pay?${params}`);
      if (!res.ok) throw new Error('Failed to load');
      const data = await res.json();
      setLines(data.pay_lines || []);
      setStats(data.stats || {});
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }

  useEffect(() => { load(); }, [activeFilter, dateFrom, dateTo]);

  function PipelineCard({ label, status, icon: Icon, color }) {
    const s = stats[status] || { count: 0, cents: 0 };
    const active = activeFilter === status;
    const colors = {
      gray: { bg: 'bg-gray-50 dark:bg-slate-800/50', border: 'border-gray-200 dark:border-slate-700', text: 'text-gray-700 dark:text-slate-200' },
      amber: { bg: 'bg-amber-50 dark:bg-amber-950/30', border: 'border-amber-200 dark:border-amber-900/60', text: 'text-amber-700 dark:text-amber-300' },
      blue: { bg: 'bg-blue-50 dark:bg-blue-950/30', border: 'border-blue-200 dark:border-blue-900/60', text: 'text-blue-700 dark:text-blue-300' },
      purple: { bg: 'bg-purple-50 dark:bg-purple-950/30', border: 'border-purple-200 dark:border-purple-900/60', text: 'text-purple-700 dark:text-purple-300' },
      emerald: { bg: 'bg-emerald-50 dark:bg-emerald-950/30', border: 'border-emerald-200 dark:border-emerald-900/60', text: 'text-emerald-700 dark:text-emerald-300' },
    };
    const c = colors[color] || colors.gray;
    return (
      <button type="button" onClick={() => setActiveFilter(active ? null : status)}
        className={`rounded-xl border p-3 text-left transition-all flex-1 min-w-[130px] ${active ? c.bg + ' ' + c.border + ' ring-2 ring-offset-1 ring-blue-400' : c.bg + ' ' + c.border + ' hover:shadow-sm'}`}>
        <div className="flex items-center gap-2 mb-0.5">
          <span className={`text-xs font-semibold ${c.text}`}>{s.count}</span>
          <span className={`text-[10px] uppercase tracking-wide font-semibold text-gray-500 dark:text-slate-400`}>{label}</span>
        </div>
        <div className={`text-lg font-bold ${c.text}`}>{formatCents(s.cents)}</div>
      </button>
    );
  }

  return (
    <div className="space-y-5">
      {error && <Alert type="error" message={error} onClose={() => setError(null)} />}

      {/* Date Range Picker */}
      <div className="flex items-center gap-3 flex-wrap">
        {/* Range mode selector */}
        <div className="flex gap-1 bg-gray-100 dark:bg-slate-800 rounded-lg p-0.5">
          {[
            { id: 'week', label: 'Weekly' },
            { id: 'month', label: 'Monthly' },
            { id: 'custom', label: 'Custom' },
          ].map((m) => (
            <button key={m.id} type="button"
              onClick={() => { setRangeMode(m.id); setRangeOffset(0); }}
              className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors ${
                rangeMode === m.id
                  ? 'bg-white dark:bg-slate-900 text-gray-900 dark:text-slate-100 shadow-sm'
                  : 'text-gray-500 dark:text-slate-400 hover:text-gray-700 dark:hover:text-slate-200'
              }`}>
              {m.label}
            </button>
          ))}
        </div>

        {/* Nav arrows + label (week/month modes) */}
        {rangeMode !== 'custom' && (
          <div className="flex items-center gap-1.5">
            <button type="button" onClick={() => setRangeOffset((o) => o - 1)}
              className="p-1.5 rounded-lg text-gray-400 dark:text-slate-500 hover:text-gray-600 dark:hover:text-slate-300 hover:bg-gray-100 dark:hover:bg-slate-800">
              <ChevronLeft className="w-4 h-4" />
            </button>
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-900 min-w-[180px] justify-center">
              <Calendar className="w-3.5 h-3.5 text-gray-400 dark:text-slate-500" />
              <span className="text-sm font-medium text-gray-900 dark:text-slate-100">
                {formatDateShort(dateFrom)} – {formatDateShort(dateTo)}
              </span>
            </div>
            <button type="button" onClick={() => setRangeOffset((o) => o + 1)}
              className="p-1.5 rounded-lg text-gray-400 dark:text-slate-500 hover:text-gray-600 dark:hover:text-slate-300 hover:bg-gray-100 dark:hover:bg-slate-800">
              <ChevronRight className="w-4 h-4" />
            </button>
            {rangeOffset !== 0 && (
              <button type="button" onClick={() => setRangeOffset(0)}
                className="text-[10px] text-blue-600 dark:text-blue-400 hover:underline font-semibold">
                Today
              </button>
            )}
          </div>
        )}

        {/* Custom date inputs */}
        {rangeMode === 'custom' && (
          <div className="flex items-center gap-2">
            <div className="w-44">
              <DatePicker
                value={customFrom}
                onChange={(v) => setCustomFrom(v)}
                placeholder="Start date"
              />
            </div>
            <span className="text-xs text-gray-400 dark:text-slate-500">to</span>
            <div className="w-44">
              <DatePicker
                value={customTo}
                onChange={(v) => setCustomTo(v)}
                placeholder="End date"
              />
            </div>
            <button type="button" onClick={applyCustomRange}
              className="px-3 py-2 rounded-lg bg-blue-600 text-white text-xs font-semibold hover:bg-blue-700 transition-colors">
              Apply
            </button>
          </div>
        )}

        {/* Current range label */}
        <div className="ml-auto text-xs text-gray-500 dark:text-slate-400">
          Driver Pay Date Range: <span className="font-semibold text-gray-700 dark:text-slate-200">{getRangeLabel()}</span>
        </div>
      </div>

      {/* Pipeline */}
      <div className="flex gap-3 flex-wrap">
        <PipelineCard label="Drafted" status="drafted" icon={FileText} color="gray" />
        <PipelineCard label="Unapproved" status="unapproved" icon={AlertCircle} color="amber" />
        <PipelineCard label="Approved" status="approved" icon={Check} color="blue" />
        <PipelineCard label="Reviewed" status="reviewed" icon={CheckCircle2} color="purple" />
        <PipelineCard label="Finalized" status="finalized" icon={Lock} color="emerald" />
      </div>

      {activeFilter && (
        <button onClick={() => setActiveFilter(null)} className="text-xs text-blue-600 dark:text-blue-400 hover:underline">
          Clear filter
        </button>
      )}

      {/* Table */}
      <div className="rounded-xl border border-gray-200 dark:border-slate-800 bg-white dark:bg-slate-900">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 dark:border-slate-800 bg-gray-50/60 dark:bg-slate-800/40">
                {['Load #', 'Container #', 'Driver', 'Load Status', 'Type', 'From', 'To', 'Amount', 'Date', 'Status'].map((h) => (
                  <th key={h} className="text-left px-4 py-2.5 font-semibold text-gray-600 dark:text-slate-300 text-xs uppercase tracking-wide">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50 dark:divide-slate-800">
              {loading ? (
                <tr><td colSpan={10} className="px-4 py-10 text-center text-gray-400 dark:text-slate-500">Loading...</td></tr>
              ) : lines.length === 0 ? (
                <tr><td colSpan={10} className="px-4 py-10 text-center text-gray-400 dark:text-slate-500">No driver pay lines in this date range.</td></tr>
              ) : (
                lines.map((line) => {
                  const badge = STATUS_BADGES[line.status] || STATUS_BADGES.drafted;
                  return (
                    <tr key={line.id} className="hover:bg-gray-50 dark:hover:bg-slate-800/40 cursor-pointer"
                      onClick={() => openOverlay('load', { loadId: line.order_id, tab: 'driver_pay' })}>
                      <td className="px-4 py-2.5">
                        <span className="font-mono text-xs text-blue-600 dark:text-blue-400">{line.order?.order_number || '—'}</span>
                      </td>
                      <td className="px-4 py-2.5 font-mono text-xs text-gray-700 dark:text-slate-300">
                        {line.order?.container_number || '—'}
                      </td>
                      <td className="px-4 py-2.5 text-xs text-gray-700 dark:text-slate-300">
                        {line.driver?.name || '—'}
                      </td>
                      <td className="px-4 py-2.5">
                        <Badge variant={line.order?.status === 'completed' ? 'green' : line.order?.status === 'dispatched' ? 'blue' : 'gray'}>
                          {line.order?.status || '—'}
                        </Badge>
                      </td>
                      <td className="px-4 py-2.5 text-xs text-gray-500 dark:text-slate-400 capitalize">{(line.line_type || '').replace('_', ' ')}</td>
                      <td className="px-4 py-2.5 text-xs text-gray-500 dark:text-slate-400">{line.from_location || '—'}</td>
                      <td className="px-4 py-2.5 text-xs text-gray-500 dark:text-slate-400">{line.to_location || '—'}</td>
                      <td className="px-4 py-2.5 font-semibold text-gray-900 dark:text-slate-100">{formatCents(line.amount_cents)}</td>
                      <td className="px-4 py-2.5 text-xs text-gray-500 dark:text-slate-400">
                        {line.worked_at ? new Date(line.worked_at).toLocaleDateString() : '—'}
                      </td>
                      <td className="px-4 py-2.5"><Badge variant={badge.variant}>{badge.label}</Badge></td>
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
