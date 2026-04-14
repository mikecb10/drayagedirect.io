import { useEffect, useState, useMemo } from 'react';
import { useRouter } from 'next/router';
import { Plus, Trash2, ChevronDown, Info, Search, DollarSign, X, Check, Calendar } from 'lucide-react';
import DatePicker from '../../../components/ui/DatePicker';
import SettingsLayout from '../../../components/settings/SettingsLayout';
import Modal from '../../../components/ui/Modal';
import Button from '../../../components/ui/Button';
import Alert from '../../../components/ui/Alert';
import OrgPicker from '../../../components/ui/OrgPicker';
import ReferenceDataPicker from '../../../components/ui/ReferenceDataPicker';
import ContainerOwnerPicker from '../../../components/ui/ContainerOwnerPicker';
import CentsInput from '../../../components/ui/CentsInput';
import { CHARGE_NAMES, UNITS_OF_MEASURE, chargeNameLabel, unitLabel, formatCents } from '../../../lib/charge-profile-constants';

// Load types available in tariffs.
// Mirrors the canonical LOAD_TYPES list in components/loads/NewLoadModal.js,
// EXCLUDING 'Bill Only' — bill-only loads are manual one-offs (no operations,
// just an invoice) so they should never be matched by an automated tariff.
//
// Stored uppercase in tariffs (e.g. 'IMPORT'), but compared case-insensitively
// against orders.load_type which is stored lowercase ('import').
const LOAD_TYPES = [
  { value: 'IMPORT', label: 'Import' },
  { value: 'INBOUND', label: 'Inbound' },
  { value: 'EXPORT', label: 'Export' },
  { value: 'OUTBOUND', label: 'Outbound' },
  { value: 'ROAD', label: 'Road' },
];

// All flags from FLAG_DEFS
const FLAG_DEFS = [
  { key: 'is_hazmat', label: 'Hazmat' },
  { key: 'is_overweight', label: 'Overweight' },
  { key: 'is_liquor', label: 'Liquor' },
  { key: 'is_hot', label: 'Hot' },
  { key: 'is_genset', label: 'Genset' },
  { key: 'is_ev', label: 'EV' },
  { key: 'is_street_turn', label: 'Street Turn' },
  { key: 'is_overheight', label: 'Overheight' },
  { key: 'is_scale', label: 'Scale' },
  { key: 'is_oog', label: 'OOG' },
  { key: 'is_bonded', label: 'Bonded' },
  { key: 'is_double', label: 'Double' },
  { key: 'is_tanker', label: 'Tanker' },
];

