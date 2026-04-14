import Input from '../../ui/Input';
import Select from '../../ui/Select';
import DatePicker from '../../ui/DatePicker';
import FormSection from '../../ui/FormSection';
import AddressAutocomplete from '../../ui/AddressAutocomplete';

const PROFILE_TYPES = [
  { value: 'company_driver', label: 'Company Driver' },
  { value: 'owner_operator', label: 'Owner-Operator' },
  { value: 'independent_contractor', label: 'Independent Contractor' },
  { value: 'subcontractor', label: 'Subcontractor' },
  { value: '3rd_party', label: '3rd Party Driver' },
  { value: 'agent_company', label: 'Agent - Company' },
  { value: 'port', label: 'Port' },
  { value: 'delivery', label: 'Delivery' },
  { value: 'trailer', label: 'Trailer' },
  { value: 'long_haul', label: 'Long Haul' },
  { value: 'temporary', label: 'Temporary' },
  { value: 'all', label: 'All' },
];

const TIMEZONE_OPTIONS = [
  { value: 'America/New_York', label: 'Eastern (ET) — New York' },
  { value: 'America/Chicago', label: 'Central (CT) — Chicago' },
  { value: 'America/Denver', label: 'Mountain (MT) — Denver' },
  { value: 'America/Los_Angeles', label: 'Pacific (PT) — Los Angeles' },
  { value: 'America/Anchorage', label: 'Alaska (AKT) — Anchorage' },
  { value: 'Pacific/Honolulu', label: 'Hawaii (HT) — Honolulu' },
  { value: 'America/Phoenix', label: 'Arizona (MST) — Phoenix' },
  { value: 'America/Indiana/Indianapolis', label: 'Indiana (ET) — Indianapolis' },
  { value: 'America/Detroit', label: 'Eastern (ET) — Detroit' },
  { value: 'America/Boise', label: 'Mountain (MT) — Boise' },
  { value: 'America/Kentucky/Louisville', label: 'Eastern (ET) — Louisville' },
  { value: 'America/Juneau', label: 'Alaska (AKT) — Juneau' },
];

