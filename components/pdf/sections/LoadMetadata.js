import { View, Text } from '@react-pdf/renderer';
import { typography } from '../shared/typography';

export default function LoadMetadata({ data }) {
  if (!data) return null;
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 12 }}>
      <View>
        <Text style={typography.label}>Load #</Text>
        <Text style={typography.value}>{data.load_number || '—'}</Text>
        {data.customer_reference ? (
          <>
            <Text style={typography.label}>Customer Ref</Text>
            <Text style={typography.value}>{data.customer_reference}</Text>
          </>
        ) : null}
      </View>
      <View style={{ minWidth: 180 }}>
        <Text style={typography.label}>Container #</Text>
        <Text style={typography.value}>{data.container_number || '—'}</Text>
        <Text style={typography.label}>Chassis #</Text>
        <Text style={typography.value}>{data.chassis_number || '—'}</Text>
      </View>
    </View>
  );
}
