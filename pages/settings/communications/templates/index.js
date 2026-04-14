import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import {
  Mail,
  Plus,
  Search,
  Shield,
  Edit3,
  Power,
  Trash2,
  Copy,
  FileText,
  Filter,
} from 'lucide-react';
import SettingsLayout from '../../../../components/settings/SettingsLayout';
import Button from '../../../../components/ui/Button';
import Alert from '../../../../components/ui/Alert';

/**
 * Settings → Communications → Email Templates (list view)
 *
 * Lists every email template for the tenant. Each row shows:
 *   - System badge (if is_system)
 *   - Name + description
 *   - Subject line preview
 *   - body_format indicator (Plain / HTML)
 *   - Active toggle
 *   - Quick actions: Edit, Clone, Delete (Delete hidden for system templates)
 *
 * Supports:
 *   - Search (substring match on name/description/subject/system_slug)
 *   - Filter toggle: All / System / Custom / Active / Inactive
 *   - Create Template CTA (navigates to the editor in "new" mode)
 */
export default function EmailTemplatesList() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [templates, setTemplates] = useState([]);
  const [error, setError] = useState(null);
  const [actionError, setActionError] = useState(null);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all'); // all | system | custom | active | inactive
  const [busyId, setBusyId] = useState(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/tenant/emails/templates');
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || 'Failed to load templates');
      }
      const data = await res.json();
      setTemplates(data.templates || []);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  // Client-side filtering — the API supports server-side filters, but
  // with only ~13+N templates, keeping it client-side makes the UI feel
  // instant and avoids a round-trip per keystroke.
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return templates.filter((t) => {
      if (filter === 'system' && !t.is_system) return false;
      if (filter === 'custom' && t.is_system) return false;
      if (filter === 'active' && !t.is_active) return false;
      if (filter === 'inactive' && t.is_active) return false;
      if (q) {
        const hay = `${t.name} ${t.description || ''} ${t.subject} ${t.system_slug || ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [templates, search, filter]);

  async function toggleActive(t) {
    setBusyId(t.id);
    setActionError(null);
    try {
      const res = await fetch(`/api/tenant/emails/templates/${t.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_active: !t.is_active }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || 'Failed to update');
      }
      const data = await res.json();
      setTemplates((ts) => ts.map((x) => (x.id === t.id ? data.template : x)));
    } catch (e) {
      setActionError(e.message);
    } finally {
      setBusyId(null);
    }
  }

  async function cloneTemplate(t) {
    setBusyId(t.id);
    setActionError(null);
    try {
      const res = await fetch('/api/tenant/emails/templates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: `${t.name} (copy)`,
          description: t.description,
          subject: t.subject,
          body_text: t.body_text,
          body_html: t.body_html,
          body_format: t.body_format,
          format_overrides: t.format_overrides,
          attachment_document_types: t.attachment_document_types,
          suppress_default_signature: t.suppress_default_signature,
          is_active: t.is_active,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || 'Failed to clone');
      }
      const data = await res.json();
      // Navigate to the new template's editor so the user can rename it
      router.push(`/settings/communications/templates/${data.template.id}`);
    } catch (e) {
      setActionError(e.message);
      setBusyId(null);
    }
  }

  async function deleteTemplate(t) {
    if (t.is_system) return;
    if (!confirm(`Delete the "${t.name}" template? This cannot be undone.`)) return;
    setBusyId(t.id);
    setActionError(null);
    try {
      const res = await fetch(`/api/tenant/emails/templates/${t.id}`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || 'Failed to delete');
      }
      setTemplates((ts) => ts.filter((x) => x.id !== t.id));
    } catch (e) {
      setActionError(e.message);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <SettingsLayout title="Email Templates">
      <div className="max-w-6xl">
        {/* Header */}
        <div className="mb-6 flex items-start gap-3">
          <div className="shrink-0 w-10 h-10 rounded-lg bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-900/60 flex items-center justify-center">
            <Mail className="w-5 h-5 text-blue-600 dark:text-blue-400" />
          </div>
          <div className="flex-1 min-w-0">
            <h1 className="text-2xl font-bold text-gray-900 dark:text-slate-100">
              Email Templates
            </h1>
            <p className="text-sm text-gray-500 dark:text-slate-400 mt-1">
              Reusable email bodies with <code className="text-xs font-mono bg-gray-100 dark:bg-slate-800 px-1 py-0.5 rounded">{'{{variable}}'}</code> tokens. System templates ship with every tenant — rename or edit them freely. Custom templates let you tailor messages for specific umbrellas.
            </p>
          </div>
          <Link
            href="/settings/communications/templates/new"
            className="shrink-0 inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium shadow-sm transition-colors"
          >
            <Plus className="w-4 h-4" />
            New Template
          </Link>
        </div>

        {error && <Alert type="error" message={error} className="mb-4" />}
        {actionError && (
          <Alert type="error" message={actionError} className="mb-4" />
        )}

        {/* Search + filter bar */}
        <div className="mb-4 flex items-center gap-3 flex-wrap">
          <div className="relative flex-1 min-w-[240px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 dark:text-slate-500" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search templates by name, description, or subject..."
              className="block w-full pl-9 pr-3 py-2 rounded-lg border border-gray-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm text-gray-900 dark:text-slate-100 placeholder-gray-400 dark:placeholder-slate-500 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
            />
          </div>
          <div className="flex items-center gap-1 rounded-lg border border-gray-300 dark:border-slate-700 bg-white dark:bg-slate-950 p-1">
            <Filter className="w-3.5 h-3.5 text-gray-400 dark:text-slate-500 ml-1 mr-1" />
            {[
              { k: 'all', label: 'All' },
              { k: 'system', label: 'System' },
              { k: 'custom', label: 'Custom' },
              { k: 'active', label: 'Active' },
              { k: 'inactive', label: 'Inactive' },
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
            <strong className="text-gray-900 dark:text-slate-100">{templates.length}</strong> total
          </span>
          <span>
            <strong className="text-gray-900 dark:text-slate-100">
              {templates.filter((t) => t.is_system).length}
            </strong>{' '}
            system
          </span>
          <span>
            <strong className="text-gray-900 dark:text-slate-100">
              {templates.filter((t) => !t.is_system).length}
            </strong>{' '}
            custom
          </span>
          <span>
            <strong className="text-gray-900 dark:text-slate-100">
              {templates.filter((t) => t.is_active).length}
            </strong>{' '}
            active
          </span>
        </div>

        {/* List */}
        {loading ? (
          <div className="py-20 text-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="py-20 text-center rounded-xl border border-dashed border-gray-300 dark:border-slate-700 bg-gray-50/40 dark:bg-slate-900/40">
            <FileText className="w-10 h-10 mx-auto text-gray-400 dark:text-slate-600 mb-3" />
            <div className="text-sm font-semibold text-gray-900 dark:text-slate-100">
              {search || filter !== 'all' ? 'No templates match your filters' : 'No templates yet'}
            </div>
            <div className="text-xs text-gray-500 dark:text-slate-400 mt-1">
              {search || filter !== 'all'
                ? 'Try clearing the search or switching to the All filter'
                : 'Get started by creating your first template'}
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            {filtered.map((t) => (
              <TemplateRow
                key={t.id}
                template={t}
                busy={busyId === t.id}
                onToggleActive={() => toggleActive(t)}
                onClone={() => cloneTemplate(t)}
                onDelete={() => deleteTemplate(t)}
              />
            ))}
          </div>
        )}
      </div>
    </SettingsLayout>
  );
}

function TemplateRow({ template: t, busy, onToggleActive, onClone, onDelete }) {
  return (
    <div
      className={`group rounded-xl border transition-colors ${
        t.is_active
          ? 'border-gray-200 dark:border-slate-800 bg-white dark:bg-slate-900 hover:border-blue-300 dark:hover:border-blue-800'
          : 'border-gray-200 dark:border-slate-800 bg-gray-50/60 dark:bg-slate-900/40 opacity-80'
      }`}
    >
      <div className="flex items-start gap-4 p-4">
        <div className="shrink-0 pt-0.5">
          <div
            className={`w-9 h-9 rounded-lg flex items-center justify-center ${
              t.is_system
                ? 'bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-900/60'
                : 'bg-gray-50 dark:bg-slate-800/80 border border-gray-200 dark:border-slate-700'
            }`}
          >
            {t.is_system ? (
              <Shield className="w-4 h-4 text-blue-600 dark:text-blue-400" />
            ) : (
              <Mail className="w-4 h-4 text-gray-500 dark:text-slate-400" />
            )}
          </div>
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-0.5">
            <Link
              href={`/settings/communications/templates/${t.id}`}
              className="text-sm font-semibold text-gray-900 dark:text-slate-100 hover:text-blue-700 dark:hover:text-blue-400 truncate"
            >
              {t.name}
            </Link>
            {t.is_system && (
              <span className="text-[9px] uppercase tracking-wider font-semibold text-blue-700 dark:text-blue-300 bg-blue-50 dark:bg-blue-950/60 border border-blue-200 dark:border-blue-900/60 px-1.5 py-0.5 rounded">
                System
              </span>
            )}
            <span
              className={`text-[9px] uppercase tracking-wider font-semibold px-1.5 py-0.5 rounded border ${
                t.body_format === 'html'
                  ? 'text-purple-700 dark:text-purple-300 bg-purple-50 dark:bg-purple-950/60 border-purple-200 dark:border-purple-900/60'
                  : 'text-gray-600 dark:text-slate-300 bg-gray-50 dark:bg-slate-800 border-gray-200 dark:border-slate-700'
              }`}
            >
              {t.body_format === 'html' ? 'HTML' : 'Plain'}
            </span>
            {!t.is_active && (
              <span className="text-[9px] uppercase tracking-wider font-semibold text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/60 border border-amber-200 dark:border-amber-900/60 px-1.5 py-0.5 rounded">
                Inactive
              </span>
            )}
          </div>
          {t.description && (
            <div className="text-xs text-gray-500 dark:text-slate-400 mb-1 line-clamp-1">
              {t.description}
            </div>
          )}
          <div className="text-xs text-gray-600 dark:text-slate-300 font-medium truncate">
            <span className="text-gray-400 dark:text-slate-500 mr-1">Subject:</span>
            {t.subject}
          </div>
        </div>

        {/* Actions */}
        <div className="shrink-0 flex items-center gap-1">
          <Link
            href={`/settings/communications/templates/${t.id}`}
            className="p-2 rounded-lg text-gray-400 hover:text-blue-600 hover:bg-blue-50 dark:text-slate-500 dark:hover:text-blue-400 dark:hover:bg-blue-950/40 transition-colors"
            title="Edit"
          >
            <Edit3 className="w-4 h-4" />
          </Link>
          <button
            type="button"
            onClick={onClone}
            disabled={busy}
            className="p-2 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 dark:text-slate-500 dark:hover:text-slate-200 dark:hover:bg-slate-800 transition-colors disabled:opacity-50"
            title="Clone"
          >
            <Copy className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={onToggleActive}
            disabled={busy}
            className={`p-2 rounded-lg transition-colors disabled:opacity-50 ${
              t.is_active
                ? 'text-emerald-500 hover:text-emerald-700 hover:bg-emerald-50 dark:text-emerald-400 dark:hover:bg-emerald-950/40'
                : 'text-gray-400 hover:text-gray-700 hover:bg-gray-100 dark:text-slate-500 dark:hover:text-slate-200 dark:hover:bg-slate-800'
            }`}
            title={t.is_active ? 'Deactivate' : 'Activate'}
          >
            <Power className="w-4 h-4" />
          </button>
          {!t.is_system && (
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
