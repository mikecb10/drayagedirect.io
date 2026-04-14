import { useEffect, useState, useMemo } from 'react';
import { useRouter } from 'next/router';
import { Search, Plus, Edit2, Trash2, DollarSign, Calendar, Tag } from 'lucide-react';
import SettingsLayout from '../../../components/settings/SettingsLayout';
import SubTabs from '../../../components/ui/SubTabs';
import Button from '../../../components/ui/Button';
import Alert from '../../../components/ui/Alert';
import { CHARGE_NAMES, UNITS_OF_MEASURE, chargeNameLabel, unitLabel, formatCents } from '../../../lib/charge-profile-constants';

export default function ChargeProfilesPage() {
  const router = useRouter();
  const [profiles, setProfiles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState('');
  const [filterChargeName, setFilterChargeName] = useState('');
  const [activeTab, setActiveTab] = useState('charge_profiles');

  async function fetchProfiles() {
    setLoading(true);
    try {
      const res = await fetch('/api/tenant/charge-profiles');
      if (!res.ok) throw new Error('Failed to load');
      const data = await res.json();
      setProfiles(data.profiles || []);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { fetchProfiles(); }, []);

  const filtered = useMemo(() => {
    let list = profiles;
    if (filterChargeName) list = list.filter((p) => p.charge_name === filterChargeName);
    if (search) {
      const q = search.toLowerCase();
      list = list.filter((p) =>
        p.name.toLowerCase().includes(q) ||
        p.charge_name.toLowerCase().includes(q) ||
        (p.description || '').toLowerCase().includes(q) ||
        (p.tags || []).some((t) => t.toLowerCase().includes(q))
      );
    }
    return list;
  }, [profiles, search, filterChargeName]);

  async function handleDelete(id) {
    if (!confirm('Delete this charge profile?')) return;
    try {
      await fetch(`/api/tenant/charge-profiles/${id}`, { method: 'DELETE' });
      await fetchProfiles();
    } catch (e) {
      setError(e.message);
    }
  }

  // Get the current active version's first tier amount for display
  function currentAmount(profile) {
    // Try versions first (new structure)
    const versions = profile.versions || [];
    const today = new Date().toISOString().slice(0, 10);

    if (versions.length > 0) {
      const activeVersion = versions.find((v) =>
        (!v.effective_from || v.effective_from <= today) &&
        (!v.effective_to || v.effective_to >= today)
      ) || versions[0];
      const tiers = activeVersion.tiers || [];
      if (tiers.length > 0) {
        const tier = tiers[0];
        if (profile.unit_of_measure === 'percentage') {
          return `${(tier.amount_cents / 100).toFixed(2)}%`;
        }
        return formatCents(tier.amount_cents);
      }
    }

    // Fallback to flat tiers (legacy)
    const tiers = profile.tiers || [];
    if (tiers.length === 0) return '\u2014';
    const active = tiers.find((t) =>
      (!t.start_date || t.start_date <= today) &&
      (!t.end_date || t.end_date >= today)
    ) || tiers[0];
    if (profile.unit_of_measure === 'percentage') {
      return `${(active.amount_cents / 100).toFixed(2)}%`;
    }
    return formatCents(active.amount_cents);
  }

  function currentMin(profile) {
    const versions = profile.versions || [];
    if (versions.length > 0) {
      const tiers = versions[0]?.tiers || [];
      if (tiers.length > 0) return formatCents(tiers[0].minimum_amount_cents);
    }
    const tiers = profile.tiers || [];
    if (tiers.length === 0) return '\u2014';
    return formatCents(tiers[0].minimum_amount_cents);
  }

  function versionCount(profile) {
    return (profile.versions || []).length;
  }

  function displayTags(profile) {
    return profile.tags?.length > 0 ? profile.tags : (profile.tag ? [profile.tag] : []);
  }

  return (
    <SettingsLayout title="Tariffs & Charge Profiles">
      <div className="max-w-7xl space-y-4">
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-lg font-semibold text-gray-900 dark:text-slate-100 flex items-center gap-2">
              <DollarSign className="w-5 h-5 text-blue-600" />
              Tariffs & Charge Profiles
            </h1>
            <p className="text-sm text-gray-500 dark:text-slate-400 mt-1">
              Manage reusable charge profiles and load tariffs that auto-apply rates to loads.
            </p>
          </div>
          <Button onClick={() => router.push('/settings/charge-profiles/new')}>
            <Plus className="w-4 h-4 mr-1 inline" />
            Add New
          </Button>
        </div>

        {error && <Alert type="error" message={error} onClose={() => setError(null)} />}

        <SubTabs
          tabs={[
            { id: 'load_tariffs', label: 'Load Tariffs' },
            { id: 'charge_profiles', label: 'Charge Profiles' },
          ]}
          active={activeTab}
          onChange={(id) => {
            if (id === 'load_tariffs') router.push('/settings/tariffs');
            else setActiveTab(id);
          }}
        />

        {/* Filters */}
        <div className="flex items-center gap-3 flex-wrap">
          <div className="relative flex-1 min-w-[200px] max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 dark:text-slate-500" />
            <input
              type="text"
              placeholder="Search profiles..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="block w-full rounded-lg border border-gray-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-gray-900 dark:text-slate-100 dark:text-slate-100 placeholder-gray-400 dark:placeholder-slate-500 pl-9 pr-3 py-2 text-sm focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 dark:focus:ring-blue-900/40"
            />
          </div>
          <select
            value={filterChargeName}
            onChange={(e) => setFilterChargeName(e.target.value)}
            className="rounded-lg border border-gray-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-gray-900 dark:text-slate-100 dark:text-slate-100 px-3 py-2 text-sm"
          >
            <option value="">All Charge Names</option>
            {CHARGE_NAMES.map((c) => (
              <option key={c.value} value={c.value}>{c.label}</option>
            ))}
          </select>
        </div>

        {/* Table */}
        <div className="rounded-xl border border-gray-200 dark:border-slate-800 bg-white dark:bg-slate-900">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 dark:border-slate-800 bg-gray-50/60 dark:bg-slate-800/60">
                  <th className="text-left px-4 py-2.5 font-semibold text-gray-600 dark:text-slate-300 text-xs uppercase tracking-wide">Charge Profile</th>
                  <th className="text-left px-4 py-2.5 font-semibold text-gray-600 dark:text-slate-300 text-xs uppercase tracking-wide">Charge Code</th>
                  <th className="text-left px-4 py-2.5 font-semibold text-gray-600 dark:text-slate-300 text-xs uppercase tracking-wide">UOM</th>
                  <th className="text-left px-4 py-2.5 font-semibold text-gray-600 dark:text-slate-300 text-xs uppercase tracking-wide">Tags</th>
                  <th className="text-right px-4 py-2.5 font-semibold text-gray-600 dark:text-slate-300 text-xs uppercase tracking-wide">Per Unit</th>
                  <th className="text-right px-4 py-2.5 font-semibold text-gray-600 dark:text-slate-300 text-xs uppercase tracking-wide">Min</th>
                  <th className="text-center px-4 py-2.5 font-semibold text-gray-600 dark:text-slate-300 text-xs uppercase tracking-wide">Versions</th>
                  <th className="text-center px-4 py-2.5 font-semibold text-gray-600 dark:text-slate-300 text-xs uppercase tracking-wide">Auto</th>
                  <th className="w-20"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50 dark:divide-slate-800">
                {loading ? (
                  <tr><td colSpan={9} className="px-4 py-10 text-center text-gray-400 dark:text-slate-500">Loading...</td></tr>
                ) : filtered.length === 0 ? (
                  <tr><td colSpan={9} className="px-4 py-10 text-center text-gray-400 dark:text-slate-500">No charge profiles found</td></tr>
                ) : (
                  filtered.map((p) => {
                    const tags = displayTags(p);
                    return (
                      <tr key={p.id} className="hover:bg-gray-50 dark:hover:bg-slate-800/60">
                        <td className="px-4 py-2.5">
                          <button
                            onClick={() => router.push(`/settings/charge-profiles/${p.id}`)}
                            className="text-sm font-medium text-blue-600 hover:text-blue-700 hover:underline"
                          >
                            {p.name}
                          </button>
                          {p.description && (
                            <div className="text-[11px] text-gray-500 dark:text-slate-400 truncate max-w-[180px]">{p.description}</div>
                          )}
                        </td>
                        <td className="px-4 py-2.5">
                          <span className="text-xs font-semibold uppercase text-gray-500 dark:text-slate-400">
                            {chargeNameLabel(p.charge_name)}
                          </span>
                        </td>
                        <td className="px-4 py-2.5">
                          <span className="text-xs text-gray-700 dark:text-slate-200">{unitLabel(p.unit_of_measure)}</span>
                        </td>
                        <td className="px-4 py-2.5">
                          <div className="flex flex-wrap gap-1">
                            {tags.length > 0 ? tags.map((t, i) => (
                              <span key={i} className="text-[10px] uppercase tracking-wide font-semibold bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded">
                                {t}
                              </span>
                            )) : <span className="text-gray-400 dark:text-slate-500">&mdash;</span>}
                          </div>
                        </td>
                        <td className="px-4 py-2.5 text-right font-semibold text-gray-900 dark:text-slate-100 text-xs">
                          {currentAmount(p)}
                        </td>
                        <td className="px-4 py-2.5 text-right text-xs text-gray-500 dark:text-slate-400">
                          {currentMin(p)}
                        </td>
                        <td className="px-4 py-2.5 text-center">
                          {versionCount(p) > 0 ? (
                            <span className="inline-flex items-center gap-0.5 text-[10px] font-semibold text-gray-600 dark:text-slate-300 bg-gray-100 dark:bg-slate-800 px-1.5 py-0.5 rounded">
                              <Calendar className="w-3 h-3" />
                              {versionCount(p)}
                            </span>
                          ) : <span className="text-gray-400 dark:text-slate-500">&mdash;</span>}
                        </td>
                        <td className="px-4 py-2.5 text-center">
                          {p.auto_add ? (
                            <span className="text-[10px] font-semibold text-emerald-700 bg-emerald-100 px-1.5 py-0.5 rounded">Yes</span>
                          ) : (
                            <span className="text-[10px] text-gray-400 dark:text-slate-500">No</span>
                          )}
                        </td>
                        <td className="px-2 py-2.5">
                          <div className="flex items-center gap-1 justify-end">
                            <button
                              onClick={() => router.push(`/settings/charge-profiles/${p.id}`)}
                              className="text-gray-400 dark:text-slate-500 hover:text-blue-600 p-1"
                            >
                              <Edit2 className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={() => handleDelete(p.id)}
                              className="text-gray-300 dark:text-slate-600 hover:text-red-500 p-1"
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
