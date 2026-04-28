import { View, Text } from '@react-pdf/renderer';

const styles = {
  section: { marginBottom: 12 },
  callout: {
    backgroundColor: '#fef3c7',
    borderLeftWidth: 3,
    borderLeftColor: '#f59e0b',
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 2,
  },
  text: { fontSize: 10, color: '#78350f', lineHeight: 1.45 },
  label: { fontSize: 8, color: '#92400e', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 3, fontWeight: 'bold' },
};

/**
 * Reason section — single free-text block explaining why the credit was issued.
 * Amber-tinted callout for visual distinction from the generic Notes section.
 *
 * `data` shape: { text: string }
 *
 * Composer-level guard: this component is only rendered when doc.memo_meta.reason
 * is non-null/non-empty (see CreditMemoTemplate.js renderSection). So the
 * component itself doesn't need to check — but we still defensive-guard against
 * a `data === null` case for robustness.
 */
export default function Reason({ data, colors }) {
  if (!data || !data.text || !String(data.text).trim()) return null;

  return (
    <View style={styles.section}>
      <Text style={styles.label}>Reason</Text>
      <View style={styles.callout}>
        <Text style={styles.text}>{String(data.text).trim()}</Text>
      </View>
    </View>
  );
}
