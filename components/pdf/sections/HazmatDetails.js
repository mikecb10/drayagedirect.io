import { View, Text } from '@react-pdf/renderer';
import { typography } from '../shared/typography';

export default function HazmatDetails({ data }) {
  if (!data || !data.hazmat_class) return null;
  return (
    <View
      style={{
        marginBottom: 12,
        padding: 8,
        border: '1pt solid #dc2626',
        backgroundColor: '#fef2f2',
      }}
    >
      <Text style={[typography.label, { color: '#dc2626', fontWeight: 'bold' }]}>HAZMAT</Text>
      <View style={{ flexDirection: 'row', gap: 16, marginTop: 4 }}>
        {data.un_code ? (
          <View>
            <Text style={[typography.label, { fontSize: 8 }]}>UN Code</Text>
            <Text style={typography.value}>{data.un_code}</Text>
          </View>
        ) : null}
        <View>
          <Text style={[typography.label, { fontSize: 8 }]}>Class</Text>
          <Text style={typography.value}>{data.hazmat_class}</Text>
        </View>
        {data.emergency_phone ? (
          <View>
            <Text style={[typography.label, { fontSize: 8 }]}>Emergency Phone</Text>
            <Text style={typography.value}>{data.emergency_phone}</Text>
          </View>
        ) : null}
      </View>
    </View>
  );
}
