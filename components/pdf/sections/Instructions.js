import { View, Text } from '@react-pdf/renderer';
import { typography } from '../shared/typography';

export default function Instructions({ data }) {
  if (!data || (!data.driver_notes && !data.special_instructions)) return null;
  return (
    <View style={{ marginBottom: 12 }}>
      <Text style={typography.label}>Notes / Instructions</Text>
      {data.driver_notes ? (
        <Text style={typography.value}>{data.driver_notes}</Text>
      ) : null}
      {data.special_instructions ? (
        <Text style={[typography.value, { marginTop: 4 }]}>
          {data.special_instructions}
        </Text>
      ) : null}
    </View>
  );
}
