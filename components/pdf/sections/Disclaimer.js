import { View, Text } from '@react-pdf/renderer';
import { typography } from '../shared/typography';

/**
 * Disclaimer section — italicized footer text. Content stored as plain text
 * in section_config.disclaimer.text for now; FU-035-G upgrades to rich-text
 * via TipTap and stores HTML.
 */
export default function Disclaimer({ data }) {
  if (!data || !data.text) return null;
  return (
    <View style={{ marginTop: 12, paddingTop: 8, borderTop: '1pt solid #eee' }}>
      <Text style={[typography.muted, { fontSize: 8, fontStyle: 'italic' }]}>{data.text}</Text>
    </View>
  );
}
