import { useEffect, useState } from 'react';
import Modal from '../ui/Modal';
import Button from '../ui/Button';
import Input from '../ui/Input';
import Select from '../ui/Select';
import Checkbox from '../ui/Checkbox';
import DatePicker from '../ui/DatePicker';
import FormSection from '../ui/FormSection';
import Alert from '../ui/Alert';

/**
 * Generic equipment modal supporting trucks, chassis, and trailers.
 * Props:
 *   type: 'trucks' | 'chassis' | 'trailers'
 *   numberField: 'truck_number' | 'chassis_number' | 'trailer_number'
 *   ownerField: 'truck_owner' | 'chassis_owner' | 'trailer_owner'
 *   typeLabel: display label (e.g. "Truck")
 */
const CONFIGS = {
  trucks: {
    numberField: 'truck_number',
    numberLabel: 'Truck Number',
    ownerField: 'truck_owner',
    typeLabel: 'Truck',
    responseKey: 'truck',
    extras: ['year', 'make', 'model', 'address', 'annual_inspection_date', 'hut_exp', 'itd_number'],
  },
  chassis: {
    numberField: 'chassis_number',
    numberLabel: 'Chassis Number',
    ownerField: 'chassis_owner',
    typeLabel: 'Chassis',
    responseKey: 'chassis',
    extras: ['chassis_type', 'chassis_size', 'gps_device_id'],
  },
  trailers: {
    numberField: 'trailer_number',
    numberLabel: 'Trailer Number',
    ownerField: 'trailer_owner',
    typeLabel: 'Trailer',
    responseKey: 'trailer',
    extras: ['trailer_type'],
  },
};

