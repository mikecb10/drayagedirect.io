import { View, Text } from '@react-pdf/renderer';

const styles = {
  section: { marginBottom: 12 },
  label: { fontSize: 8, color: '#166534', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 3, fontWeight: 'bold' },
  card: {
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderLeftWidth: 3,
    borderLeftColor: '#10b981',
    borderRadius: 4,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: '#fafbfc',
  },
  topRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 3 },
  invNum:   { fontWeight: 'bold', fontSize: 11, color: '#0f172a' },
  balance:  { fontWeight: 'bold', fontSize: 12, color: '#0f172a' },
  meta:     { fontSize: 9, color: '#64748b' },
};

function fmtDollars(cents) {
  if (cents == null) return '—';
  return `$${(cents / 100).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`;
}

/**
 * Applied To Invoice — small card showing the destination invoice (the
 * invoice this credit's amount was applied against). Green 3px left border —
 * the palette is hardcoded for semantic distinction (green == "applied to";
 * blue == "issued from"). The composer passes `colors` to all section
 * components for call-uniformity; this component intentionally ignores it.
 *
 * `data` shape: { invoice_number, invoice_date, balance_due_cents,
 *                 applied_amount_cents, applied_date }
 * `opts.fields`: { invoice_number, invoice_date, balance_due,
 *                  applied_amount, applied_date }
 *
 * Composer-level guard: rendered only when doc.applied_to_invoice is non-null.
 * Component-level guard: returns null when every field is toggled off (avoids
 * an empty bordered card in that edge case).
 */
export default function AppliedToInvoice({ data, opts }) {
  if (!data) return null;
  const fields = opts?.fields || {};

  const showInv      = fields.invoice_number  !== false;
  const showInvD     = fields.invoice_date    !== false;
  const showBalance  = fields.balance_due     !== false;
  const showApplied  = fields.applied_amount  !== false;
  const showAppliedD = fields.applied_date    !== false;

  const balanceLabel = showBalance && data.balance_due_cents != null
    ? `Bal: ${fmtDollars(data.balance_due_cents)}`
    : null;

  const meta = [];
  if (showInvD && data.invoice_date) meta.push(`Issued ${data.invoice_date}`);
  if (showApplied && data.applied_amount_cents != null) {
    const amount = fmtDollars(data.applied_amount_cents);
    if (showAppliedD && data.applied_date) {
      meta.push(`Reduced by ${amount} on ${data.applied_date}`);
    } else {
      meta.push(`Reduced by ${amount}`);
    }
  } else if (showAppliedD && data.applied_date) {
    meta.push(`Applied ${data.applied_date}`);
  }

  const hasTopRow = showInv || balanceLabel;
  const hasMeta   = meta.length > 0;
  if (!hasTopRow && !hasMeta) return null;  // every leaf hidden — drop the empty card

  return (
    <View style={styles.section}>
      <Text style={styles.label}>Applied To Invoice</Text>
      <View style={styles.card}>
        {hasTopRow && (
          <View style={styles.topRow}>
            {showInv ? (
              <Text style={styles.invNum}>{data.invoice_number || '—'}</Text>
            ) : (
              <Text style={styles.invNum}>—</Text>
            )}
            {balanceLabel ? (
              <Text style={styles.balance}>{balanceLabel}</Text>
            ) : null}
          </View>
        )}
        {hasMeta && <Text style={styles.meta}>{meta.join(' · ')}</Text>}
      </View>
    </View>
  );
}
