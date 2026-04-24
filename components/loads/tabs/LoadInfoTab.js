import { useEffect, useState, useCallback, useRef } from 'react';
import Input from '../../ui/Input';
import Select from '../../ui/Select';
import DatePicker from '../../ui/DatePicker';
import DateTimePicker from '../../ui/DateTimePicker';
import Checkbox from '../../ui/Checkbox';
import FormSection from '../../ui/FormSection';
import OrgPicker from '../../ui/OrgPicker';
import ContainerOwnerPicker from '../../ui/ContainerOwnerPicker';
import ReferenceDataPicker from '../../ui/ReferenceDataPicker';
import BranchPicker from '../../ui/BranchPicker';
import { Package, Box, Truck, Ruler } from 'lucide-react';
import Alert from '../../ui/Alert';
import { useTenantTimeFormat } from '../../../hooks/useTenantSettings';

// Per-type location slot labels (matches NewLoadModal TYPE_CONFIG)
const TYPE_SLOTS = {
  import: {
    slot1: { label: 'Pickup Location', orgType: 'terminal' },
    slot2: { label: 'Delivery Location', orgType: 'warehouse' },
    slot3: { label: 'Return Location', orgType: 'terminal' },
    showFinalDelivery: false,
  },
  inbound: {
    slot1: { label: 'Pickup Location (Rail)', orgType: 'terminal' },
    slot2: { label: 'Delivery Location', orgType: 'warehouse' },
    slot3: { label: 'Return Location (Rail)', orgType: 'terminal' },
    showFinalDelivery: false,
  },
  export: {
    slot1: { label: 'Empty Container Pickup', orgType: 'terminal' },
    slot2: { label: 'Loading Warehouse', orgType: 'warehouse' },
    slot3: { label: 'Delivery Terminal', orgType: 'terminal' },
    showFinalDelivery: false,
  },
  outbound: {
    slot1: { label: 'Empty Container Pickup', orgType: 'terminal' },
    slot2: { label: 'Loading Warehouse', orgType: 'warehouse' },
    slot3: { label: 'Delivery Terminal (Rail)', orgType: 'terminal' },
    showFinalDelivery: true,
  },
  road: {
    slot1: { label: 'Loading Warehouse', orgType: 'warehouse' },
    slot2: { label: 'Final Delivery', orgType: 'warehouse' },
    slot3: null,
    showFinalDelivery: false,
  },
  bill_only: {
    slot1: null,
    slot2: null,
    slot3: null,
    showFinalDelivery: false,
  },
};

const STATUS_OPTIONS = [
  { value: 'pending', label: 'Pending' },
  { value: 'dispatched', label: 'Dispatched' },
  { value: 'in_transit', label: 'In Transit' },
  { value: 'delivered', label: 'Delivered' },
  { value: 'completed', label: 'Completed' },
  { value: 'cancelled', label: 'Cancelled' },
];

const CONTAINER_SIZE_OPTIONS = [
  { value: '20', label: "20'" },
  { value: '40', label: "40'" },
  { value: '40HC', label: "40' HC" },
  { value: '45', label: "45'" },
];

const FLAGS = [
  { key: 'is_hazmat', label: 'Hazmat' },
  { key: 'is_overweight', label: 'Overweight' },
  { key: 'is_overheight', label: 'Overheight' },
  { key: 'is_liquor', label: 'Liquor' },
  { key: 'is_hot', label: 'Hot' },
  { key: 'is_genset', label: 'Genset' },
  { key: 'is_scale', label: 'Scale' },
  { key: 'is_ev', label: 'EV' },
  { key: 'is_street_turn', label: 'Street Turn' },
  { key: 'is_oog', label: 'Out of Gauge' },
  { key: 'is_bonded', label: 'Bonded' },
  { key: 'is_double', label: 'Double' },
  { key: 'is_tanker', label: 'Tanker' },
];

const HOLD_TYPES = [
  { key: 'freight', label: 'Freight' },
  { key: 'custom', label: 'Custom' },
  { key: 'terminal', label: 'Terminal' },
  { key: 'fees_storage', label: 'Fees / Storage' },
  { key: 'carrier', label: 'Carrier' },
  { key: 'other', label: 'Other' },
];

