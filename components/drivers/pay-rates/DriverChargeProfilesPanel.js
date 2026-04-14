import { useEffect, useState } from 'react';
import { Plus, Pencil, Trash2, Search, X } from 'lucide-react';
import Button from '../../ui/Button';
import Input from '../../ui/Input';
import Select from '../../ui/Select';
import Alert from '../../ui/Alert';
import Badge from '../../ui/Badge';
import Modal from '../../ui/Modal';
import DatePicker from '../../ui/DatePicker';
import OrgPicker from '../../ui/OrgPicker';
import ConditionBuilder from '../../ui/ConditionBuilder';
import { AR_RULES } from '../../../lib/ar-rule-definitions';
import {
  DRIVER_CHARGE_NAMES,
  DRIVER_UNITS_OF_MEASURE,
  DRIVER_CALCULATION_MODES,
  LEG_OPTIONS,
  LOCATION_TYPE_OPTIONS,
  DRIVER_EVENT_TYPES,
  EVENT_TIME_OPTIONS,
  PERCENTAGE_BASED_ON,
  EFFECTIVE_DATE_OPTIONS,
  MATCH_RESOLUTION_OPTIONS,
  MOVE_CALC_FROM,
  MOVE_CALC_TO,
  chargeNameLabel,
  unitLabel,
  requiresPercentageBase,
} from '../../../lib/driver-charge-profile-constants';
import { CHARGE_NAMES as AR_CHARGE_NAMES } from '../../../lib/charge-profile-constants';

function formatCents(c) {
  if (c == null) return '$0.00';
  return `$${(c / 100).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`;
}

const EMPTY_TIER = {
  amount_cents: 0, minimum_amount_cents: 0, free_units: 0,
  // By Event fields
  event_type: '', event_time: '', event_location_type: '', event_location_id: '', event_location_value: '',
  // By Move fields
  move_calc_from: '', move_calc_to: '',
  // By Leg fields
  leg_from: '', leg_from_location_type: '', leg_from_location_id: '', leg_from_location_value: '',
  leg_to: '', leg_to_location_type: '', leg_to_location_id: '', leg_to_location_value: '',
};

