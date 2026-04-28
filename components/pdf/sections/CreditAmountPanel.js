import { View, Text } from '@react-pdf/renderer';

const PALETTE = {
  bg:        '#f0fdf4',
  border:    '#16a34a',
  textLight: '#15803d',
  textDark:  '#15803d',
};

const styles = {
  section: { marginBottom: 12, alignItems: 'flex-end' },
  panel: {
    backgroundColor: PALETTE.bg,
    borderWidth: 1.5,
    borderColor: PALETTE.border,
    borderRadius: 4,
    paddingHorizontal: 18,
    paddingVertical: 14,
    minWidth: 180,
    alignItems: 'flex-end',
  },
  label: {
    fontSize: 9,
    letterSpacing: 1,
    textTransform: 'uppercase',
    color: PALETTE.textLight,
    fontWeight: 'bold',
    marginBottom: 2,
  },
  amount: {
    fontSize: 22,
    fontWeight: 'bold',
    color: PALETTE.textDark,
  },
};

function fmtDollars(cents) {
  if (cents == null) return '—';
  return `$${(cents / 100).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`;
}

/**
 * Credit Amount panel — right-aligned green accent block displaying the total
 * credit issued. Always green; VOID state is conveyed by the watermark, not
 * by changing this panel's color (per spec §3.5 and §10.5).
 *
 * `data` shape: { total_cents }
 * `opts.fields`: { total }  (only one leaf — disabling it hides the panel)
 */
export default function CreditAmountPanel({ data, opts, colors }) {
  if (!data) return null;
  const fields = opts?.fields || {};
  if (fields.total === false) return null;

  return (
    <View style={styles.section}>
      <View style={styles.panel}>
        <Text style={styles.label}>Credit Amount</Text>
        <Text style={styles.amount}>{fmtDollars(data.total_cents)}</Text>
      </View>
    </View>
  );
}