export default function LoadInfoTab({ load, holds: initialHolds, routingLocks, onSaved }) {
  // Derive per-field lock metadata from routing_locks (server-provided).
  // A location field is locked when the matching routing event has
  // arrived_at or departed_at — the dispatcher must go to the Routing
  // tab, clear the timestamp, then edit (or edit from Routing directly
  // and let the reverse cascade push the change back here).
  const lockFor = (key) => routingLocks?.[key] || { locked: false, reason: null };
  const pickupLock = lockFor('pickup');
  const deliveryLock = lockFor('delivery');
  const returnLock = lockFor('return');
  const lockHelpText = (lock) =>
    lock.locked
      ? `Locked — the driver has ${
          lock.reason === 'departed' ? 'departed' : 'arrived at'
        } this location. Edit from the Routing tab.`
      : undefined;
  const use24h = useTenantTimeFormat();
  const [form, setForm] = useState(() => ({ ...load }));
  const [holds, setHolds] = useState(() => {
    const byType = {};
    for (const ht of HOLD_TYPES) {
      const existing = (initialHolds || []).find((h) => h.hold_type === ht.key);
      byType[ht.key] = existing || { hold_type: ht.key, status: 'released', note: '' };
    }
    return byType;
  });
  const [error, setError] = useState(null);
  // Transient warning shown when an order-level location edit couldn't
  // fully cascade to the routing event (e.g. because the event is
  // already timestamped). The cascade still applies to unlocked events;
  // this flags the ones that didn't follow.
  const [warning, setWarning] = useState(null);
  const [flashFields, setFlashFields] = useState({}); // { fieldName: 'success' | 'error' }

  useEffect(() => {
    setForm({ ...load });
  }, [load]);

  function update(field, value) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  // Flash a field green (success) or red (error) for 1.5s
  function flash(field, type = 'success') {
    setFlashFields((f) => ({ ...f, [field]: type }));
    setTimeout(() => {
      setFlashFields((f) => {
        const next = { ...f };
        delete next[field];
        return next;
      });
    }, 1500);
  }

  // Auto-save with patch merging — never drops changes.
  // If a save is in flight, incoming patches are queued and merged.
  // When the current save finishes, the merged queue is sent as one PUT.
  const savingRef = useRef(false);
  const pendingPatchRef = useRef(null);
  const pendingFlashKeysRef = useRef([]);

  const autoSave = useCallback(
    async (patch, flashKey) => {
      if (!patch || Object.keys(patch).length === 0) return;

      // If a save is already in flight, merge this patch into the queue
      if (savingRef.current) {
        pendingPatchRef.current = { ...(pendingPatchRef.current || {}), ...patch };
        if (flashKey) pendingFlashKeysRef.current.push(flashKey);
        return;
      }

      savingRef.current = true;
      try {
        const res = await fetch(`/api/tenant/loads/${load.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(patch),
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(body.error || 'Save failed');
        }
        // Surface routing cascade warnings (e.g. locked events that the
        // sidebar location change couldn't propagate to). The save itself
        // succeeded — this just tells the user the routing tab didn't
        // follow automatically and they need to clear timestamps first.
        // Reset the warning on each successful save so stale messages
        // don't linger after the user fixes the issue.
        if (body.routing_cascade?.warnings?.length > 0) {
          setWarning(
            body.routing_cascade.warnings.map((w) => w.message).join(' ')
          );
        } else {
          setWarning(null);
        }
        if (flashKey) flash(flashKey, 'success');
        onSaved?.();
      } catch (e) {
        setError(e.message);
        if (flashKey) flash(flashKey, 'error');
      } finally {
        savingRef.current = false;

        // If patches accumulated while we were saving, flush them now
        if (pendingPatchRef.current) {
          const mergedPatch = pendingPatchRef.current;
          const mergedKeys = [...pendingFlashKeysRef.current];
          pendingPatchRef.current = null;
          pendingFlashKeysRef.current = [];
          // Recursive call to send the merged patch
          autoSave(mergedPatch, mergedKeys[0] || null);
          // Flash all queued keys
          mergedKeys.slice(1).forEach((k) => flash(k, 'success'));
        }
      }
    },
    [load.id, onSaved]
  );

  // For text inputs: update local state on change, save on blur
  function handleTextBlur(field) {
    if (form[field] !== load[field]) {
      autoSave({ [field]: form[field] }, field);
    }
  }

  // For multi-field text inputs (weight lbs/kg): save the pair on blur
  function handleWeightBlur(fields) {
    const patch = {};
    let changed = false;
    for (const f of fields) {
      if (form[f] !== load[f]) {
        patch[f] = form[f];
        changed = true;
      }
    }
    if (changed) autoSave(patch, fields[0]);
  }

  // For selects, pickers, dates, checkboxes: save immediately
  // Map of date fields → notification event_name. When these fields
  // transition from empty → set, we fire the matching notification
  // trigger so email templates configured for that event get dispatched.
  const NOTIFICATION_FIELDS = {
    empty_date: 'load_empty',
    ready_to_return_date: 'ready_to_return',
  };

  function fireNotificationIfNeeded(field, oldValue, newValue) {
    const eventName = NOTIFICATION_FIELDS[field];
    if (!eventName) return;
    // Only fire when transitioning from empty → set (not on updates or clears)
    const wasEmpty = !oldValue;
    const nowSet = !!newValue;
    if (wasEmpty && nowSet) {
      fetch('/api/tenant/emails/fire-notification', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ load_id: load.id, event_name: eventName }),
      }).catch((e) => console.error(`notification fire (${eventName}):`, e));
    }
  }

  function updateAndSave(field, value) {
    const oldValue = form[field];
    setForm((f) => ({ ...f, [field]: value }));
    autoSave({ [field]: value }, field);
    fireNotificationIfNeeded(field, oldValue, value);

    // Auto-copy apt_from → apt_to: when "From" is set and "To" is empty
    // or still matches the previous "From" value, mirror it automatically.
    // User can then manually override "To" for a buffer window.
    const aptPairs = {
      pickup_apt_from: 'pickup_apt_to',
      delivery_apt_from: 'delivery_apt_to',
      return_apt_from: 'return_apt_to',
    };
    const toField = aptPairs[field];
    if (toField && value) {
      const currentTo = form[toField];
      // Auto-fill To if it's empty or was previously auto-copied (matches old From)
      if (!currentTo || currentTo === oldValue) {
        setForm((f) => ({ ...f, [toField]: value }));
        autoSave({ [toField]: value }, toField);
      }
    }
  }

  // For pickers that update multiple fields at once (e.g. container_size_id + container_size)
  function updateMultiAndSave(patch, flashKey) {
    setForm((f) => ({ ...f, ...patch }));
    autoSave(patch, flashKey);
  }

  // Auto-save holds on change
  async function updateHoldAndSave(type, patch) {
    const newHold = { ...holds[type], ...patch };
    setHolds((h) => ({ ...h, [type]: newHold }));
    try {
      const res = await fetch(`/api/tenant/loads/${load.id}/holds`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          hold_type: type,
          status: newHold.status || 'released',
          note: newHold.note || null,
        }),
      });
      if (!res.ok) throw new Error('Failed to save hold');
      flash(`hold_${type}`, 'success');
    } catch (e) {
      flash(`hold_${type}`, 'error');
    }
  }

  // When customer changes, offer to update bill-to on existing charge sets
  async function handleCustomerChange(org) {
    const newId = org?.id || null;
    if (!newId || newId === form.customer_id) {
      updateAndSave('customer_id', newId);
      return;
    }

    // Save the customer change first
    updateAndSave('customer_id', newId);

    // Ask if they want to sync bill-to on existing charge sets
    const syncBillTo = confirm(
      `Update the "Bill To" party on all existing charge sets to match "${org.name}"?\n\n` +
      `Yes → All charge sets bill to ${org.name}\n` +
      `No → Keep existing bill-to parties unchanged`
    );

    if (syncBillTo) {
      try {
        // Fetch existing charge sets and update each one
        const csRes = await fetch(`/api/tenant/loads/${load.id}/charge-sets`);
        if (csRes.ok) {
          const csData = await csRes.json();
          const sets = csData.charge_sets || [];
          await Promise.all(
            sets.map((cs) =>
              fetch(`/api/tenant/loads/${load.id}/charge-sets/${cs.id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ bill_to_customer_id: newId }),
              })
            )
          );
          flash('customer_id', 'success');
        }
      } catch {
        // Non-critical — customer was already saved
      }
    }
  }

  // CSS class for flash effect
  function flashClass(field) {
    const f = flashFields[field];
    if (f === 'success') return 'ring-2 ring-emerald-400 bg-emerald-50/30 dark:bg-emerald-950/40 transition-all duration-300';
    if (f === 'error') return 'ring-2 ring-red-400 bg-red-50/30 dark:bg-red-950/40 transition-all duration-300';
    return 'transition-all duration-300';
  }

  return (
    <div className="space-y-5">
      {error && <Alert type="error" message={error} onClose={() => setError(null)} />}
      {warning && <Alert type="warning" message={warning} onClose={() => setWarning(null)} />}

      {/* 2-column layout: Left (Identity + Locations + References) | Right (Dates + Equipment + Cargo) */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">

      {/* ═══════ LEFT COLUMN ═══════ */}
      <div className="space-y-5">

      {/* Identity */}
      <FormSection title="Identity">
        <div>
          <label className="block text-sm font-medium text-muted mb-1">Load Type</label>
          <div className="rounded-lg border border-gray-200 dark:border-slate-700 bg-gray-50 dark:bg-slate-900 px-3 py-2.5 text-sm text-muted capitalize">
            {(form.load_type || 'import').replace('_', ' ')}
          </div>
          <p className="mt-[var(--space-field-helper)] text-helper text-muted">
            Load type is locked after creation — the load number embeds the type
            letter. Delete and recreate to change.
          </p>
        </div>
        <div className={`rounded-lg ${flashClass('status')}`}>
          <Select
            label="Status"
            value={form.status || 'pending'}
            onChange={(e) => updateAndSave('status', e.target.value)}
            options={STATUS_OPTIONS}
          />
        </div>
        <Input
          label="Routing Template"
          value={form.routing_template_name || ''}
          disabled
        />
        <div className={`rounded-lg ${flashClass('branch_id')}`}>
          <BranchPicker
            label="Branch"
            value={form.branch_id || ''}
            onChange={(val) => updateAndSave('branch_id', val)}
            placeholder="— No Branch —"
          />
        </div>
      </FormSection>

      {/* Customer */}
      <FormSection title="Customer">
        <div className={`sm:col-span-2 rounded-lg ${flashClass('customer_id')}`}>
          <OrgPicker
            label="Customer"
            type="customer"
            value={form.customer_id}
            valueLabel={load.customer?.name}
            onChange={handleCustomerChange}
            required
          />
        </div>
      </FormSection>

      {/* Pickup Location + Appointment */}
      {(() => {
        const slots = TYPE_SLOTS[form.load_type] || TYPE_SLOTS.import;
        if (!slots.slot1) return null;
        return (
          <FormSection title={slots.slot1.label}>
            <div className={`sm:col-span-2 rounded-lg ${flashClass('pickup_location_id')}`}>
              <OrgPicker
                label={slots.slot1.label}
                type={slots.slot1.orgType}
                value={form.pickup_location_id}
                valueLabel={load.pickup_org?.name}
                onChange={(org) => updateAndSave('pickup_location_id', org?.id || null)}
                disabled={pickupLock.locked}
                helpText={lockHelpText(pickupLock)}
              />
            </div>
            <div className={`rounded-lg ${flashClass('pickup_apt_from')}`}>
              <DateTimePicker
                label="Pickup Apt From"
                value={form.pickup_apt_from}
                onChange={(v) => updateAndSave('pickup_apt_from', v)}
                showTime
                use24h={use24h}
              />
            </div>
            <div className={`rounded-lg ${flashClass('pickup_apt_to')}`}>
              <DateTimePicker
                label="Pickup Apt To"
                value={form.pickup_apt_to}
                onChange={(v) => updateAndSave('pickup_apt_to', v)}
                showTime
                use24h={use24h}
              />
            </div>
          </FormSection>
        );
      })()}

      {/* Delivery Location + Appointment */}
      {(() => {
        const slots = TYPE_SLOTS[form.load_type] || TYPE_SLOTS.import;
        if (!slots.slot2) return null;
        return (
          <FormSection title={slots.slot2.label}>
            <div className={`sm:col-span-2 rounded-lg ${flashClass('delivery_location_id')}`}>
              <OrgPicker
                label={slots.slot2.label}
                type={slots.slot2.orgType}
                value={form.delivery_location_id}
                valueLabel={load.delivery_org?.name}
                onChange={(org) => updateAndSave('delivery_location_id', org?.id || null)}
                disabled={deliveryLock.locked}
                helpText={lockHelpText(deliveryLock)}
              />
            </div>
            <div className={`rounded-lg ${flashClass('delivery_apt_from')}`}>
              <DateTimePicker
                label="Delivery Apt From"
                value={form.delivery_apt_from}
                onChange={(v) => updateAndSave('delivery_apt_from', v)}
                showTime
                use24h={use24h}
              />
            </div>
            <div className={`rounded-lg ${flashClass('delivery_apt_to')}`}>
              <DateTimePicker
                label="Delivery Apt To"
                value={form.delivery_apt_to}
                onChange={(v) => updateAndSave('delivery_apt_to', v)}
                showTime
                use24h={use24h}
              />
            </div>
          </FormSection>
        );
      })()}

      {/* Return Location + Appointment */}
      {(() => {
        const slots = TYPE_SLOTS[form.load_type] || TYPE_SLOTS.import;
        if (!slots.slot3) return null;
        return (
          <FormSection title={slots.slot3.label}>
            <div className={`sm:col-span-2 rounded-lg ${flashClass('return_location_id')}`}>
              <OrgPicker
                label={slots.slot3.label}
                type={slots.slot3.orgType}
                value={form.return_location_id}
                valueLabel={load.return_org?.name}
                onChange={(org) => updateAndSave('return_location_id', org?.id || null)}
                disabled={returnLock.locked}
                helpText={lockHelpText(returnLock)}
              />
            </div>
            <div className={`rounded-lg ${flashClass('return_apt_from')}`}>
              <DateTimePicker
                label="Return Apt From"
                value={form.return_apt_from}
                onChange={(v) => updateAndSave('return_apt_from', v)}
                showTime
                use24h={use24h}
              />
            </div>
            <div className={`rounded-lg ${flashClass('return_apt_to')}`}>
              <DateTimePicker
                label="Return Apt To"
                value={form.return_apt_to}
                onChange={(v) => updateAndSave('return_apt_to', v)}
                showTime
                use24h={use24h}
              />
            </div>
          </FormSection>
        );
      })()}

      {/* Final Delivery (outbound only) */}
      {(() => {
        const slots = TYPE_SLOTS[form.load_type] || TYPE_SLOTS.import;
        if (!slots.showFinalDelivery) return null;
        return (
          <FormSection title="Final Delivery">
            <div className={`sm:col-span-2 rounded-lg ${flashClass('final_delivery_location_id')}`}>
              <OrgPicker
                label="Final Delivery Location"
                type="final_destination"
                value={form.final_delivery_location_id}
                valueLabel={load.final_delivery_org?.name}
                onChange={(org) => updateAndSave('final_delivery_location_id', org?.id || null)}
                helpText="Outbound final destination — where the load goes after the rail move"
              />
            </div>
          </FormSection>
        );
      })()}

      {/* Chassis Locations */}
      <FormSection
        title="Chassis Locations"
        description="Leave empty to assume chassis pickup/return at same location as container"
      >
        <div className={`rounded-lg ${flashClass('hook_chassis_location_id')}`}>
          <OrgPicker
            label="Hook Chassis Location"
            type="yard"
            value={form.hook_chassis_location_id}
            valueLabel={form.hook_chassis_location_id ? '—' : null}
            onChange={(org) => updateAndSave('hook_chassis_location_id', org?.id || null)}
            helpText="Where the driver picks up the chassis"
          />
        </div>
        <div className={`rounded-lg ${flashClass('terminate_chassis_location_id')}`}>
          <OrgPicker
            label="Terminate Chassis Location"
            type="yard"
            value={form.terminate_chassis_location_id}
            valueLabel={form.terminate_chassis_location_id ? '—' : null}
            onChange={(org) => updateAndSave('terminate_chassis_location_id', org?.id || null)}
            helpText="Where the driver returns the chassis"
          />
        </div>
      </FormSection>

      </div>{/* end left column */}

      {/* ═══════ RIGHT COLUMN ═══════ */}
      <div className="space-y-5">

      {/* Drayage Dates */}
      <FormSection
        title="Drayage Dates"
        description="Vessel schedule, port milestones, and appointment dates"
        columns={3}
      >
        {[
          ['vessel_eta', 'Vessel ETA', true],
          ['discharge_date', 'Discharge Date', true],
          ['last_free_day', 'Last Free Day', false],
          ['outgate_date', 'Outgate Date', true],
          ['pickup_date', 'Pickup Date', true],
          ['delivery_date', 'Delivery Date', true],
          ['empty_date', 'Empty Date', true],
          ['per_diem_free_day', 'Per Diem Free Day', false],
          ['ingate_date', 'Ingate Date', true],
          ['ready_to_return_date', 'Ready To Return', true],
          ['cutoff_date', 'Cutoff Date', true],
        ].map(([field, label, withTime]) => (
          <div key={field} className={`rounded-lg ${flashClass(field)}`}>
            <DateTimePicker
              label={label}
              value={form[field]}
              onChange={(v) => updateAndSave(field, v)}
              showTime={withTime}
              use24h={use24h}
            />
          </div>
        ))}
      </FormSection>

      {/* Container & Equipment */}
      <FormSection title="Container & Equipment">
        <div className={`rounded-lg ${flashClass('container_number')}`}>
          <Input
            label="Container Number"
            value={form.container_number || ''}
            onChange={(e) => update('container_number', e.target.value.toUpperCase())}
            onBlur={() => handleTextBlur('container_number')}
          />
        </div>
        <div className={`rounded-lg ${flashClass('container_size_id')}`}>
          <ReferenceDataPicker
            label="Container Size"
            endpoint="/api/tenant/container-sizes"
            icon={Ruler}
            value={form.container_size_id}
            valueLabel={form.container_size}
            onChange={(item) => {
              updateMultiAndSave({
                container_size_id: item?.id || null,
                container_size: item?.code || null,
              }, 'container_size_id');
            }}
          />
        </div>
        <div className={`rounded-lg ${flashClass('container_type_id')}`}>
          <ReferenceDataPicker
            label="Container Type"
            endpoint="/api/tenant/container-types"
            icon={Package}
            value={form.container_type_id}
            valueLabel={form.container_type}
            onChange={(item) => {
              updateMultiAndSave({
                container_type_id: item?.id || null,
                container_type: item?.label || null,
              }, 'container_type_id');
            }}
          />
        </div>
        <div className={`rounded-lg ${flashClass('seal_number')}`}>
          <Input
            label="Seal Number"
            value={form.seal_number || ''}
            onChange={(e) => update('seal_number', e.target.value)}
            onBlur={() => handleTextBlur('seal_number')}
          />
        </div>
        <div className={`rounded-lg ${flashClass('container_owner_id')}`}>
          <ContainerOwnerPicker
            label="Steamship Line"
            value={form.container_owner_id}
            valueLabel={form.steamship_line}
            onChange={(owner) => {
              if (owner) {
                updateMultiAndSave({
                  container_owner_id: owner.id,
                  steamship_line: owner.label || owner.name,
                  steamship_line_scac: owner.scac_code || '',
                }, 'container_owner_id');
              } else {
                updateMultiAndSave({
                  container_owner_id: null,
                  steamship_line: '',
                  steamship_line_scac: '',
                }, 'container_owner_id');
              }
            }}
            helpText="Pick from the reference list — SCAC auto-fills"
          />
        </div>
        <Input
          label="SSL SCAC"
          value={form.steamship_line_scac || ''}
          disabled
          helpText="Auto-populated from selected SSL"
        />
        <div className={`rounded-lg ${flashClass('chassis_number')}`}>
          <Input
            label="Chassis Number"
            value={form.chassis_number || ''}
            onChange={(e) => update('chassis_number', e.target.value)}
            onBlur={() => handleTextBlur('chassis_number')}
          />
        </div>
        <div className={`rounded-lg ${flashClass('chassis_size_id')}`}>
          <ReferenceDataPicker
            label="Chassis Size"
            endpoint="/api/tenant/chassis-sizes"
            icon={Ruler}
            value={form.chassis_size_id}
            valueLabel={form.chassis_size}
            onChange={(item) => {
              updateMultiAndSave({
                chassis_size_id: item?.id || null,
                chassis_size: item?.code || null,
              }, 'chassis_size_id');
            }}
          />
        </div>
        <div className={`rounded-lg ${flashClass('chassis_type_id')}`}>
          <ReferenceDataPicker
            label="Chassis Type"
            endpoint="/api/tenant/chassis-types"
            icon={Truck}
            value={form.chassis_type_id}
            valueLabel={form.chassis_type}
            onChange={(item) => {
              updateMultiAndSave({
                chassis_type_id: item?.id || null,
                chassis_type: item?.label || null,
              }, 'chassis_type_id');
            }}
          />
        </div>
        <div className={`rounded-lg ${flashClass('chassis_owner')}`}>
          <Input
            label="Chassis Owner"
            value={form.chassis_owner || ''}
            onChange={(e) => update('chassis_owner', e.target.value)}
            onBlur={() => handleTextBlur('chassis_owner')}
          />
        </div>
        <div className={`rounded-lg ${flashClass('genset_number')}`}>
          <Input
            label="Genset Number"
            value={form.genset_number || ''}
            onChange={(e) => update('genset_number', e.target.value)}
            onBlur={() => handleTextBlur('genset_number')}
          />
        </div>
        <div className={`rounded-lg ${flashClass('genset_temperature')}`}>
          <Input
            label="Genset Temperature (°F)"
            type="number"
            value={form.genset_temperature ?? ''}
            onChange={(e) =>
              update('genset_temperature', e.target.value === '' ? null : Number(e.target.value))
            }
            onBlur={() => handleTextBlur('genset_temperature')}
          />
        </div>
        <div className={`rounded-lg ${flashClass('genset_route')}`}>
          <Input
            label="Genset Route"
            value={form.genset_route || ''}
            onChange={(e) => update('genset_route', e.target.value)}
            onBlur={() => handleTextBlur('genset_route')}
          />
        </div>
        <div className={`rounded-lg ${flashClass('genset_scac')}`}>
          <Input
            label="Genset SCAC"
            value={form.genset_scac || ''}
            onChange={(e) => update('genset_scac', e.target.value)}
            onBlur={() => handleTextBlur('genset_scac')}
          />
        </div>
      </FormSection>

      {/* Cargo */}
      <FormSection
        title="Cargo"
        description="Cargo metrics — piece count, pallet count, weight, and commodity description"
        columns={3}
      >
        <div className={`rounded-lg ${flashClass('piece_count')}`}>
          <Input label="Piece Count" type="number" value={form.piece_count ?? ''} placeholder="0"
            onChange={(e) => update('piece_count', e.target.value === '' ? null : parseInt(e.target.value, 10))}
            onBlur={() => handleTextBlur('piece_count')} />
        </div>
        <div className={`rounded-lg ${flashClass('pallet_count')}`}>
          <Input label="Pallet Count" type="number" value={form.pallet_count ?? ''} placeholder="0"
            onChange={(e) => update('pallet_count', e.target.value === '' ? null : parseInt(e.target.value, 10))}
            onBlur={() => handleTextBlur('pallet_count')} />
        </div>
        <div />
        <div className={`rounded-lg ${flashClass('weight_lbs')}`}>
          <Input label="Weight (lbs)" type="number" value={form.weight_lbs ?? ''} placeholder="0" helpText="Auto-converts to kg"
            onChange={(e) => {
              const lbs = e.target.value === '' ? null : Number(e.target.value);
              update('weight_lbs', lbs);
              if (lbs != null) update('weight_kg', Math.round(lbs * 0.453592 * 100) / 100);
              else update('weight_kg', null);
            }}
            onBlur={() => handleWeightBlur(['weight_lbs', 'weight_kg'])} />
        </div>
        <div className={`rounded-lg ${flashClass('weight_kg')}`}>
          <Input label="Weight (kg)" type="number" value={form.weight_kg ?? ''} placeholder="0" helpText="Auto-converts to lbs"
            onChange={(e) => {
              const kg = e.target.value === '' ? null : Number(e.target.value);
              update('weight_kg', kg);
              if (kg != null) update('weight_lbs', Math.round(kg * 2.20462));
              else update('weight_lbs', null);
            }}
            onBlur={() => handleWeightBlur(['weight_kg', 'weight_lbs'])} />
        </div>
        <div />
        <div className={`rounded-lg sm:col-span-3 ${flashClass('commodity_description')}`}>
          <Input label="Commodity Description" value={form.commodity_description || ''}
            onChange={(e) => update('commodity_description', e.target.value)}
            onBlur={() => handleTextBlur('commodity_description')}
            placeholder="e.g. Auto parts, electronics, frozen foods" />
        </div>
      </FormSection>

      {/* Flags */}
      <FormSection
        title="Equipment & Cargo Flags"
        description="Special handling requirements for this load"
        columns={1}
      >
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
          {FLAGS.map((f) => (
            <div key={f.key} className={`rounded ${flashClass(f.key)}`}>
              <Checkbox
                checked={!!form[f.key]}
                onChange={(v) => updateAndSave(f.key, v)}
                label={f.label}
              />
            </div>
          ))}
        </div>
      </FormSection>

      </div>{/* end right column */}
      </div>{/* end 2-column grid */}

      {/* ═══════ FULL WIDTH SECTIONS (below the grid) ═══════ */}

      {/* Reference Numbers */}
      <FormSection title="Reference Numbers" columns={3}>
        {[
          ['bill_of_lading', 'Master BOL'],
          ['house_bol', 'House BOL'],
          ['customer_reference', 'Customer Reference'],
          ['booking_number', 'Booking Number'],
          ['vessel_name', 'Vessel Name'],
          ['voyage_number', 'Voyage Number'],
          ['shipment_number', 'Shipment Number'],
          ['pickup_number', 'Pickup Number'],
          ['appointment_number', 'Appointment Number'],
          ['return_number', 'Return Number'],
          ['reservation_number', 'Reservation Number'],
          ['delivery_reference', 'Delivery Reference'],
          ['work_order', 'Work Order'],
        ].map(([field, label]) => (
          <div key={field} className={`rounded-lg ${flashClass(field)}`}>
            <Input
              label={label}
              value={form[field] || ''}
              onChange={(e) => update(field, e.target.value)}
              onBlur={() => handleTextBlur(field)}
            />
          </div>
        ))}
      </FormSection>

      {/* Holds */}
      <FormSection
        title="Holds"
        description="Track hold statuses from various parties. A load with any active hold cannot move."
        columns={1}
      >
        <div className="space-y-2">
          {HOLD_TYPES.map((ht) => {
            const h = holds[ht.key];
            const isHold = h.status === 'hold';
            return (
              <div
                key={ht.key}
                className={`flex flex-col sm:flex-row sm:items-center gap-2 rounded-lg border p-3 ${
                  flashFields[`hold_${ht.key}`] === 'success'
                    ? 'border-emerald-400 bg-emerald-50/40 dark:bg-emerald-950/40'
                    : isHold ? 'border-red-200 dark:border-red-800 bg-red-50/40 dark:bg-red-950/40' : 'border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-900'
                } transition-all duration-300`}
              >
                <div className="w-36 text-body font-medium text-strong shrink-0">{ht.label}</div>
                <div className="flex gap-1">
                  <button
                    type="button"
                    onClick={() => updateHoldAndSave(ht.key, { status: 'hold' })}
                    className={`text-xs px-3 py-1 rounded-full font-medium ${
                      isHold
                        ? 'bg-red-600 text-white'
                        : 'bg-white dark:bg-slate-900 text-gray-600 dark:text-slate-300 border border-gray-200 dark:border-slate-700'
                    }`}
                  >
                    Hold
                  </button>
                  <button
                    type="button"
                    onClick={() => updateHoldAndSave(ht.key, { status: 'released' })}
                    className={`text-xs px-3 py-1 rounded-full font-medium ${
                      !isHold
                        ? 'bg-green-600 text-white'
                        : 'bg-white dark:bg-slate-900 text-gray-600 dark:text-slate-300 border border-gray-200 dark:border-slate-700'
                    }`}
                  >
                    Released
                  </button>
                </div>
                <input
                  type="text"
                  value={h.note || ''}
                  onChange={(e) => setHolds((hh) => ({ ...hh, [ht.key]: { ...hh[ht.key], note: e.target.value } }))}
                  onBlur={() => updateHoldAndSave(ht.key, { note: holds[ht.key]?.note || '' })}
                  placeholder="Optional note..."
                  className="flex-1 rounded-lg border border-gray-300 dark:border-slate-600 px-3 py-1.5 text-sm text-gray-900 dark:text-slate-100 placeholder-gray-400 dark:placeholder-slate-500 focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 dark:focus:ring-blue-900/40"
                />
              </div>
            );
          })}
        </div>
      </FormSection>

    </div>
  );
}
