import { View, Text } from '@react-pdf/renderer';
import { colors as defaultColors } from '../shared/typography';

/**
 * Aging Summary — 5-bucket horizontal grid. Each bucket: label + amount.
 * Master toggle only; no leaf field toggles (the 5 buckets are fixed by
 * the lib/pdf/compute-aging.js helper).
 *
 * `data` shape: { current, days_1_30, days_31_60, days_61_90, days_90_plus }
 *   All cents.
 */
const BUCKETS = [
  { key: 'current',      label: 'Current',     bg: '#ecfdf5', border: '#a7f3d0', textLight: '#059669', textDark: '#065f46' },
  { key: 'days_1_30',    label: '1-30 Days',   bg: '#fffbeb', border: '#fde68a', textLight: '#d97706', textDark: '#92400e' },
  { key: 'days_31_60',   label: '31-60 Days',  bg: '#fef2f2', border: '#fecaca', textLight: '#dc2626', textDark: '#991b1b' },
  { key: 'days_61_90',   label: '61-90 Days',  bg: '#f9fafb', border: '#e5e7eb', textLight: '#6b7280', textDark: '#9ca3af' },
  { key: 'days_90_plus', label: '90+ Days',    bg: '#fef2f2', border: '#dc2626', textLight: '#7f1d1d', textDark: '#7f1d1d', emphasized: true },
];

const styles = {
  section: { marginBottom: 12 },
  band: { paddingHorizontal: 4, paddingVertical: 3, marginBottom: 4 },
  bandText: { color: 'white', fontSize: 7, fontWeight: 'bold', textTransform: 'uppercase' },
  grid: { flexDirection: 'row', gap: 6 },
  bucket: { flex: 1, paddingVertical: 8, paddingHorizontal: 6, borderRadius: 4, alignItems: 'center' },
  bucketLabel: { fontSize: 7, fontWeight: 'bold', textTransform: 'uppercase', marginBottom: 2 },
  bucketAmount: { fontSize: 10, fontWeight: 'bold' },
};

function fmtDollars(cents) {
  if (cents == null) return '$0.00';
  return `$${(cents / 100).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`;
}

export default function AgingSummary({ data, opts, colors }) {
  if (!data) return null;
  const accent = colors?.accent || '#3B82F6';

  return (
    <View style={styles.section}>
      <View style={[styles.band, { backgroundColor: accent }]}>
        <Text style={styles.bandText}>Aging Summary</Text>
      </View>
      <View style={styles.grid}>
        {BUCKETS.map((b) => {
          const cents = data[b.key] || 0;
          const bucketStyle = {
            ...styles.bucket,
            backgroundColor: b.bg,
            borderWidth: b.emphasized ? 2 : 1,
            borderColor: b.border,
          };
          return (
            <View key={b.key} style={bucketStyle}>
              <Text style={[styles.bucketLabel, { color: b.textLight }]}>{b.label}</Text>
              <Text style={[styles.bucketAmount, { color: b.textDark }]}>{fmtDollars(cents)}</Text>
            </View>
          );
        })}
      </View>
    </View>
  );
}
