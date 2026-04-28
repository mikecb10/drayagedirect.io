import { View, Text } from '@react-pdf/renderer';
import { typography } from '../shared/typography';

/**
 * Credit Memo Details section — 3 toggleable fields rendered as a 3-col
 * label-value grid. Skips empty values (so applied_date=null hides that
 * column at render time). Mirrors StatementDetails.js's structure.
 *
 * `data` shape: { memo_number, issue_date, applied_date }
 * `opts.fields`: { memo_number, issue_date, applied_date }
 */
const FIELD_ORDER = [
  ['memo_number',  'Memo #'],
  ['issue_date',   'Issue Date'],
  ['applied_date', 'Applied Date'],
];

export default function CreditMemoDetails({ data, opts, colors }) {
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
