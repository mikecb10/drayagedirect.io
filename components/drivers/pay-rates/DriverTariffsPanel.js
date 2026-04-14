import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import { Plus, Pencil, Trash2, Search } from 'lucide-react';
import Button from '../../ui/Button';
import Alert from '../../ui/Alert';
import Badge from '../../ui/Badge';

const STATUS_BADGES = {
  active: 'green', pending: 'amber', draft: 'gray', expired: 'red',
};

const LOAD_TYPE_OPTIONS = [
  { value: 'import', label: 'Import' },
  { value: 'inbound', label: 'Inbound' },
  { value: 'export', label: 'Export' },
  { value: 'outbound', label: 'Outbound' },
  { value: 'road', label: 'Road' },
  { value: 'bill_only', label: 'Bill Only' },
];

export default function DriverTariffsPanel() {
  const router = useRouter();
  const [tariffs, setTariffs] = useState([]);
  const [driverGroups, setDriverGroups] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState('');

  async function load() {
    setLoading(true);
    try {
      const [tRes, gRes] = await Promise.all([
        fetch(`/api/tenant/ap/tariffs${search ? `?search=${search}` : ''}`),
        fetch('/api/tenant/ap/driver-groups'),
      ]);
      if (tRes.ok) setTariffs((await tRes.json()).tariffs || []);
      if (gRes.ok) setDriverGroups((await gRes.json()).driver_groups || []);
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }

  useEffect(() => { load(); }, [search]);

  // Navigation — driver tariff form is a full page at
  // /settings/driver-tariffs/[id], mirroring AR tariff (/settings/tariffs/[id]).
  function openCreate() {
    router.push('/settings/driver-tariffs/new');
  }
  function openEdit(tariff) {
    router.push(`/settings/driver-tariffs/${tariff.id}`);
  }

  async function handleDelete(id) {
    if (!confirm('Delete this tariff?')) return;
    await fetch(`/api/tenant/ap/tariffs/${id}`, { method: 'DELETE' });
    load();
  }

  return (
    <div className="space-y-4">
      {error && <Alert type="error" message={error} onClose={() => setError(null)} />}

      <div className="flex items-center justify-between gap-3">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 dark:text-slate-500" />
          <input type="text" placeholder="Search tariffs..." value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="block w-full rounded-lg border border-gray-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-gray-900 dark:text-slate-100 placeholder-gray-400 dark:placeholder-slate-500 pl-9 pr-3 py-2 text-sm focus:outline-none focus:border-blue-500" />
        </div>
        <Button onClick={openCreate}>
          <Plus className="w-4 h-4 mr-1 inline -mt-0.5" /> Add Tariff
        </Button>
      </div>

      <div className="rounded-xl border border-gray-200 dark:border-slate-800 bg-white dark:bg-slate-900">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 dark:border-slate-800 bg-gray-50/60 dark:bg-slate-800/40">
                {['Tariff Name', 'Driver Group', 'Status', 'Priority', 'Load Types', 'Effective', 'Profiles', 'Actions'].map((h) => (
                  <th key={h} className="text-left px-4 py-2.5 font-semibold text-gray-600 dark:text-slate-300 text-xs uppercase tracking-wide">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50 dark:divide-slate-800">
              {loading ? (
                <tr><td colSpan={8} className="px-4 py-10 text-center text-gray-400 dark:text-slate-500">Loading...</td></tr>
              ) : tariffs.length === 0 ? (
                <tr><td colSpan={8} className="px-4 py-10 text-center text-gray-400 dark:text-slate-500">No driver tariffs yet. Create one to set up automated pay rates.</td></tr>
              ) : (
                tariffs.map((t) => {
                  const profileCount = (t.charge_sets || []).reduce((s, cs) => s + (cs.profiles || []).length, 0);
                  return (
                    <tr key={t.id} className="hover:bg-gray-50 dark:hover:bg-slate-800/40">
                      <td className="px-4 py-2.5 font-medium text-gray-900 dark:text-slate-100">{t.name}</td>
                      <td className="px-4 py-2.5 text-xs text-gray-500 dark:text-slate-400">{t.driver_group?.name || 'All'}</td>
                      <td className="px-4 py-2.5"><Badge variant={STATUS_BADGES[t.status] || 'gray'}>{t.status}</Badge></td>
                      <td className="px-4 py-2.5 text-xs text-gray-500 dark:text-slate-400">{t.priority}</td>
                      <td className="px-4 py-2.5 text-xs text-gray-500 dark:text-slate-400">
                        {(t.load_types || []).length > 0 ? t.load_types.join(', ') : 'All'}
                      </td>
                      <td className="px-4 py-2.5 text-xs text-gray-500 dark:text-slate-400">
                        {t.effective_start && t.effective_end
                          ? `${new Date(t.effective_start + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' })} – ${new Date(t.effective_end + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' })}`
                          : '—'}
                      </td>
                      <td className="px-4 py-2.5 text-xs text-gray-500 dark:text-slate-400">{profileCount} profile{profileCount !== 1 ? 's' : ''}</td>
                      <td className="px-4 py-2.5">
                        <div className="flex gap-1">
                          <button onClick={() => openEdit(t)}
                            className="p-1.5 text-gray-400 dark:text-slate-500 hover:text-blue-600 dark:hover:text-blue-400 rounded hover:bg-blue-50 dark:hover:bg-blue-950/40">
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                          <button onClick={() => handleDelete(t.id)}
                            className="p-1.5 text-gray-400 dark:text-slate-500 hover:text-red-500 dark:hover:text-red-400 rounded hover:bg-red-50 dark:hover:bg-red-950/40">
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
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
