import { useEffect, useState, useMemo } from 'react';
import { useRouter } from 'next/router';
import {
  Plus, Trash2, Tag, Edit2, Copy, ChevronDown,
} from 'lucide-react';
import Link from 'next/link';
import SettingsLayout from '../../../components/settings/SettingsLayout';
import Select from '../../../components/ui/Select';
import Button from '../../../components/ui/Button';
import Alert from '../../../components/ui/Alert';
import OrgPicker from '../../../components/ui/OrgPicker';
import CentsInput from '../../../components/ui/CentsInput';
import DatePicker from '../../../components/ui/DatePicker';
import RulesPanel from '../../../components/settings/charge-profile-detail/RulesPanel';
import {
  CHARGE_NAMES,
  UNITS_OF_MEASURE,
  EFFECTIVE_DATE_OPTIONS,
  STATUS_OPTIONS,
  EVENT_TYPES,
  EVENT_TIME_OPTIONS,
  MOVE_CALC_FROM,
  MOVE_CALC_TO,
  RADIUS_RATE_TYPES,
  getModesForUOM,
} from '../../../lib/charge-profile-constants';
import {
  emptyRowForMode,
  newVersion,
} from '../../../lib/charge-profile-row-shapes';
import TagInput from '../../../components/settings/charge-profile-detail/TagInput';
import LaneLocationCell from '../../../components/settings/charge-profile-detail/LaneLocationCell';
import MatchResolutionPanel from '../../../components/settings/charge-profile-detail/MatchResolutionPanel';