export default function DriverChargeProfilesPanel() {
  const [profiles, setProfiles] = useState([]);
  const [driverGroups, setDriverGroups] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState('');

  // Modal
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({
    name: '', charge_name: '', description: '', driver_group_id: '',
    unit_of_measure: 'fixed', percentage_based_on: '', percentage_charge_code: '',
    effective_date_basis: 'CURRENT_DATE', calculation_mode: 'by_event',
    auto_add: false, match_resolution: 'first_match_wins',
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

  function openCreate() {
    setEditing(null);
    setForm({
      name: '', charge_name: '', description: '', driver_group_id: '',
      unit_of_measure: 'fixed', percentage_based_on: '', percentage_charge_code: '',
      effective_date_basis: 'CURRENT_DATE', calculation_mode: 'by_event',
      auto_add: false, match_resolution: 'first_match_wins',
    });
    setTiers([{ ...EMPTY_TIER }]);
    setModalOpen(true);
  }

  function openEdit(profile) {
    setEditing(profile);
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
    });
    // Load tiers from first version
    const version = (profile.versions || [])[0];
    const existingTiers = (version?.tiers || []).map((t) => ({ ...t }));
    setTiers(existingTiers.length > 0 ? existingTiers : [{ ...EMPTY_TIER }]);
    setModalOpen(true);
  }

  async function handleSave(e) {
    e.preventDefault();
    if (!form.name || !form.charge_name) { setError('Name and charge name are required'); return; }
    setSaving(true);
    setError(null);
    try {
      const payload = {
        ...form,
        driver_group_id: form.driver_group_id || null,
        percentage_based_on: form.percentage_based_on || null,
        percentage_charge_code: form.percentage_charge_code || null,
        versions: [{
          label: 'Version 1',
          rows: tiers.map((t) => ({
            amount_cents: Math.round((parseFloat(t.amount) || 0) * 100) || t.amount_cents || 0,
            minimum_amount_cents: Math.round((parseFloat(t.minimum) || 0) * 100) || t.minimum_amount_cents || 0,
            free_units: parseFloat(t.free_units) || 0,
            // By Event
            event_type: t.event_type || null,
            event_time: t.event_time || null,
            event_location_type: t.event_location_type || null,
            event_location_id: t.event_location_id || null,
            event_location_value: t.event_location_value || null,
            // By Move
            move_calc_from: t.move_calc_from || null,
            move_calc_to: t.move_calc_to || null,
            // By Leg
            leg_from: t.leg_from || null,
            leg_from_location_type: t.leg_from_location_type || null,
            leg_from_location_id: t.leg_from_location_id || null,
            leg_from_location_value: t.leg_from_location_value || null,
            leg_to: t.leg_to || null,
            leg_to_location_type: t.leg_to_location_type || null,
            leg_to_location_id: t.leg_to_location_id || null,
            leg_to_location_value: t.leg_to_location_value || null,
          })),
        }],
      };

      const url = editing ? `/api/tenant/ap/charge-profiles/${editing.id}` : '/api/tenant/ap/charge-profiles';
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

              {/* ── By Event ─────────────────────────────────── */}
              {form.calculation_mode === 'by_event' && tiers.map((tier, idx) => (
                <div key={idx} className="space-y-3 mb-3 p-3 rounded-lg border border-gray-200 dark:border-slate-700 bg-gray-50/50 dark:bg-slate-800/30">
                  <div className="grid grid-cols-3 gap-3">
                    <Select label="Event Type" value={tier.event_type || ''}
                      onChange={(e) => updateTier(idx, 'event_type', e.target.value)}
                      options={DRIVER_EVENT_TYPES} />
                    <Select label="Event Time" value={tier.event_time || ''}
                      onChange={(e) => updateTier(idx, 'event_time', e.target.value)}
                      options={EVENT_TIME_OPTIONS} />
                    <Select label="Location Match" value={tier.event_location_type || ''}
                      placeholder="Any Location"
                      onChange={(e) => {
                        updateTier(idx, 'event_location_type', e.target.value);
                        updateTier(idx, 'event_location_id', '');
                        updateTier(idx, 'event_location_value', '');
                      }}
                      options={LOCATION_TYPE_OPTIONS} />
                  </div>
                  {/* Location value based on type */}
                  {tier.event_location_type === 'org' && (
                    <div>
                      <div className="text-[10px] font-bold text-gray-500 dark:text-slate-400 uppercase tracking-wide mb-1">Event Location</div>
                      {tier.event_location_value && (
                        <div className="flex items-center gap-2 mb-1 bg-blue-50 dark:bg-blue-950/40 rounded-lg px-3 py-1.5">
                          <span className="text-xs text-blue-700 dark:text-blue-300 font-medium flex-1 truncate">{tier.event_location_value}</span>
                          <button type="button" onClick={() => { updateTier(idx, 'event_location_id', ''); updateTier(idx, 'event_location_value', ''); }}
                            className="text-gray-400 hover:text-red-500"><X className="w-3 h-3" /></button>
                        </div>
                      )}
                      {!tier.event_location_id && (
                        <OrgPicker placeholder="Search organization..." onChange={(org) => {
                          if (org) { updateTier(idx, 'event_location_id', org.id); updateTier(idx, 'event_location_value', org.name); }
                        }} />
                      )}
                    </div>
                  )}
                  {tier.event_location_type === 'city_state' && (
                    <Input label="City, State" placeholder="e.g. Bryan, TX" value={tier.event_location_value || ''}
                      onChange={(e) => updateTier(idx, 'event_location_value', e.target.value)} />
                  )}
                  {tier.event_location_type === 'zip' && (
                    <Input label="Zip Code" placeholder="e.g. 75098" value={tier.event_location_value || ''}
                      onChange={(e) => updateTier(idx, 'event_location_value', e.target.value)} />
                  )}
                </div>
              ))}

              {/* ── By Move ──────────────────────────────────── */}
              {form.calculation_mode === 'by_move' && tiers.map((tier, idx) => (
                <div key={idx} className="space-y-3 mb-3 p-3 rounded-lg border border-gray-200 dark:border-slate-700 bg-gray-50/50 dark:bg-slate-800/30">
                  <div className="text-[10px] font-bold text-gray-500 dark:text-slate-400 uppercase tracking-wide">
                    Move Billable Period
                  </div>
                  <p className="text-[11px] text-gray-500 dark:text-slate-500 -mt-2">
                    Define when the move starts and ends for billing calculation (used with time-based UOM like per hour, per day).
                  </p>
                  <div className="grid grid-cols-2 gap-3">
                    <Select label="Calculate From" value={tier.move_calc_from || ''}
                      onChange={(e) => updateTier(idx, 'move_calc_from', e.target.value)}
                      options={MOVE_CALC_FROM} />
                    <Select label="Calculate To" value={tier.move_calc_to || ''}
                      onChange={(e) => updateTier(idx, 'move_calc_to', e.target.value)}
                      options={MOVE_CALC_TO} />
                  </div>
                </div>
              ))}

              {/* ── By Leg ───────────────────────────────────── */}
              {form.calculation_mode === 'by_leg' && tiers.map((tier, idx) => (
                <div key={idx} className="space-y-3 mb-3 p-3 rounded-lg border border-gray-200 dark:border-slate-700 bg-gray-50/50 dark:bg-slate-800/30">
                  {/* From / To Leg selectors */}
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <div className="text-[10px] font-bold text-gray-500 dark:text-slate-400 uppercase tracking-wide mb-1">From Leg</div>
                      <Select value={tier.leg_from || ''}
                        onChange={(e) => updateTier(idx, 'leg_from', e.target.value)}
                        options={LEG_OPTIONS} />
                    </div>
                    <div>
                      <div className="text-[10px] font-bold text-gray-500 dark:text-slate-400 uppercase tracking-wide mb-1">To Leg</div>
                      <Select value={tier.leg_to || ''}
                        onChange={(e) => updateTier(idx, 'leg_to', e.target.value)}
                        options={LEG_OPTIONS} />
                    </div>
                  </div>

                  {/* From Location */}
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <Select label="From Location Type" value={tier.leg_from_location_type || ''}
                        onChange={(e) => {
                          updateTier(idx, 'leg_from_location_type', e.target.value);
                          updateTier(idx, 'leg_from_location_id', '');
                          updateTier(idx, 'leg_from_location_value', '');
                        }}
                        placeholder="Any" options={LOCATION_TYPE_OPTIONS} />
                      {tier.leg_from_location_type === 'org' && (
                        <>
                          {tier.leg_from_location_value && (
                            <div className="flex items-center gap-2 bg-blue-50 dark:bg-blue-950/40 rounded-lg px-3 py-1.5">
                              <span className="text-xs text-blue-700 dark:text-blue-300 font-medium flex-1 truncate">{tier.leg_from_location_value}</span>
                              <button type="button" onClick={() => { updateTier(idx, 'leg_from_location_id', ''); updateTier(idx, 'leg_from_location_value', ''); }}
                                className="text-gray-400 hover:text-red-500"><X className="w-3 h-3" /></button>
                            </div>
                          )}
                          {!tier.leg_from_location_id && (
                            <OrgPicker placeholder="Search organization..." onChange={(org) => {
                              if (org) { updateTier(idx, 'leg_from_location_id', org.id); updateTier(idx, 'leg_from_location_value', org.name); }
                            }} />
                          )}
                        </>
                      )}
                      {tier.leg_from_location_type === 'city_state' && (
                        <Input placeholder="e.g. Bryan, TX" value={tier.leg_from_location_value || ''}
                          onChange={(e) => updateTier(idx, 'leg_from_location_value', e.target.value)} />
                      )}
                      {tier.leg_from_location_type === 'zip' && (
                        <Input placeholder="e.g. 75098" value={tier.leg_from_location_value || ''}
                          onChange={(e) => updateTier(idx, 'leg_from_location_value', e.target.value)} />
                      )}
                    </div>

                    {/* To Location */}
                    <div className="space-y-1">
                      <Select label="To Location Type" value={tier.leg_to_location_type || ''}
                        onChange={(e) => {
                          updateTier(idx, 'leg_to_location_type', e.target.value);
                          updateTier(idx, 'leg_to_location_id', '');
                          updateTier(idx, 'leg_to_location_value', '');
                        }}
                        placeholder="Any" options={LOCATION_TYPE_OPTIONS} />
                      {tier.leg_to_location_type === 'org' && (
                        <>
                          {tier.leg_to_location_value && (
                            <div className="flex items-center gap-2 bg-blue-50 dark:bg-blue-950/40 rounded-lg px-3 py-1.5">
                              <span className="text-xs text-blue-700 dark:text-blue-300 font-medium flex-1 truncate">{tier.leg_to_location_value}</span>
                              <button type="button" onClick={() => { updateTier(idx, 'leg_to_location_id', ''); updateTier(idx, 'leg_to_location_value', ''); }}
                                className="text-gray-400 hover:text-red-500"><X className="w-3 h-3" /></button>
                            </div>
                          )}
                          {!tier.leg_to_location_id && (
                            <OrgPicker placeholder="Search organization..." onChange={(org) => {
                              if (org) { updateTier(idx, 'leg_to_location_id', org.id); updateTier(idx, 'leg_to_location_value', org.name); }
                            }} />
                          )}
                        </>
                      )}
                      {tier.leg_to_location_type === 'city_state' && (
                        <Input placeholder="e.g. Bryan, TX" value={tier.leg_to_location_value || ''}
                          onChange={(e) => updateTier(idx, 'leg_to_location_value', e.target.value)} />
                      )}
                      {tier.leg_to_location_type === 'zip' && (
                        <Input placeholder="e.g. 75098" value={tier.leg_to_location_value || ''}
                          onChange={(e) => updateTier(idx, 'leg_to_location_value', e.target.value)} />
                      )}
                    </div>
                  </div>
                </div>
              ))}
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
