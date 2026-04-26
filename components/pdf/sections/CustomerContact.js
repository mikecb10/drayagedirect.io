import { View, Text } from '@react-pdf/renderer';
import { typography } from '../shared/typography';

export default function CustomerContact({ data }) {
  if (!data || (!data.phone && !data.email)) return null;
  return (
    <View style={{ marginBottom: 8, flexDirection: 'row', gap: 16 }}>
      {data.phone ? (
        <View>
          <Text style={typography.label}>Phone</Text>
          <Text style={typography.value}>{data.phone}</Text>
        </View>
      ) : null}
      {data.email ? (
        <View>
          <Text style={typography.label}>Email</Text>
          <Text style={typography.value}>{data.email}</Text>
        </View>
      ) : null}
    </View>
  );
}
