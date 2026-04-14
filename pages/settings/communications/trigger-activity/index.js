import { useEffect, useMemo, useState } from 'react';
import {
  Activity,
  Search,
  Filter,
  ChevronRight,
  ChevronDown,
  CheckCircle2,
  XCircle,
  Clock,
  AlertTriangle,
  SkipForward,
  Mail,
  Umbrella as UmbrellaIcon,
  Zap,
} from 'lucide-react';
import SettingsLayout from '../../../../components/settings/SettingsLayout';
import Alert from '../../../../components/ui/Alert';

/**
 * Settings → Communications → Trigger Activity
 *
 * Read-only timeline of every `email_trigger_log` row for the tenant.
 * Dispatchers use this to debug why a trigger did/didn't fire — the
 * row expansion shows the full umbrella decision tree + the generated
 * `email_messages` so you can see the rendered subject/body.
 *
 * All surfaces include dark mode variants per the dev_dark_mode_convention.md
 * memory — every gray/white utility has a matching dark:slate-* sibling.
 */

const OUTCOME_CONFIG = {
  fired: {
    label: 'Fired',
    Icon: CheckCircle2,
    className:
      'text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/60 border-emerald-200 dark:border-emerald-900/60',
  },
  skipped: {
    label: 'Skipped',
    Icon: SkipForward,
    className:
      'text-slate-700 dark:text-slate-300 bg-gray-100 dark:bg-slate-800 border-gray-200 dark:border-slate-700',
  },
  deduped: {
    label: 'Deduped',
    Icon: Clock,
    className:
      'text-blue-700 dark:text-blue-300 bg-blue-50 dark:bg-blue-950/60 border-blue-200 dark:border-blue-900/60',
  },
  errored: {
    label: 'Errored',
    Icon: XCircle,
    className:
      'text-rose-700 dark:text-rose-300 bg-rose-50 dark:bg-rose-950/60 border-rose-200 dark:border-rose-900/60',
  },
  disabled: {
    label: 'Disabled',
    Icon: AlertTriangle,
    className:
      'text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/60 border-amber-200 dark:border-amber-900/60',
  },
};

const ALL_OUTCOMES = Object.keys(OUTCOME_CONFIG);

