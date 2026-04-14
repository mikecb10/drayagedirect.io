import { useEffect, useState } from 'react';
import { Calculator, Plus, Edit2, Trash2, Ship, Building2, Package } from 'lucide-react';
import SettingsLayout from '../../components/settings/SettingsLayout';
import Button from '../../components/ui/Button';
import Alert from '../../components/ui/Alert';
import Select from '../../components/ui/Select';
import PerDiemRuleModal from '../../components/settings/PerDiemRuleModal';


const LOAD_TYPE_OPTIONS = [
  { value: '', label: 'All Load Types' },
  { value: 'import', label: 'Import' },
  { value: 'inbound', label: 'Inbound' },
  { value: 'export', label: 'Export' },
  { value: 'outbound', label: 'Outbound' },
  { value: 'road', label: 'Road' },
];

function formatCents(cents) {
  if (cents == null) return '$0.00';
  return `$${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function summarizeTiers(tiers) {
  if (!tiers || tiers.length === 0) return '—';
  if (tiers.length === 1) {
    const t = tiers[0];
    const range = t.to_day ? `Days ${t.from_day}-${t.to_day}` : `Day ${t.from_day}+`;
    return `${range}: ${formatCents(t.amount_cents)}/day`;
  }
  return `${tiers.length} tiers · ${formatCents(tiers[0].amount_cents)} → ${formatCents(tiers[tiers.length - 1].amount_cents)}/day`;
}

export default function PerDiemSettings() {
  const [rules, setRules] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [filter, setFilter] = useState({ load_type: '' });
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (filter.load_type) params.set('load_type', filter.load_type);
      const res = await fetch(`/api/tenant/per-diem-rules?${params}`);
      if (!res.ok) throw new Error('Failed to load rules');
      const data = await res.json();
      setRules(data.rules || []);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter]);

  function openNew() {
    setEditing(null);
    setModalOpen(true);
  }

  function openEdit(rule) {
    setEditing(rule);
    setModalOpen(true);
  }

  async function handleDelete(rule) {
    if (!confirm(`Delete per diem rule "${rule.name || 'unnamed'}"?`)) return;
    try {
      const res = await fetch(`/api/tenant/per-diem-rules/${rule.id}`, {
        method: 'DELETE',
      });
      if (!res.ok) throw new Error('Failed to delete rule');
      await load();
    } catch (e) {
      setError(e.message);
    }
  }

  async function toggleEnabled(rule) {
    try {
      const res = await fetch(`/api/tenant/per-diem-rules/${rule.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_enabled: !rule.is_enabled }),
      });
      if (!res.ok) throw new Error('Failed to toggle rule');
      await load();
    } catch (e) {
      setError(e.message);
    }
  }

  const enabledCount = rules.filter((r) => r.is_enabled).length;

  return (
    <SettingsLayout
      title="Per Diem Pricing"
    >
      <div className="max-w-6xl space-y-4">
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-slate-100 flex items-center gap-2">
              <Calculator className="w-6 h-6 text-blue-600" />
              Per Diem Free Day Pricing
            </h1>
            <p className="text-sm text-gray-500 dark:text-slate-400 mt-1">
              Configure tiered per-diem rates by Customer × Steamship Line × Container
              Type × Load Type. When a load sits past its free days, the matching rule's
              tiers will be charged.
            </p>
          </div>
          <Button onClick={openNew}>
            <Plus className="w-4 h-4 mr-1 inline -mt-0.5" />
            Add Per Diem Rule
          </Button>
        </div>

        {error && <Alert type="error" message={error} />}

        {/* Stats */}
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          <div className="rounded-xl border border-gray-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-3">
            <div className="text-[11px] uppercase tracking-wide text-gray-500 dark:text-slate-400">
              Total Rules
            </div>
            <div className="text-2xl font-bold text-gray-900 dark:text-slate-100">{rules.length}</div>
          </div>
          <div className="rounded-xl border border-gray-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-3">
            <div className="text-[11px] uppercase tracking-wide text-gray-500 dark:text-slate-400">Enabled</div>
            <div className="text-2xl font-bold text-emerald-600">{enabledCount}</div>
          </div>
          <div className="rounded-xl border border-gray-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-3">
            <div className="text-[11px] uppercase tracking-wide text-gray-500 dark:text-slate-400">Disabled</div>
            <div className="text-2xl font-bold text-gray-400 dark:text-slate-500">
              {rules.length - enabledCount}
            </div>
          </div>
        </div>

        {/* Filter */}
        <div className="flex gap-3 items-end">
          <Select
            label="Filter by Load Type"
            value={filter.load_type}
            onChange={(e) => setFilter({ ...filter, load_type: e.target.value })}
            options={LOAD_TYPE_OPTIONS}
            className="w-48"
          />
        </div>

        {/* Rules table */}
        <div className="rounded-xl border border-gray-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 dark:bg-slate-800/50 text-[11px] uppercase tracking-wide text-gray-500 dark:text-slate-400">
                <tr>
                  <th className="text-left px-4 py-2">Name</th>
                  <th className="text-left px-4 py-2">Customer</th>
                  <th className="text-left px-4 py-2">SSL</th>
                  <th className="text-left px-4 py-2">Container Type</th>
                  <th className="text-left px-4 py-2">Load Type</th>
                  <th className="text-left px-4 py-2">Tiers</th>
                  <th className="text-center px-4 py-2">Enabled</th>
                  <th className="w-20"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-slate-800">
                {loading ? (
                  <tr>
                    <td colSpan={8} className="px-4 py-10 text-center text-sm text-gray-400 dark:text-slate-500">
                      Loading...
                    </td>
                  </tr>
                ) : rules.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="px-4 py-10 text-center text-sm text-gray-400 dark:text-slate-500">
                      No per diem rules yet. Click "Add Per Diem Rule" to create one.
                    </td>
                  </tr>
                ) : (
                  rules.map((r) => (
                    <tr
                      key={r.id}
                      className={`hover:bg-gray-50 dark:hover:bg-slate-800/60 ${r.is_enabled ? '' : 'opacity-50'}`}
                    >
                      <td className="px-4 py-2 font-medium text-gray-900 dark:text-slate-100">
                        {r.name || <span className="text-gray-400 dark:text-slate-500 italic">Unnamed</span>}
                      </td>
                      <td className="px-4 py-2 text-xs text-gray-700 dark:text-slate-200">
                        {r.customer ? (
                          <span className="flex items-center gap-1">
                            <Building2 className="w-3 h-3 text-gray-400 dark:text-slate-500" />
                            {r.customer.name}
                          </span>
                        ) : (
                          <span className="text-gray-300 dark:text-slate-600">Any</span>
                        )}
                      </td>
                      <td className="px-4 py-2 text-xs text-gray-700 dark:text-slate-200">
                        {r.owner ? (
                          <span className="flex items-center gap-1">
                            <Ship className="w-3 h-3 text-gray-400 dark:text-slate-500" />
                            {r.owner.label || r.owner.name}
                            {r.owner.scac_code && (
                              <span className="text-[9px] uppercase tracking-wide font-mono bg-blue-50 text-blue-700 px-1 rounded">
                                {r.owner.scac_code}
                              </span>
                            )}
                          </span>
                        ) : (
                          <span className="text-gray-300 dark:text-slate-600">Any</span>
                        )}
                      </td>
                      <td className="px-4 py-2 text-xs text-gray-700 dark:text-slate-200">
                        {r.container_type ? (
                          <span className="flex items-center gap-1">
                            <Package className="w-3 h-3 text-gray-400 dark:text-slate-500" />
                            {r.container_type.code}
                          </span>
                        ) : (
                          <span className="text-gray-300 dark:text-slate-600">Any</span>
                        )}
                      </td>
                      <td className="px-4 py-2 text-xs text-gray-700 dark:text-slate-200 capitalize">
                        {r.load_type ? (
                          r.load_type.replace('_', ' ')
                        ) : (
                          <span className="text-gray-300 dark:text-slate-600">Any</span>
                        )}
                      </td>
                      <td className="px-4 py-2 text-xs text-gray-700 dark:text-slate-200">
                        {summarizeTiers(r.tiers)}
                      </td>
                      <td className="px-4 py-2">
                        <button
                          type="button"
                          onClick={() => toggleEnabled(r)}
                          className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                            r.is_enabled ? 'bg-blue-600' : 'bg-gray-300 dark:bg-slate-700'
                          }`}
                          title={r.is_enabled ? 'Disable rule' : 'Enable rule'}
                        >
                          <span
                            className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${
                              r.is_enabled ? 'translate-x-5' : 'translate-x-1'
                            }`}
                          />
                        </button>
                      </td>
                      <td className="px-2 py-2 text-right">
                        <div className="flex items-center gap-1 justify-end">
                          <button
                            onClick={() => openEdit(r)}
                            className="text-gray-400 dark:text-slate-500 hover:text-blue-600"
                            title="Edit"
                          >
                            <Edit2 className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => handleDelete(r)}
                            className="text-gray-300 dark:text-slate-600 hover:text-red-500"
                            title="Delete"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <PerDiemRuleModal
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        editing={editing}
        onSaved={load}
      />
    </SettingsLayout>
  );
}
