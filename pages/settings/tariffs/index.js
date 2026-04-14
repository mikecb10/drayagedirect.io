import { useEffect, useState, useMemo } from 'react';
import { useRouter } from 'next/router';
import { Search, Plus, Edit2, Trash2, Tag, ChevronRight } from 'lucide-react';
import SettingsLayout from '../../../components/settings/SettingsLayout';
import SubTabs from '../../../components/ui/SubTabs';
import Button from '../../../components/ui/Button';
import Alert from '../../../components/ui/Alert';

const STATUS_TABS = [
  { id: 'active', label: 'Active', icon: '⚡' },
  { id: 'pending', label: 'Pending', icon: '⏳' },
  { id: 'draft', label: 'Draft', icon: '📝' },
  { id: 'expired', label: 'Expired', icon: '⏰' },
];

const STATUS_BADGES = {
  active: 'bg-green-100 text-green-700',
  pending: 'bg-amber-100 text-amber-700',
  draft: 'bg-gray-100 text-gray-600',
  expired: 'bg-red-100 text-red-600',
};

export default function TariffsPage() {
  const router = useRouter();
  const [tariffs, setTariffs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('active');
  const [activeTab, setActiveTab] = useState('load_tariffs');

  async function fetchTariffs() {
    setLoading(true);
    try {
      const res = await fetch('/api/tenant/tariffs');
      if (!res.ok) throw new Error('Failed to load');
      const data = await res.json();
      setTariffs(data.tariffs || []);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { fetchTariffs(); }, []);

  // Count tariffs by status
  const statusCounts = useMemo(() => {
    const counts = { active: 0, pending: 0, draft: 0, expired: 0 };
    tariffs.forEach((t) => { if (counts[t.status] !== undefined) counts[t.status]++; });
    return counts;
  }, [tariffs]);

  // Filter
  const filtered = useMemo(() => {
    let list = tariffs.filter((t) => t.status === statusFilter);
    if (search) {
      const q = search.toLowerCase();
      list = list.filter((t) =>
        t.name.toLowerCase().includes(q) ||
        (t.customer_ids || []).length > 0
      );
    }
    return list;
  }, [tariffs, search, statusFilter]);

  async function handleDelete(id) {
    if (!confirm('Delete this load tariff?')) return;
    try {
      await fetch(`/api/tenant/tariffs/${id}`, { method: 'DELETE' });
      await fetchTariffs();
    } catch (e) {
      setError(e.message);
    }
  }

  function getCustomerLabel(tariff) {
    if (!tariff.customer_ids || tariff.customer_ids.length === 0) return 'All Customers';
    return `${tariff.customer_ids.length} Customer${tariff.customer_ids.length > 1 ? 's' : ''}`;
  }

  function getLocationLabel(conditions) {
    if (!conditions || conditions.all) return 'All Locations';
    if (conditions.ids?.length > 0) return `${conditions.ids.length} Location${conditions.ids.length > 1 ? 's' : ''}`;
    return 'All Locations';
  }

  function chargeSetCount(tariff) {
    return (tariff.charge_sets || []).length;
  }

  return (
    <SettingsLayout title="Load Tariffs">
      <div className="max-w-7xl space-y-4">
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
              <Tag className="w-5 h-5 text-blue-600" />
              Tariffs & Charge Profiles
            </h1>
            <p className="text-sm text-gray-500 mt-1">
              Define matching conditions that auto-apply charge profiles to loads.
            </p>
          </div>
          <Button onClick={() => router.push('/settings/tariffs/new')}>
            <Plus className="w-4 h-4 mr-1 inline" />
            Add Load Tariff
          </Button>
        </div>

        {error && <Alert type="error" message={error} onClose={() => setError(null)} />}

        {/* Sub tabs: Load Tariff | Charge Profiles */}
        <SubTabs
          tabs={[
            { id: 'load_tariffs', label: 'Load Tariff' },
            { id: 'charge_profiles', label: 'Charge Profiles' },
          ]}
          active={activeTab}
          onChange={(id) => {
            if (id === 'charge_profiles') router.push('/settings/charge-profiles');
            else setActiveTab(id);
          }}
        />

        {/* Status tabs — PP style with counts */}
        <div className="flex items-center gap-1 border-b border-gray-200">
          {STATUS_TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setStatusFilter(tab.id)}
              className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                statusFilter === tab.id
                  ? 'border-blue-600 text-blue-700'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              <span>{statusCounts[tab.id]}</span>
              <span>{tab.label}</span>
              <ChevronRight className="w-3 h-3 text-gray-400" />
            </button>
          ))}
        </div>

        {/* Filters row */}
        <div className="flex items-center gap-3 flex-wrap">
          <div className="relative flex-1 min-w-[200px] max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="text"
              placeholder="Search..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="block w-full rounded-lg border border-gray-300 bg-white pl-9 pr-3 py-2 text-sm focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
            />
          </div>
        </div>

        {/* Table */}
        <div className="rounded-xl border border-gray-200 bg-white">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50/60">
                  <th className="text-left px-4 py-2.5 font-semibold text-gray-600 text-xs uppercase tracking-wide">Load Tariff Name</th>
                  <th className="text-left px-4 py-2.5 font-semibold text-gray-600 text-xs uppercase tracking-wide">Customer</th>
                  <th className="text-left px-4 py-2.5 font-semibold text-gray-600 text-xs uppercase tracking-wide">Status</th>
                  <th className="text-left px-4 py-2.5 font-semibold text-gray-600 text-xs uppercase tracking-wide">Pick Up Location</th>
                  <th className="text-left px-4 py-2.5 font-semibold text-gray-600 text-xs uppercase tracking-wide">Delivery Location</th>
                  <th className="text-left px-4 py-2.5 font-semibold text-gray-600 text-xs uppercase tracking-wide">Return Location</th>
                  <th className="text-right px-4 py-2.5 font-semibold text-gray-600 text-xs uppercase tracking-wide"># of Charges</th>
                  <th className="w-20"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {loading ? (
                  <tr><td colSpan={8} className="px-4 py-10 text-center text-gray-400">Loading...</td></tr>
                ) : filtered.length === 0 ? (
                  <tr><td colSpan={8} className="px-4 py-10 text-center text-gray-400">
                    {statusFilter === 'draft' ? 'No draft tariffs' : `No ${statusFilter} tariffs found`}
                  </td></tr>
                ) : (
                  filtered.map((t) => (
                    <tr key={t.id} className="hover:bg-gray-50">
                      <td className="px-4 py-2.5">
                        <button
                          onClick={() => router.push(`/settings/tariffs/${t.id}`)}
                          className="text-sm font-medium text-blue-600 hover:text-blue-700 hover:underline"
                        >
                          {t.name}
                        </button>
                      </td>
                      <td className="px-4 py-2.5 text-xs text-gray-700">
                        {getCustomerLabel(t)}
                      </td>
                      <td className="px-4 py-2.5">
                        <span className={`text-[10px] uppercase tracking-wide font-semibold px-2 py-0.5 rounded ${STATUS_BADGES[t.status] || 'bg-gray-100 text-gray-600'}`}>
                          {t.status}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-xs text-gray-600">
                        {getLocationLabel(t.pickup_conditions)}
                      </td>
                      <td className="px-4 py-2.5 text-xs text-gray-600">
                        {getLocationLabel(t.delivery_conditions)}
                      </td>
                      <td className="px-4 py-2.5 text-xs text-gray-600">
                        {getLocationLabel(t.return_conditions)}
                      </td>
                      <td className="px-4 py-2.5 text-right font-semibold text-gray-900">
                        {chargeSetCount(t)}
                      </td>
                      <td className="px-2 py-2.5">
                        <div className="flex items-center gap-1 justify-end">
                          <button
                            onClick={() => router.push(`/settings/tariffs/${t.id}`)}
                            className="text-gray-400 hover:text-blue-600 p-1"
                          >
                            <Edit2 className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => handleDelete(t.id)}
                            className="text-gray-300 hover:text-red-500 p-1"
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
    </SettingsLayout>
  );
}