export default function TriggerActivityPage() {
  const [rows, setRows] = useState([]);
  const [triggers, setTriggers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [page, setPage] = useState(1);
  const [pageSize] = useState(50);
  const [total, setTotal] = useState(0);
  const [expandedId, setExpandedId] = useState(null);
  const [expansion, setExpansion] = useState(null); // {row, messages}
  const [expansionLoading, setExpansionLoading] = useState(false);

  // Filters
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [outcomeFilter, setOutcomeFilter] = useState(new Set(ALL_OUTCOMES));
  const [triggerIdFilter, setTriggerIdFilter] = useState('');
  const [loadSearch, setLoadSearch] = useState('');

  async function loadTriggers() {
    try {
      const res = await fetch('/api/tenant/emails/triggers');
      if (!res.ok) return;
      const data = await res.json();
      setTriggers(data.triggers || []);
    } catch {
      /* non-fatal — dropdown will stay empty */
    }
  }

  async function loadRows() {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      params.set('page', String(page));
      params.set('page_size', String(pageSize));
      if (dateFrom) params.set('from', dateFrom);
      if (dateTo) {
        // Extend to end of day
        const d = new Date(dateTo);
        d.setHours(23, 59, 59, 999);
        params.set('to', d.toISOString());
      }
      if (outcomeFilter.size > 0 && outcomeFilter.size < ALL_OUTCOMES.length) {
        params.set('outcome', Array.from(outcomeFilter).join(','));
      }
      if (triggerIdFilter) params.set('trigger_id', triggerIdFilter);
      if (loadSearch.trim()) params.set('load_search', loadSearch.trim());

      const res = await fetch(`/api/tenant/emails/trigger-activity?${params}`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || 'Failed to load trigger activity');
      }
      const data = await res.json();
      setRows(data.rows || []);
      setTotal(data.total || 0);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadTriggers();
  }, []);

  useEffect(() => {
    loadRows();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, dateFrom, dateTo, outcomeFilter, triggerIdFilter]);

  async function toggleExpand(row) {
    if (expandedId === row.id) {
      setExpandedId(null);
      setExpansion(null);
      return;
    }
    setExpandedId(row.id);
    setExpansion(null);
    setExpansionLoading(true);
    try {
      const res = await fetch(
        `/api/tenant/emails/trigger-activity?log_id=${row.id}`
      );
      if (!res.ok) throw new Error('Failed to load row details');
      const data = await res.json();
      setExpansion(data);
    } catch (e) {
      setExpansion({ error: e.message });
    } finally {
      setExpansionLoading(false);
    }
  }

  function toggleOutcome(o) {
    setOutcomeFilter((prev) => {
      const next = new Set(prev);
      if (next.has(o)) next.delete(o);
      else next.add(o);
      if (next.size === 0) return new Set(ALL_OUTCOMES); // Don't allow empty
      return next;
    });
    setPage(1);
  }

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <SettingsLayout title="Trigger Activity">
      <div className="max-w-6xl">
        {/* Header */}
        <div className="mb-6 flex items-start gap-3">
          <div className="shrink-0 w-10 h-10 rounded-lg bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-900/60 flex items-center justify-center">
            <Activity className="w-5 h-5 text-blue-600 dark:text-blue-400" />
          </div>
          <div className="flex-1 min-w-0">
            <h1 className="text-2xl font-bold text-gray-900 dark:text-slate-100">
              Trigger Activity
            </h1>
            <p className="text-sm text-gray-500 dark:text-slate-400 mt-1">
              Every time an email trigger fires — or is suppressed, deduped, or errored — a row lands here. Expand any row to see which umbrellas matched and the email messages that got generated.
            </p>
          </div>
        </div>

        {error && <Alert type="error" message={error} className="mb-4" />}

        {/* Filter bar */}
        <div className="mb-4 rounded-xl border border-gray-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-3">
          <div className="flex items-center gap-2 flex-wrap">
            <Filter className="w-4 h-4 text-gray-400 dark:text-slate-500" />
            <span className="text-xs font-semibold text-gray-500 dark:text-slate-400 uppercase tracking-wider">
              Filters
            </span>
          </div>

          <div className="mt-3 grid grid-cols-1 md:grid-cols-[1fr_1fr_1fr] gap-3">
            {/* Date range */}
            <div>
              <label className="block text-[11px] font-semibold text-gray-600 dark:text-slate-300 mb-1">
                From
              </label>
              <input
                type="date"
                value={dateFrom}
                onChange={(e) => {
                  setDateFrom(e.target.value);
                  setPage(1);
                }}
                className="block w-full px-2.5 py-1.5 rounded-lg border border-gray-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm text-gray-900 dark:text-slate-100 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-gray-600 dark:text-slate-300 mb-1">
                To
              </label>
              <input
                type="date"
                value={dateTo}
                onChange={(e) => {
                  setDateTo(e.target.value);
                  setPage(1);
                }}
                className="block w-full px-2.5 py-1.5 rounded-lg border border-gray-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm text-gray-900 dark:text-slate-100 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
              />
            </div>
            {/* Trigger dropdown */}
            <div>
              <label className="block text-[11px] font-semibold text-gray-600 dark:text-slate-300 mb-1">
                Trigger
              </label>
              <select
                value={triggerIdFilter}
                onChange={(e) => {
                  setTriggerIdFilter(e.target.value);
                  setPage(1);
                }}
                className="block w-full px-2.5 py-1.5 rounded-lg border border-gray-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm text-gray-900 dark:text-slate-100 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
              >
                <option value="">All triggers</option>
                {triggers.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name} ({t.trigger_kind})
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="mt-3 grid grid-cols-1 md:grid-cols-[2fr_3fr] gap-3">
            {/* Load search */}
            <div>
              <label className="block text-[11px] font-semibold text-gray-600 dark:text-slate-300 mb-1">
                Load order number
              </label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 dark:text-slate-500" />
                <input
                  type="text"
                  value={loadSearch}
                  onChange={(e) => setLoadSearch(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      setPage(1);
                      loadRows();
                    }
                  }}
                  placeholder="e.g. M01234 (press Enter)"
                  className="block w-full pl-8 pr-3 py-1.5 rounded-lg border border-gray-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm text-gray-900 dark:text-slate-100 placeholder-gray-400 dark:placeholder-slate-500 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                />
              </div>
            </div>
            {/* Outcome filter chips */}
            <div>
              <label className="block text-[11px] font-semibold text-gray-600 dark:text-slate-300 mb-1">
                Outcomes
              </label>
              <div className="flex items-center gap-1.5 flex-wrap">
                {ALL_OUTCOMES.map((o) => {
                  const cfg = OUTCOME_CONFIG[o];
                  const { Icon } = cfg;
                  const active = outcomeFilter.has(o);
                  return (
                    <button
                      key={o}
                      type="button"
                      onClick={() => toggleOutcome(o)}
                      className={`inline-flex items-center gap-1 px-2 py-1 rounded text-[11px] font-semibold border transition-colors ${
                        active
                          ? cfg.className
                          : 'text-gray-400 dark:text-slate-500 bg-white dark:bg-slate-900 border-gray-200 dark:border-slate-800 opacity-60 hover:opacity-100'
                      }`}
                    >
                      <Icon className="w-3 h-3" />
                      {cfg.label}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </div>

        {/* Stats strip */}
        <div className="mb-4 flex items-center gap-6 text-xs text-gray-500 dark:text-slate-400">
          <span>
            <strong className="text-gray-900 dark:text-slate-100">{total}</strong> total{' '}
            {total === 1 ? 'fire' : 'fires'}
          </span>
          <span>
            Page{' '}
            <strong className="text-gray-900 dark:text-slate-100">
              {page} / {totalPages}
            </strong>
          </span>
        </div>

        {/* Table */}
        {loading ? (
          <div className="py-20 text-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto" />
          </div>
        ) : rows.length === 0 ? (
          <div className="py-20 text-center rounded-xl border border-dashed border-gray-300 dark:border-slate-700 bg-gray-50/40 dark:bg-slate-900/40">
            <Activity className="w-10 h-10 mx-auto text-gray-400 dark:text-slate-600 mb-3" />
            <div className="text-sm font-semibold text-gray-900 dark:text-slate-100">
              No trigger fires match your filters
            </div>
            <div className="text-xs text-gray-500 dark:text-slate-400 mt-1">
              Try clearing the filters or widening the date range.
            </div>
          </div>
        ) : (
          <div className="rounded-xl border border-gray-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 dark:bg-slate-900/60 border-b border-gray-200 dark:border-slate-800">
                <tr className="text-[10px] uppercase tracking-wider font-semibold text-gray-500 dark:text-slate-400">
                  <th className="text-left px-3 py-2 w-8"></th>
                  <th className="text-left px-3 py-2">Fired At</th>
                  <th className="text-left px-3 py-2">Load</th>
                  <th className="text-left px-3 py-2">Template</th>
                  <th className="text-left px-3 py-2">Trigger</th>
                  <th className="text-left px-3 py-2">Outcome</th>
                  <th className="text-right px-3 py-2">Msgs</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-slate-800">
                {rows.map((row) => {
                  const isOpen = expandedId === row.id;
                  return (
                    <ActivityRow
                      key={row.id}
                      row={row}
                      isOpen={isOpen}
                      expansion={isOpen ? expansion : null}
                      expansionLoading={isOpen && expansionLoading}
                      onToggle={() => toggleExpand(row)}
                    />
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination */}
        {rows.length > 0 && totalPages > 1 && (
          <div className="mt-4 flex items-center justify-between">
            <button
              type="button"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1}
              className="px-3 py-1.5 rounded-lg text-xs font-medium border border-gray-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-gray-700 dark:text-slate-200 hover:bg-gray-50 dark:hover:bg-slate-800 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              ← Previous
            </button>
            <span className="text-xs text-gray-500 dark:text-slate-400">
              Page {page} of {totalPages}
            </span>
            <button
              type="button"
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages}
              className="px-3 py-1.5 rounded-lg text-xs font-medium border border-gray-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-gray-700 dark:text-slate-200 hover:bg-gray-50 dark:hover:bg-slate-800 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              Next →
            </button>
          </div>
        )}
      </div>
    </SettingsLayout>
  );
}

/* ─────────────────────── Activity Row ─────────────────────── */

function ActivityRow({ row, isOpen, expansion, expansionLoading, onToggle }) {
  const outcomeCfg = OUTCOME_CONFIG[row.outcome] || OUTCOME_CONFIG.skipped;
  const { Icon: OutcomeIcon } = outcomeCfg;

  return (
    <>
      <tr
        className={`cursor-pointer transition-colors ${
          isOpen
            ? 'bg-blue-50/60 dark:bg-blue-950/20'
            : 'hover:bg-gray-50 dark:hover:bg-slate-800/60'
        }`}
        onClick={onToggle}
      >
        <td className="px-3 py-2.5 text-gray-400 dark:text-slate-500">
          {isOpen ? (
            <ChevronDown className="w-4 h-4" />
          ) : (
            <ChevronRight className="w-4 h-4" />
          )}
        </td>
        <td className="px-3 py-2.5 text-xs text-gray-600 dark:text-slate-300 font-mono">
          {formatFiredAt(row.fired_at)}
        </td>
        <td className="px-3 py-2.5 text-sm text-gray-900 dark:text-slate-100">
          {row.load?.order_number || (
            <span className="italic text-gray-400 dark:text-slate-500">
              (no load)
            </span>
          )}
        </td>
        <td className="px-3 py-2.5 text-sm text-gray-700 dark:text-slate-200 truncate max-w-[200px]">
          {row.template?.name || '—'}
        </td>
        <td className="px-3 py-2.5 text-sm">
          <span className="text-gray-900 dark:text-slate-100">
            {row.trigger?.name || '—'}
          </span>
          <span className="ml-1.5 text-[10px] uppercase font-semibold text-gray-400 dark:text-slate-500">
            {row.trigger?.trigger_kind}
          </span>
        </td>
        <td className="px-3 py-2.5">
          <span
            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] uppercase tracking-wider font-semibold border ${outcomeCfg.className}`}
          >
            <OutcomeIcon className="w-2.5 h-2.5" />
            {outcomeCfg.label}
          </span>
        </td>
        <td className="px-3 py-2.5 text-right text-sm tabular-nums text-gray-900 dark:text-slate-100">
          {row.messages_created || 0}
        </td>
      </tr>
      {isOpen && (
        <tr>
          <td
            colSpan={7}
            className="px-4 py-4 bg-gray-50/40 dark:bg-slate-900/40 border-t border-gray-200 dark:border-slate-800"
          >
            <RowExpansion
              row={row}
              expansion={expansion}
              loading={expansionLoading}
            />
          </td>
        </tr>
      )}
    </>
  );
}

function RowExpansion({ row, expansion, loading }) {
  if (loading) {
    return (
      <div className="py-6 text-center">
        <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-blue-600 mx-auto" />
      </div>
    );
  }

  const umbrellaDecisions = row.umbrella_decisions || [];
  const messages = expansion?.messages || [];

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      {/* Left: umbrella decisions */}
      <div>
        <div className="flex items-center gap-2 mb-2">
          <UmbrellaIcon className="w-3.5 h-3.5 text-gray-500 dark:text-slate-400" />
          <h4 className="text-xs font-semibold text-gray-700 dark:text-slate-200 uppercase tracking-wider">
            Umbrella Decisions
          </h4>
        </div>
        {row.outcome_detail && (
          <div className="mb-2 text-xs text-gray-600 dark:text-slate-300 italic">
            {row.outcome_detail}
          </div>
        )}
        {umbrellaDecisions.length === 0 ? (
          <div className="text-xs text-gray-400 dark:text-slate-500 italic">
            No umbrellas evaluated (trigger was disabled, deduped, or errored
            early).
          </div>
        ) : (
          <div className="space-y-2">
            {umbrellaDecisions.map((d, i) => (
              <UmbrellaDecisionCard key={d.umbrella_id || i} decision={d} />
            ))}
          </div>
        )}
      </div>

      {/* Right: generated messages */}
      <div>
        <div className="flex items-center gap-2 mb-2">
          <Mail className="w-3.5 h-3.5 text-gray-500 dark:text-slate-400" />
          <h4 className="text-xs font-semibold text-gray-700 dark:text-slate-200 uppercase tracking-wider">
            Messages ({messages.length})
          </h4>
        </div>
        {messages.length === 0 ? (
          <div className="text-xs text-gray-400 dark:text-slate-500 italic">
            No messages were generated by this fire.
          </div>
        ) : (
          <div className="space-y-2">
            {messages.map((m) => (
              <MessageCard key={m.id} message={m} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function UmbrellaDecisionCard({ decision }) {
  const suppressed = !!decision.suppressed_reason;
  const groups = decision.groups_fired || [];
  const messagesCount = groups.filter((g) => g.message_id).length;

  return (
    <div
      className={`rounded-lg border p-2.5 ${
        suppressed
          ? 'border-amber-200 dark:border-amber-900/60 bg-amber-50/40 dark:bg-amber-950/20'
          : 'border-emerald-200 dark:border-emerald-900/60 bg-emerald-50/40 dark:bg-emerald-950/20'
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold text-gray-900 dark:text-slate-100 truncate">
            {decision.name || decision.umbrella_id}
          </div>
          <div className="text-[10px] text-gray-500 dark:text-slate-400 mt-0.5">
            Specificity {decision.specificity_score ?? 0}
            {decision.always_run && (
              <span className="ml-1.5 inline-flex items-center gap-0.5 text-amber-700 dark:text-amber-300">
                <Zap className="w-2.5 h-2.5" />
                always_run
              </span>
            )}
          </div>
        </div>
        {suppressed ? (
          <span className="text-[9px] uppercase tracking-wider font-semibold text-amber-700 dark:text-amber-300 bg-amber-100 dark:bg-amber-950/60 px-1.5 py-0.5 rounded shrink-0">
            {decision.suppressed_reason}
          </span>
        ) : (
          <span className="text-[9px] uppercase tracking-wider font-semibold text-emerald-700 dark:text-emerald-300 bg-emerald-100 dark:bg-emerald-950/60 px-1.5 py-0.5 rounded shrink-0">
            {messagesCount} sent
          </span>
        )}
      </div>
      {decision.configuration_name && (
        <div className="mt-1 text-[11px] text-gray-500 dark:text-slate-400">
          via {decision.configuration_name}{' '}
          {decision.sender_kind && (
            <span className="text-gray-400 dark:text-slate-500">
              ({decision.sender_kind})
            </span>
          )}
        </div>
      )}
      {decision.error && (
        <div className="mt-1 text-[11px] text-rose-700 dark:text-rose-300 font-mono">
          {decision.error}
        </div>
      )}
      {groups.length > 0 && (
        <div className="mt-2 space-y-1">
          {groups.map((g, gi) => (
            <div
              key={g.group_id || gi}
              className="text-[11px] flex items-center gap-1.5 text-gray-600 dark:text-slate-300"
            >
              <span className="font-semibold">{g.group_name}:</span>
              {g.message_id ? (
                <>
                  <CheckCircle2 className="w-3 h-3 text-emerald-600 dark:text-emerald-400" />
                  <span className="text-gray-500 dark:text-slate-400">
                    {g.recipient_counts
                      ? `${g.recipient_counts.to} to / ${g.recipient_counts.cc} cc / ${g.recipient_counts.bcc} bcc`
                      : 'sent'}
                  </span>
                </>
              ) : (
                <>
                  <XCircle className="w-3 h-3 text-amber-600 dark:text-amber-400" />
                  <span className="italic text-gray-500 dark:text-slate-400">
                    {g.suppressed_reason || 'not sent'}
                  </span>
                </>
              )}
              {g.missing_variables && g.missing_variables.length > 0 && (
                <span className="text-amber-600 dark:text-amber-400 text-[10px]">
                  missing: {g.missing_variables.join(', ')}
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function MessageCard({ message }) {
  const to = Array.isArray(message.to_addresses)
    ? message.to_addresses
    : [];
  return (
    <div className="rounded-lg border border-gray-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-2.5">
      <div className="text-xs font-semibold text-gray-900 dark:text-slate-100 truncate">
        {message.subject || '(no subject)'}
      </div>
      <div className="mt-0.5 text-[11px] text-gray-500 dark:text-slate-400 truncate">
        From {message.from_address}
        {message.from_name && ` (${message.from_name})`}
      </div>
      <div className="mt-0.5 text-[11px] text-gray-500 dark:text-slate-400 truncate">
        To {to.join(', ') || '(no recipients)'}
      </div>
      <div className="mt-1 flex items-center gap-2">
        <span className="text-[10px] uppercase tracking-wider font-semibold text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-200 dark:border-emerald-900/60 px-1.5 py-0.5 rounded">
          {message.status}
        </span>
        <span className="text-[10px] uppercase tracking-wider text-gray-400 dark:text-slate-500">
          {message.provider}
        </span>
      </div>
    </div>
  );
}

function formatFiredAt(iso) {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    return (
      d.toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
      }) +
      ' ' +
      d.toLocaleTimeString(undefined, {
        hour: 'numeric',
        minute: '2-digit',
      })
    );
  } catch {
    return iso;
  }
}
