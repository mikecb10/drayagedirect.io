import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/router';
import { Plus, Pencil, Trash2, Search, X } from 'lucide-react';
import Button from '../../ui/Button';
import Input from '../../ui/Input';
import Select from '../../ui/Select';
import Alert from '../../ui/Alert';
import Badge from '../../ui/Badge';
import Modal from '../../ui/Modal';
import ConditionBuilder from '../../ui/ConditionBuilder';
import { AR_RULES } from '../../../lib/ar-rule-definitions';
import {
  DRIVER_CHARGE_NAMES,
  DRIVER_UNITS_OF_MEASURE,
  DRIVER_CALCULATION_MODES,
  LEG_OPTIONS,
  DRIVER_EVENT_TYPES,
  EVENT_TIME_OPTIONS,
  PERCENTAGE_BASED_ON,
  EFFECTIVE_DATE_OPTIONS,
  MATCH_RESOLUTION_OPTIONS,
  DISPATCHER_STATE_OPTIONS,
  chargeNameLabel,
  unitLabel,
  requiresPercentageBase,
} from '../../../lib/driver-charge-profile-constants';
import { CHARGE_NAMES as AR_CHARGE_NAMES } from '../../../lib/charge-profile-constants';
import EventLocationPicker from '../../ui/EventLocationPicker';

function formatCents(c) {
  if (c == null) return '$0.00';
  return `$${(c / 100).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`;
}

// Pay amount tier — just minimum / free / amount. The calculation-mode
// config (event / move / leg / between_statuses) lives at the profile
// level now, not per tier, matching the PortPro UX where a profile has
// one calc config and one-or-more pay amount rows.
const EMPTY_TIER = {
  amount_cents: 0, minimum_amount_cents: 0, free_units: 0,
};

// Calculation mode default configs — stored at the form level.
const EMPTY_EVENT_CONFIG = {
  event_type: '', event_time: 'arrived', location: null,
};

function makeEmptyMoveEvent() {
  return { event_type: '', event_time: 'arrived', location: null };
}

const EMPTY_LEG_CONFIG = {
  from_types: [], from_location: null,
  to_types: [], to_location: null,
};

