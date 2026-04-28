import { View, Text } from '@react-pdf/renderer';

const styles = {
  section: { marginBottom: 12 },
  label: { fontSize: 8, color: '#1e40af', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 3, fontWeight: 'bold' },
  card: {
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderLeftWidth: 3,
    borderLeftColor: '#3b82f6',
    borderRadius: 4,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: '#fafbfc',
  },
  topRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 3 },
  invNum: { fontWeight: 'bold', fontSize: 11, color: '#0f172a' },
  total:  { fontWeight: 'bold', fontSize: 12, color: '#0f172a' },
  meta:   { fontSize: 9, color: '#64748b' },
};

function fmtDollars(cents) {
  if (cents == null) return '—';
  return `$${(cents / 100).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`;
}

/**
 * Issued From Invoice — small card showing the source invoice (the invoice
 * the credit was issued against). Blue 3px left border accent — the palette
 * is hardcoded for semantic distinction (blue == "issued from"; green ==
 * "applied to"). The composer passes `colors` to all section components for
 * call-uniformity; this component intentionally ignores it.
 *
 * `data` shape: { invoice_number, invoice_date, due_date, total_cents }
 * `opts.fields`: { invoice_number, invoice_date, due_date, total }
 *
 * Composer-level guard: rendered only when doc.issued_from_invoice is non-null.
 * Component-level guard: returns null when every field is toggled off (avoids
 * an empty bordered card in that edge case).
 */
export default function IssuedFromInvoice({ data, opts }) {
  if (!data) return null;
  const fields = opts?.fields || {};

  const showInv  = fields.invoice_number !== false;
  const showInvD = fields.invoice_date   !== false;
  const showDue  = fields.due_date       !== false;
  const showTot  = fields.total          !== false;

  const meta = [];
  if (showInvD && data.invoice_date) meta.push(`Issued ${data.invoice_date}`);
  if (showDue  && data.due_date)     meta.push(`Due ${data.due_date}`);

  const hasTopRow = showInv || showTot;
  const hasMeta   = meta.length > 0;
  if (!hasTopRow && !hasMeta) return null;  // every leaf hidden — drop the empty card

  return (
    <View style={styles.section}>
      <Text style={styles.label}>Issued From Invoice</Text>
      <View style={styles.card}>
        {hasTopRow && (
          <View style={styles.topRow}>
            {showInv ? (
              <Text style={styles.invNum}>{data.invoice_number || '—'}</Text>
            ) : (
              <Text style={styles.invNum}>—</Text>
            )}
            {showTot ? (
              <Text style={styles.total}>{fmtDollars(data.total_cents)}</Text>
            ) : null}
          </View>
        )}
        {hasMeta && <Text style={styles.meta}>{meta.join(' · ')}</Text>}
      </View>
    </View>
  );
}
