import { View, Text } from '@react-pdf/renderer';
import { typography } from '../shared/typography';

/**
 * Invoice Details section — 6 toggleable fields rendered as a 3-col
 * label-value grid. Skips empty values. Appends an italic muted
 * "Includes charges from N loads" footnote when consolidated.
 *
 * `data` shape:
 *   {
 *     invoice_number, load_number, customer_reference,
 *     invoice_date, terms_days, due_date,
 *     consolidated_count: number  // when > 1, renders the footnote
 *   }
 *
 * `opts.fields`: { invoice_number, load_number, customer_reference,
 *                  invoice_date, terms, due_date }
 *
 * Terms field renders as `Net ${terms_days}` when terms_days > 0;
 * otherwise the row is hidden (avoids "Net 0" in the output).
 */
const FIELD_ORDER = [
  ['invoice_number',     'Invoice Number'],
  ['load_number',        'Load Number'],
  ['customer_reference', 'Customer Reference / PO #'],
  ['invoice_date',       'Invoice Date'],
  ['terms',              'Terms'],
  ['due_date',           'Due Date'],
];

export default function InvoiceDetails({ data, opts, colors }) {
  if (!data) return null;
  const fields = opts?.fields || {};
  const textColor = colors?.text || '#111827';
  const termsLabel = data.terms_days > 0 ? `Net ${data.terms_days}` : null;

  const rows = FIELD_ORDER
    .map(([key, label]) => {
      if (fields[key] === false) return null;
      const value = key === 'terms' ? termsLabel : data[key];
      if (value === undefined || value === null || value === '') return null;
      return [label, value];
    })
    .filter(Boolean);

  if (rows.length === 0 && !(data.consolidated_count > 1)) return null;

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
      {data.consolidated_count > 1 ? (
        <Text style={[typography.value, typography.muted, { fontStyle: 'italic', marginTop: 2 }]}>
          Includes charges from {data.consolidated_count} loads
        </Text>
      ) : null}
    </View>
  );
}
