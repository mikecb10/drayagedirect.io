import { View, Text } from '@react-pdf/renderer';
import { typography } from '../shared/typography';

/**
 * Notes section — 5 toggleable note types (driver / yard / customer /
 * billing / load). Subsumes data the old `instructions` section ID rendered.
 *
 * `opts.fields`: { driver_notes, yard_notes, customer_notes, billing_notes, load_notes }.
 * Default-true for all except billing_notes (defaultVisible: false in registry).
 *
 * `data` shape:
 *   {
 *     driver_notes:   string | null,
 *     yard_notes:     string | null,
 *     customer_notes: string | null,
 *     billing_notes:  string | null,
 *     load_notes:     string | null   // sourced from doc.instructions.special_instructions
 *   }
 */
const NOTE_ORDER = [
  ['driver_notes',   'Driver Notes'],
  ['yard_notes',     'Yard Notes'],
  ['customer_notes', 'Customer Notes'],
  ['billing_notes',  'Billing Notes'],
  ['load_notes',     'Load Notes'],
];

export default function Notes({ data, opts }) {
  if (!data) return null;
  const fields = opts?.fields || {};
  const visible = NOTE_ORDER
    .map(([key, label]) => {
      // billing_notes default is false; everything else is true.
      const enabled = key === 'billing_notes' ? fields[key] === true : fields[key] !== false;
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