export default function DriverInfoTab({ form, update }) {
  return (
    <div className="space-y-6">
      <FormSection title="Driver Info">
        <Input
          label="First Name"
          value={form.first_name || ''}
          onChange={(e) => update('first_name', e.target.value)}
          required
        />
        <Input
          label="Last Name"
          value={form.last_name || ''}
          onChange={(e) => update('last_name', e.target.value)}
          required
        />
        <Input
          label="Username"
          value={form.username || ''}
          onChange={(e) => update('username', e.target.value)}
          helpText="Used for mobile app login"
        />
        <Input
          label="Email"
          type="email"
          value={form.email || ''}
          onChange={(e) => update('email', e.target.value)}
        />
        <Input
          label="Phone"
          value={form.phone || ''}
          onChange={(e) => update('phone', e.target.value)}
        />
        <div className="sm:col-span-2">
          <label className="block text-xs font-semibold text-gray-700 dark:text-slate-300 mb-1.5">
            Profile Type
          </label>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
            {PROFILE_TYPES.map((pt) => {
              const types = Array.isArray(form.profile_type) ? form.profile_type : (form.profile_type ? [form.profile_type] : []);
              const checked = types.includes(pt.value);
              return (
                <label
                  key={pt.value}
                  className={`flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-xs font-medium cursor-pointer transition-colors ${
                    checked
                      ? 'border-blue-500 bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300'
                      : 'border-gray-200 dark:border-slate-700 text-gray-600 dark:text-slate-300 hover:border-gray-300 dark:hover:border-slate-600'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => {
                      const next = checked
                        ? types.filter((t) => t !== pt.value)
                        : [...types, pt.value];
                      update('profile_type', next);
                    }}
                    className="rounded text-blue-600 w-3.5 h-3.5"
                  />
                  {pt.label}
                </label>
              );
            })}
          </div>
        </div>
        <DatePicker
          label="Date of Birth"
          value={form.date_of_birth}
          onChange={(v) => update('date_of_birth', v)}
        />
        <DatePicker
          label="Date of Hire"
          value={form.date_of_hire}
          onChange={(v) => update('date_of_hire', v)}
        />
        <Select
          label="Home Branch Timezone"
          value={form.home_branch_timezone || ''}
          onChange={(e) => update('home_branch_timezone', e.target.value)}
          options={TIMEZONE_OPTIONS}
        />
        <Input
          label="Default Start Location"
          value={form.default_start_location || ''}
          onChange={(e) => update('default_start_location', e.target.value)}
        />
        <Input
          label="Truck Number"
          value={form.truck_number || ''}
          onChange={(e) => update('truck_number', e.target.value)}
        />
        <Input
          label="Trailer Number"
          value={form.trailer_number || ''}
          onChange={(e) => update('trailer_number', e.target.value)}
        />
      </FormSection>

      <FormSection
        title="Expiration Dates"
        description="Track driver credentials to prevent compliance issues"
      >
        <DatePicker
          label="Driver's License Exp"
          value={form.license_expiry}
          onChange={(v) => update('license_expiry', v)}
        />
        <Input
          label="License Number"
          value={form.license_number || ''}
          onChange={(e) => update('license_number', e.target.value)}
        />
        <Input
          label="License State"
          value={form.license_state || ''}
          onChange={(e) => update('license_state', e.target.value)}
        />
        <DatePicker
          label="Medical Exp"
          value={form.medical_exp}
          onChange={(v) => update('medical_exp', v)}
        />
        <DatePicker
          label="TWIC Exp"
          value={form.twic_exp}
          onChange={(v) => update('twic_exp', v)}
        />
        <DatePicker
          label="Sea Link Exp"
          value={form.sea_link_exp}
          onChange={(v) => update('sea_link_exp', v)}
        />
        <DatePicker
          label="OCAC Insurance Exp"
          value={form.ocac_insurance_exp}
          onChange={(v) => update('ocac_insurance_exp', v)}
        />
        <DatePicker
          label="Termination Date"
          value={form.termination_date}
          onChange={(v) => update('termination_date', v)}
        />
      </FormSection>

      <FormSection title="Document Information">
        <Input
          label="Sealink #"
          value={form.sealink_number || ''}
          onChange={(e) => update('sealink_number', e.target.value)}
        />
        <Input
          label="Register Business Name"
          value={form.register_business_name || ''}
          onChange={(e) => update('register_business_name', e.target.value)}
        />
        <Input
          label="HST #"
          value={form.hst_number || ''}
          onChange={(e) => update('hst_number', e.target.value)}
        />
        <Input
          label="Social Security #"
          value={form.social_security || ''}
          onChange={(e) => update('social_security', e.target.value)}
          helpText="Encrypted at rest"
        />
        <Input
          label="Tablet #"
          value={form.tablet_number || ''}
          onChange={(e) => update('tablet_number', e.target.value)}
        />
        <Input
          label="ELD #"
          value={form.eld_number || ''}
          onChange={(e) => update('eld_number', e.target.value)}
        />
        <Input
          label="Fuel Card"
          value={form.fuel_card || ''}
          onChange={(e) => update('fuel_card', e.target.value)}
        />
        <Input
          label="EZ Pass"
          value={form.ez_pass || ''}
          onChange={(e) => update('ez_pass', e.target.value)}
        />
      </FormSection>

      <FormSection title="Emergency Contact" columns={3}>
        <Input
          label="Name"
          value={form.emergency_contact_name || ''}
          onChange={(e) => update('emergency_contact_name', e.target.value)}
        />
        <Input
          label="Relation"
          value={form.emergency_relation || ''}
          onChange={(e) => update('emergency_relation', e.target.value)}
        />
        <Input
          label="Phone"
          value={form.emergency_phone || ''}
          onChange={(e) => update('emergency_phone', e.target.value)}
        />
      </FormSection>

      <FormSection title="Other">
        <Input
          label="Truck Owner"
          value={form.truck_owner || ''}
          onChange={(e) => update('truck_owner', e.target.value)}
        />
        <Input
          label="Carrier Name"
          value={form.carrier_name || ''}
          onChange={(e) => update('carrier_name', e.target.value)}
        />
        <AddressAutocomplete
          label="Main Office Address"
          value={form.main_office_address || ''}
          onChange={(val) => update('main_office_address', val)}
          onSelect={(addr) => update('main_office_address', addr.formatted || addr.street)}
        />
        <Input
          label="T-Shirt Size"
          value={form.tshirt_size || ''}
          onChange={(e) => update('tshirt_size', e.target.value)}
          placeholder="S / M / L / XL / 2XL"
        />
        <AddressAutocomplete
          label="Permanent Address"
          value={form.permanent_address || ''}
          onChange={(val) => update('permanent_address', val)}
          onSelect={(addr) => update('permanent_address', addr.formatted || addr.street)}
          className="sm:col-span-2"
        />
      </FormSection>
    </div>
  );
}
