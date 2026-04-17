import { useEffect, useState, useMemo } from 'react';
import { useRouter } from 'next/router';
import { Search, Plus, Edit2, Trash2, Truck } from 'lucide-react';
import SettingsLayout from '../../../components/settings/SettingsLayout';
import Button from '../../../components/ui/Button';
import Alert from '../../../components/ui/Alert';
import Badge from '../../../components/ui/Badge';

const STATUS_BADGES = {
  active: 'green', pending: 'amber', draft: 'gray', expired: 'red',
};

export default function DriverTariffsPage() {
  const router = useRouter();
  const [tariffs, setTariffs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState('');

  async function fetchTariffs() {
    setLoading(true);
    try {
      const res = await fetch(`/api/tenant/ap/tariffs${search ? `?search=${encodeURIComponent(search)}` : ''}`);
      if (!res.ok) throw new Error('Failed to load driver tariffs');
      const data = await res.json();
      setTariffs(data.tariffs || []);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { fetchTariffs(); }, [search]); // eslint-disable-line react-hooks/exhaustive-deps

  const filtered = useMemo(() => {
    if (!search) return tariffs;
    const q = search.toLowerCase();
    return tariffs.filter((t) =>
      t.name.toLowerCase().includes(q) ||
      (t.driver_group?.name || '').toLowerCase().includes(q)
    );
  }, [tariffs, search]);

  async function handleDelete(id) {
    if (!confirm('Delete this driver tariff?')) return;
    try {
      const res = await fetch(`/api/tenant/ap/tariffs/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Failed to delete');
      await fetchTariffs();
    } catch (e) {
      setError(e.message);
    }
  }

  return (
    <SettingsLayout title="Driver Tariffs">
      <div className="max-w-7xl space-y-4">
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-lg font-semibold text-gray-900 dark:text-slate-100 flex items-center gap-2">
              <Truck className="w-5 h-5 text-blue-600" />
              Driver Tariffs
            </h1>
            <p className="text-sm text-gray-500 dark:text-slate-400 mt-1">
              Define matching conditions that auto-apply driver pay rates to loads.
            </p>
          </div>
          <Button onClick={() => router.push('/settings/driver-tariffs/new')}>
            <Plus className="w-4 h-4 mr-1 inline" />
            Add Tariff
          </Button>
        </div>

        {error && <Alert type="error" message={error} onClose={() => setError(null)} />}

        {/* Search */}
        <div className="flex items-center gap-3 flex-wrap">
          <div className="relative flex-1 min-w-[200px] max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 dark:text-slate-500" />
            <input
              type="text"
              placeholder="Search tariffs..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="block w-full rounded-lg border border-gray-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-gray-900 dark:text-slate-100 placeholder-gray-400 dark:placeholder-slate-500 pl-9 pr-3 py-2 text-sm focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 dark:focus:ring-blue-900/40"
            />
          </div>
        </div>

        {/* Table */}
        <div className="rounded-xl border border-gray-200 dark:border-slate-800 bg-white dark:bg-slate-900">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 dark:border-slate-800 bg-gray-50/60 dark:bg-slate-800/40">
                  {['Tariff Name', 'Driver Group', 'Status', 'Priority', 'Load Types', 'Effective', 'Profiles', ''].map((h) => (
                    <th
                      key={h}
                      className={`text-left px-4 py-2.5 font-semibold text-gray-600 dark:text-slate-300 text-xs uppercase tracking-wide${h === '' ? ' w-20' : ''}`}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50 dark:divide-slate-800">
                {loading ? (
                  <tr>
                    <td colSpan={8} className="px-4 py-10 text-center text-gray-400 dark:text-slate-500">Loading...</td>
                  </tr>
                ) : filtered.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="px-4 py-10 text-center text-gray-400 dark:text-slate-500">
                      {search ? 'No tariffs match your search.' : 'No driver tariffs yet. Create one to set up automated pay rates.'}
                    </td>
                  </tr>
                ) : (
                  filtered.map((t) => {
                    const profileCount = (t.charge_sets || []).reduce((s, cs) => s + (cs.profiles || []).length, 0);
                    return (
                      <tr key={t.id} className="hover:bg-gray-50 dark:hover:bg-slate-800/40">
                        <td className="px-4 py-2.5">
                          <button
                            onClick={() => router.push(`/settings/driver-tariffs/${t.id}`)}
                            className="text-sm font-medium text-blue-600 hover:text-blue-700 hover:underline"
                          >
                            {t.name}
                          </button>
                        </td>
                        <td className="px-4 py-2.5 text-xs text-gray-500 dark:text-slate-400">
                          {t.driver_group?.name || 'All'}
                        </td>
                        <td className="px-4 py-2.5">
                          <Badge variant={STATUS_BADGES[t.status] || 'gray'}>{t.status}</Badge>
                        </td>
                        <td className="px-4 py-2.5 text-xs text-gray-500 dark:text-slate-400">{t.priority}</td>
                        <td className="px-4 py-2.5 text-xs text-gray-500 dark:text-slate-400">
                          {(t.load_types || []).length > 0 ? t.load_types.join(', ') : 'All'}
                        </td>
                        <td className="px-4 py-2.5 text-xs text-gray-500 dark:text-slate-400">
                          {t.effective_start && t.effective_end
                            ? `${new Date(t.effective_start + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' })} – ${new Date(t.effective_end + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' })}`
                            : '—'}
                        </td>
                        <td className="px-4 py-2.5 text-xs text-gray-500 dark:text-slate-400">
                          {profileCount} profile{profileCount !== 1 ? 's' : ''}
                        </td>
                        <td className="px-2 py-2.5">
                          <div className="flex items-center gap-1 justify-end">
                            <button
                              onClick={() => router.push(`/settings/driver-tariffs/${t.id}`)}
                              className="text-gray-400 dark:text-slate-500 hover:text-blue-600 dark:hover:text-blue-400 p-1 rounded hover:bg-blue-50 dark:hover:bg-blue-950/40"
                            >
                              <Edit2 className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={() => handleDelete(t.id)}
                              className="text-gray-300 dark:text-slate-600 hover:text-red-500 dark:hover:text-red-400 p-1 rounded hover:bg-red-50 dark:hover:bg-red-950/40"
                            >
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
    </SettingsLayout>
  );
}