export default function EquipmentModal({ isOpen, onClose, onSuccess, type, editing = null }) {
  const config = CONFIGS[type];
  const [form, setForm] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [chassisOwners, setChassisOwners] = useState([]);
  const [chassisTypes, setChassisTypes] = useState([]);
  const [chassisSizes, setChassisSizes] = useState([]);

  useEffect(() => {
    if (isOpen) {
      setError(null);
      setForm(
        editing
          ? { ...editing }
          : {
              [config.numberField]: '',
              [config.ownerField]: '',
              license_plate: '',
              license_plate_state: '',
              vin: '',
              registration_exp: '',
              inspection_exp: '',
              is_enabled: true,
              notes: '',
            }
      );
      // Fetch chassis reference data for dropdowns when opening a chassis modal
      if (type === 'chassis') {
        fetch('/api/tenant/chassis-owners')
          .then((r) => (r.ok ? r.json() : { chassis_owners: [] }))
          .then((data) => setChassisOwners(data.chassis_owners || []))
          .catch(() => setChassisOwners([]));
        fetch('/api/tenant/chassis-types')
          .then((r) => (r.ok ? r.json() : { items: [] }))
          .then((data) => setChassisTypes(data.items || []))
          .catch(() => setChassisTypes([]));
        fetch('/api/tenant/chassis-sizes')
          .then((r) => (r.ok ? r.json() : { items: [] }))
          .then((data) => setChassisSizes(data.items || []))
          .catch(() => setChassisSizes([]));
      }
    }
  }, [isOpen, editing, type]);

  function update(field, value) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);

    try {
      if (!form[config.numberField]) {
        throw new Error(`${config.numberLabel} is required`);
      }

      const url = editing
        ? `/api/tenant/equipment/${type}/${editing.id}`
        : `/api/tenant/equipment/${type}`;
      const method = editing ? 'PUT' : 'POST';

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Failed to save ${config.typeLabel.toLowerCase()}`);
      }

      const data = await res.json();
      onSuccess?.(data[config.responseKey]);
    } catch (e) {
      setError(e.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={editing ? `Edit ${config.typeLabel}` : `Add ${config.typeLabel}`}
      size="lg"
    >
      <form onSubmit={handleSubmit} className="space-y-6">
        {error && <Alert type="error" message={error} />}

        <FormSection title="Identity">
          <Input
            label={config.numberLabel}
            value={form[config.numberField] || ''}
            onChange={(e) => update(config.numberField, e.target.value)}
            required
          />
          {type === 'chassis' ? (
            <Select
              label="Owner"
              value={form[config.ownerField] || ''}
              onChange={(e) => update(config.ownerField, e.target.value)}
              options={chassisOwners.map((o) => ({
                value: o.name,
                label: o.is_own_fleet ? `${o.name} (Own Fleet)` : o.name,
              }))}
              placeholder="— Select chassis owner —"
            />
          ) : (
            <Input
              label="Owner"
              value={form[config.ownerField] || ''}
              onChange={(e) => update(config.ownerField, e.target.value)}
              placeholder="Company or individual"
            />
          )}
          <Input
            label="VIN"
            value={form.vin || ''}
            onChange={(e) => update('vin', e.target.value)}
          />
          {type === 'trucks' && (
            <>
              <Input
                label="Year"
                type="number"
                value={form.year || ''}
                onChange={(e) => update('year', e.target.value ? Number(e.target.value) : null)}
              />
              <Input
                label="Make"
                value={form.make || ''}
                onChange={(e) => update('make', e.target.value)}
              />
              <Input
                label="Model"
                value={form.model || ''}
                onChange={(e) => update('model', e.target.value)}
              />
            </>
          )}
          {type === 'chassis' && (
            <>
              <Select
                label="Chassis Type"
                value={form.chassis_type || ''}
                onChange={(e) => update('chassis_type', e.target.value)}
                options={chassisTypes.map((t) => ({
                  value: t.name || t.label,
                  label: t.name || t.label,
                }))}
                placeholder="— Select chassis type —"
              />
              <Select
                label="Chassis Size"
                value={form.chassis_size || ''}
                onChange={(e) => update('chassis_size', e.target.value)}
                options={chassisSizes.map((s) => ({
                  value: s.name || s.label,
                  label: s.name || s.label,
                }))}
                placeholder="— Select chassis size —"
              />
              <Input
                label="GPS Device ID"
                value={form.gps_device_id || ''}
                onChange={(e) => update('gps_device_id', e.target.value)}
              />
            </>
          )}
          {type === 'trailers' && (
            <Input
              label="Trailer Type"
              value={form.trailer_type || ''}
              onChange={(e) => update('trailer_type', e.target.value)}
            />
          )}
        </FormSection>

        <FormSection title="License & Registration">
          <Input
            label="License Plate"
            value={form.license_plate || ''}
            onChange={(e) => update('license_plate', e.target.value)}
          />
          <Input
            label="License Plate State"
            value={form.license_plate_state || ''}
            onChange={(e) => update('license_plate_state', e.target.value)}
          />
          <DatePicker
            label="Registration Expiration"
            value={form.registration_exp}
            onChange={(v) => update('registration_exp', v)}
          />
          <DatePicker
            label="Inspection Expiration"
            value={form.inspection_exp}
            onChange={(v) => update('inspection_exp', v)}
          />
          {type === 'trucks' && (
            <>
              <DatePicker
                label="Annual Inspection Date (AID)"
                value={form.annual_inspection_date}
                onChange={(v) => update('annual_inspection_date', v)}
              />
              <DatePicker
                label="HUT Expiration"
                value={form.hut_exp}
                onChange={(v) => update('hut_exp', v)}
              />
              <Input
                label="ITD Number"
                value={form.itd_number || ''}
                onChange={(e) => update('itd_number', e.target.value)}
              />
              <Input
                label="Address"
                value={form.address || ''}
                onChange={(e) => update('address', e.target.value)}
              />
            </>
          )}
        </FormSection>

        <FormSection title="Status" columns={1}>
          <Checkbox
            checked={!!form.is_enabled}
            onChange={(v) => update('is_enabled', v)}
            label="Enabled"
            description="Disable to remove from active equipment lists without deleting"
          />
          {type === 'trucks' && (
            <Checkbox
              checked={!!form.use_for_pre_appointment}
              onChange={(v) => update('use_for_pre_appointment', v)}
              label="Use for pre-appointment"
            />
          )}
        </FormSection>

        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-slate-200 mb-1">Notes</label>
          <textarea
            value={form.notes || ''}
            onChange={(e) => update('notes', e.target.value)}
            rows={2}
            className="block w-full rounded-lg border border-gray-300 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 px-3 py-2 text-sm focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 dark:focus:ring-blue-900/40"
          />
        </div>

        <div className="flex justify-end gap-3 pt-2 border-t border-gray-100 dark:border-slate-800">
          <Button variant="secondary" type="button" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" loading={submitting}>
            {editing ? 'Save Changes' : `Add ${config.typeLabel}`}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