// ═══════════════════════════════════════════════════════════════
// MAIN FORM — mirrors PortPro layout
// ═══════════════════════════════════════════════════════════════
export default function ChargeProfileForm({ chargeProfileId: propId, onClose: onCloseProp }) {
  const router = useRouter();
  const id = propId || router.query.id;
  const isNew = id === 'new';
  const isReady = propId ? true : router.isReady;
  const isOverlay = typeof onCloseProp === 'function';

  const [form, setForm] = useState({
    name: '', charge_name: '', description: '', tags: [],
    unit_of_measure: 'fixed', auto_add: true,
    effective_date_basis: 'CURRENT_DATE', calculation_mode: 'by_lane',
    match_resolution: 'first_match_wins', percentage_based_on: '', conditions: [],
  });

  const [versions, setVersions] = useState([newVersion('by_lane', 1)]);
  const [activeVersionIdx, setActiveVersionIdx] = useState(0);
  const [availableTags, setAvailableTags] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const isPercentage = form.unit_of_measure === 'percentage';
  const availableModes = useMemo(() => getModesForUOM(form.unit_of_measure), [form.unit_of_measure]);
  const activeVersion = versions[activeVersionIdx] || versions[0];
  const mode = form.calculation_mode;

  // ── Fetch ─────────────────────────────────────────────────
  useEffect(() => {
    if (!isReady) return;
    async function load() {
      try {
        try {
          const tagRes = await fetch('/api/tenant/charge-profile-tags');
          if (tagRes.ok) {
            const tagData = await tagRes.json();
            setAvailableTags((tagData.tags || []).map((t) => t.name));
          }
        } catch { /* ignore */ }

        if (isNew) { setLoading(false); return; }
        if (!id) return;

        const res = await fetch(`/api/tenant/charge-profiles/${id}`);
        if (!res.ok) throw new Error('Failed to load');
        const { profile: p } = await res.json();

        setForm({
          name: p.name || '', charge_name: p.charge_name || '',
          description: p.description || '', tags: p.tags || (p.tag ? [p.tag] : []),
          unit_of_measure: p.unit_of_measure || 'fixed', auto_add: p.auto_add || false,
          effective_date_basis: p.effective_date_basis || 'CURRENT_DATE',
          calculation_mode: p.calculation_mode || 'by_lane',
          match_resolution: p.match_resolution || 'first_match_wins',
          percentage_based_on: p.percentage_based_on || '', conditions: p.conditions || [],
        });

        // Rebuild versions
        if (p.versions?.length > 0) {
          setVersions(p.versions.map((v) => ({
            id: v.id, label: v.label || '', effective_from: v.effective_from || '', effective_to: v.effective_to || '',
            rows: (v.tiers || []).map(mapTierToRow),
          })));
        } else if (p.tiers?.length > 0) {
          setVersions([{
            label: 'Version 1', effective_from: p.tiers[0]?.start_date || '', effective_to: p.tiers[0]?.end_date || '',
            rows: p.tiers.map(mapTierToRow),
          }]);
        }
      } catch (e) { setError(e.message); }
      finally { setLoading(false); }
    }
    load();
  }, [id, isNew, isReady]);

  function mapTierToRow(t) {
    return {
      id: t.id, amount_cents: t.amount_cents || 0, minimum_amount_cents: t.minimum_amount_cents || 0,
      free_units: t.free_units || 0, from_status: t.from_status || '', to_status: t.to_status || '',
      event_type: t.event_type || '', event_location_id: t.event_location_id || null,
      event_location_label: '', event_location_type: t.event_location_type || 'org',
      event_location_value: t.event_location_value || '',
      pickup_location_id: t.pickup_location_id || null, pickup_location_label: '',
      delivery_location_id: t.delivery_location_id || null, delivery_location_label: '',
      move_events: t.move_events || [{ event: '', event_time: 'arrived', location_id: null, location_label: '', location_type: 'org', location_value: '' }],
      move_calc_from: t.move_calc_from || 'first_event_arrived', move_calc_to: t.move_calc_to || 'last_event_arrived',
    };
  }

  // When UOM changes, ensure calc mode is valid
  useEffect(() => {
    const valid = getModesForUOM(form.unit_of_measure);
    if (!valid.find((m) => m.value === form.calculation_mode)) {
      setForm((f) => ({ ...f, calculation_mode: valid[0]?.value || 'by_event' }));
    }
  }, [form.unit_of_measure]);

  // ── Updaters ──────────────────────────────────────────────
  function update(field, value) { setForm((f) => ({ ...f, [field]: value })); }

  function updateVersion(field, value) {
    setVersions((prev) => prev.map((v, i) => i === activeVersionIdx ? { ...v, [field]: value } : v));
  }

  function updateRow(rIdx, field, value) {
    setVersions((prev) => prev.map((v, i) => {
      if (i !== activeVersionIdx) return v;
      return { ...v, rows: v.rows.map((r, ri) => ri === rIdx ? { ...r, [field]: value } : r) };
    }));
  }

  function addRow() {
    setVersions((prev) => prev.map((v, i) => {
      if (i !== activeVersionIdx) return v;
      return { ...v, rows: [...v.rows, emptyRowForMode(mode)] };
    }));
  }

  function removeRow(rIdx) {
    setVersions((prev) => prev.map((v, i) => {
      if (i !== activeVersionIdx) return v;
      return { ...v, rows: v.rows.filter((_, ri) => ri !== rIdx) };
    }));
  }

  function addVersion() {
    const nv = newVersion(mode, versions.length + 1);
    setVersions((prev) => [...prev, nv]);
    setActiveVersionIdx(versions.length);
  }

  function removeVersion() {
    if (versions.length <= 1) return;
    setVersions((prev) => prev.filter((_, i) => i !== activeVersionIdx));
    setActiveVersionIdx(Math.max(0, activeVersionIdx - 1));
  }

  function duplicateVersion() {
    const dup = JSON.parse(JSON.stringify(activeVersion));
    dup.label = `${dup.label} (Copy)`;
    delete dup.id;
    dup.rows.forEach((r) => delete r.id);
    setVersions((prev) => [...prev, dup]);
    setActiveVersionIdx(versions.length);
  }

  // By Move event helpers
  function addMoveEvent(rIdx) {
    setVersions((prev) => prev.map((v, vi) => {
      if (vi !== activeVersionIdx) return v;
      return {
        ...v, rows: v.rows.map((r, ri) => {
          if (ri !== rIdx) return r;
          return { ...r, move_events: [...(r.move_events || []), { event: '', event_time: 'arrived', location_id: null, location_label: '', location_type: 'org', location_value: '' }] };
        }),
      };
    }));
  }

  function removeMoveEvent(rIdx, eIdx) {
    setVersions((prev) => prev.map((v, vi) => {
      if (vi !== activeVersionIdx) return v;
      return { ...v, rows: v.rows.map((r, ri) => ri !== rIdx ? r : { ...r, move_events: r.move_events.filter((_, i) => i !== eIdx) }) };
    }));
  }

  function updateMoveEvent(rIdx, eIdx, field, value) {
    setVersions((prev) => prev.map((v, vi) => {
      if (vi !== activeVersionIdx) return v;
      return {
        ...v, rows: v.rows.map((r, ri) => {
          if (ri !== rIdx) return r;
          return { ...r, move_events: r.move_events.map((e, ei) => ei === eIdx ? { ...e, [field]: value } : e) };
        }),
      };
    }));
  }

  // ── Save ──────────────────────────────────────────────────
  async function handleSave() {
    if (!form.name || !form.charge_name) { setError('Charge Profile Name and Charge Name are required'); return; }
    if (isPercentage && !form.percentage_based_on) { setError('Percentage Based On is required when UOM is Percentage'); return; }
    setSaving(true); setError(null);
    const payload = {
      ...form,
      versions: versions.map((v) => ({
        id: v.id || undefined, label: v.label, effective_from: v.effective_from || null, effective_to: v.effective_to || null,
        rows: v.rows.map((r) => ({
          ...r,
          amount_cents: Math.round(parseFloat(r.amount_cents) || 0),
          minimum_amount_cents: Math.round(parseFloat(r.minimum_amount_cents) || 0),
          free_units: parseFloat(r.free_units) || 0,
        })),
      })),
    };
    try {
      const url = isNew ? '/api/tenant/charge-profiles' : `/api/tenant/charge-profiles/${id}`;
      const method = isNew ? 'POST' : 'PUT';
      const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      if (!res.ok) { const body = await res.json().catch(() => ({})); throw new Error(body.error || 'Failed to save'); }
      if (isOverlay) { onCloseProp(); } else { router.push('/settings/charge-profiles'); }
    } catch (e) { setError(e.message); }
    finally { setSaving(false); }
  }

  function handleCancel() {
    if (isOverlay) { onCloseProp(); } else { router.push('/settings/charge-profiles'); }
  }

  const formContent = () => {
    if (loading) {
      return <div className="py-20 text-center text-gray-400 dark:text-slate-500">Loading...</div>;
    }

    // ═══════════════════════════════════════════════════════════
    // RENDER — PP-style layout
    // ═══════════════════════════════════════════════════════════
    return (
      <div className="max-w-6xl space-y-5 pb-20">
        {/* Page title */}
        <div className="flex items-center justify-between">
          <h1 className="text-base font-semibold text-gray-900 dark:text-slate-100">
            {isNew ? 'Add Charge Profile' : 'Edit Charge Profile'}
          </h1>
        </div>

        {error && <Alert type="error" message={error} onClose={() => setError(null)} />}

        {/* ═══════════════════════════════════════════════════ */}
        {/* SECTION 1: Header fields — compact inline layout   */}
        {/* ═══════════════════════════════════════════════════ */}
        <div className="rounded-xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-5 space-y-4">
          {/* Row 1: Name | Charge Name | Description */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-slate-300 mb-1">* Charge Profile Name</label>
              <input type="text" value={form.name} onChange={(e) => update('name', e.target.value)}
                placeholder="My Base Price"
                className="block w-full rounded-lg border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-950 text-gray-900 dark:text-slate-100 placeholder-gray-400 dark:placeholder-slate-500 px-3 py-2 text-sm focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 dark:focus:ring-blue-900/40" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-slate-300 mb-1">* Charge Name</label>
              <select value={form.charge_name} onChange={(e) => update('charge_name', e.target.value)}
                className="block w-full rounded-lg border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-950 text-gray-900 dark:text-slate-100 px-3 py-2 text-sm focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 dark:focus:ring-blue-900/40">
                <option value="">Select...</option>
                {CHARGE_NAMES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-slate-300 mb-1">Charge Description</label>
              <input type="text" value={form.description} onChange={(e) => update('description', e.target.value)}
                placeholder="Enter description"
                className="block w-full rounded-lg border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-950 text-gray-900 dark:text-slate-100 placeholder-gray-400 dark:placeholder-slate-500 px-3 py-2 text-sm focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 dark:focus:ring-blue-900/40" />
            </div>
          </div>

          {/* Row 2: Tag | Auto Add */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <TagInput tags={form.tags} onChange={(tags) => update('tags', tags)} availableTags={availableTags} />
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-slate-300 mb-1">* Auto Add to Load</label>
              <div className="flex items-center gap-4 h-[36px]">
                <label className="flex items-center gap-2 text-sm cursor-pointer">
                  <input type="radio" checked={!form.auto_add} onChange={() => update('auto_add', false)} className="text-blue-600 w-4 h-4" />
                  No
                </label>
                <label className="flex items-center gap-2 text-sm cursor-pointer">
                  <input type="radio" checked={form.auto_add} onChange={() => update('auto_add', true)} className="text-blue-600 w-4 h-4" />
                  Yes
                </label>
              </div>
            </div>
          </div>
        </div>

        {/* ═══════════════════════════════════════════════════ */}
        {/* SECTION 2: Version box — PP-style with selector    */}
        {/* ═══════════════════════════════════════════════════ */}
        <div className="rounded-xl border border-blue-200 dark:border-blue-800 bg-blue-50/30 dark:bg-blue-950/40">
          {/* Version header bar */}
          <div className="flex items-center justify-between px-5 py-3 border-b border-blue-200 dark:border-blue-800 bg-blue-50/60 dark:bg-blue-950/40 rounded-t-xl">
            <div className="flex items-center gap-3">
              <label className="text-xs font-semibold text-gray-700 dark:text-slate-200">* Version</label>
              <select
                value={activeVersionIdx}
                onChange={(e) => setActiveVersionIdx(parseInt(e.target.value))}
                className="rounded-lg border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-900 px-3 py-1.5 text-sm font-medium min-w-[140px]"
              >
                {versions.map((v, i) => (
                  <option key={i} value={i}>{v.label || `Version ${i + 1}`}</option>
                ))}
              </select>
            </div>
            <div className="flex items-center gap-1.5">
              <button type="button" onClick={() => {
                const name = prompt('Version name:', activeVersion.label);
                if (name !== null) updateVersion('label', name);
              }} className="text-gray-500 dark:text-slate-400 hover:text-blue-600 p-1.5 rounded hover:bg-white/80 dark:hover:bg-slate-800/80" title="Rename version">
                <Edit2 className="w-3.5 h-3.5" />
              </button>
              <button type="button" onClick={duplicateVersion} className="text-gray-500 dark:text-slate-400 hover:text-blue-600 p-1.5 rounded hover:bg-white/80 dark:hover:bg-slate-800/80" title="Duplicate version">
                <Copy className="w-3.5 h-3.5" />
              </button>
              {versions.length > 1 && (
                <button type="button" onClick={removeVersion} className="text-gray-500 dark:text-slate-400 hover:text-red-500 p-1.5 rounded hover:bg-white/80 dark:hover:bg-slate-800/80" title="Delete version">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              )}
              <Button variant="secondary" onClick={addVersion} className="!py-1 !px-3 !text-xs ml-2">
                <Plus className="w-3 h-3 mr-1 inline" /> New Version
              </Button>
            </div>
          </div>

          <div className="p-5 space-y-5">
            {/* UOM + Effective Date + Version dates (inside the version box, like PP) */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <div>
                <label className="block text-xs font-medium text-gray-600 dark:text-slate-300 mb-1">* Unit of Measure</label>
                <select value={form.unit_of_measure} onChange={(e) => update('unit_of_measure', e.target.value)}
                  className="block w-full rounded-lg border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-900 px-3 py-2 text-sm focus:outline-none focus:border-blue-500">
                  {UNITS_OF_MEASURE.map((u) => <option key={u.value} value={u.value}>{u.label}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 dark:text-slate-300 mb-1">Effective Date Based On</label>
                <select value={form.effective_date_basis} onChange={(e) => update('effective_date_basis', e.target.value)}
                  className="block w-full rounded-lg border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-900 px-3 py-2 text-sm focus:outline-none focus:border-blue-500">
                  {EFFECTIVE_DATE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </div>
              <DatePicker
                label="Effective From"
                value={activeVersion.effective_from || ''}
                onChange={(v) => updateVersion('effective_from', v)}
              />
              <DatePicker
                label="Effective To"
                value={activeVersion.effective_to || ''}
                onChange={(v) => updateVersion('effective_to', v)}
              />
            </div>

            {/* Percentage Based On — conditional */}
            {isPercentage && (
              <div className="max-w-xs">
                <label className="block text-xs font-medium text-gray-600 dark:text-slate-300 mb-1">* Percentage Based On</label>
                <select value={form.percentage_based_on} onChange={(e) => update('percentage_based_on', e.target.value)}
                  className="block w-full rounded-lg border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-900 px-3 py-2 text-sm focus:outline-none focus:border-blue-500">
                  <option value="">Select charge code...</option>
                  {CHARGE_NAMES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                </select>
              </div>
            )}

            {/* Calculation mode label + radio buttons */}
            <div>
              <div className="text-xs font-semibold text-gray-700 dark:text-slate-200 mb-2">Add your charges</div>
              <div className="flex gap-4 mb-4">
                {availableModes.map((m) => (
                  <label key={m.value} className="flex items-center gap-2 text-sm cursor-pointer">
                    <input type="radio" name="calc_mode" checked={mode === m.value}
                      onChange={() => update('calculation_mode', m.value)} className="text-blue-600 w-4 h-4" />
                    {m.label}
                  </label>
                ))}
              </div>
            </div>

            {/* By Move: Calc From / To timing (once per version) */}
            {mode === 'by_move' && activeVersion.rows.length > 0 && (
              <div className="grid grid-cols-2 gap-4 p-3 rounded-lg bg-white/70 dark:bg-slate-900/70 border border-blue-100 dark:border-blue-800">
                <div>
                  <label className="block text-[11px] font-medium text-blue-700 dark:text-blue-300 mb-1">Calculate From</label>
                  <select value={activeVersion.rows[0]?.move_calc_from || 'first_event_arrived'}
                    onChange={(e) => {
                      const val = e.target.value;
                      setVersions((prev) => prev.map((v, vi) => vi !== activeVersionIdx ? v : { ...v, rows: v.rows.map((r) => ({ ...r, move_calc_from: val })) }));
                    }}
                    className="block w-full rounded-md border border-blue-200 dark:border-blue-800 px-2 py-1.5 text-xs bg-white dark:bg-slate-900">
                    {MOVE_CALC_FROM.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-[11px] font-medium text-blue-700 dark:text-blue-300 mb-1">Calculate To</label>
                  <select value={activeVersion.rows[0]?.move_calc_to || 'last_event_arrived'}
                    onChange={(e) => {
                      const val = e.target.value;
                      setVersions((prev) => prev.map((v, vi) => vi !== activeVersionIdx ? v : { ...v, rows: v.rows.map((r) => ({ ...r, move_calc_to: val })) }));
                    }}
                    className="block w-full rounded-md border border-blue-200 dark:border-blue-800 px-2 py-1.5 text-xs bg-white dark:bg-slate-900">
                    {MOVE_CALC_TO.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </div>
              </div>
            )}

            {/* ── Charges table — proper <table> for column alignment ── */}
            <div className="rounded-lg border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-900">
              <table className="w-full text-sm" style={{ tableLayout: 'auto' }}>
                <colgroup>
                  {mode === 'by_lane' && <><col style={{ width: '22%' }} /><col style={{ width: '22%' }} /></>}
                  {mode === 'between_statuses' && <><col style={{ width: '22%' }} /><col style={{ width: '22%' }} /></>}
                  {mode === 'by_event' && <><col style={{ width: '22%' }} /><col style={{ width: '22%' }} /></>}
                  {mode === 'by_move' && <col style={{ width: '44%' }} />}
                  <col style={{ width: '16%' }} />
                  <col style={{ width: '12%' }} />
                  <col style={{ width: '16%' }} />
                  <col style={{ width: '32px' }} />
                </colgroup>
                <thead>
                  <tr className="bg-gray-50 dark:bg-slate-900 text-[10px] font-semibold text-gray-500 dark:text-slate-400 uppercase tracking-wide">
                    {mode === 'by_lane' && (
                      <><th className="text-left px-3 py-2 font-semibold">Origin</th><th className="text-left px-3 py-2 font-semibold">Destination</th></>
                    )}
                    {mode === 'between_statuses' && (
                      <><th className="text-left px-3 py-2 font-semibold">From Status</th><th className="text-left px-3 py-2 font-semibold">To Status</th></>
                    )}
                    {mode === 'by_event' && (
                      <><th className="text-left px-3 py-2 font-semibold">Event</th><th className="text-left px-3 py-2 font-semibold">Location</th></>
                    )}
                    {mode === 'by_move' && (
                      <th className="text-left px-3 py-2 font-semibold">Events & Locations</th>
                    )}
                    <th className="text-left px-3 py-2 font-semibold">Minimum Amount</th>
                    <th className="text-left px-3 py-2 font-semibold">Free Units</th>
                    <th className="text-left px-3 py-2 font-semibold">Amount</th>
                    <th className="px-1 py-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {activeVersion.rows.length === 0 ? (
                    <tr><td colSpan={mode === 'by_move' ? 5 : 6} className="px-4 py-6 text-center text-sm text-gray-400 dark:text-slate-500">No charges added yet</td></tr>
                  ) : activeVersion.rows.map((row, rIdx) => (
                    <tr key={rIdx} className="border-t border-gray-100 dark:border-slate-800 align-top">
                      {/* ─── BY LANE ─── */}
                      {mode === 'by_lane' && (
                        <>
                          <td className="px-2 py-2">
                            <LaneLocationCell
                              typeValue={row.origin_type || 'org'}
                              orgId={row.origin_id}
                              orgLabel={row.origin_label}
                              textValue={row.origin_value}
                              onTypeChange={(t) => updateRow(rIdx, 'origin_type', t)}
                              onOrgChange={(org) => { updateRow(rIdx, 'origin_id', org?.id || null); updateRow(rIdx, 'origin_label', org?.name || ''); }}
                              onTextChange={(v) => updateRow(rIdx, 'origin_value', v)}
                              orgType="terminal"
                              placeholder="Origin"
                            />
                          </td>
                          <td className="px-2 py-2">
                            <LaneLocationCell
                              typeValue={row.dest_type || 'org'}
                              orgId={row.dest_id}
                              orgLabel={row.dest_label}
                              textValue={row.dest_value}
                              onTypeChange={(t) => updateRow(rIdx, 'dest_type', t)}
                              onOrgChange={(org) => { updateRow(rIdx, 'dest_id', org?.id || null); updateRow(rIdx, 'dest_label', org?.name || ''); }}
                              onTextChange={(v) => updateRow(rIdx, 'dest_value', v)}
                              orgType="warehouse"
                              placeholder="Destination"
                            />
                          </td>
                        </>
                      )}
                      {/* ─── BETWEEN STATUSES ─── */}
                      {mode === 'between_statuses' && (
                        <>
                          <td className="px-2 py-2">
                            <select value={row.from_status || ''} onChange={(e) => updateRow(rIdx, 'from_status', e.target.value)}
                              className="block w-full rounded border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-950 text-gray-900 dark:text-slate-100 px-2 py-1.5 text-xs">
                              <option value="">Select...</option>
                              {STATUS_OPTIONS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                            </select>
                          </td>
                          <td className="px-2 py-2">
                            <select value={row.to_status || ''} onChange={(e) => updateRow(rIdx, 'to_status', e.target.value)}
                              className="block w-full rounded border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-950 text-gray-900 dark:text-slate-100 px-2 py-1.5 text-xs">
                              <option value="">Select...</option>
                              {STATUS_OPTIONS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                            </select>
                          </td>
                        </>
                      )}
                      {/* ─── BY EVENT ─── */}
                      {mode === 'by_event' && (
                        <>
                          <td className="px-2 py-2">
                            <select value={row.event_type || ''} onChange={(e) => updateRow(rIdx, 'event_type', e.target.value)}
                              className="block w-full rounded border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-950 text-gray-900 dark:text-slate-100 px-2 py-1.5 text-xs">
                              <option value="">Select...</option>
                              {EVENT_TYPES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                            </select>
                          </td>
                          <td className="px-2 py-2">
                            <OrgPicker value={row.event_location_id} valueLabel={row.event_location_label}
                              onChange={(org) => { updateRow(rIdx, 'event_location_id', org?.id || null); updateRow(rIdx, 'event_location_label', org?.name || ''); }}
                              placeholder="Location..." />
                          </td>
                        </>
                      )}
                      {/* ─── BY MOVE — stacked events ─── */}
                      {mode === 'by_move' && (
                        <td className="px-2 py-2">
                          <div className="space-y-2">
                            {(row.move_events || []).map((me, eIdx) => (
                              <div key={eIdx} className="flex items-center gap-2">
                                <select value={me.event || ''} onChange={(e) => updateMoveEvent(rIdx, eIdx, 'event', e.target.value)}
                                  className="rounded border border-gray-300 dark:border-slate-600 px-2 py-1.5 text-xs shrink-0 w-[155px]">
                                  <option value="">Select event...</option>
                                  {EVENT_TYPES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                                </select>
                                <select value={me.event_time || 'arrived'} onChange={(e) => updateMoveEvent(rIdx, eIdx, 'event_time', e.target.value)}
                                  className="rounded border border-gray-300 dark:border-slate-600 px-2 py-1.5 text-xs shrink-0 w-[100px]">
                                  {EVENT_TIME_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                                </select>
                                <div className="min-w-[100px] flex-1">
                                  <OrgPicker value={me.location_id} valueLabel={me.location_label}
                                    onChange={(org) => { updateMoveEvent(rIdx, eIdx, 'location_id', org?.id || null); updateMoveEvent(rIdx, eIdx, 'location_label', org?.name || ''); }}
                                    placeholder="Location..." />
                                </div>
                                {(row.move_events || []).length > 1 && (
                                  <button type="button" onClick={() => removeMoveEvent(rIdx, eIdx)} className="text-gray-400 dark:text-slate-500 hover:text-red-500 shrink-0">
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </button>
                                )}
                              </div>
                            ))}
                            <button type="button" onClick={() => addMoveEvent(rIdx)}
                              className="text-xs text-blue-600 dark:text-blue-400 hover:text-blue-700 font-medium flex items-center gap-0.5">
                              <Plus className="w-3 h-3" /> Add Event
                            </button>
                          </div>
                        </td>
                      )}

                      {/* Common: Min Amount | Free Units | Amount */}
                      <td className="px-2 py-2">
                        <CentsInput value={row.minimum_amount_cents} onChange={(cents) => updateRow(rIdx, 'minimum_amount_cents', cents)} />
                      </td>
                      <td className="px-2 py-2">
                        <input type="number" step="0.01" value={row.free_units || ''}
                          onChange={(e) => updateRow(rIdx, 'free_units', e.target.value)}
                          placeholder="0"
                          className="block w-full rounded border border-gray-300 dark:border-slate-600 px-2 py-1.5 text-xs focus:outline-none focus:border-blue-500" />
                      </td>
                      <td className="px-2 py-2">
                        <CentsInput value={row.amount_cents} isPercent={isPercentage}
                          onChange={(cents) => updateRow(rIdx, 'amount_cents', cents)} />
                      </td>
                      <td className="px-1 py-2">
                        {activeVersion.rows.length > 1 && (
                          <button type="button" onClick={() => removeRow(rIdx)} className="text-gray-400 dark:text-slate-500 hover:text-red-500 mt-1">
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Action buttons below table — PP style */}
            <div className="flex items-center gap-2">
              <Button variant="secondary" onClick={addRow} className="!py-1.5 !px-3 !text-xs">
                <Plus className="w-3 h-3 mr-1 inline" /> Add Charge
              </Button>
            </div>
          </div>
        </div>

        {/* ═══════════════════════════════════════════════════ */}
        {/* SECTION 3: Rules — placeholder for future          */}
        {/* ═══════════════════════════════════════════════════ */}
        <RulesPanel
          conditions={form.conditions || []}
          onChange={(c) => update('conditions', c)}
        />

        {/* ═══════════════════════════════════════════════════ */}
        {/* SECTION 4: Link to existing + Match Resolution     */}
        {/* ═══════════════════════════════════════════════════ */}
        <MatchResolutionPanel
          value={form.match_resolution}
          onChange={(v) => update('match_resolution', v)}
        />

        {/* ═══════════════════════════════════════════════════ */}
        {/* Bottom action bar — fixed to bottom right           */}
        {/* ═══════════════════════════════════════════════════ */}
        <div className="flex justify-end gap-3 pt-4 border-t border-gray-200 dark:border-slate-700">
          <Button variant="secondary" onClick={handleCancel}>Close</Button>
          <Button onClick={handleSave} loading={saving}>
            {isNew ? 'Add Charge Profile' : 'Update Charge Profile'}
          </Button>
        </div>
      </div>
    );
  };

  // Overlay mode: render without SettingsLayout
  if (isOverlay) {
    return <div className="p-6">{formContent()}</div>;
  }

  // Page mode: wrap in SettingsLayout
  return (
    <SettingsLayout title={isNew ? 'Add Charge Profile' : 'Edit Charge Profile'}>
      {formContent()}
    </SettingsLayout>
  );
}