export default function DriverChargeProfilesPanel() {
  const router = useRouter();
  const [profiles, setProfiles] = useState([]);
  const [driverGroups, setDriverGroups] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState('');

  // Remember which profile the URL asked us to open, so we can trigger
  // openEdit() once the profile list has loaded. We store it in a ref
  // (not state) because the auto-open is a one-time side effect — if we
  // kept it in state the effect would re-fire on every rerender.
  const pendingOpenProfileId = useRef(null);

  // Modal
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({
    name: '', charge_name: '', description: '', driver_group_id: '',
    unit_of_measure: 'fixed', percentage_based_on: '', percentage_charge_code: '',
    effective_date_basis: 'CURRENT_DATE', calculation_mode: 'by_event',
    auto_add: false, match_resolution: 'first_match_wins',
    // Calc mode config — mode-specific subsets used depending on calculation_mode:
    status_from: '', status_to: '',                 // between_statuses
    event_config: { ...EMPTY_EVENT_CONFIG },        // by_event
    move_events: [makeEmptyMoveEvent()],            // by_move
    leg_config: { ...EMPTY_LEG_CONFIG },            // by_leg
  });
  const [tiers, setTiers] = useState([{ ...EMPTY_TIER }]);
  const [saving, setSaving] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (search) params.set('search', search);
      const [profRes, groupRes] = await Promise.all([
        fetch(`/api/tenant/ap/charge-profiles?${params}`),
        fetch('/api/tenant/ap/driver-groups'),
      ]);
      if (profRes.ok) setProfiles((await profRes.json()).profiles || []);
      if (groupRes.ok) setDriverGroups((await groupRes.json()).driver_groups || []);
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }

  useEffect(() => { load(); }, [search]);

  // Capture the profile_id query param on first mount. Stored in a ref
  // because the open happens in a later effect once profiles are loaded —
  // we only want to try once per navigation, not every re-render.
  useEffect(() => {
    if (!router.isReady) return;
    if (router.query.profile_id && !pendingOpenProfileId.current) {
      pendingOpenProfileId.current = router.query.profile_id;
    }
  }, [router.isReady, router.query.profile_id]);

  // When profiles finish loading, auto-open the pending profile's editor.
  // We clear the ref afterward so a manual close won't reopen the modal.
  useEffect(() => {
    if (!pendingOpenProfileId.current) return;
    if (profiles.length === 0) return;
    const target = profiles.find((p) => p.id === pendingOpenProfileId.current);
    if (target) {
      openEdit(target);
      pendingOpenProfileId.current = null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profiles]);

  function openCreate() {
    setEditing(null);
    setForm({
      name: '', charge_name: '', description: '', driver_group_id: '',
      unit_of_measure: 'fixed', percentage_based_on: '', percentage_charge_code: '',
      effective_date_basis: 'CURRENT_DATE', calculation_mode: 'by_event',
      auto_add: false, match_resolution: 'first_match_wins',
      status_from: '', status_to: '',
      event_config: { ...EMPTY_EVENT_CONFIG },
      move_events: [makeEmptyMoveEvent()],
      leg_config: { ...EMPTY_LEG_CONFIG },
    });
    setTiers([{ ...EMPTY_TIER }]);
    setModalOpen(true);
  }

  function openEdit(profile) {
    setEditing(profile);
    // Load tiers from the first version. Calc-mode config lives on tier[0].
    const version = (profile.versions || [])[0];
    const allTiers = (version?.tiers || []).map((t) => ({ ...t }));
    const primary = allTiers[0] || {};

    // Reconstruct calc-mode configs from the primary tier's columns.
    const evLoc = reconstructLocation(primary, 'event_');
    const legFromLoc = reconstructLocation(primary, 'leg_from_');
    const legToLoc = reconstructLocation(primary, 'leg_to_');

    setForm({
      name: profile.name || '',
      charge_name: profile.charge_name || '',
      description: profile.description || '',
      driver_group_id: profile.driver_group_id || '',
      unit_of_measure: profile.unit_of_measure || 'fixed',
      percentage_based_on: profile.percentage_based_on || '',
      percentage_charge_code: profile.percentage_charge_code || '',
      effective_date_basis: profile.effective_date_basis || 'CURRENT_DATE',
      calculation_mode: profile.calculation_mode || 'by_event',
      auto_add: profile.auto_add || false,
      match_resolution: profile.match_resolution || 'first_match_wins',
      conditions: profile.conditions || [],
      // Between Statuses
      status_from: primary.status_from || '',
      status_to: primary.status_to || '',
      // By Event — single config from primary tier
      event_config: {
        event_type: primary.event_type || '',
        event_time: primary.event_time || 'arrived',
        location: evLoc,
      },
      // By Move — deserialize move_events JSONB array (fallback to single-event)
      move_events: Array.isArray(primary.move_events) && primary.move_events.length > 0
        ? primary.move_events.map((me) => ({
            event_type: me.event_type || '',
            event_time: me.event_time || 'arrived',
            location: me.location || null,
          }))
        : [makeEmptyMoveEvent()],
      // By Leg — prefer array columns, fall back to single-value columns
      leg_config: {
        from_types: primary.leg_from_types
          ? primary.leg_from_types.filter(Boolean)
          : primary.leg_from
            ? [primary.leg_from]
            : [],
        from_location: legFromLoc,
        to_types: primary.leg_to_types
          ? primary.leg_to_types.filter(Boolean)
          : primary.leg_to
            ? [primary.leg_to]
            : [],
        to_location: legToLoc,
      },
    });
    // Pay amount tiers — only amount-related fields
    setTiers(
      allTiers.length > 0
        ? allTiers.map((t) => ({
            amount_cents: t.amount_cents || 0,
            minimum_amount_cents: t.minimum_amount_cents || 0,
            free_units: t.free_units || 0,
            // Pre-fill formatted strings for the inputs so edit round-trip works
            amount: t.amount_cents ? (t.amount_cents / 100).toFixed(2) : '',
            minimum: t.minimum_amount_cents ? (t.minimum_amount_cents / 100).toFixed(2) : '',
          }))
        : [{ ...EMPTY_TIER }]
    );
    setModalOpen(true);
  }

  // Reconstruct a location object {type, id, value, meta} from the tier's
  // flat legacy columns + JSONB meta column added in migration 072.
  function reconstructLocation(tier, prefix) {
    const type = tier[`${prefix}location_type`];
    if (!type) return null;
    const id = tier[`${prefix}location_id`] || null;
    const value = tier[`${prefix}location_value`] || '';
    const meta = tier[`${prefix}location_meta`] || null;
    if (!id && !value) return null;
    return { type, id, value, meta };
  }

  async function handleSave(e) {
    e.preventDefault();
    if (!form.name || !form.charge_name) { setError('Name and charge name are required'); return; }
    setSaving(true);
    setError(null);
    try {
      // Calc-mode config lives on tier[0] so the engine can read it.
      // Tiers[1+] are pure pay amount rows.
      const mode = form.calculation_mode;
      const evLoc = form.event_config?.location || null;
      const legFromLoc = form.leg_config?.from_location || null;
      const legToLoc = form.leg_config?.to_location || null;

      // Build the calc-config columns to attach to tier[0]
      const calcColsTier0 = {
        // Between Statuses
        status_from: mode === 'between_statuses' ? (form.status_from || null) : null,
        status_to: mode === 'between_statuses' ? (form.status_to || null) : null,
        // By Event
        event_type: mode === 'by_event' ? (form.event_config?.event_type || null) : null,
        event_time: mode === 'by_event' ? (form.event_config?.event_time || null) : null,
        event_location_type: mode === 'by_event' ? (evLoc?.type || null) : null,
        event_location_id: mode === 'by_event' ? (evLoc?.id || null) : null,
        event_location_value: mode === 'by_event' ? (evLoc?.value || null) : null,
        event_location_meta: mode === 'by_event' ? (evLoc?.meta || null) : null,
        // By Move — store stacked events in move_events JSONB. Each entry
        // carries its own {type,id,value,meta} location object for
        // forward compatibility.
        move_events: mode === 'by_move'
          ? (form.move_events || []).filter((me) => me.event_type).map((me) => ({
              event_type: me.event_type,
              event_time: me.event_time || 'arrived',
              location: me.location || null,
            }))
          : [],
        // By Leg — arrays + single-value columns for backward compat
        leg_from_types: mode === 'by_leg' ? (form.leg_config?.from_types || []) : null,
        leg_to_types: mode === 'by_leg' ? (form.leg_config?.to_types || []) : null,
        leg_from: mode === 'by_leg' ? (form.leg_config?.from_types?.[0] || null) : null,
        leg_to: mode === 'by_leg' ? (form.leg_config?.to_types?.[0] || null) : null,
        leg_from_location_type: mode === 'by_leg' ? (legFromLoc?.type || null) : null,
        leg_from_location_id: mode === 'by_leg' ? (legFromLoc?.id || null) : null,
        leg_from_location_value: mode === 'by_leg' ? (legFromLoc?.value || null) : null,
        leg_from_location_meta: mode === 'by_leg' ? (legFromLoc?.meta || null) : null,
        leg_to_location_type: mode === 'by_leg' ? (legToLoc?.type || null) : null,
        leg_to_location_id: mode === 'by_leg' ? (legToLoc?.id || null) : null,
        leg_to_location_value: mode === 'by_leg' ? (legToLoc?.value || null) : null,
        leg_to_location_meta: mode === 'by_leg' ? (legToLoc?.meta || null) : null,
      };

      const rows = tiers.map((t, idx) => ({
        amount_cents:
          Math.round((parseFloat(t.amount) || 0) * 100) || t.amount_cents || 0,
        minimum_amount_cents:
          Math.round((parseFloat(t.minimum) || 0) * 100) ||
          t.minimum_amount_cents || 0,
        free_units: parseFloat(t.free_units) || 0,
        // Only tier[0] carries the calc-mode config.
        ...(idx === 0 ? calcColsTier0 : {}),
      }));

      const payload = {
        name: form.name,
        charge_name: form.charge_name,
        description: form.description,
        driver_group_id: form.driver_group_id || null,
        unit_of_measure: form.unit_of_measure,
        percentage_based_on: form.percentage_based_on || null,
        percentage_charge_code: form.percentage_charge_code || null,
        effective_date_basis: form.effective_date_basis,
        calculation_mode: form.calculation_mode,
        auto_add: form.auto_add,
        match_resolution: form.match_resolution,
        conditions: form.conditions || [],
        versions: [{ label: 'Version 1', rows }],
      };

      const url = editing
        ? `/api/tenant/ap/charge-profiles/${editing.id}`
        : '/api/tenant/ap/charge-profiles';
      const res = await fetch(url, {
        method: editing ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const b = await res.json().catch(() => ({}));
        throw new Error(b.error || 'Failed to save');
      }
      setModalOpen(false);
      load();
    } catch (e) { setError(e.message); }
    finally { setSaving(false); }
  }

  async function handleDelete(id) {
    if (!confirm('Delete this charge profile?')) return;
    await fetch(`/api/tenant/ap/charge-profiles/${id}`, { method: 'DELETE' });
    load();
  }

  function updateTier(idx, field, value) {
    setTiers((prev) => prev.map((t, i) => i === idx ? { ...t, [field]: value } : t));
  }

  const groupOptions = driverGroups.map((g) => ({ value: g.id, label: g.name }));

  return (
    <div className="space-y-4">
      {error && <Alert type="error" message={error} onClose={() => setError(null)} />}

      <div className="flex items-center justify-between gap-3">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 dark:text-slate-500" />
          <input type="text" placeholder="Search profiles..." value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="block w-full rounded-lg border border-gray-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-gray-900 dark:text-slate-100 placeholder-gray-400 dark:placeholder-slate-500 pl-9 pr-3 py-2 text-sm focus:outline-none focus:border-blue-500" />
        </div>
        <Button onClick={openCreate}>
          <Plus className="w-4 h-4 mr-1 inline -mt-0.5" /> Add Charge Profile
        </Button>
      </div>

      {/* Profiles table */}
      <div className="rounded-xl border border-gray-200 dark:border-slate-800 bg-white dark:bg-slate-900">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 dark:border-slate-800 bg-gray-50/60 dark:bg-slate-800/40">
                {['Profile Name', 'Driver Group', 'Charge Name', 'UOM', 'Calc Mode', 'Auto Add', 'Actions'].map((h) => (
                  <th key={h} className="text-left px-4 py-2.5 font-semibold text-gray-600 dark:text-slate-300 text-xs uppercase tracking-wide">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50 dark:divide-slate-800">
              {loading ? (
                <tr><td colSpan={7} className="px-4 py-10 text-center text-gray-400 dark:text-slate-500">Loading...</td></tr>
              ) : profiles.length === 0 ? (
                <tr><td colSpan={7} className="px-4 py-10 text-center text-gray-400 dark:text-slate-500">No charge profiles yet. Create one to define driver pay rates.</td></tr>
              ) : (
                profiles.map((p) => (
                  <tr key={p.id} className="hover:bg-gray-50 dark:hover:bg-slate-800/40">
                    <td className="px-4 py-2.5 font-medium text-gray-900 dark:text-slate-100">{p.name}</td>
                    <td className="px-4 py-2.5 text-xs text-gray-500 dark:text-slate-400">{p.driver_group?.name || 'All'}</td>
                    <td className="px-4 py-2.5"><Badge variant="blue">{chargeNameLabel(p.charge_name)}</Badge></td>
                    <td className="px-4 py-2.5 text-xs text-gray-500 dark:text-slate-400">{unitLabel(p.unit_of_measure)}</td>
                    <td className="px-4 py-2.5 text-xs text-gray-500 dark:text-slate-400 capitalize">{(p.calculation_mode || '').replace('_', ' ')}</td>
                    <td className="px-4 py-2.5">
                      <Badge variant={p.auto_add ? 'green' : 'gray'}>{p.auto_add ? 'Yes' : 'No'}</Badge>
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="flex gap-1">
                        <button onClick={() => openEdit(p)}
                          className="p-1.5 text-gray-400 dark:text-slate-500 hover:text-blue-600 dark:hover:text-blue-400 rounded hover:bg-blue-50 dark:hover:bg-blue-950/40">
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                        <button onClick={() => handleDelete(p.id)}
                          className="p-1.5 text-gray-400 dark:text-slate-500 hover:text-red-500 dark:hover:text-red-400 rounded hover:bg-red-50 dark:hover:bg-red-950/40">
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

      {/* Create/Edit Modal */}
      {modalOpen && (
        <Modal isOpen onClose={() => setModalOpen(false)} title={editing ? 'Edit Charge Profile' : 'Add Charge Profile'} size="xl">
          <form onSubmit={handleSave} className="space-y-4 max-h-[70vh] overflow-y-auto pr-1">
            {/* Header fields */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <Select label="Driver Pay Group *" value={form.driver_group_id}
                onChange={(e) => setForm((f) => ({ ...f, driver_group_id: e.target.value }))}
                placeholder="All Driver Groups" options={groupOptions} />
              <Input label="Charge Profile Name *" value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} required />
              <Select label="Charge Name *" value={form.charge_name}
                onChange={(e) => setForm((f) => ({ ...f, charge_name: e.target.value }))}
                options={DRIVER_CHARGE_NAMES} />
              <Select label="Unit of Measure *" value={form.unit_of_measure}
                onChange={(e) => setForm((f) => ({ ...f, unit_of_measure: e.target.value }))}
                options={DRIVER_UNITS_OF_MEASURE} />
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <Select label="Effective Date Based On" value={form.effective_date_basis}
                onChange={(e) => setForm((f) => ({ ...f, effective_date_basis: e.target.value }))}
                options={EFFECTIVE_DATE_OPTIONS} />
              <Input label="Charge Description" value={form.description}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} />
              <div className="flex items-end pb-1">
                <label className="flex items-center gap-2 cursor-pointer">
                  <span className="text-xs font-semibold text-gray-700 dark:text-slate-300">Auto Add To Load</span>
                  <div className="flex gap-3">
                    <label className={`px-3 py-1 rounded-lg text-xs font-semibold cursor-pointer border transition-colors ${
                      !form.auto_add ? 'border-gray-300 dark:border-slate-600 text-gray-500 dark:text-slate-400' : 'border-blue-500 bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300'
                    }`}>
                      <input type="radio" name="auto_add" checked={form.auto_add} onChange={() => setForm((f) => ({ ...f, auto_add: true }))} className="sr-only" /> Yes
                    </label>
                    <label className={`px-3 py-1 rounded-lg text-xs font-semibold cursor-pointer border transition-colors ${
                      form.auto_add ? 'border-gray-300 dark:border-slate-600 text-gray-500 dark:text-slate-400' : 'border-blue-500 bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300'
                    }`}>
                      <input type="radio" name="auto_add" checked={!form.auto_add} onChange={() => setForm((f) => ({ ...f, auto_add: false }))} className="sr-only" /> No
                    </label>
                  </div>
                </label>
              </div>
              {requiresPercentageBase(form.unit_of_measure) && (
                <>
                  <Select label="Percentage Based On" value={form.percentage_based_on}
                    onChange={(e) => setForm((f) => ({ ...f, percentage_based_on: e.target.value, percentage_charge_code: '' }))}
                    options={PERCENTAGE_BASED_ON} />
                  {(form.percentage_based_on === 'ar_invoice' || form.percentage_based_on === 'driver_pay') && (
                    <Select label="Based On Charge Code" value={form.percentage_charge_code}
                      placeholder="All (total amount)"
                      onChange={(e) => setForm((f) => ({ ...f, percentage_charge_code: e.target.value }))}
                      options={AR_CHARGE_NAMES.map((c) => ({ value: c.value, label: c.label }))} />
                  )}
                </>
              )}
            </div>

            {/* Pay Amounts */}
            <div className="border-t border-gray-200 dark:border-slate-800 pt-4">
              <div className="text-sm font-semibold text-gray-900 dark:text-slate-100 mb-2">Add Your Pay Amounts</div>
              {tiers.map((tier, idx) => (
                <div key={idx} className="grid grid-cols-3 gap-3 mb-2 p-3 rounded-lg border border-gray-200 dark:border-slate-700 bg-gray-50/50 dark:bg-slate-800/30">
                  <Input label="Pay Minimum ($)" type="number" step="0.01" value={tier.minimum || (tier.minimum_amount_cents ? (tier.minimum_amount_cents / 100).toFixed(2) : '')}
                    onChange={(e) => updateTier(idx, 'minimum', e.target.value)} placeholder="0.00" />
                  <Input label="Free Units" type="number" step="0.01" value={tier.free_units || ''}
                    onChange={(e) => updateTier(idx, 'free_units', e.target.value)} placeholder="0" />
                  <Input label="Amount ($)" type="number" step="0.01" value={tier.amount || (tier.amount_cents ? (tier.amount_cents / 100).toFixed(2) : '')}
                    onChange={(e) => updateTier(idx, 'amount', e.target.value)} placeholder="0.00" />
                </div>
              ))}
              <button type="button" onClick={() => setTiers((prev) => [...prev, { ...EMPTY_TIER }])}
                className="text-xs text-blue-600 dark:text-blue-400 hover:underline font-semibold">
                + Add New Charge
              </button>
            </div>

            {/* Calculation Mode */}
            <div className="border-t border-gray-200 dark:border-slate-800 pt-4">
              <div className="text-sm font-semibold text-gray-900 dark:text-slate-100 mb-2">Define How You Want To Calculate The Pay</div>
              <div className="flex gap-3 mb-3">
                {DRIVER_CALCULATION_MODES.map((m) => (
                  <label key={m.value} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-semibold cursor-pointer transition-colors ${
                    form.calculation_mode === m.value
                      ? 'border-blue-500 bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300'
                      : 'border-gray-200 dark:border-slate-700 text-gray-500 dark:text-slate-400 hover:border-gray-300'
                  }`}>
                    <input type="radio" name="calc_mode" value={m.value}
                      checked={form.calculation_mode === m.value}
                      onChange={() => setForm((f) => ({ ...f, calculation_mode: m.value }))}
                      className="sr-only" />
                    {m.label}
                  </label>
                ))}
              </div>

              {/* ── Between Statuses ─────────────────────────── */}
              {form.calculation_mode === 'between_statuses' && (
                <div className="grid grid-cols-2 gap-3">
                  <Select label="Calculate From This" value={form.status_from || ''}
                    placeholder="Select status..."
                    onChange={(e) => setForm((f) => ({ ...f, status_from: e.target.value }))}
                    options={DISPATCHER_STATE_OPTIONS} />
                  <Select label="Calculate To This" value={form.status_to || ''}
                    placeholder="Select status..."
                    onChange={(e) => setForm((f) => ({ ...f, status_to: e.target.value }))}
                    options={DISPATCHER_STATE_OPTIONS} />
                </div>
              )}

              {/* ── By Event — single numbered row (no Event Time) ─ */}
              {form.calculation_mode === 'by_event' && (
                <NumberedEventRow
                  idx={0}
                  event={form.event_config}
                  onChange={(next) => setForm((f) => ({ ...f, event_config: next }))}
                  showDelete={false}
                  showEventTime={false}
                />
              )}

              {/* ── By Move — multi-event stack + Add Event ──── */}
              {form.calculation_mode === 'by_move' && (
                <div className="space-y-2">
                  {form.move_events.map((evt, idx) => (
                    <NumberedEventRow
                      key={idx}
                      idx={idx}
                      event={evt}
                      onChange={(next) => {
                        const copy = [...form.move_events];
                        copy[idx] = next;
                        setForm((f) => ({ ...f, move_events: copy }));
                      }}
                      onDelete={() => {
                        const copy = form.move_events.filter((_, i) => i !== idx);
                        setForm((f) => ({
                          ...f,
                          move_events: copy.length > 0 ? copy : [makeEmptyMoveEvent()],
                        }));
                      }}
                      showDelete={form.move_events.length > 1}
                    />
                  ))}
                  <button type="button"
                    onClick={() => setForm((f) => ({ ...f, move_events: [...f.move_events, makeEmptyMoveEvent()] }))}
                    className="text-xs text-blue-600 dark:text-blue-400 hover:underline font-semibold flex items-center gap-1">
                    <Plus className="w-3.5 h-3.5" /> Add Event
                  </button>
                </div>
              )}

              {/* ── By Leg — multi-select legs + location ────── */}
              {form.calculation_mode === 'by_leg' && (
                <div className="space-y-3 p-3 rounded-lg border border-gray-200 dark:border-slate-700 bg-gray-50/50 dark:bg-slate-800/30">
                  <LegRow
                    label="From Legs"
                    selectedTypes={form.leg_config.from_types}
                    location={form.leg_config.from_location}
                    onTypesChange={(types) =>
                      setForm((f) => ({ ...f, leg_config: { ...f.leg_config, from_types: types } }))}
                    onLocationChange={(loc) =>
                      setForm((f) => ({ ...f, leg_config: { ...f.leg_config, from_location: loc } }))}
                  />
                  <LegRow
                    label="To Legs"
                    selectedTypes={form.leg_config.to_types}
                    location={form.leg_config.to_location}
                    onTypesChange={(types) =>
                      setForm((f) => ({ ...f, leg_config: { ...f.leg_config, to_types: types } }))}
                    onLocationChange={(loc) =>
                      setForm((f) => ({ ...f, leg_config: { ...f.leg_config, to_location: loc } }))}
                  />
                </div>
              )}
            </div>

            {/* Conditions / Rules Engine */}
            <div className="border-t border-gray-200 dark:border-slate-800 pt-4">
              <ConditionBuilder
                rules={AR_RULES}
                conditions={form.conditions || []}
                onChange={(c) => setForm((f) => ({ ...f, conditions: c }))}
              />
            </div>

            <div className="flex justify-end gap-2 pt-4 border-t border-gray-200 dark:border-slate-800">
              <Button variant="secondary" type="button" onClick={() => setModalOpen(false)}>Cancel</Button>
              <Button type="submit" loading={saving}>{editing ? 'Save Changes' : 'Add Charge Profile'}</Button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}

// ── Numbered event row ─────────────────────────────────────────
// Renders one row of the event builder. Used by:
//   - By Event (single instance, 2 columns: If Event | Event Location)
//   - By Move  (stacked instances, 3 columns: If Event | Event Time | Location)
//
// `showEventTime` controls whether the middle "Event Time" column
// (Arrived/Departed) is rendered. Off for By Event, on for By Move.
function NumberedEventRow({ idx, event, onChange, onDelete, showDelete, showEventTime = true }) {
  const update = (patch) => onChange({ ...event, ...patch });
  const gridCols = showEventTime ? 'grid-cols-3' : 'grid-cols-2';
  return (
    <div className="flex items-start gap-2">
      <div className="shrink-0 w-7 h-9 rounded-lg bg-gray-100 dark:bg-slate-800 text-xs font-semibold text-gray-500 dark:text-slate-400 flex items-center justify-center mt-5">
        {idx + 1}
      </div>
      <div className={`flex-1 grid ${gridCols} gap-3`}>
        <Select label="If Event" value={event?.event_type || ''}
          placeholder="Select event..."
          onChange={(e) => update({ event_type: e.target.value })}
          options={DRIVER_EVENT_TYPES} />
        {showEventTime && (
          <Select label="Event Time" value={event?.event_time || 'arrived'}
            onChange={(e) => update({ event_time: e.target.value })}
            options={EVENT_TIME_OPTIONS} />
        )}
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1">Event Location</label>
          <EventLocationPicker
            value={event?.location}
            onChange={(loc) => update({ location: loc })}
          />
        </div>
      </div>
      {showDelete && (
        <button type="button" onClick={onDelete}
          className="shrink-0 p-1.5 text-gray-400 dark:text-slate-500 hover:text-red-500 mt-6" aria-label="Remove event">
          <X className="w-4 h-4" />
        </button>
      )}
    </div>
  );
}

// ── By Leg row (label + multi-select types + location picker) ──
function LegRow({ label, selectedTypes, location, onTypesChange, onLocationChange }) {
  function toggleType(type) {
    if (selectedTypes.includes(type)) {
      onTypesChange(selectedTypes.filter((t) => t !== type));
    } else {
      onTypesChange([...selectedTypes, type]);
    }
  }
  return (
    <div className="grid grid-cols-2 gap-3">
      <div>
        <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1">{label}</label>
        <LegMultiSelect selectedTypes={selectedTypes} onToggle={toggleType} />
      </div>
      <div>
        <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1">Event Location</label>
        <EventLocationPicker value={location} onChange={onLocationChange} />
      </div>
    </div>
  );
}

// Multi-select with chip display + dropdown. Reusing our Select UI
// would be clunky for multi-select, so hand-rolled compact version.
function LegMultiSelect({ selectedTypes, onToggle }) {
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef(null);

  useEffect(() => {
    function onClick(e) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  const labelFor = (v) => LEG_OPTIONS.find((o) => o.value === v)?.label || v;

  return (
    <div ref={wrapperRef} className="relative">
      <button type="button" onClick={() => setOpen((o) => !o)}
        className="w-full min-h-[38px] rounded-lg border border-gray-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-left text-sm focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 dark:focus:ring-blue-900/40">
        {selectedTypes.length === 0 ? (
          <span className="text-gray-400 dark:text-slate-500">Select leg types...</span>
        ) : (
          <div className="flex flex-wrap gap-1">
            {selectedTypes.map((t) => (
              <span key={t} className="inline-flex items-center gap-1 text-xs bg-blue-100 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300 rounded px-2 py-0.5">
                {labelFor(t)}
                <X className="w-3 h-3 cursor-pointer" onClick={(e) => { e.stopPropagation(); onToggle(t); }} />
              </span>
            ))}
          </div>
        )}
      </button>
      {open && (
        <div className="absolute z-50 mt-1 w-full rounded-lg border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-lg max-h-60 overflow-auto">
          {LEG_OPTIONS.map((opt) => (
            <label key={opt.value}
              className="flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-blue-50 dark:hover:bg-blue-950/40 text-sm text-gray-900 dark:text-slate-100">
              <input type="checkbox" checked={selectedTypes.includes(opt.value)}
                onChange={() => onToggle(opt.value)}
                className="rounded border-gray-300 dark:border-slate-600 text-blue-600 w-4 h-4" />
              <span>{opt.label}</span>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}
