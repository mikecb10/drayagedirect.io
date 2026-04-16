import { useEffect, useState, useMemo } from 'react';
import { Search, Check } from 'lucide-react';
import Modal from '../../ui/Modal';
import Button from '../../ui/Button';
import { CHARGE_NAMES, chargeNameLabel, unitLabel, formatCents } from '../../../lib/charge-profile-constants';

/**
 * ChargeProfilePickerModal — modal for selecting one or more existing
 * charge profiles to attach to a tariff's charge set.
 *
 * Originally defined inside pages/settings/tariffs/[id].js (line 744).
 * Extracted to its own file in Plan G1 with no behavior change.
 *
 * Props (unchanged from inline version):
 *   isOpen        - boolean
 *   onClose       - () => void
 *   onSelect      - (profiles: ChargeProfile[]) => void
 *   existingIds   - charge_profile.id[] already attached (filtered out)
 */
export default function ChargeProfilePickerModal({ isOpen, onClose, onSelect, existingIds = [] }) {
  const [profiles, setProfiles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filterCharge, setFilterCharge] = useState('');
  const [filterTag, setFilterTag] = useState('');
  const [selected, setSelected] = useState(new Set());

  useEffect(() => {
    if (!isOpen) return;
    setSelected(new Set());
    setSearch('');
    setFilterCharge('');
    setFilterTag('');
    setLoading(true);
    fetch('/api/tenant/charge-profiles?enabled=true')
      .then((r) => r.ok ? r.json() : { profiles: [] })
      .then((d) => setProfiles(d.profiles || []))
      .catch(() => setProfiles([]))
      .finally(() => setLoading(false));
  }, [isOpen]);

  // Collect all unique tags from profiles
  const allTags = useMemo(() => {
    const tags = new Set();
    for (const p of profiles) {
      if (p.tags?.length > 0) p.tags.forEach((t) => tags.add(t));
      else if (p.tag) tags.add(p.tag);
    }
    return [...tags].sort();
  }, [profiles]);

  const filtered = useMemo(() => {
    let list = profiles;
    if (existingIds.length > 0) {
      const existing = new Set(existingIds);
      list = list.filter((p) => !existing.has(p.id));
    }
    if (filterCharge) list = list.filter((p) => p.charge_name === filterCharge);
    if (filterTag) list = list.filter((p) => (p.tags || []).includes(filterTag) || p.tag === filterTag);
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
  }, [profiles, search, filterCharge, filterTag, existingIds]);

  function selectAllFiltered() {
    setSelected((prev) => {
      const arr = [...prev];
      for (const p of filtered) {
        if (!arr.includes(p.id)) arr.push(p.id);
      }
      return new Set(arr);
    });
  }

  function deselectAll() {
    setSelected(new Set());
  }

  function toggleProfile(id) {
    setSelected((prev) => {
      const arr = [...prev];
      const idx = arr.indexOf(id);
      if (idx >= 0) arr.splice(idx, 1);
      else arr.push(id);
      return new Set(arr);
    });
  }

  function handleConfirm() {
    const selectedProfiles = profiles.filter((p) => selected.has(p.id));
    onSelect(selectedProfiles);
  }

  function getCurrentAmount(profile) {
    const versions = profile.versions || [];
    const tiers = profile.tiers || [];
    const today = new Date().toISOString().slice(0, 10);
    if (versions.length > 0) {
      const v = versions.find((v) => (!v.effective_from || v.effective_from <= today) && (!v.effective_to || v.effective_to >= today)) || versions[0];
      const t = v.tiers?.[0];
      if (t) return profile.unit_of_measure === 'percentage' ? `${(t.amount_cents / 100).toFixed(2)}%` : formatCents(t.amount_cents);
    }
    if (tiers.length > 0) {
      const t = tiers[0];
      return profile.unit_of_measure === 'percentage' ? `${(t.amount_cents / 100).toFixed(2)}%` : formatCents(t.amount_cents);
    }
    return '—';
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Select Charge Profiles" size="xl">
      <div className="space-y-4">
        {/* Search + filters */}
        <div className="flex items-center gap-3 flex-wrap">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 dark:text-slate-500" />
            <input type="text" placeholder="Search profiles..." value={search} onChange={(e) => setSearch(e.target.value)}
              className="block w-full rounded-lg border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-900 pl-9 pr-3 py-2 text-sm focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 dark:focus:ring-blue-900/40" />
          </div>
          <select value={filterCharge} onChange={(e) => setFilterCharge(e.target.value)}
            className="rounded-lg border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-900 px-3 py-2 text-sm">
            <option value="">All Charge Names</option>
            {CHARGE_NAMES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
          </select>
          {allTags.length > 0 && (
            <select value={filterTag} onChange={(e) => setFilterTag(e.target.value)}
              className="rounded-lg border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-900 px-3 py-2 text-sm">
              <option value="">All Tags</option>
              {allTags.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          )}
        </div>
        {/* Select all / deselect */}
        <div className="flex items-center gap-3">
          <button type="button" onClick={selectAllFiltered} className="text-xs text-blue-600 dark:text-blue-400 hover:text-blue-700 font-medium">
            Select All ({filtered.length})
          </button>
          {selected.size > 0 && (
            <button type="button" onClick={deselectAll} className="text-xs text-gray-500 dark:text-slate-400 hover:text-gray-700 dark:hover:text-slate-200 font-medium">
              Deselect All
            </button>
          )}
        </div>

        {/* Profile list */}
        <div className="border border-gray-200 dark:border-slate-700 rounded-lg max-h-[400px] overflow-y-auto">
          {loading ? (
            <div className="px-4 py-10 text-center text-sm text-gray-400 dark:text-slate-500">Loading...</div>
          ) : filtered.length === 0 ? (
            <div className="px-4 py-10 text-center text-sm text-gray-400 dark:text-slate-500">
              {profiles.length === 0 ? 'No charge profiles exist yet. Create one in Settings → Charge Profiles.' : 'No profiles match your search.'}
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 dark:bg-slate-900 border-b border-gray-100 dark:border-slate-800">
                  <th className="w-10 px-3 py-2"></th>
                  <th className="text-left px-3 py-2 text-[10px] font-semibold text-gray-500 dark:text-slate-400 uppercase">Charge Profile</th>
                  <th className="text-left px-3 py-2 text-[10px] font-semibold text-gray-500 dark:text-slate-400 uppercase">Charge Code</th>
                  <th className="text-left px-3 py-2 text-[10px] font-semibold text-gray-500 dark:text-slate-400 uppercase">UOM</th>
                  <th className="text-right px-3 py-2 text-[10px] font-semibold text-gray-500 dark:text-slate-400 uppercase">Amount</th>
                  <th className="text-left px-3 py-2 text-[10px] font-semibold text-gray-500 dark:text-slate-400 uppercase">Tags</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50 dark:divide-slate-800">
                {filtered.map((p) => {
                  const isChecked = selected.has(p.id);
                  const tags = p.tags?.length > 0 ? p.tags : (p.tag ? [p.tag] : []);
                  return (
                    <tr key={p.id} onClick={() => toggleProfile(p.id)}
                      className={`cursor-pointer transition-colors ${isChecked ? 'bg-blue-50 dark:bg-blue-950/40' : 'hover:bg-gray-50 dark:hover:bg-slate-800'}`}>
                      <td className="px-3 py-2 text-center" onClick={(e) => e.stopPropagation()}>
                        <input type="checkbox" checked={isChecked} onChange={() => toggleProfile(p.id)}
                          className="rounded border-gray-300 dark:border-slate-600 text-blue-600 w-4 h-4 cursor-pointer" />
                      </td>
                      <td className="px-3 py-2">
                        <div className="font-medium text-gray-900 dark:text-slate-100 text-xs">{p.name}</div>
                        {p.description && <div className="text-[10px] text-gray-400 dark:text-slate-500 truncate max-w-[200px]">{p.description}</div>}
                      </td>
                      <td className="px-3 py-2 text-xs text-gray-600 dark:text-slate-300">{chargeNameLabel(p.charge_name)}</td>
                      <td className="px-3 py-2 text-xs text-gray-600 dark:text-slate-300">{unitLabel(p.unit_of_measure)}</td>
                      <td className="px-3 py-2 text-right text-xs font-semibold text-gray-900 dark:text-slate-100">{getCurrentAmount(p)}</td>
                      <td className="px-3 py-2">
                        <div className="flex gap-1">
                          {tags.map((t, i) => (
                            <span key={i} className="text-[9px] uppercase font-semibold bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 px-1 py-0.5 rounded">{t}</span>
                          ))}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        {/* Selection summary + confirm */}
        <div className="flex items-center justify-between pt-2 border-t border-gray-200 dark:border-slate-700">
          <span className="text-xs text-gray-500 dark:text-slate-400">
            {selected.size > 0 ? `${selected.size} profile${selected.size > 1 ? 's' : ''} selected` : 'Click profiles to select them'}
          </span>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={onClose}>Cancel</Button>
            <Button onClick={handleConfirm} disabled={selected.size === 0}>
              <Check className="w-4 h-4 mr-1 inline" /> Add Selected ({selected.size})
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
