import { View, Text } from '@react-pdf/renderer';
import { typography } from '../shared/typography';

/**
 * Order Details section — 19 toggleable fields covering equipment, container,
 * appointment, hazmat, and load reference data. Subsumes data the old
 * `equipment_details` + `appointment_details` + `hazmat_details` + parts of
 * `load_metadata` rendered.
 *
 * `opts.fields`: 19 keys per spec §4. Default-true for any not specified.
 *
 * `data` shape (composer-merged from doc.equipment_details + doc.appointment_details
 * + doc.hazmat_details + doc.load_metadata):
 *   {
 *     reference_number, booking_bl, mbol, hbol,
 *     container_number, container_size, container_type,
 *     chassis_number, chassis_size, chassis_type, chassis_owner,
 *     steamship_line, seal, hazmat (boolean | text), pickup_number,
 *     pull_container_date, return_container_date,
 *     last_free_day, per_diem_free_day
 *   }
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

export default function OrderDetails({ data, opts, colors }) {
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
    <View style={{ marginBottom: 12 }}>
      <Text style={[typography.label, { color: textColor }]}>Order Details</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: 2 }}>
        {rows.map(([label, value]) => (
          <View key={label} style={{ minWidth: 100 }}>
            <Text style={[typography.label, { fontSize: 8 }]}>{label}</Text>
            <Text style={typography.value}>{value}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}
