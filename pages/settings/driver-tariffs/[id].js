import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import { ChevronDown, Info, X, Calendar } from 'lucide-react';
import DatePicker from '../../../components/ui/DatePicker';
import SettingsLayout from '../../../components/settings/SettingsLayout';
import Button from '../../../components/ui/Button';
import ChargeProfilePickerModal from '../../../components/settings/driver-tariff-detail/ChargeProfilePickerModal';
import DriverGroupSelect from '../../../components/settings/driver-tariff-detail/DriverGroupSelect';
import LocationConditionField from '../../../components/settings/driver-tariff-detail/LocationConditionField';
import DriverTariffHeader from '../../../components/settings/driver-tariff-detail/DriverTariffHeader';
import DriverPayPanel from '../../../components/settings/driver-tariff-detail/DriverPayPanel';
import Alert from '../../../components/ui/Alert';
import ReferenceDataPicker from '../../../components/ui/ReferenceDataPicker';
import ContainerOwnerPicker from '../../../components/ui/ContainerOwnerPicker';
import CentsInput from '../../../components/ui/CentsInput';
import { UNITS_OF_MEASURE } from '../../../lib/charge-profile-constants';

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

  // Flat list of driver charge profiles linked to this tariff.
  // Unlike AR tariffs (which group charges by bill_to customer for
  // invoicing), driver pay is simpler: each linked profile produces
  // a pay line on any load that matches. The driver gets paid through
  // their settlement period. No grouping needed.
  //
  // On the DB side we still use driver_tariff_charge_sets +
  // driver_tariff_charge_set_profiles (shared junction pattern with
  // AR) — we just collapse to a single implicit charge set on save.
  const [linkedProfiles, setLinkedProfiles] = useState([]);
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
          // Flatten all charge sets' profiles into one list, deduped by
          // charge_profile_id. Pre-existing "Pay To" grouping from the
          // earlier schema is ignored — driver pay doesn't need it.
          //
          // IMPORTANT: the API GET nests the charge profile as
          //   { id, charge_profile: { id, name, ... } }
          // so `p.charge_profile_id` is undefined. We pull the id from
          // the nested object (or fall back to the flat field if the
          // API is later updated to expose it). Skipping this step is
          // why previously-saved charge profiles looked unsaved — the
          // junction rows existed, but the reader couldn't find them.
          const seen = new Set();
          const flat = [];
          for (const cs of t.charge_sets) {
            for (const p of cs.profiles || []) {
              const pid = p.charge_profile?.id || p.driver_charge_profile_id || p.charge_profile_id;
              if (!pid || seen.has(pid)) continue;
              seen.add(pid);
              flat.push({
                charge_profile_id: pid,
                name: p.charge_profile?.name || '',
                charge_name: p.charge_profile?.charge_name || '',
                unit_of_measure: p.charge_profile?.unit_of_measure || 'fixed',
              });
            }
          }
          setLinkedProfiles(flat);
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

  function openProfilePicker() { setProfilePickerOpen(true); }

  function handleProfilesSelected(selectedProfiles) {
    setLinkedProfiles((prev) => {
      const existing = new Set(prev.map((p) => p.charge_profile_id));
      const newOnes = selectedProfiles
        .filter((p) => !existing.has(p.id))
        .map((p) => ({
          charge_profile_id: p.id,
          name: p.name,
          charge_name: p.charge_name,
          unit_of_measure: p.unit_of_measure,
        }));
      return [...prev, ...newOnes];
    });
    setProfilePickerOpen(false);
  }

  function removeProfile(idx) {
    setLinkedProfiles((prev) => prev.filter((_, i) => i !== idx));
  }

  // Save
  async function handleSave() {
    if (!form.name) { setError('Driver Tariff Name is required'); return; }
    setSaving(true); setError(null);

    // Wrap the flat linkedProfiles into a single implicit charge set
    // for the API / DB (which still uses the driver_tariff_charge_sets
    // + driver_tariff_charge_set_profiles junction tables). Driver pay
    // doesn't use bill-to grouping, so pay_to_mode stays at a default.
    // pay_to_mode must match the check constraint on driver_tariff_charge_sets:
    // CHECK (pay_to_mode IN ('load_driver', 'specified')). 'load_driver' means
    // whichever driver is on the load at pay-calc time — the normal case now
    // that the UI flattened charge sets away from the old "assigned driver"
    // language.
    const charge_sets = linkedProfiles.length > 0
      ? [{
          pay_to_mode: 'load_driver',
          pay_to_driver_id: null,
          profiles: linkedProfiles,
          items: [],
        }]
      : [];

    const payload = {
      ...form,
      priority: Number(form.priority) || 0,
      effective_start: form.effective_start || null,
      effective_end: form.effective_end || null,
      charge_sets,
    };

    try {
      const url = isNew ? '/api/tenant/ap/tariffs' : `/api/tenant/ap/tariffs/${id}`;
      const method = isNew ? 'POST' : 'PUT';
      const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      if (!res.ok) { const body = await res.json().catch(() => ({})); throw new Error(body.error || 'Failed to save'); }
      // The main POST/PUT endpoint handles charge_sets inline (including
      // junction writes to driver_tariff_charge_set_profiles). No
      // follow-up /charge-sets call needed — the dedicated sub-endpoint
      // doesn't even exist.

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
        <DriverTariffHeader
          matchingMode={form.matching_mode}
          onMatchingModeChange={(mode) => update('matching_mode', mode)}
        />

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

          <DriverPayPanel
            linkedProfiles={linkedProfiles}
            onOpenPicker={openProfilePicker}
            onRemoveProfile={removeProfile}
          />
        </div>

        {/* Bottom actions */}
        <div className="flex justify-end gap-3 pt-4 mt-4 border-t border-gray-200 dark:border-slate-700">
          <Button variant="secondary" onClick={handleCancel}>Cancel</Button>
          <Button onClick={handleSave} loading={saving}>
            {isNew ? 'Create Driver Tariff' : 'Update Driver Tariff'}
          </Button>
        </div>
      </div>

      {/* Driver Charge Profile Picker Modal */}
      <ChargeProfilePickerModal
        isOpen={profilePickerOpen}
        onClose={() => setProfilePickerOpen(false)}
        onSelect={handleProfilesSelected}
        existingIds={linkedProfiles.map((p) => p.charge_profile_id)}
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
