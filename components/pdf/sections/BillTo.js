import { View, Text } from '@react-pdf/renderer';
import { typography } from '../shared/typography';

export default function BillTo({ data }) {
  if (!data || !data.name) return null;
  const cityLine = [data.city, data.state, data.zip].filter(Boolean).join(', ');
  return (
    <View style={{ marginBottom: 12 }}>
      <Text style={typography.label}>Bill To</Text>
      <Text style={typography.value}>{data.name}</Text>
      {data.address_line1 ? <Text style={typography.value}>{data.address_line1}</Text> : null}
      {cityLine ? <Text style={typography.value}>{cityLine}</Text> : null}
    </View>
  );
}
