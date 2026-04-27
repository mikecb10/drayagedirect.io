import { View, Text } from '@react-pdf/renderer';
import { typography, colors } from '../shared/typography';

function formatTimestamp() {
  return new Date().toLocaleString('en-US', {
    year: 'numeric', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

export default function DocumentFooter({ data }) {
  return (
    <View
      style={{
        position: 'absolute', bottom: 24, left: 36, right: 36,
        flexDirection: 'row', justifyContent: 'space-between',
        borderTop: `0.5pt solid ${colors.border || '#e5e7eb'}`,
        paddingTop: 4,
      }}
      fixed
    >
      <Text style={[typography.value, typography.muted, { fontSize: 8 }]}>
        {data?.tenant_name || ''} • Generated {formatTimestamp()}
      </Text>
      <Text
        style={[typography.value, typography.muted, { fontSize: 8 }]}
        render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`}
      />
    </View>
  );
}
