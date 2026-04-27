import { View, Text } from '@react-pdf/renderer';
import { typography } from '../shared/typography';

/**
 * Rate Confirmation Details section — 5 toggleable fields rendered as a 3-col
 * label-value grid. Skips empty values. Mirrors InvoiceDetails.js's structure
 * minus the consolidated footnote (rate cons don't consolidate) and minus the
 * terms_days special case (rate cons don't have payment terms).
 *
 * `data` shape:
 *   {
 *     confirmation_number, issue_date, reference_number,
 *     pickup_appointment, delivery_appointment,
 *   }
 *
 * `opts.fields`: { confirmation_number, issue_date, reference_number,
 *                  pickup_appointment, delivery_appointment }
 */
const FIELD_ORDER = [
  ['confirmation_number',  'Confirmation #'],
  ['issue_date',           'Issue Date'],
  ['reference_number',     'Reference #'],
  ['pickup_appointment',   'Pickup Appointment'],
  ['delivery_appointment', 'Delivery Appointment'],
];

export default function RateConDetails({ data, opts, colors }) {
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
