import { useEffect, useState } from 'react';
import { User, Sliders, Smartphone, FileText } from 'lucide-react';
import Modal from '../ui/Modal';
import Button from '../ui/Button';
import DetailTabs from '../ui/DetailTabs';
import Alert from '../ui/Alert';
import DriverInfoTab from './tabs/DriverInfoTab';
import DriverPreferencesTab from './tabs/DriverPreferencesTab';
import DriverMobilePermissionsTab from './tabs/DriverMobilePermissionsTab';
import DriverNotesTab from './tabs/DriverNotesTab';

const EMPTY = {
  first_name: '',
  last_name: '',
  username: '',
  email: '',
  phone: '',
  profile_type: [],
  date_of_birth: '',
  date_of_hire: '',
  billing_email: '',
  home_branch_timezone: '',
  default_start_location: '',
  medical_exp: '',
  twic_exp: '',
  sea_link_exp: '',
  license_expiry: '',
  license_number: '',
  license_state: '',
  ocac_insurance_exp: '',
  termination_date: '',
  sealink_number: '',
  register_business_name: '',
  hst_number: '',
  social_security: '',
  tablet_number: '',
  eld_number: '',
  eld_connected: false,
  fuel_card: '',
  ez_pass: '',
  bank_account: '',
  routing_number: '',
  emergency_contact_name: '',
  emergency_relation: '',
  emergency_phone: '',
  truck_owner: '',
  carrier_name: '',
  main_office_address: '',
  tshirt_size: '',
  permanent_address: '',
  truck_number: '',
  trailer_number: '',
  driver_shift: 'day',
  min_miles: '',
  max_miles: '',
  endorsements: {},
  pay_type: 'flat',
  pay_rate_cents: '',
  hst_pct: '',
  disable_driver_pay: false,
  hide_settlements: false,
  mobile_permissions: {},
  status: 'active',
  notes: '',
};

const TABS = [
  { id: 'driver', label: 'Driver', icon: User },
  { id: 'preferences', label: 'Preferences', icon: Sliders },
  { id: 'mobile', label: 'Mobile Permissions', icon: Smartphone },
  { id: 'notes', label: 'Notes', icon: FileText },
];

export default function DriverModal({ isOpen, onClose, onSuccess, editing = null }) {
  const [form, setForm] = useState(EMPTY);
  const [activeTab, setActiveTab] = useState('driver');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (isOpen) {
      setError(null);
      setActiveTab('driver');
      setForm(editing ? { ...EMPTY, ...editing } : EMPTY);
    }
  }, [isOpen, editing]);

  function update(field, value) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      if (!form.first_name && !form.last_name) {
        throw new Error('First and last name are required');
      }

      const url = editing ? `/api/tenant/drivers/${editing.id}` : '/api/tenant/drivers';
      const method = editing ? 'PUT' : 'POST';

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || 'Failed to save driver');
      }
      const data = await res.json();
      onSuccess?.(data.driver);
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
      title={editing ? `Edit ${editing.name || 'Driver'}` : 'Add Driver'}
      size="lg"
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        {error && <Alert type="error" message={error} />}

        <DetailTabs tabs={TABS} active={activeTab} onChange={setActiveTab} />

        <div className="min-h-[400px]">
          {activeTab === 'driver' && <DriverInfoTab form={form} update={update} />}
          {activeTab === 'preferences' && (
            <DriverPreferencesTab form={form} update={update} />
          )}
          {activeTab === 'mobile' && (
            <DriverMobilePermissionsTab form={form} update={update} />
          )}
          {activeTab === 'notes' && <DriverNotesTab form={form} update={update} />}
        </div>

        <div className="flex justify-end gap-3 pt-4 border-t border-gray-100 dark:border-slate-800">
          <Button variant="secondary" type="button" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" loading={submitting}>
            {editing ? 'Save Changes' : 'Add Driver'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
