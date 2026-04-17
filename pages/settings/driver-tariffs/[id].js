import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import SettingsLayout from '../../../components/settings/SettingsLayout';
import Button from '../../../components/ui/Button';
import ChargeProfilePickerModal from '../../../components/settings/driver-tariff-detail/ChargeProfilePickerModal';
import DriverTariffHeader from '../../../components/settings/driver-tariff-detail/DriverTariffHeader';
import DriverPayPanel from '../../../components/settings/driver-tariff-detail/DriverPayPanel';
import DriverTariffMatchingPanel from '../../../components/settings/driver-tariff-detail/DriverTariffMatchingPanel';
import DriverTariffAdvancedRoutePanel from '../../../components/settings/driver-tariff-detail/DriverTariffAdvancedRoutePanel';
import Alert from '../../../components/ui/Alert';

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

  // Advanced route state. Preserved when toggling back to Basic
  // (see matching payload logic in handleSave).
  const [advancedRoute, setAdvancedRoute] = useState(null);
  const [routingTemplates, setRoutingTemplates] = useState([]);

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

        setAdvancedRoute(t.advanced_route || null);

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

  useEffect(() => {
    async function loadTemplates() {
      try {
        const res = await fetch('/api/tenant/routing-templates');
        if (res.ok) {
          const body = await res.json();
          setRoutingTemplates(body.templates || []);
        }
      } catch { /* silent */ }
    }
    loadTemplates();
  }, []);

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
    if (form.matching_mode === 'advanced_route') {
      payload.advanced_route = advancedRoute;
    }

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

    return (
      <>
      <div className="max-w-7xl pb-20">
        <DriverTariffHeader
          matchingMode={form.matching_mode}
          onMatchingModeChange={(mode) => update('matching_mode', mode)}
        />

        {error && <Alert type="error" message={error} onClose={() => setError(null)} />}

        {form.matching_mode === 'advanced_route' ? (
          <>
            <div className="flex gap-3 rounded-xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-0 mb-4">
              <DriverTariffMatchingPanel
                form={form}
                update={update}
                toggleLoadType={toggleLoadType}
                toggleFlag={toggleFlag}
                toggleLocationAll={toggleLocationAll}
                addLocationId={addLocationId}
                removeLocationId={removeLocationId}
                isLocationAll={isLocationAll}
                showAdditional={showAdditional}
                onToggleAdditional={() => setShowAdditional((s) => !s)}
                isAdvanced
              />
              <div className="flex-1 p-3">
                <DriverTariffAdvancedRoutePanel
                  value={advancedRoute}
                  onChange={setAdvancedRoute}
                  routingTemplates={routingTemplates}
                />
              </div>
            </div>

            <div className="rounded-xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-900">
              <DriverPayPanel
                linkedProfiles={linkedProfiles}
                onOpenPicker={openProfilePicker}
                onRemoveProfile={removeProfile}
              />
            </div>
          </>
        ) : (
          <div className="flex gap-0 rounded-xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-900 min-h-[calc(100vh-200px)]">
            <DriverTariffMatchingPanel
              form={form}
              update={update}
              toggleLoadType={toggleLoadType}
              toggleFlag={toggleFlag}
              toggleLocationAll={toggleLocationAll}
              addLocationId={addLocationId}
              removeLocationId={removeLocationId}
              isLocationAll={isLocationAll}
              showAdditional={showAdditional}
              onToggleAdditional={() => setShowAdditional((s) => !s)}
            />
            <DriverPayPanel
              linkedProfiles={linkedProfiles}
              onOpenPicker={openProfilePicker}
              onRemoveProfile={removeProfile}
            />
          </div>
        )}

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
