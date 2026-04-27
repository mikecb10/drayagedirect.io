/**
 * HTML preview of Rate Confirmation Details. Mirrors components/pdf/sections/RateConDetails.js.
 * 3-col label-value grid; skips empty values.
 */
const FIELD_ORDER = [
  ['confirmation_number',  'Confirmation #'],
  ['issue_date',           'Issue Date'],
  ['reference_number',     'Reference #'],
  ['pickup_appointment',   'Pickup Appointment'],
  ['delivery_appointment', 'Delivery Appointment'],
];

export default function RateConDetailsPreview({ data, opts, colors }) {
  if (!data) return null;
  const fields = opts?.fields || {};
  const textColor = colors?.text || '#111827';

  const rows = FIELD_ORDER
    .map(([key, label]) => {
      if (fields[key] === false) return null;
      const value = data[key];
      if (value === undefined || value === null || value === '') return null;
      return [label, value];
    })
    .filter(Boolean);

  if (rows.length === 0) return null;

  return (
    <div className="mb-4 pb-3 border-b border-gray-200">
      <div className="grid grid-cols-3 gap-x-4 gap-y-2">
        {rows.map(([label, value]) => (
          <div key={label}>
            <div className="text-[10px] uppercase tracking-wider font-bold" style={{ color: textColor }}>
              {label}
            </div>
            <div className="text-[12px] text-gray-900">{String(value)}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
