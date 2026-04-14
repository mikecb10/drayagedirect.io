import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  Zap,
  Plus,
  Search,
  Edit3,
  Power,
  Trash2,
  Star,
  Globe,
  Users as UsersIcon,
  Mail,
  Umbrella as UmbrellaIcon,
} from 'lucide-react';
import SettingsLayout from '../../../../components/settings/SettingsLayout';
import Button from '../../../../components/ui/Button';
import Alert from '../../../../components/ui/Alert';

/**
 * Settings → Communications → Configurations (list view)
 *
 * A Configuration wires umbrellas → a sender identity. When a trigger
 * fires, the engine finds matching umbrellas, looks up the configuration
 * that owns them, and uses that configuration's sender to dispatch.
 *
 * Each row surfaces:
 *   - Default badge (if is_default)
 *   - Sender kind icon (SendGrid/Shared Gmail/Personal Gmail)
 *   - Name + sender identity line
 *   - Umbrella count
 *   - Priority
 *   - Active toggle + edit/delete quick actions
 */
export default function ConfigurationsList() {
  const [loading, setLoading] = useState(true);
  const [configurations, setConfigurations] = useState([]);
  const [error, setError] = useState(null);
  const [actionError, setActionError] = useState(null);
  const [search, setSearch] = useState('');
  const [busyId, setBusyId] = useState(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/tenant/emails/configurations');
      if (!res.ok) {
        const b = await res.json().catch(() => ({}));
        throw new Error(b.error || 'Failed to load configurations');
      }
      const data = await res.json();
      setConfigurations(data.configurations || []);
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
    if (!q) return configurations;
    return configurations.filter((c) => {
      const hay = `${c.name} ${c.description || ''}`.toLowerCase();
      return hay.includes(q);
    });
  }, [configurations, search]);

  async function toggleActive(config) {
    setBusyId(config.id);
    setActionError(null);
    try {
      const res = await fetch(`/api/tenant/emails/configurations/${config.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_active: !config.is_active }),
      });
      if (!res.ok) {
        const b = await res.json().catch(() => ({}));
        throw new Error(b.error || 'Failed to update');
      }
      await load();
    } catch (e) {
      setActionError(e.message);
    } finally {
      setBusyId(null);
    }
  }

  async function deleteConfig(config) {
    if (!confirm(`Delete "${config.name}"? Any umbrellas attached to it will be detached. This cannot be undone.`)) {
      return;
    }
    setBusyId(config.id);
    setActionError(null);
    try {
      const res = await fetch(`/api/tenant/emails/configurations/${config.id}`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        const b = await res.json().catch(() => ({}));
        throw new Error(b.error || 'Failed to delete');
      }
      setConfigurations((cs) => cs.filter((c) => c.id !== config.id));
    } catch (e) {
      setActionError(e.message);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <SettingsLayout title="Configurations">
      <div className="max-w-6xl">
        {/* Header */}
        <div className="mb-6 flex items-start gap-3">
          <div className="shrink-0 w-10 h-10 rounded-lg bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-900/60 flex items-center justify-center">
            <Zap className="w-5 h-5 text-blue-600 dark:text-blue-400" />
          </div>
          <div className="flex-1 min-w-0">
            <h1 className="text-2xl font-bold text-gray-900 dark:text-slate-100">
              Configurations
            </h1>
            <p className="text-sm text-gray-500 dark:text-slate-400 mt-1">
              Wire <strong>umbrellas</strong> to a <strong>sender identity</strong>. When a trigger fires, the engine finds matching umbrellas, looks up the configuration that owns them, and dispatches via that configuration&apos;s sender.
            </p>
          </div>
          <Link
            href="/settings/communications/configurations/new"
            className="shrink-0 inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium shadow-sm transition-colors"
          >
            <Plus className="w-4 h-4" />
            New Configuration
          </Link>
        </div>

        {error && <Alert type="error" message={error} className="mb-4" />}
        {actionError && <Alert type="error" message={actionError} className="mb-4" />}

        {/* Search + stats */}
        <div className="mb-4 flex items-center gap-3 flex-wrap">
          <div className="relative flex-1 min-w-[240px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 dark:text-slate-500" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search configurations..."
              className="block w-full pl-9 pr-3 py-2 rounded-lg border border-gray-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm text-gray-900 dark:text-slate-100 placeholder-gray-400 dark:placeholder-slate-500 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
            />
          </div>
          <div className="flex items-center gap-4 text-xs text-gray-500 dark:text-slate-400">
            <span>
              <strong className="text-gray-900 dark:text-slate-100">{configurations.length}</strong> total
            </span>
            <span>
              <strong className="text-gray-900 dark:text-slate-100">
                {configurations.filter((c) => c.is_active).length}
              </strong>{' '}
              active
            </span>
          </div>
        </div>

        {/* List */}
        {loading ? (
          <div className="py-20 text-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="py-20 text-center rounded-xl border border-dashed border-gray-300 dark:border-slate-700 bg-gray-50/40 dark:bg-slate-900/40">
            <Zap className="w-10 h-10 mx-auto text-gray-400 dark:text-slate-600 mb-3" />
            <div className="text-sm font-semibold text-gray-900 dark:text-slate-100">
              {search ? 'No configurations match your search' : 'No configurations yet'}
            </div>
            <div className="text-xs text-gray-500 dark:text-slate-400 mt-1">
              {search
                ? 'Try clearing the search.'
                : 'Create your first configuration to connect umbrellas to a sender identity.'}
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            {filtered.map((c) => (
              <ConfigurationRow
                key={c.id}
                config={c}
                busy={busyId === c.id}
                onToggle={() => toggleActive(c)}
                onDelete={() => deleteConfig(c)}
              />
            ))}
          </div>
        )}
      </div>
    </SettingsLayout>
  );
}

function ConfigurationRow({ config, busy, onToggle, onDelete }) {
  const senderLabel = senderLineFor(config);
  const SenderIcon = senderIconFor(config.sender_kind);

  return (
    <div
      className={`group rounded-xl border transition-colors ${
        config.is_active
          ? 'border-gray-200 dark:border-slate-800 bg-white dark:bg-slate-900 hover:border-blue-300 dark:hover:border-blue-800'
          : 'border-gray-200 dark:border-slate-800 bg-gray-50/60 dark:bg-slate-900/40 opacity-80'
      }`}
    >
      <div className="flex items-start gap-4 p-4">
        <div className="shrink-0 pt-0.5">
          <div
            className={`w-9 h-9 rounded-lg flex items-center justify-center ${
              config.is_default
                ? 'bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900/60'
                : 'bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-900/60'
            }`}
          >
            {config.is_default ? (
              <Star className="w-4 h-4 text-amber-600 dark:text-amber-400 fill-amber-500 dark:fill-amber-400" />
            ) : (
              <SenderIcon className="w-4 h-4 text-blue-600 dark:text-blue-400" />
            )}
          </div>
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-0.5">
            <Link
              href={`/settings/communications/configurations/${config.id}`}
              className="text-sm font-semibold text-gray-900 dark:text-slate-100 hover:text-blue-700 dark:hover:text-blue-400 truncate"
            >
              {config.name}
            </Link>
            {config.is_default && (
              <span className="text-[9px] uppercase tracking-wider font-semibold text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/60 border border-amber-200 dark:border-amber-900/60 px-1.5 py-0.5 rounded">
                Default
              </span>
            )}
            {!config.is_active && (
              <span className="text-[9px] uppercase tracking-wider font-semibold text-gray-500 dark:text-slate-400 bg-gray-100 dark:bg-slate-800 border border-gray-200 dark:border-slate-700 px-1.5 py-0.5 rounded">
                Inactive
              </span>
            )}
          </div>
          {config.description && (
            <div className="text-xs text-gray-500 dark:text-slate-400 mb-1 line-clamp-1">
              {config.description}
            </div>
          )}
          <div className="flex items-center gap-3 text-xs text-gray-600 dark:text-slate-300 flex-wrap">
            <span className="inline-flex items-center gap-1">
              <SenderIcon className="w-3 h-3" />
              {senderLabel}
            </span>
            <span className="inline-flex items-center gap-1 text-gray-500 dark:text-slate-400">
              <UmbrellaIcon className="w-3 h-3" />
              {config.umbrella_count || 0}{' '}
              {config.umbrella_count === 1 ? 'umbrella' : 'umbrellas'}
            </span>
            <span className="text-[10px] text-gray-400 dark:text-slate-500">
              Priority {config.priority || 0}
            </span>
          </div>
        </div>

        <div className="shrink-0 flex items-center gap-1">
          <Link
            href={`/settings/communications/configurations/${config.id}`}
            className="p-2 rounded-lg text-gray-400 hover:text-blue-600 hover:bg-blue-50 dark:text-slate-500 dark:hover:text-blue-400 dark:hover:bg-blue-950/40 transition-colors"
            title="Edit"
          >
            <Edit3 className="w-4 h-4" />
          </Link>
          <button
            type="button"
            onClick={onToggle}
            disabled={busy}
            className={`p-2 rounded-lg transition-colors disabled:opacity-50 ${
              config.is_active
                ? 'text-emerald-500 hover:text-emerald-700 hover:bg-emerald-50 dark:text-emerald-400 dark:hover:bg-emerald-950/40'
                : 'text-gray-400 hover:text-gray-700 hover:bg-gray-100 dark:text-slate-500 dark:hover:text-slate-200 dark:hover:bg-slate-800'
            }`}
            title={config.is_active ? 'Deactivate' : 'Activate'}
          >
            <Power className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={onDelete}
            disabled={busy}
            className="p-2 rounded-lg text-gray-400 hover:text-rose-600 hover:bg-rose-50 dark:text-slate-500 dark:hover:text-rose-400 dark:hover:bg-rose-950/40 transition-colors disabled:opacity-50"
            title="Delete"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}

function senderIconFor(kind) {
  if (kind === 'sendgrid') return Globe;
  if (kind === 'shared_gmail') return UsersIcon;
  if (kind === 'user_gmail') return Mail;
  return Zap;
}

function senderLineFor(config) {
  if (config.sender_kind === 'sendgrid') {
    if (config.sender_address) {
      return `SendGrid — ${config.sender_address.local_part}@… (${config.sender_address.display_name})`;
    }
    return 'SendGrid — address not found';
  }
  if (config.sender_kind === 'shared_gmail') {
    if (config.shared_account) {
      return `Shared — ${config.shared_account.display_name || config.shared_account.email_address}`;
    }
    return 'Shared — account not found';
  }
  if (config.sender_kind === 'user_gmail') {
    return 'Personal — each user sends from their own connected mailbox';
  }
  return 'No sender identity configured';
}
