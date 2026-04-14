import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import {
  Umbrella,
  Plus,
  Search,
  Shield,
  Edit3,
  Power,
  Trash2,
  Users,
  Gauge,
  Zap,
  Filter,
} from 'lucide-react';
import SettingsLayout from '../../../../components/settings/SettingsLayout';
import Button from '../../../../components/ui/Button';
import Alert from '../../../../components/ui/Alert';

/**
 * Settings → Communications → Umbrellas (list view)
 *
 * Each row surfaces:
 *   - Default badge (if is_default)
 *   - Always-run badge (if always_run)
 *   - Name + description
 *   - Specificity score (visual gauge)
 *   - Scope summary (short human-readable filter list)
 *   - Group count
 *   - Active toggle + edit/delete quick actions
 *
 * Supports search + filter tabs. The Default umbrella floats to top and
 * cannot be deleted (the row omits the delete button).
 */
export default function UmbrellasList() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [umbrellas, setUmbrellas] = useState([]);
  const [error, setError] = useState(null);
  const [actionError, setActionError] = useState(null);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all'); // all | active | inactive | always_run
  const [busyId, setBusyId] = useState(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/tenant/emails/umbrellas');
      if (!res.ok) {
        const b = await res.json().catch(() => ({}));
        throw new Error(b.error || 'Failed to load umbrellas');
      }
      const data = await res.json();
      setUmbrellas(data.umbrellas || []);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return umbrellas.filter((u) => {
      if (filter === 'active' && !u.is_active) return false;
      if (filter === 'inactive' && u.is_active) return false;
      if (filter === 'always_run' && !u.always_run) return false;
      if (q) {
        const hay = `${u.name} ${u.description || ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [umbrellas, search, filter]);

  async function toggleActive(u) {
    setBusyId(u.id);
    setActionError(null);
    try {
      const res = await fetch(`/api/tenant/emails/umbrellas/${u.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_active: !u.is_active }),
      });
      if (!res.ok) {
        const b = await res.json().catch(() => ({}));
        throw new Error(b.error || 'Failed to update');
      }
      const data = await res.json();
      setUmbrellas((us) =>
        us.map((x) => (x.id === u.id ? { ...x, ...data.umbrella } : x))
      );
    } catch (e) {
      setActionError(e.message);
    } finally {
      setBusyId(null);
    }
  }

  async function deleteUmbrella(u) {
    if (u.is_default) return;
    if (!confirm(`Delete "${u.name}"? This cannot be undone.`)) return;
    setBusyId(u.id);
    setActionError(null);
    try {
      const res = await fetch(`/api/tenant/emails/umbrellas/${u.id}`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        const b = await res.json().catch(() => ({}));
        throw new Error(b.error || 'Failed to delete');
      }
      setUmbrellas((us) => us.filter((x) => x.id !== u.id));
    } catch (e) {
      setActionError(e.message);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <SettingsLayout title="Umbrellas">
      <div className="max-w-6xl">
        {/* Header */}
        <div className="mb-6 flex items-start gap-3">
          <div className="shrink-0 w-10 h-10 rounded-lg bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-900/60 flex items-center justify-center">
            <Umbrella className="w-5 h-5 text-blue-600 dark:text-blue-400" />
          </div>
          <div className="flex-1 min-w-0">
            <h1 className="text-2xl font-bold text-gray-900 dark:text-slate-100">
              Umbrellas
            </h1>
            <p className="text-sm text-gray-500 dark:text-slate-400 mt-1">
              Named load-filter scopes that wrap email groups. Each umbrella defines <strong>which loads</strong> it applies to (Import vs Export, customer, locations, container type, etc.) and contains one or more <strong>email groups</strong> — the recipient lists + templates that fire when a load matches.
            </p>
          </div>
          <Link
            href="/settings/communications/umbrellas/new"
            className="shrink-0 inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium shadow-sm transition-colors"
          >
            <Plus className="w-4 h-4" />
            New Umbrella
          </Link>
        </div>

        {error && <Alert type="error" message={error} className="mb-4" />}
        {actionError && <Alert type="error" message={actionError} className="mb-4" />}

        {/* Search + filter bar */}
        <div className="mb-4 flex items-center gap-3 flex-wrap">
          <div className="relative flex-1 min-w-[240px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 dark:text-slate-500" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search umbrellas by name or description..."
              className="block w-full pl-9 pr-3 py-2 rounded-lg border border-gray-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm text-gray-900 dark:text-slate-100 placeholder-gray-400 dark:placeholder-slate-500 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
            />
          </div>
          <div className="flex items-center gap-1 rounded-lg border border-gray-300 dark:border-slate-700 bg-white dark:bg-slate-950 p-1">
            <Filter className="w-3.5 h-3.5 text-gray-400 dark:text-slate-500 ml-1 mr-1" />
            {[
              { k: 'all', label: 'All' },
              { k: 'active', label: 'Active' },
              { k: 'inactive', label: 'Inactive' },
              { k: 'always_run', label: 'Always-Run' },
            ].map(({ k, label }) => (
              <button
                key={k}
                type="button"
                onClick={() => setFilter(k)}
                className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${
                  filter === k
                    ? 'bg-blue-600 text-white'
                    : 'text-gray-600 dark:text-slate-300 hover:bg-gray-100 dark:hover:bg-slate-800'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* Stats strip */}
        <div className="mb-4 flex items-center gap-6 text-xs text-gray-500 dark:text-slate-400">
          <span>
            <strong className="text-gray-900 dark:text-slate-100">{umbrellas.length}</strong> total
          </span>
          <span>
            <strong className="text-gray-900 dark:text-slate-100">
              {umbrellas.filter((u) => u.is_active).length}
            </strong>{' '}
            active
          </span>
          <span>
            <strong className="text-gray-900 dark:text-slate-100">
              {umbrellas.filter((u) => u.always_run).length}
            </strong>{' '}
            always-run
          </span>
        </div>

        {/* List */}
        {loading ? (
          <div className="py-20 text-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="py-20 text-center rounded-xl border border-dashed border-gray-300 dark:border-slate-700 bg-gray-50/40 dark:bg-slate-900/40">
            <Umbrella className="w-10 h-10 mx-auto text-gray-400 dark:text-slate-600 mb-3" />
            <div className="text-sm font-semibold text-gray-900 dark:text-slate-100">
              {search || filter !== 'all' ? 'No umbrellas match your filters' : 'No umbrellas yet'}
            </div>
            <div className="text-xs text-gray-500 dark:text-slate-400 mt-1">
              {search || filter !== 'all'
                ? 'Try clearing the search or switching to the All filter'
                : 'The Default — All Loads umbrella is created automatically. Click New Umbrella to add a customer-specific one.'}
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            {filtered.map((u) => (
              <UmbrellaRow
                key={u.id}
                umbrella={u}
                busy={busyId === u.id}
                onToggleActive={() => toggleActive(u)}
                onDelete={() => deleteUmbrella(u)}
              />
            ))}
          </div>
        )}
      </div>
    </SettingsLayout>
  );
}

function UmbrellaRow({ umbrella: u, busy, onToggleActive, onDelete }) {
  // Build a short human-readable scope summary from populated filter fields
  const scopeParts = [];
  if (u.load_type) scopeParts.push(capitalize(u.load_type));
  if (u.customer?.name) scopeParts.push(u.customer.name);
  if (u.delivery?.name) scopeParts.push(`→ ${u.delivery.name}`);
  else if (u.pickup?.name) scopeParts.push(`from ${u.pickup.name}`);
  if (u.container_size) scopeParts.push(`${u.container_size}ft`);
  if (u.container_type) scopeParts.push(u.container_type);
  if (u.ssl) scopeParts.push(u.ssl);
  if (u.hazmat) scopeParts.push('Hazmat');
  if (u.overweight) scopeParts.push('Overweight');
  const scopeSummary = scopeParts.length > 0 ? scopeParts.join(' · ') : null;

  return (
    <div
      className={`group rounded-xl border transition-colors ${
        u.is_active
          ? 'border-gray-200 dark:border-slate-800 bg-white dark:bg-slate-900 hover:border-blue-300 dark:hover:border-blue-800'
          : 'border-gray-200 dark:border-slate-800 bg-gray-50/60 dark:bg-slate-900/40 opacity-80'
      }`}
    >
      <div className="flex items-start gap-4 p-4">
        <div className="shrink-0 pt-0.5">
          <div
            className={`w-9 h-9 rounded-lg flex items-center justify-center ${
              u.is_default
                ? 'bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-900/60'
                : 'bg-gray-50 dark:bg-slate-800/80 border border-gray-200 dark:border-slate-700'
            }`}
          >
            {u.is_default ? (
              <Shield className="w-4 h-4 text-blue-600 dark:text-blue-400" />
            ) : (
              <Umbrella className="w-4 h-4 text-gray-500 dark:text-slate-400" />
            )}
          </div>
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-0.5">
            <Link
              href={`/settings/communications/umbrellas/${u.id}`}
              className="text-sm font-semibold text-gray-900 dark:text-slate-100 hover:text-blue-700 dark:hover:text-blue-400 truncate"
            >
              {u.name}
            </Link>
            {u.is_default && (
              <span className="text-[9px] uppercase tracking-wider font-semibold text-blue-700 dark:text-blue-300 bg-blue-50 dark:bg-blue-950/60 border border-blue-200 dark:border-blue-900/60 px-1.5 py-0.5 rounded">
                Default
              </span>
            )}
            {u.always_run && (
              <span className="text-[9px] uppercase tracking-wider font-semibold text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/60 border border-amber-200 dark:border-amber-900/60 px-1.5 py-0.5 rounded inline-flex items-center gap-1">
                <Zap className="w-2.5 h-2.5" />
                Always-Run
              </span>
            )}
            {!u.is_active && (
              <span className="text-[9px] uppercase tracking-wider font-semibold text-gray-500 dark:text-slate-400 bg-gray-100 dark:bg-slate-800 border border-gray-200 dark:border-slate-700 px-1.5 py-0.5 rounded">
                Inactive
              </span>
            )}
          </div>
          {u.description && (
            <div className="text-xs text-gray-500 dark:text-slate-400 mb-1 line-clamp-1">
              {u.description}
            </div>
          )}
          <div className="flex items-center gap-3 text-xs text-gray-600 dark:text-slate-300 mt-1 flex-wrap">
            <SpecificityMeter score={u.specificity_score || 0} />
            <span className="inline-flex items-center gap-1 text-gray-500 dark:text-slate-400">
              <Users className="w-3 h-3" />
              {u.group_count || 0} {u.group_count === 1 ? 'group' : 'groups'}
            </span>
            {scopeSummary && (
              <span className="text-gray-500 dark:text-slate-400 truncate">
                <span className="text-gray-400 dark:text-slate-500">Scope:</span>{' '}
                {scopeSummary}
              </span>
            )}
            {!scopeSummary && !u.is_default && (
              <span className="italic text-amber-600 dark:text-amber-400">
                No filters set — matches every load
              </span>
            )}
          </div>
        </div>

        <div className="shrink-0 flex items-center gap-1">
          <Link
            href={`/settings/communications/umbrellas/${u.id}`}
            className="p-2 rounded-lg text-gray-400 hover:text-blue-600 hover:bg-blue-50 dark:text-slate-500 dark:hover:text-blue-400 dark:hover:bg-blue-950/40 transition-colors"
            title="Edit"
          >
            <Edit3 className="w-4 h-4" />
          </Link>
          <button
            type="button"
            onClick={onToggleActive}
            disabled={busy}
            className={`p-2 rounded-lg transition-colors disabled:opacity-50 ${
              u.is_active
                ? 'text-emerald-500 hover:text-emerald-700 hover:bg-emerald-50 dark:text-emerald-400 dark:hover:bg-emerald-950/40'
                : 'text-gray-400 hover:text-gray-700 hover:bg-gray-100 dark:text-slate-500 dark:hover:text-slate-200 dark:hover:bg-slate-800'
            }`}
            title={u.is_active ? 'Deactivate' : 'Activate'}
          >
            <Power className="w-4 h-4" />
          </button>
          {!u.is_default && (
            <button
              type="button"
              onClick={onDelete}
              disabled={busy}
              className="p-2 rounded-lg text-gray-400 hover:text-rose-600 hover:bg-rose-50 dark:text-slate-500 dark:hover:text-rose-400 dark:hover:bg-rose-950/40 transition-colors disabled:opacity-50"
              title="Delete"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// Tiny specificity-score gauge. 0 = catch-all, 1-3 = low, 4-8 = medium,
// 9+ = high. Visually communicates "more filter = more specific match".
function SpecificityMeter({ score }) {
  const max = 19;
  const pct = Math.min(100, (score / max) * 100);
  const color =
    score === 0
      ? 'bg-gray-300 dark:bg-slate-700'
      : score <= 3
      ? 'bg-blue-400 dark:bg-blue-500'
      : score <= 8
      ? 'bg-indigo-500 dark:bg-indigo-400'
      : 'bg-purple-500 dark:bg-purple-400';
  return (
    <span
      className="inline-flex items-center gap-1.5 text-[11px] text-gray-500 dark:text-slate-400"
      title={`Specificity score: ${score} / ${max} — higher = more specific match wins over lower ones`}
    >
      <Gauge className="w-3 h-3" />
      <span className="w-12 h-1.5 rounded-full bg-gray-200 dark:bg-slate-800 overflow-hidden inline-block">
        <span className={`h-full block ${color}`} style={{ width: `${pct}%` }} />
      </span>
      <span>{score}</span>
    </span>
  );
}

function capitalize(s) {
  if (!s) return '';
  return String(s).charAt(0).toUpperCase() + String(s).slice(1);
}
