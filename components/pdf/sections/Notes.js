import { View, Text } from '@react-pdf/renderer';
import { typography } from '../shared/typography';

/**
 * Notes section — toggleable note types. Field set varies by doc type:
 *   - DO / Invoice / Rate Con / Combined Invoice / POD: `driver_notes`, `yard_notes`,
 *     `customer_notes`, `billing_notes`, `load_notes` (from doc.instructions).
 *   - Statement / Credit Memo (AR doc types): `payment_instructions`, `custom_notes`.
 *
 * Each doc-type's registry declares which fields belong to its `notes` section,
 * so this component renders a superset and relies on (a) `opts.fields` from the
 * registry to gate visibility, and (b) the data shape from the doc-type's
 * `buildSectionData` to populate values. Fields not produced by a doc type's
 * builder are skipped via the empty-value check.
 *
 * Default-true for everything except `billing_notes` and `custom_notes`
 * (which match `defaultVisible: false` in their respective registries).
 *
 * `data` shape (union):
 *   {
 *     // DO-family
 *     driver_notes?:         string | null,
 *     yard_notes?:           string | null,
 *     customer_notes?:       string | null,
 *     billing_notes?:        string | null,
 *     load_notes?:           string | null,
 *     // AR-family (Statement / Credit Memo)
 *     payment_instructions?: string | null,
 *     custom_notes?:         string | null,
 *   }
 */
const NOTE_ORDER = [
  ['driver_notes',         'Driver Notes'],
  ['yard_notes',           'Yard Notes'],
  ['customer_notes',       'Customer Notes'],
  ['billing_notes',        'Billing Notes'],
  ['load_notes',           'Load Notes'],
  ['payment_instructions', 'Payment Instructions'],
  ['custom_notes',         'Custom Notes'],
];

const DEFAULT_OFF_FIELDS = new Set(['billing_notes', 'custom_notes']);

export default function Notes({ data, opts }) {
  if (!data) return null;
  const fields = opts?.fields || {};
  const visible = NOTE_ORDER
    .map(([key, label]) => {
      const enabled = DEFAULT_OFF_FIELDS.has(key)
        ? fields[key] === true
        : fields[key] !== false;
      if (!enabled) return null;
      const value = data[key];
      if (!value) return null;
      return [label, value];
    })
    .filter(Boolean);

  if (visible.length === 0) return null;

  return (
    <View style={{ marginBottom: 12 }}>
      {visible.map(([label, value]) => (
        <View key={label} style={{ marginBottom: 4 }}>
          <Text style={[typography.label, { fontSize: 8 }]}>{label}</Text>
          <Text style={typography.value}>{value}</Text>
        </View>
      ))}
    </View>
  );
}
