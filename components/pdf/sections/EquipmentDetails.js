import { View, Text } from '@react-pdf/renderer';
import { typography } from '../shared/typography';

export default function EquipmentDetails({ data, opts }) {
  if (!data) return null;
  const showSeal = opts?.show_seal !== false;
  const fields = [
    ['Container Size', data.container_size],
    ['Container Type', data.container_type],
    ['Chassis Size', data.chassis_size],
    ['Chassis Type', data.chassis_type],
    showSeal ? ['Seal #', data.seal_number] : null,
    data.weight_lbs ? ['Weight', `${data.weight_lbs.toLocaleString()} lbs`] : null,
  ].filter((f) => f && f[1]);

  if (fields.length === 0) return null;

  return (
    <View style={{ marginBottom: 12 }}>
      <Text style={typography.label}>Equipment</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
        {fields.map(([label, value]) => (
          <View key={label} style={{ minWidth: 100 }}>
            <Text style={[typography.label, { fontSize: 8 }]}>{label}</Text>
            <Text style={typography.value}>{value}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}
