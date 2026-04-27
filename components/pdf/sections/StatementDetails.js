import { View, Text } from '@react-pdf/renderer';
import { typography } from '../shared/typography';

/**
 * Statement Details section — 2 toggleable fields rendered as a 3-col
 * label-value grid. Skips empty values. Mirrors PodDetails.js's structure.
 *
 * `data` shape: { as_of_date, account_number }
 * `opts.fields`: { as_of_date, account_number }
 */
const FIELD_ORDER = [
  ['as_of_date',     'As of Date'],
  ['account_number', 'Account Number'],
];

export default function StatementDetails({ data, opts, colors }) {
  if (!data) return null;
  const fields = opts?.fields || {};
  const textColor = colors?.text || '#111827';

  const rows = FIELD_ORDER
    .map(([key, label]) => {
      if (fields[key] === false) return null;
      const value = data[key];
      if (value === undefined || value === null || value === '') return null;
      return [label, value];
    })
    .filter(Boolean);

  if (rows.length === 0) return null;

  return (
    <View style={{ marginBottom: 12 }}>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginBottom: 4 }}>
        {rows.map(([label, value]) => (
          <View key={label} style={{ width: '33.33%', marginBottom: 4 }}>
            <Text style={[typography.label, { color: textColor }]}>{label}</Text>
            <Text style={typography.value}>{String(value)}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}
