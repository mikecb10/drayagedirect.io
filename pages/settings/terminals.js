import { useEffect, useState, useMemo } from 'react';
import { MapPin, Search, Ship, Train, Check, X, Pencil } from 'lucide-react';
import SettingsLayout from '../../components/settings/SettingsLayout';
import Alert from '../../components/ui/Alert';
import { PageHeader } from '../../components/ui/ModuleHeader';
import { SectionCard } from '../../components/ui/FormSection';
import FieldGroup from '../../components/ui/FieldGroup';
import Field from '../../components/ui/Field';


function TerminalsPage() {
  const [terminals, setTerminals] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState('');
  const [filterMarket, setFilterMarket] = useState('');
  const [filterType, setFilterType] = useState('');
  const [editingId, setEditingId] = useState(null);
  const [editName, setEditName] = useState('');

  async function fetchTerminals() {
    setLoading(true);
    try {
      const res = await fetch('/api/tenant/terminals?all=true');
      if (!res.ok) throw new Error('Failed to load terminals');
      const data = await res.json();
      setTerminals(data.terminals || []);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchTerminals();
  }, []);

  async function saveCustomName(id) {
    try {
      const res = await fetch(`/api/tenant/terminals/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ custom_name: editName || null }),
      });
      if (!res.ok) throw new Error('Failed to save');
      setEditingId(null);
      await fetchTerminals();
    } catch (e) {
      setError(e.message);
    }
  }

  async function toggleTerminal(id, enabled) {
    setTerminals((ts) =>
      ts.map((t) => (t.id === id ? { ...t, effective_enabled: enabled } : t))
    );
    try {
      const res = await fetch(`/api/tenant/terminals/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled }),
      });
      if (!res.ok) throw new Error('Failed to toggle');
    } catch (e) {
      setError(e.message);
      fetchTerminals();
    }
  }

  const markets = useMemo(() => {
    const set = new Set(terminals.map((t) => t.market));
    return [...set].sort();
  }, [terminals]);

  const filtered = useMemo(() => {
    let list = terminals;
    if (filterMarket) list = list.filter((t) => t.market === filterMarket);
    if (filterType) list = list.filter((t) => t.type === filterType);
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(
        (t) =>
          t.label.toLowerCase().includes(q) ||
          t.effective_name.toLowerCase().includes(q) ||
          t.city?.toLowerCase().includes(q)
      );
    }
    return list;
  }, [terminals, filterMarket, filterType, search]);

  const stats = useMemo(() => {
    const total = terminals.length;
    const marine = terminals.filter((t) => t.type === 'MARINE').length;
    const rail = terminals.filter((t) => t.type === 'RAIL').length;
    const enabled = terminals.filter((t) => t.effective_enabled && t.market_enabled).length;
    const customized = terminals.filter((t) => t.custom_name).length;
    return { total, marine, rail, enabled, customized };
  }, [terminals]);

  return (
    <div className="space-y-5 max-w-7xl">
        {error && <Alert type="error" message={error} onClose={() => setError(null)} />}

        <PageHeader
          variant="plain"
          title={<><MapPin className="w-6 h-6 text-blue-600 inline -mt-0.5 mr-2" />Terminals</>}
          description="Enable/disable individual port and rail terminals. Customize their display names. Only enabled terminals appear in load pickers."
          className="mb-[var(--space-section)]"
        />

        {/* Stats */}
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          <StatCard label="Total" value={stats.total} />
          <StatCard label="Marine" value={stats.marine} icon={<Ship className="w-4 h-4 text-blue-400" />} />
          <StatCard label="Rail" value={stats.rail} icon={<Train className="w-4 h-4 text-amber-500" />} />
          <StatCard label="Active" value={stats.enabled} />
          <StatCard label="Customized" value={stats.customized} />
        </div>

        {/* Filters */}
        <SectionCard title="Filter" columns={0}>
          <FieldGroup columns={3}>
            <Field label="Search">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 dark:text-slate-500 pointer-events-none" />
                <input
                  type="text"
                  placeholder="Search terminals…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="block w-full rounded-lg border border-gray-300 dark:border-slate-700 bg-white dark:bg-slate-900 pl-9 pr-3 py-2 text-body text-strong focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                />
              </div>
            </Field>
            <Field label="Market">
              <select
                value={filterMarket}
                onChange={(e) => setFilterMarket(e.target.value)}
                className="block w-full rounded-lg border border-gray-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-body text-strong"
              >
                <option value="">All Markets</option>
                {markets.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Type">
              <select
                value={filterType}
                onChange={(e) => setFilterType(e.target.value)}
                className="block w-full rounded-lg border border-gray-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-body text-strong"
              >
                <option value="">All Types</option>
                <option value="MARINE">Marine</option>
                <option value="RAIL">Rail</option>
              </select>
            </Field>
          </FieldGroup>
        </SectionCard>

        {/* Table */}
        <SectionCard title="Terminals" columns={0}>
          {loading ? (
            <div className="py-16 text-center text-body text-muted">Loading terminals…</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-body">
                <thead>
                  <tr className="border-b border-gray-100 dark:border-slate-800 bg-gray-50/60 dark:bg-slate-800/60">
                    <th className="text-left px-4 py-2.5 text-field-label text-muted">Market</th>
                    <th className="text-left px-4 py-2.5 text-field-label text-muted">Type</th>
                    <th className="text-left px-4 py-2.5 text-field-label text-muted">Label / Key</th>
                    <th className="text-left px-4 py-2.5 text-field-label text-muted">Profile Name</th>
                    <th className="text-left px-4 py-2.5 text-field-label text-muted">City</th>
                    <th className="text-left px-4 py-2.5 text-field-label text-muted">State</th>
                    <th className="text-center px-4 py-2.5 text-field-label text-muted">Enabled</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((t) => (
                    <tr key={t.id} className="border-b border-gray-50 dark:border-slate-800 hover:bg-gray-50/50 dark:hover:bg-slate-800/50">
                      <td className="px-4 py-2.5">
                        <div className="flex items-center gap-1.5">
                          {!t.market_enabled && (
                            <span className="text-[9px] uppercase tracking-wide font-semibold bg-gray-100 dark:bg-slate-800 text-muted px-1.5 py-0.5 rounded">
                              market off
                            </span>
                          )}
                          <span className="text-helper text-strong">{t.market}</span>
                        </div>
                      </td>
                      <td className="px-4 py-2.5">
                        <span
                          className={`inline-flex items-center gap-1 rounded px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                            t.type === 'MARINE'
                              ? 'bg-blue-100 text-blue-700'
                              : 'bg-amber-100 text-amber-700'
                          }`}
                        >
                          {t.type === 'MARINE' ? (
                            <Ship className="w-3 h-3" />
                          ) : (
                            <Train className="w-3 h-3" />
                          )}
                          {t.type}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 font-mono text-helper text-muted">{t.label}</td>
                      <td className="px-4 py-2.5">
                        {editingId === t.id ? (
                          <div className="flex items-center gap-1">
                            <input
                              type="text"
                              value={editName}
                              onChange={(e) => setEditName(e.target.value)}
                              className="block w-48 rounded border border-blue-300 px-2 py-1 text-helper focus:outline-none focus:ring-2 focus:ring-blue-100"
                              autoFocus
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') saveCustomName(t.id);
                                if (e.key === 'Escape') setEditingId(null);
                              }}
                            />
                            <button
                              onClick={() => saveCustomName(t.id)}
                              className="p-1 text-emerald-600 hover:bg-emerald-50 rounded"
                            >
                              <Check className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={() => setEditingId(null)}
                              className="p-1 text-gray-400 dark:text-slate-500 hover:bg-gray-100 dark:hover:bg-slate-800 rounded"
                            >
                              <X className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        ) : (
                          <div className="flex items-center gap-1.5 group">
                            <span className="text-helper text-strong">
                              {t.effective_name}
                            </span>
                            {t.custom_name && (
                              <span className="text-[9px] uppercase tracking-wide font-semibold bg-purple-100 text-purple-600 px-1 py-0.5 rounded">
                                custom
                              </span>
                            )}
                            <button
                              onClick={() => {
                                setEditingId(t.id);
                                setEditName(t.effective_name);
                              }}
                              className="p-0.5 text-gray-300 dark:text-slate-600 hover:text-blue-600 opacity-0 group-hover:opacity-100 transition-opacity"
                            >
                              <Pencil className="w-3 h-3" />
                            </button>
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-helper text-muted">{t.city || '—'}</td>
                      <td className="px-4 py-2.5 text-helper text-muted">{t.state || '—'}</td>
                      <td className="px-4 py-2.5 text-center">
                        <button
                          type="button"
                          onClick={() => toggleTerminal(t.id, !t.effective_enabled)}
                          className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${
                            t.effective_enabled ? 'bg-blue-600' : 'bg-gray-200 dark:bg-slate-700'
                          }`}
                        >
                          <span
                            className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
                              t.effective_enabled ? 'translate-x-4' : 'translate-x-0'
                            }`}
                          />
                        </button>
                      </td>
                    </tr>
                  ))}
                  {filtered.length === 0 && (
                    <tr>
                      <td colSpan={7} className="py-12 text-center text-body text-muted">
                        No terminals found
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </SectionCard>
      </div>
  );
}

TerminalsPage.getLayout = (page) => (
  <SettingsLayout title="Terminals">{page}</SettingsLayout>
);

export default TerminalsPage;

function StatCard({ label, value, icon }) {
  return (
    <div className="rounded-lg border border-gray-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-4 py-3">
      <div className="flex items-center gap-2">
        {icon}
        <div className="text-2xl font-semibold text-strong">{value}</div>
      </div>
      <div className="text-helper text-muted mt-0.5">{label}</div>
    </div>
  );
}
