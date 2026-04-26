import { View, Text } from '@react-pdf/renderer';
import { typography, colors } from '../shared/typography';

export default function SignatureBlock() {
  return (
    <View style={{ marginTop: 16, flexDirection: 'row', justifyContent: 'space-between' }}>
      <View style={{ flex: 1, marginRight: 12 }}>
        <View style={{ borderTop: `1pt solid ${colors.border || '#000'}`, paddingTop: 4 }}>
          <Text style={typography.label}>Driver Signature</Text>
          <Text style={[typography.label, { fontSize: 8, marginTop: 14 }]}>Date / Time</Text>
        </View>
      </View>
      <View style={{ flex: 1 }}>
        <View style={{ borderTop: `1pt solid ${colors.border || '#000'}`, paddingTop: 4 }}>
          <Text style={typography.label}>Customer Signature</Text>
          <Text style={[typography.label, { fontSize: 8, marginTop: 14 }]}>Date / Time</Text>
        </View>
      </View>
    </View>
  );
}
