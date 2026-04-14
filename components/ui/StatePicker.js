import { US_STATES, CA_PROVINCES, ALL_REGIONS } from '../../lib/us-states';

/**
 * StatePicker — standardized state/province dropdown.
 *
 * Props:
 *   - country: 'US' | 'CA' | 'all' (default: 'all') — filters the list
 *   - value: current 2-letter code (e.g. 'NJ')
 *   - onChange: (code) => void
 *   - label: optional field label
 *   - required: optional
 *   - className: optional wrapper class
 *   - placeholder: optional placeholder text
 */
export default function StatePicker({
  country = 'all',
  value,
  onChange,
  label,
  required = false,
  className = '',
  placeholder = '— Select state —',
  disabled = false,
}) {
  const options =
    country === 'US'
      ? US_STATES
      : country === 'CA'
        ? CA_PROVINCES
        : ALL_REGIONS;

  return (
    <div className={className}>
      {label && (
        <label className="block text-sm font-medium text-gray-700 mb-1">
          {label}
          {required && <span className="text-red-500 ml-0.5">*</span>}
        </label>
      )}
      <select
        value={value || ''}
        onChange={(e) => onChange(e.target.value || null)}
        disabled={disabled}
        className="block w-full rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-900 focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 disabled:bg-gray-50 disabled:text-gray-400"
      >
        <option value="">{placeholder}</option>
        {country === 'all' && (
          <>
            <optgroup label="United States">
              {US_STATES.map((s) => (
                <option key={s.code} value={s.code}>
                  {s.code} — {s.name}
                </option>
              ))}
            </optgroup>
            <optgroup label="Canada">
              {CA_PROVINCES.map((s) => (
                <option key={s.code} value={s.code}>
                  {s.code} — {s.name}
                </option>
              ))}
            </optgroup>
          </>
        )}
        {country !== 'all' &&
          options.map((s) => (
            <option key={s.code} value={s.code}>
              {s.code} — {s.name}
            </option>
          ))}
      </select>
    </div>
  );
}
