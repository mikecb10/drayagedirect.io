/**
 * HTML preview of the Order Details section. Mirrors
 * components/pdf/sections/OrderDetails.js. Renders 19 toggleable fields as a
 * 3-column label-value grid, only including fields whose toggle is on AND
 * whose value is non-empty.
 *
 * `opts.fields`: 19 keys per spec §4 of the FU-035-D design.
 */
const FIELD_ORDER = [
  ['reference_number',      'Reference #'],
  ['booking_bl',            'Booking/BL'],
  ['mbol',                  'MBOL #'],
  ['hbol',                  'HBOL #'],
  ['container_number',      'Container #'],
  ['container_size',        'Container Size'],
  ['container_type',        'Container Type'],
  ['chassis_number',        'Chassis #'],
  ['chassis_size',          'Chassis Size'],
  ['chassis_type',          'Chassis Type'],
  ['chassis_owner',         'Chassis Owner'],
  ['steamship_line',        'Steamship Line'],
  ['seal',                  'Seal #'],
  ['hazmat',                'Hazmat'],
  ['pickup_number',         'Pickup #'],
  ['pull_container_date',   'Pull Container Date'],
  ['return_container_date', 'Return Container Date'],
  ['last_free_day',         'Last Free Day'],
  ['per_diem_free_day',     'Per Diem Free Day'],
];

export default function OrderDetailsPreview({ data, opts, colors }) {
  if (!data) return null;
  const fields = opts?.fields || {};
  const textColor = colors?.text || '#111827';
  const rows = FIELD_ORDER
    .map(([key, label]) => {
      if (fields[key] === false) return null;
      const value = data[key];
      if (value === undefined || value === null || value === '') return null;
      return [label, typeof value === 'boolean' ? (value ? 'Yes' : 'No') : value];
    })
    .filter(Boolean);

  if (rows.length === 0) return null;

  return (
    <div className="mb-4 pb-3 border-b border-gray-200">
      <div
        className="text-[10px] uppercase tracking-wider font-bold mb-2"
        style={{ color: textColor }}
      >
        Order Details
      </div>
      <div className="grid grid-cols-3 gap-x-4 gap-y-1.5">
        {rows.map(([label, value]) => (
          <div key={label} className="flex">
            <div className="text-[11px] text-gray-600 font-medium min-w-[110px]">
              {label}
            </div>
            <div className="text-[11px] text-gray-900">: {value}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
