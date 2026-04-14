import Input from '../../ui/Input';
import Select from '../../ui/Select';
import Checkbox from '../../ui/Checkbox';
import DatePicker from '../../ui/DatePicker';
import FormSection from '../../ui/FormSection';
import CurrencyInput from '../../ui/CurrencyInput';

const ENDORSEMENTS = [
  { key: 'hazmat', label: 'Hazmat', hasExpiry: true },
  { key: 'liquor', label: 'Liquor' },
  { key: 'over_height', label: 'Over Height' },
  { key: 'reefer', label: 'Reefer' },
  { key: 'highway', label: 'Highway' },
  { key: 'local', label: 'Local' },
  { key: 'genset', label: 'Genset' },
  { key: 'hot', label: 'Hot' },
  { key: 'ev', label: 'EV' },
  { key: 'street_turn', label: 'Street Turn' },
  { key: 'scale', label: 'Scale' },
  { key: 'bonded', label: 'Bonded' },
  { key: 'oog', label: 'OOG' },
  { key: 'b_train', label: 'B-Train' },
  { key: 'over_weight', label: 'Over Weight' },
  { key: 'double', label: 'Double' },
  { key: 'tanker', label: 'Tanker' },
];

export default function DriverPreferencesTab({ form, update }) {
  const endorsements = form.endorsements || {};

  function toggleEndorsement(key) {
    const current = endorsements[key];
    update('endorsements', {
      ...endorsements,
      [key]: current ? false : { enabled: true },
    });
  }

  function setEndorsementExpiry(key, date) {
    update('endorsements', {
      ...endorsements,
      [key]: { ...(endorsements[key] || {}), enabled: true, expiry: date },
    });
  }

  return (
    <div className="space-y-6">
      <FormSection title="Driver Shift" columns={2}>
        <Select
          label="Shift"
          value={form.driver_shift || 'day'}
          onChange={(e) => update('driver_shift', e.target.value)}
          options={[
            { value: 'day', label: 'Day' },
            { value: 'night', label: 'Night' },
          ]}
        />
      </FormSection>

      <FormSection
        title="Load Preferences"
        description="Configure what kinds of loads this driver prefers"
      >
        <Input
          label="Min Miles"
          type="number"
          value={form.min_miles || ''}
          onChange={(e) => update('min_miles', e.target.value ? Number(e.target.value) : null)}
        />
        <Input
          label="Max Miles"
          type="number"
          value={form.max_miles || ''}
          onChange={(e) => update('max_miles', e.target.value ? Number(e.target.value) : null)}
        />
      </FormSection>

      <section>
        <h3 className="text-sm font-semibold text-gray-900 dark:text-slate-100 mb-1">Endorsements</h3>
        <p className="text-xs text-gray-500 dark:text-slate-400 mb-4">
          What this driver is certified or equipped to handle. These are used to auto-match
          drivers to loads with matching requirements.
        </p>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3 bg-gray-50 dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded-lg p-4">
          {ENDORSEMENTS.map((e) => {
            const data = endorsements[e.key];
            const enabled = !!data;
            return (
              <div key={e.key}>
                <Checkbox
                  checked={enabled}
                  onChange={() => toggleEndorsement(e.key)}
                  label={e.label}
                />
                {enabled && e.hasExpiry && (
                  <div className="mt-1 ml-6">
                    <input
                      type="date"
                      value={data?.expiry || ''}
                      onChange={(ev) => setEndorsementExpiry(e.key, ev.target.value)}
                      className="text-xs rounded border border-gray-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-gray-900 dark:text-slate-100 px-2 py-1 dark:[color-scheme:dark]"
                      placeholder="Expiration"
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>

      <FormSection title="Financial Preferences">
        <Select
          label="Pay Type"
          value={form.pay_type || 'flat'}
          onChange={(e) => update('pay_type', e.target.value)}
          options={[
            { value: 'per_mile', label: 'Per Mile' },
            { value: 'flat', label: 'Flat' },
            { value: 'percentage', label: 'Percentage' },
          ]}
        />
        {form.pay_type === 'percentage' ? (
          <Input
            label="Pay Percentage (%)"
            type="number"
            step="0.01"
            value={form.pay_percentage || ''}
            onChange={(e) =>
              update('pay_percentage', e.target.value ? Number(e.target.value) : null)
            }
            helpText="Percentage of linehaul revenue"
          />
        ) : (
          <CurrencyInput
            label={form.pay_type === 'per_mile' ? 'Pay Rate (per mile)' : 'Pay Rate (flat)'}
            valueCents={form.pay_rate_cents}
            onChangeCents={(cents) => update('pay_rate_cents', cents)}
          />
        )}
        <Input
          label="HST %"
          type="number"
          step="0.01"
          value={form.hst_pct || ''}
          onChange={(e) => update('hst_pct', e.target.value ? Number(e.target.value) : null)}
        />
        <div className="space-y-2 pt-6">
          <Checkbox
            checked={form.disable_driver_pay || false}
            onChange={(v) => update('disable_driver_pay', v)}
            label="Disable driver pay"
            description="Driver is salaried / not paid per load"
          />
          <Checkbox
            checked={form.hide_settlements || false}
            onChange={(v) => update('hide_settlements', v)}
            label="Hide settlements from driver"
          />
        </div>
      </FormSection>
    </div>
  );
}
