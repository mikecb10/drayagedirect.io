import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import SettingsLayout from '../../../components/settings/SettingsLayout';
import Button from '../../../components/ui/Button';
import Alert from '../../../components/ui/Alert';
import ChargeProfilePickerModal from '../../../components/settings/tariff-detail/ChargeProfilePickerModal';
import TariffHeader from '../../../components/settings/tariff-detail/TariffHeader';
import TariffMatchingPanel from '../../../components/settings/tariff-detail/TariffMatchingPanel';
import TariffChargeSetsPanel from '../../../components/settings/tariff-detail/TariffChargeSetsPanel';
import TariffAdvancedRoutePanel from '../../../components/settings/tariff-detail/TariffAdvancedRoutePanel';

export default function TariffForm({ tariffId: propTariffId, onClose: onCloseProp }) {
  const router = useRouter();
  const id = propTariffId || router.query.id;
  const isNew = id === 'new';
  const isReady = propTariffId ? true : router.isReady;
  const isOverlay = typeof onCloseProp === 'function';

  const [form, setForm] = useState({
    name: '',
    status: 'draft',
    effective_start: '',
    effective_end: '',
    matching_mode: 'basic',
    load_types: [],
    customer_ids: [],
    pickup_conditions: { all: true },
    delivery_conditions: { all: true },
    return_conditions: {},
    container_type: '',
    container_size: '',
    ssl_id: null,
    csr_user_id: null,
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

  // Customer labels cache
  const [customerLabels, setCustomerLabels] = useState({});

  // Advanced route state — separate from form so the panel can emit
  // the whole blob atomically. Toggling back to Basic does NOT clear
  // this (preserve-on-toggle) — see spec "so re-entering Advanced
  // restores it".
  const [advancedRoute, setAdvancedRoute] = useState(null);
  const [routingTemplates, setRoutingTemplates] = useState([]);

  useEffect(() => {
    if (!isReady) return;
    async function load() {
      try {
        if (isNew) { setLoading(false); return; }
        if (!id) return;
        const res = await fetch(`/api/tenant/tariffs/${id}`);
        if (!res.ok) throw new Error('Failed to load');
        const { tariff: t } = await res.json();

        setForm({
          name: t.name || '',
          status: t.status || 'draft',
          effective_start: t.effective_start || '',
          effective_end: t.effective_end || '',
          matching_mode: t.matching_mode || 'basic',
          load_types: t.load_types || [],
          customer_ids: t.customer_ids || [],
          pickup_conditions: t.pickup_conditions || { all: true },
          delivery_conditions: t.delivery_conditions || { all: true },
          return_conditions: t.return_conditions || {},
          container_type: t.container_type || '',
          container_size: t.container_size || '',
          ssl_id: t.ssl_id || null,
          csr_user_id: t.csr_user_id || null,
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
          setChargeSets(t.charge_sets.map((cs) => ({
            id: cs.id,
            bill_to_mode: cs.bill_to_mode || 'load_customer',
            bill_to_customer_id: cs.bill_to_customer_id || null,
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

  // Fetch routing templates once (used for seeding the advanced-route
  // builder). Silent on failure — the picker just stays empty.
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
  const [profilePickerTarget, setProfilePickerTarget] = useState(null); // charge set index

  // Add charge set
  function addChargeSet() {
    setChargeSets((prev) => [...prev, {
      bill_to_mode: 'load_customer',
      bill_to_customer_id: null,
      profiles: [],
      items: [],
    }]);
  }

  function removeChargeSet(idx) {
    setChargeSets((prev) => prev.filter((_, i) => i !== idx));
  }

  function updateChargeSet(idx, field, value) {
    setChargeSets((prev) => prev.map((cs, i) =>
      i === idx ? { ...cs, [field]: value } : cs
    ));
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
    if (!form.name) { setError('Load Tariff Name is required'); return; }
    setSaving(true); setError(null);

    const payload = {
      ...form,
      effective_start: form.effective_start || null,
      effective_end: form.effective_end || null,
      charge_sets: chargeSets,
    };
    // Only send advanced_route when the tariff is in advanced mode.
    // Absent key = no-op on the server (PUT preserves the saved row).
    // This is how toggling Basic <-> Advanced doesn't destroy work.
    if (form.matching_mode === 'advanced_route') {
      payload.advanced_route = advancedRoute;
    }

    try {
      const url = isNew ? '/api/tenant/tariffs' : `/api/tenant/tariffs/${id}`;
      const method = isNew ? 'POST' : 'PUT';
      const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      if (!res.ok) { const body = await res.json().catch(() => ({})); throw new Error(body.error || 'Failed to save'); }
      const tariffData = await res.json();
      const tariffId = tariffData.tariff?.id || id;

      // Sync charge sets
      if (tariffId && chargeSets.length > 0) {
        const csPayload = chargeSets.map((cs) => ({
          bill_to_mode: cs.bill_to_mode || 'load_customer',
          bill_to_customer_id: cs.bill_to_customer_id || null,
          profile_ids: (cs.profiles || []).map((p) => p.charge_profile_id).filter(Boolean),
          items: cs.items || [],
          tags: cs.tags || [],
        }));
        await fetch(`/api/tenant/tariffs/${tariffId}/charge-sets`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ charge_sets: csPayload }),
        });
      }

      if (isOverlay) {
        onCloseProp();
      } else {
        router.push('/settings/tariffs');
      }
    } catch (e) { setError(e.message); }
    finally { setSaving(false); }
  }

  function handleCancel() {
    if (isOverlay) {
      onCloseProp();
    } else {
      router.push('/settings/tariffs');
    }
  }

  const formContent = () => {
    if (loading) {
      return <div className="py-20 text-center text-gray-400 dark:text-slate-500">Loading...</div>;
    }

    return (
      <>
      <div className="max-w-7xl pb-20">
        {/* Header */}
        <TariffHeader
          matchingMode={form.matching_mode}
          onMatchingModeChange={(mode) => update('matching_mode', mode)}
        />

        {error && <Alert type="error" message={error} onClose={() => setError(null)} />}

        {/* Two-panel layout like PP */}
        <div className="flex gap-0 rounded-xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-900 min-h-[calc(100vh-200px)]">

          {/* ═══════════════════════════════════════════ */}
          {/* LEFT PANEL — Load Matching Conditions       */}
          {/* ═══════════════════════════════════════════ */}
          <TariffMatchingPanel
            form={form}
            update={update}
            toggleLoadType={toggleLoadType}
            toggleFlag={toggleFlag}
            toggleLocationAll={toggleLocationAll}
            addLocationId={addLocationId}
            removeLocationId={removeLocationId}
            isLocationAll={isLocationAll}
            showAdditional={showAdditional}
            onShowAdditionalChange={setShowAdditional}
            customerLabels={customerLabels}
            setCustomerLabels={setCustomerLabels}
          />

          {/* ═══════════════════════════════════════════ */}
          {/* RIGHT PANEL — Charge Sets                   */}
          {/* ═══════════════════════════════════════════ */}
          <TariffChargeSetsPanel
            chargeSets={chargeSets}
            onAddChargeSet={addChargeSet}
            onRemoveChargeSet={removeChargeSet}
            onOpenProfilePicker={openProfilePicker}
            onRemoveProfile={removeProfile}
            onAddChargeItem={addChargeItem}
            onUpdateChargeItem={updateChargeItem}
            onRemoveChargeItem={removeChargeItem}
            onUpdateChargeSet={updateChargeSet}
          />
        </div>

        {/* Bottom actions */}
        <div className="flex justify-end gap-3 pt-4 mt-4 border-t border-gray-200 dark:border-slate-700">
          <Button variant="secondary" onClick={handleCancel}>Cancel</Button>
          <Button onClick={handleSave} loading={saving}>
            {isNew ? 'Create Load Tariff' : 'Update Load Tariff'}
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
    <SettingsLayout title={isNew ? 'Add Load Tariff' : 'Edit Load Tariff'}>
      {formContent()}
    </SettingsLayout>
  );
}