export default function DriverTariffForm({ tariffId: propTariffId, onClose: onCloseProp }) {
  const router = useRouter();
  const id = propTariffId || router.query.id;
  const isNew = id === 'new';
  const isReady = propTariffId ? true : router.isReady;
  const isOverlay = typeof onCloseProp === 'function';

  const [form, setForm] = useState({
    name: '',
    status: 'draft',
    priority: 0,
    driver_group_id: null,
    effective_start: '',
    effective_end: '',
    matching_mode: 'basic',
    load_types: [],
    pickup_conditions: { all: true },
    delivery_conditions: { all: true },
    return_conditions: {},
    container_type: '',
    container_size: '',
    ssl_id: null,
    chassis_type: '',
    chassis_size: '',
    chassis_owner: '',
    // Flags
    is_hazmat: null,
    is_overweight: null,
    is_liquor: null,
    is_hot: null,
    is_genset: null,
    is_overheight: null,
    is_scale: null,
    is_ev: null,
    is_street_turn: null,
    is_oog: null,
    is_bonded: null,
    is_double: null,
    is_tanker: null,
  });

  const [chargeSets, setChargeSets] = useState([]);
  const [showAdditional, setShowAdditional] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  // (Driver group dropdown handles its own data fetching.)

  useEffect(() => {
    if (!isReady) return;
    async function load() {
      try {
        if (isNew) { setLoading(false); return; }
        if (!id) return;
        const res = await fetch(`/api/tenant/ap/tariffs/${id}`);
        if (!res.ok) throw new Error('Failed to load');
        const { tariff: t } = await res.json();

        setForm({
          name: t.name || '',
          status: t.status || 'draft',
          priority: t.priority ?? 0,
          driver_group_id: t.driver_group_id || null,
          effective_start: t.effective_start || '',
          effective_end: t.effective_end || '',
          matching_mode: t.matching_mode || 'basic',
          load_types: t.load_types || [],
          pickup_conditions: t.pickup_conditions || { all: true },
          delivery_conditions: t.delivery_conditions || { all: true },
          return_conditions: t.return_conditions || {},
          container_type: t.container_type || '',
          container_size: t.container_size || '',
          ssl_id: t.ssl_id || null,
          chassis_type: t.chassis_type || '',
          chassis_size: t.chassis_size || '',
          chassis_owner: t.chassis_owner || '',
          is_hazmat: t.is_hazmat,
          is_overweight: t.is_overweight,
          is_liquor: t.is_liquor,
          is_hot: t.is_hot,
          is_genset: t.is_genset,
          is_overheight: t.is_overheight,
          is_scale: t.is_scale,
          is_ev: t.is_ev,
          is_street_turn: t.is_street_turn,
          is_oog: t.is_oog,
          is_bonded: t.is_bonded,
          is_double: t.is_double,
          is_tanker: t.is_tanker,
        });

        if (t.charge_sets?.length > 0) {
          setChargeSets(t.charge_sets.map((cs) => ({
            id: cs.id,
            pay_to_mode: cs.pay_to_mode || 'assigned_driver',
            pay_to_driver_id: cs.pay_to_driver_id || null,
            profiles: (cs.profiles || []).map((p) => ({
              id: p.id,
              charge_profile_id: p.charge_profile_id,
              name: p.charge_profile?.name || '',
              charge_name: p.charge_profile?.charge_name || '',
            })),
            items: cs.items || [],
          })));
        }

        // Check if additional conditions are set
        if (t.container_type || t.container_size || t.ssl_id || t.chassis_type || t.chassis_size || t.chassis_owner) {
          setShowAdditional(true);
        }
      } catch (e) { setError(e.message); }
      finally { setLoading(false); }
    }
    load();
  }, [id, isNew, isReady]);

  function update(field, value) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  function toggleLoadType(type) {
    setForm((f) => {
      const types = f.load_types.includes(type)
        ? f.load_types.filter((t) => t !== type)
        : [...f.load_types, type];
      return { ...f, load_types: types };
    });
  }

  function toggleFlag(key) {
    setForm((f) => ({ ...f, [key]: f[key] ? null : true }));
  }

  // Location conditions helpers
  function toggleLocationAll(field) {
    const current = form[field] || {};
    if (current.all) {
      // Switch from "all" to "specific" — start with empty list
      update(field, { ids: [], labels: {} });
    } else {
      // Switch back to "all"
      update(field, { all: true });
    }
  }

  function addLocationId(field, orgId, orgName) {
    setForm((f) => {
      const current = f[field] || {};
      const ids = current.ids || [];
      if (ids.includes(orgId)) return f;
      return { ...f, [field]: { ids: [...ids, orgId], labels: { ...(current.labels || {}), [orgId]: orgName } } };
    });
  }

  function removeLocationId(field, orgId) {
    setForm((f) => {
      const current = f[field] || {};
      const ids = (current.ids || []).filter((i) => i !== orgId);
      const labels = { ...(current.labels || {}) };
      delete labels[orgId];
      return { ...f, [field]: ids.length === 0 ? { all: true } : { ids, labels } };
    });
  }

  function isLocationAll(field) {
    return !form[field] || form[field].all === true;
  }

  // Profile picker state
  const [profilePickerOpen, setProfilePickerOpen] = useState(false);
  const [profilePickerTarget, setProfilePickerTarget] = useState(null); // charge set index

  // Add charge set
  function addChargeSet() {
    setChargeSets((prev) => [...prev, {
      pay_to_mode: 'load_customer',
      pay_to_driver_id: null,
      profiles: [],
      items: [],
    }]);
  }

  function removeChargeSet(idx) {
    setChargeSets((prev) => prev.filter((_, i) => i !== idx));
  }

  function openProfilePicker(csIdx) {
    setProfilePickerTarget(csIdx);
    setProfilePickerOpen(true);
  }

  function handleProfilesSelected(selectedProfiles) {
    if (profilePickerTarget === null) return;
    setChargeSets((prev) => prev.map((cs, i) => {
      if (i !== profilePickerTarget) return cs;
      // Merge — don't duplicate existing profiles
      const existingIds = new Set(cs.profiles.map((p) => p.charge_profile_id));
      const newProfiles = selectedProfiles.filter((p) => !existingIds.has(p.id));
      return {
        ...cs,
        profiles: [
          ...cs.profiles,
          ...newProfiles.map((p) => ({
            charge_profile_id: p.id,
            name: p.name,
            charge_name: p.charge_name,
            unit_of_measure: p.unit_of_measure,
          })),
        ],
      };
    }));
    setProfilePickerOpen(false);
    setProfilePickerTarget(null);
  }

  function removeProfile(csIdx, pIdx) {
    setChargeSets((prev) => prev.map((cs, i) => {
      if (i !== csIdx) return cs;
      return { ...cs, profiles: cs.profiles.filter((_, pi) => pi !== pIdx) };
    }));
  }

  function addChargeItem(csIdx) {
    setChargeSets((prev) => prev.map((cs, i) => {
      if (i !== csIdx) return cs;
      return {
        ...cs,
        items: [...cs.items, {
          name: '', charge_name: '', unit_of_measure: 'fixed',
          amount_cents: 0, minimum_amount_cents: 0, free_units: 0,
        }],
      };
    }));
  }

  function updateChargeItem(csIdx, itemIdx, field, value) {
    setChargeSets((prev) => prev.map((cs, i) => {
      if (i !== csIdx) return cs;
      return {
        ...cs,
        items: cs.items.map((item, ii) => ii === itemIdx ? { ...item, [field]: value } : item),
      };
    }));
  }

  function removeChargeItem(csIdx, itemIdx) {
    setChargeSets((prev) => prev.map((cs, i) => {
      if (i !== csIdx) return cs;
      return { ...cs, items: cs.items.filter((_, ii) => ii !== itemIdx) };
    }));
  }

  // Save
  async function handleSave() {
    if (!form.name) { setError('Driver Tariff Name is required'); return; }
    setSaving(true); setError(null);

    const payload = {
      ...form,
      priority: Number(form.priority) || 0,
      effective_start: form.effective_start || null,
      effective_end: form.effective_end || null,
      charge_sets: chargeSets,
    };

    try {
      const url = isNew ? '/api/tenant/ap/tariffs' : `/api/tenant/ap/tariffs/${id}`;
      const method = isNew ? 'POST' : 'PUT';
      const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      if (!res.ok) { const body = await res.json().catch(() => ({})); throw new Error(body.error || 'Failed to save'); }
      const tariffData = await res.json();
      const tariffId = tariffData.tariff?.id || id;

      // Sync charge sets
      if (tariffId && chargeSets.length > 0) {
        const csPayload = chargeSets.map((cs) => ({
          pay_to_mode: cs.pay_to_mode || 'assigned_driver',
          pay_to_driver_id: cs.pay_to_driver_id || null,
          profile_ids: (cs.profiles || []).map((p) => p.charge_profile_id).filter(Boolean),
          items: cs.items || [],
          tags: cs.tags || [],
        }));
        await fetch(`/api/tenant/ap/tariffs/${tariffId}/charge-sets`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ charge_sets: csPayload }),
        });
      }

      if (isOverlay) {
        onCloseProp();
      } else {
        router.push('/settings/driver-tariffs');
      }
    } catch (e) { setError(e.message); }
    finally { setSaving(false); }
  }

  function handleCancel() {
    if (isOverlay) {
      onCloseProp();
    } else {
      router.push('/settings/driver-tariffs');
    }
  }

  const formContent = () => {
    if (loading) {
      return <div className="py-20 text-center text-gray-400 dark:text-slate-500">Loading...</div>;
    }

    const hasActiveFlags = FLAG_DEFS.some((f) => form[f.key]);

    return (
      <>
      <div className="max-w-7xl pb-20">
        {/* Header */}
        <div className="flex items-center justify-between mb-5">
          <h1 className="text-base font-semibold text-gray-900 dark:text-slate-100">Driver Tariff</h1>
          <div className="flex items-center gap-2 text-xs text-gray-400 dark:text-slate-500">
            <button onClick={() => update('matching_mode', 'basic')}
              className={`px-3 py-1 rounded ${form.matching_mode === 'basic' ? 'bg-gray-200 dark:bg-slate-700 text-gray-700 dark:text-slate-200 font-semibold' : 'hover:bg-gray-100 dark:hover:bg-slate-800'}`}>
              Basic
            </button>
            <button onClick={() => update('matching_mode', 'advanced_route')}
              className={`px-3 py-1 rounded ${form.matching_mode === 'advanced_route' ? 'bg-gray-200 dark:bg-slate-700 text-gray-700 dark:text-slate-200 font-semibold' : 'hover:bg-gray-100 dark:hover:bg-slate-800'}`}>
              Advanced Route Matching
            </button>
          </div>
        </div>

        {error && <Alert type="error" message={error} onClose={() => setError(null)} />}

        {/* Two-panel layout like PP */}
        <div className="flex gap-0 rounded-xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-900 min-h-[calc(100vh-200px)]">

          {/* ═══════════════════════════════════════════ */}
          {/* LEFT PANEL — Load Matching Conditions       */}
          {/* ═══════════════════════════════════════════ */}
          <div className="w-[280px] lg:w-[320px] shrink-0 border-r border-gray-200 dark:border-slate-700 overflow-y-auto">
            <div className="px-4 py-3 border-b border-gray-200 dark:border-slate-700 bg-gray-50/60 dark:bg-slate-900/60">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-gray-700 dark:text-slate-200">
                <Info className="w-3.5 h-3.5 text-gray-400 dark:text-slate-500" />
                Load Matching Conditions
              </div>
            </div>

            <div className="p-4 space-y-4">
              {/* Tariff Name */}
              <div>
                <label className="block text-xs font-medium text-gray-600 dark:text-slate-300 mb-1">* Driver Tariff Name</label>
                <input type="text" value={form.name} onChange={(e) => update('name', e.target.value)}
                  placeholder="Enter Tariff Name"
                  className="block w-full rounded-lg border border-gray-300 dark:border-slate-600 px-3 py-2 text-sm focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 dark:focus:ring-blue-900/40" />
              </div>

              {/* Draft toggle */}
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={form.status === 'draft'}
                  onChange={(e) => update('status', e.target.checked ? 'draft' : 'active')}
                  className="rounded border-gray-300 dark:border-slate-600 text-blue-600 w-4 h-4" />
                <span className="text-sm text-gray-700 dark:text-slate-200">Draft</span>
              </label>

              {/* Effective Dates */}
              <div>
                <label className="block text-xs font-medium text-gray-600 dark:text-slate-300 mb-1">* Effective Start Date</label>
                <DatePicker
                  value={form.effective_start || ''}
                  onChange={(val) => update('effective_start', val)}
                  placeholder="Select start date"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 dark:text-slate-300 mb-1">* Effective End Date</label>
                <DatePicker
                  value={form.effective_end || ''}
                  onChange={(val) => update('effective_end', val)}
                  placeholder="Select end date"
                />
              </div>

              {/* Load Type — multi-select checkboxes */}
              <div>
                <label className="block text-xs font-medium text-gray-600 dark:text-slate-300 mb-1">* Load Type</label>
                <div className="space-y-1">
                  {LOAD_TYPES.map((lt) => (
                    <label key={lt.value} className="flex items-center gap-2 cursor-pointer">
                      <input type="checkbox" checked={form.load_types.includes(lt.value)}
                        onChange={() => toggleLoadType(lt.value)}
                        className="rounded border-gray-300 dark:border-slate-600 text-blue-600 w-3.5 h-3.5" />
                      <span className="text-xs text-gray-700 dark:text-slate-200">{lt.label}</span>
                    </label>
                  ))}
                </div>
              </div>

              {/* Driver Group */}
              <div>
                <label className="block text-xs font-medium text-gray-600 dark:text-slate-300 mb-1">* Driver Group</label>
                <DriverGroupSelect
                  value={form.driver_group_id}
                  onChange={(val) => update('driver_group_id', val)}
                />
                <p className="text-[10px] text-gray-500 dark:text-slate-400 mt-1">
                  Leave blank to apply to all driver groups. Otherwise this tariff only pays drivers in the selected group.
                </p>
              </div>

              {/* Priority */}
              <div>
                <label className="block text-xs font-medium text-gray-600 dark:text-slate-300 mb-1">Priority</label>
                <input
                  type="number"
                  value={form.priority}
                  onChange={(e) => update('priority', e.target.value)}
                  className="block w-full rounded-lg border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-950 text-gray-900 dark:text-slate-100 px-3 py-2 text-sm focus:outline-none focus:border-blue-500"
                />
                <p className="text-[10px] text-gray-500 dark:text-slate-400 mt-1">
                  Tiebreaker when multiple tariffs match with identical specificity. Higher wins. Most cases don't need this — leave at 0.
                </p>
              </div>

              {/* Pick Up Location */}
              <LocationConditionField
                label="* Pick Up Location"
                field="pickup_conditions"
                form={form}
                isAll={isLocationAll('pickup_conditions')}
                onSetAll={() => toggleLocationAll('pickup_conditions')}
                onAddLocation={(orgId, name) => addLocationId('pickup_conditions', orgId, name)}
                onRemoveLocation={(orgId) => removeLocationId('pickup_conditions', orgId)}
                orgType="terminal"
              />

              {/* Delivery Location */}
              <LocationConditionField
                label="* Delivery Location"
                field="delivery_conditions"
                form={form}
                isAll={isLocationAll('delivery_conditions')}
                onSetAll={() => toggleLocationAll('delivery_conditions')}
                onAddLocation={(orgId, name) => addLocationId('delivery_conditions', orgId, name)}
                onRemoveLocation={(orgId) => removeLocationId('delivery_conditions', orgId)}
                orgType="warehouse"
              />

              {/* Return Location */}
              <LocationConditionField
                label="Return Location"
                field="return_conditions"
                form={form}
                isAll={isLocationAll('return_conditions')}
                onSetAll={() => toggleLocationAll('return_conditions')}
                onAddLocation={(orgId, name) => addLocationId('return_conditions', orgId, name)}
                onRemoveLocation={(orgId) => removeLocationId('return_conditions', orgId)}
                orgType="terminal"
              />

              {/* ── Additional Load Conditions ─────────── */}
              <button type="button" onClick={() => setShowAdditional(!showAdditional)}
                className="flex items-center gap-1.5 text-xs font-semibold text-gray-700 dark:text-slate-200 mt-2">
                Additional Load Conditions
                <ChevronDown className={`w-3.5 h-3.5 transition-transform ${showAdditional ? '' : '-rotate-90'}`} />
              </button>

              {showAdditional && (
                <div className="space-y-3 pl-1">
                  <div>
                    <label className="block text-xs font-medium text-gray-600 dark:text-slate-300 mb-1">Container Type</label>
                    <ReferenceDataPicker endpoint="/api/tenant/reference-data/container-types"
                      value={form.container_type}
                      onChange={(item) => update('container_type', item?.code || null)} placeholder="Select..." />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 dark:text-slate-300 mb-1">Container Size</label>
                    <ReferenceDataPicker endpoint="/api/tenant/reference-data/container-sizes"
                      value={form.container_size}
                      onChange={(item) => update('container_size', item?.code || null)} placeholder="Select..." />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 dark:text-slate-300 mb-1">SSL</label>
                    <ContainerOwnerPicker value={form.ssl_id}
                      onChange={(owner) => update('ssl_id', owner?.id || null)} />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 dark:text-slate-300 mb-1">Chassis Type</label>
                    <ReferenceDataPicker endpoint="/api/tenant/reference-data/chassis-types"
                      value={form.chassis_type}
                      onChange={(item) => update('chassis_type', item?.code || null)} placeholder="Select..." />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 dark:text-slate-300 mb-1">Chassis Size</label>
                    <ReferenceDataPicker endpoint="/api/tenant/reference-data/chassis-sizes"
                      value={form.chassis_size}
                      onChange={(item) => update('chassis_size', item?.code || null)} placeholder="Select..." />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 dark:text-slate-300 mb-1">Chassis Owner</label>
                    <input type="text" value={form.chassis_owner || ''} onChange={(e) => update('chassis_owner', e.target.value)}
                      placeholder="Select..."
                      className="block w-full rounded-lg border border-gray-300 dark:border-slate-600 px-3 py-2 text-sm focus:outline-none focus:border-blue-500" />
                  </div>
                </div>
              )}

              {/* Flags */}
              <div className="space-y-1 pt-2">
                {FLAG_DEFS.map((f) => (
                  <label key={f.key} className="flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" checked={!!form[f.key]}
                      onChange={() => toggleFlag(f.key)}
                      className="rounded border-gray-300 dark:border-slate-600 text-blue-600 w-3.5 h-3.5" />
                    <span className="text-xs text-gray-700 dark:text-slate-200">{f.label}</span>
                  </label>
                ))}
              </div>
            </div>
          </div>

          {/* ═══════════════════════════════════════════ */}
          {/* RIGHT PANEL — Charge Sets                   */}
          {/* ═══════════════════════════════════════════ */}
          <div className="flex-1 min-w-0">
            <div className="px-5 py-3 border-b border-gray-200 dark:border-slate-700 bg-gray-50/60 dark:bg-slate-900/60 flex items-center justify-between">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-gray-700 dark:text-slate-200">
                Charge Sets
                <Info className="w-3.5 h-3.5 text-gray-400 dark:text-slate-500" />
              </div>
              <Button variant="secondary" onClick={addChargeSet} className="!py-1 !px-3 !text-xs">
                <Plus className="w-3 h-3 mr-1 inline" /> Add Charge Set
              </Button>
            </div>

            <div className="p-5">
              {chargeSets.length === 0 ? (
                <div className="text-center py-16 text-gray-400 dark:text-slate-500">
                  <DollarSign className="w-8 h-8 mx-auto mb-3 text-gray-300 dark:text-slate-600" />
                  <p className="text-sm">No charge sets added yet.</p>
                  <p className="text-xs mt-1">Add a charge set, then link charge profiles or add one-off charges.</p>
                  <Button variant="secondary" onClick={addChargeSet} className="mt-4 !text-xs">
                    <Plus className="w-3 h-3 mr-1 inline" /> Add Charge Set
                  </Button>
                </div>
              ) : (
                <div className="space-y-4">
                  {chargeSets.map((cs, csIdx) => (
                    <div key={csIdx} className="rounded-lg border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-900">
                      {/* Charge set header */}
                      <div className="flex items-center justify-between px-4 py-2.5 bg-gray-50/70 dark:bg-slate-900/70 border-b border-gray-200 dark:border-slate-700 rounded-t-lg">
                        <div className="flex items-center gap-3">
                          <span className="text-xs font-semibold text-gray-500 dark:text-slate-400">*Pay To</span>
                          <select value={cs.pay_to_mode}
                            onChange={(e) => setChargeSets((prev) => prev.map((c, i) => i === csIdx ? { ...c, pay_to_mode: e.target.value } : c))}
                            className="rounded border border-gray-300 dark:border-slate-600 px-2 py-1 text-xs bg-white dark:bg-slate-900">
                            <option value="assigned_driver">Assigned Driver</option>
                            <option value="specified">Specific Driver</option>
                          </select>
                          {cs.pay_to_mode === 'specified' && (
                            <div className="w-48">
                              <DriverPicker value={cs.pay_to_driver_id}
                                onChange={(driverId) => setChargeSets((prev) => prev.map((c, i) => i === csIdx ? { ...c, pay_to_driver_id: driverId } : c))} />
                            </div>
                          )}
                        </div>
                        <button type="button" onClick={() => removeChargeSet(csIdx)} className="text-gray-400 dark:text-slate-500 hover:text-red-500">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>

                      <div className="p-4 space-y-3">
                        {/* Linked charge profiles */}
                        {cs.profiles.length > 0 && (
                          <div>
                            <div className="text-[10px] font-semibold text-gray-500 dark:text-slate-400 uppercase tracking-wide mb-1.5">Linked Charge Profiles</div>
                            <div className="space-y-1">
                              {cs.profiles.map((p, pIdx) => (
                                <div key={pIdx} className="flex items-center justify-between bg-blue-50/50 dark:bg-blue-950/40 rounded-lg px-3 py-2 border border-blue-100 dark:border-blue-800">
                                  <div className="flex items-center gap-2">
                                    <DollarSign className="w-3.5 h-3.5 text-blue-500" />
                                    <span className="text-xs font-medium text-gray-900 dark:text-slate-100">{p.name}</span>
                                    <span className="text-[10px] text-gray-400 dark:text-slate-500">{chargeNameLabel(p.charge_name)}</span>
                                    {p.unit_of_measure && (
                                      <span className="text-[9px] bg-gray-100 dark:bg-slate-800 text-gray-500 dark:text-slate-400 px-1.5 py-0.5 rounded">{unitLabel(p.unit_of_measure)}</span>
                                    )}
                                  </div>
                                  <button type="button" onClick={() => removeProfile(csIdx, pIdx)} className="text-gray-400 dark:text-slate-500 hover:text-red-500">
                                    <Trash2 className="w-3 h-3" />
                                  </button>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* One-off charge items */}
                        {cs.items.length > 0 && (
                          <div>
                            <div className="text-[10px] font-semibold text-gray-500 dark:text-slate-400 uppercase tracking-wide mb-1.5">One-Off Charges</div>
                            <div className="space-y-2">
                              {cs.items.map((item, itemIdx) => (
                                <div key={itemIdx} className="grid grid-cols-[1fr_1fr_100px_100px_30px] gap-2 items-end">
                                  <div>
                                    <label className="block text-[10px] text-gray-500 dark:text-slate-400 mb-0.5">Name</label>
                                    <input type="text" value={item.name} onChange={(e) => updateChargeItem(csIdx, itemIdx, 'name', e.target.value)}
                                      placeholder="Charge name..."
                                      className="block w-full rounded border border-gray-300 dark:border-slate-600 px-2 py-1.5 text-xs" />
                                  </div>
                                  <div>
                                    <label className="block text-[10px] text-gray-500 dark:text-slate-400 mb-0.5">Code</label>
                                    <select value={item.charge_name || ''} onChange={(e) => updateChargeItem(csIdx, itemIdx, 'charge_name', e.target.value)}
                                      className="block w-full rounded border border-gray-300 dark:border-slate-600 px-2 py-1.5 text-xs">
                                      <option value="">Select...</option>
                                      {CHARGE_NAMES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                                    </select>
                                  </div>
                                  <CentsInput label="Amount" value={item.amount_cents}
                                    onChange={(cents) => updateChargeItem(csIdx, itemIdx, 'amount_cents', cents)} />
                                  <CentsInput label="Min" value={item.minimum_amount_cents}
                                    onChange={(cents) => updateChargeItem(csIdx, itemIdx, 'minimum_amount_cents', cents)} />
                                  <div className="flex items-end pb-1">
                                    <button type="button" onClick={() => removeChargeItem(csIdx, itemIdx)} className="text-gray-400 dark:text-slate-500 hover:text-red-500">
                                      <Trash2 className="w-3 h-3" />
                                    </button>
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* Action buttons */}
                        <div className="flex items-center gap-3 pt-1">
                          <button type="button" onClick={() => openProfilePicker(csIdx)}
                            className="text-xs text-blue-600 dark:text-blue-400 hover:text-blue-700 font-medium flex items-center gap-0.5">
                            <Plus className="w-3 h-3" /> Select Charge Profiles
                          </button>
                          <span className="text-gray-300 dark:text-slate-600">|</span>
                          <button type="button" onClick={() => addChargeItem(csIdx)}
                            className="text-xs text-blue-600 dark:text-blue-400 hover:text-blue-700 font-medium flex items-center gap-0.5">
                            <Plus className="w-3 h-3" /> Add Charge Item
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}

                  <button type="button" onClick={addChargeSet}
                    className="text-xs text-blue-600 dark:text-blue-400 hover:text-blue-700 font-medium flex items-center gap-0.5">
                    <Plus className="w-3 h-3" /> Add Charge Set
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Bottom actions */}
        <div className="flex justify-end gap-3 pt-4 mt-4 border-t border-gray-200 dark:border-slate-700">
          <Button variant="secondary" onClick={handleCancel}>Cancel</Button>
          <Button onClick={handleSave} loading={saving}>
            {isNew ? 'Create Driver Tariff' : 'Update Driver Tariff'}
          </Button>
        </div>
      </div>

      {/* Charge Profile Picker Modal */}
      <ChargeProfilePickerModal
        isOpen={profilePickerOpen}
        onClose={() => { setProfilePickerOpen(false); setProfilePickerTarget(null); }}
        onSelect={handleProfilesSelected}
        existingIds={(chargeSets[profilePickerTarget]?.profiles || []).map((p) => p.charge_profile_id)}
      />
    </>
  );
  };

  // Overlay mode: render without SettingsLayout
  if (isOverlay) {
    return <div className="p-6">{formContent()}</div>;
  }

  // Page mode: wrap in SettingsLayout
  return (
    <SettingsLayout title={isNew ? 'Add Driver Tariff' : 'Edit Driver Tariff'}>
      {formContent()}
    </SettingsLayout>
  );
}

// ── Charge Profile Picker Modal ─────────────────────────────
function ChargeProfilePickerModal({ isOpen, onClose, onSelect, existingIds = [] }) {
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
    fetch('/api/tenant/ap/charge-profiles?enabled=true')
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

// ── Reusable Location Condition Field ─────────────────────────
// ── Driver dropdown ─────────────────────────────────────────
// Used for charge sets with pay_to_mode='specified' — pin a specific
// driver to receive pay regardless of which driver runs the load.
function DriverPicker({ value, onChange }) {
  const [drivers, setDrivers] = useState([]);
  useEffect(() => {
    async function load() {
      try {
        const res = await fetch('/api/tenant/drivers');
        if (res.ok) {
          const data = await res.json();
          setDrivers(data.drivers || []);
        }
      } catch { /* silent */ }
    }
    load();
  }, []);
  return (
    <select value={value || ''} onChange={(e) => onChange(e.target.value || null)}
      className="block w-full rounded border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-xs px-2 py-1">
      <option value="">Select driver...</option>
      {drivers.map((d) => (
        <option key={d.id} value={d.id}>
          {d.name || [d.first_name, d.last_name].filter(Boolean).join(' ')}
        </option>
      ))}
    </select>
  );
}

// ── Driver Group dropdown ───────────────────────────────────
// Fetches /api/tenant/ap/driver-groups once and renders a simple select.
// Value is the group id (or null for "all groups").
function DriverGroupSelect({ value, onChange }) {
  const [groups, setGroups] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch('/api/tenant/ap/driver-groups');
        if (res.ok) {
          const data = await res.json();
          setGroups(data.driver_groups || data.groups || []);
        }
      } catch {
        // silent — user will see empty dropdown
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  return (
    <select
      value={value || ''}
      onChange={(e) => onChange(e.target.value || null)}
      disabled={loading}
      className="block w-full rounded-lg border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-950 text-gray-900 dark:text-slate-100 px-3 py-2 text-sm focus:outline-none focus:border-blue-500"
    >
      <option value="">All Driver Groups</option>
      {groups.map((g) => (
        <option key={g.id} value={g.id}>{g.name}</option>
      ))}
    </select>
  );
}

function LocationConditionField({ label, field, form, isAll, onSetAll, onAddLocation, onRemoveLocation, orgType }) {
  const conditions = form[field] || {};
  const locationIds = conditions.ids || [];
  const labels = conditions.labels || {};

  return (
    <div>
      <label className="block text-xs font-medium text-gray-600 dark:text-slate-300 mb-1">{label}</label>
      <label className="flex items-center gap-2 cursor-pointer mb-2">
        <input type="checkbox" checked={isAll} onChange={onSetAll}
          className="rounded border-gray-300 dark:border-slate-600 text-blue-600 w-3.5 h-3.5" />
        <span className="text-xs text-gray-700 dark:text-slate-200">All Locations</span>
      </label>
      {!isAll && locationIds.length > 0 && (
        <div className="space-y-1 mb-2">
          {locationIds.map((lid) => (
            <div key={lid} className="flex items-center justify-between bg-gray-50 dark:bg-slate-900 rounded px-2 py-1">
              <span className="text-xs text-gray-700 dark:text-slate-200 truncate">{labels[lid] || lid.slice(0, 8)}</span>
              <button type="button" onClick={() => onRemoveLocation(lid)}
                className="text-gray-400 dark:text-slate-500 hover:text-red-500"><Trash2 className="w-3 h-3" /></button>
            </div>
          ))}
        </div>
      )}
      {!isAll && (
        <OrgPicker type={orgType} placeholder={`Add ${orgType}...`}
          onChange={(org) => { if (org) onAddLocation(org.id, org.name); }} />
      )}
    </div>
  );
}
