import { View, Text } from '@react-pdf/renderer';
import { typography } from '../shared/typography';

/**
 * POD Delivery Details section — 5 toggleable fields rendered as a 3-col
 * label-value grid. Skips empty values. Mirrors RateConDetails.js's structure.
 *
 * `data` shape:
 *   {
 *     order_number, customer_reference, driver_name,
 *     delivery_date, delivery_time,
 *   }
 *
 * `opts.fields`: { order_number, customer_reference, driver_name,
 *                  delivery_date, delivery_time }
 */
const FIELD_ORDER = [
  ['order_number',       'Order #'],
  ['customer_reference', 'Customer Reference / PO #'],
  ['driver_name',        'Driver'],
  ['delivery_date',      'Delivery Date'],
  ['delivery_time',      'Delivery Time'],
];

export default function PodDetails({ data, opts, colors }) {
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
    <View style={{ marginBottom: 12 }}>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginBottom: 4 }}>
        {rows.map(([label, value]) => (
          <View key={label} style={{ width: '33.33%', marginBottom: 4 }}>
            <Text style={[typography.label, { color: textColor }]}>{label}</Text>
            <Text style={typography.value}>{String(value)}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}
