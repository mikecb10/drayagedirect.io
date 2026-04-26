import { View, Text } from '@react-pdf/renderer';
import { typography } from '../shared/typography';

export default function AppointmentDetails({ data }) {
  if (!data) return null;
  const rows = [];
  if (data.pickup_appt_number) rows.push(['Pickup Appt', data.pickup_appt_number]);
  if (data.delivery_appt_number) rows.push(['Delivery Appt', data.delivery_appt_number]);
  if (data.gate_codes?.pickup) rows.push(['Pickup Gate', data.gate_codes.pickup]);
  if (data.gate_codes?.delivery) rows.push(['Delivery Gate', data.gate_codes.delivery]);
  if (rows.length === 0) return null;
  return (
    <View style={{ marginBottom: 12 }}>
      <Text style={typography.label}>Appointments / Gate Codes</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
        {rows.map(([label, value]) => (
          <View key={label} style={{ minWidth: 110 }}>
            <Text style={[typography.label, { fontSize: 8 }]}>{label}</Text>
            <Text style={typography.value}>{value}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}
