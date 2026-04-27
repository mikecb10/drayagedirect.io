import { View, Text } from '@react-pdf/renderer';
import { typography } from '../shared/typography';

/**
 * Delivery Order Details section — top-of-doc reference info.
 * Subsumes data the old `LoadMetadata` and `driver_per_move` section IDs
 * rendered, plus pickup #, delivery appointment, reference #.
 *
 * `opts.fields`: { delivery_order_number, pickup_number, driver_name,
 *                  delivery_appointment, reference_number }
 * Default-true for any field not specified.
 *
 * `data` shape:
 *   {
 *     delivery_order_number,
 *     pickup_number,
 *     driver_name,
 *     delivery_appointment,
 *     reference_number
 *   }
 * In FU-035-D, this data is sourced from `doc.load_metadata` (load_number →
 * delivery_order_number, customer_reference → reference_number) plus first
 * move's driver_name. Future doc.delivery_order_details object is wired in D2.
 */
export default function DeliveryOrderDetails({ data, opts }) {
  if (!data) return null;
  const fields = opts?.fields || {};
  const rows = [
    fields.delivery_order_number !== false && data.delivery_order_number
      ? ['Delivery Order #', data.delivery_order_number] : null,
    fields.pickup_number !== false && data.pickup_number
      ? ['Pickup #', data.pickup_number] : null,
    fields.driver_name !== false && data.driver_name
      ? ['Driver', data.driver_name] : null,
    fields.delivery_appointment !== false && data.delivery_appointment
      ? ['Delivery Appt', data.delivery_appointment] : null,
    fields.reference_number !== false && data.reference_number
      ? ['Reference #', data.reference_number] : null,
  ].filter(Boolean);

  if (rows.length === 0) return null;

  return (
    <View style={{ marginBottom: 12, flexDirection: 'row', flexWrap: 'wrap', gap: 16 }}>
      {rows.map(([label, value]) => (
        <View key={label} style={{ minWidth: 120 }}>
          <Text style={[typography.label, { fontSize: 8 }]}>{label}</Text>
          <Text style={typography.value}>{value}</Text>
        </View>
      ))}
    </View>
  );
}
