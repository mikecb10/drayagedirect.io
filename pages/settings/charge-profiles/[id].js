import { useEffect, useState, useMemo } from 'react';
import { useRouter } from 'next/router';
import SettingsLayout from '../../../components/settings/SettingsLayout';
import Button from '../../../components/ui/Button';
import Alert from '../../../components/ui/Alert';
import RulesPanel from '../../../components/settings/charge-profile-detail/RulesPanel';
import { getModesForUOM } from '../../../lib/charge-profile-constants';
import {
  emptyRowForMode,
  newVersion,
} from '../../../lib/charge-profile-row-shapes';
import MatchResolutionPanel from '../../../components/settings/charge-profile-detail/MatchResolutionPanel';
import ChargeProfileHeader from '../../../components/settings/charge-profile-detail/ChargeProfileHeader';
import VersionManager from '../../../components/settings/charge-profile-detail/VersionManager';

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
    unit_of_measure: 'fixed', auto_add: true, is_dry_run: false,
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
          is_dry_run: p.is_dry_run || false,
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

  // Bulk-update a single field across ALL rows in the active version.
  // Used by the by_move Calculate-From / Calculate-To controls — those values
  // are stored per-row in the data model but are surfaced as a single
  // version-wide control in the UI.
  function updateAllRowsMoveField(field, value) {
    setVersions((prev) => prev.map((v, vi) => (
      vi !== activeVersionIdx ? v : { ...v, rows: v.rows.map((r) => ({ ...r, [field]: value })) }
    )));
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
        <ChargeProfileHeader
          form={form}
          update={update}
          availableTags={availableTags}
        />

        {/* ═══════════════════════════════════════════════════ */}
        {/* SECTION 2: Version box — PP-style with selector    */}
        {/* ═══════════════════════════════════════════════════ */}
        <VersionManager
          versions={versions}
          activeVersionIdx={activeVersionIdx}
          activeVersion={activeVersion}
          mode={mode}
          form={form}
          update={update}
          availableModes={availableModes}
          isPercentage={isPercentage}
          onSelectVersion={setActiveVersionIdx}
          onUpdateVersion={updateVersion}
          onAddVersion={addVersion}
          onRemoveVersion={removeVersion}
          onDuplicateVersion={duplicateVersion}
          onUpdateRow={updateRow}
          onAddRow={addRow}
          onRemoveRow={removeRow}
          onAddMoveEvent={addMoveEvent}
          onRemoveMoveEvent={removeMoveEvent}
          onUpdateMoveEvent={updateMoveEvent}
          onUpdateAllRowsMoveField={updateAllRowsMoveField}
        />

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
