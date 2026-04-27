import { View, Text } from '@react-pdf/renderer';
import { typography } from '../shared/typography';

/**
 * Signature Block section — 5 fields (Print Name / Receiver Signature /
 * Time In / Time Out / Date) rendered as labeled signature lines at the
 * bottom of the document.
 *
 * `data` shape: { print_name, signature, date, time_in, time_out } —
 * typically all empty strings on initial print (signed on paper). A future
 * FU may pre-populate from a captured signature image at print time.
 */
const SIG_FIELDS = [
  ['print_name', 'Print Name'],
  ['signature',  'Receiver Signature'],
  ['date',       'Date'],
  ['time_in',    'Time In'],
  ['time_out',   'Time Out'],
];

export default function Signature({ data }) {
  if (!data) return null;
  return (
    <View style={{ marginTop: 18, paddingTop: 10, borderTop: '1pt solid #ccc' }}>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 16 }}>
        {SIG_FIELDS.map(([key, label]) => (
          <View key={key} style={{ flex: 1, minWidth: 100 }}>
            <View style={{ height: 18, borderBottom: '1pt solid #444' }}>
              <Text style={typography.value}>{data[key] || ''}</Text>
            </View>
            <Text style={[typography.label, { fontSize: 7, marginTop: 2 }]}>{label}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}
