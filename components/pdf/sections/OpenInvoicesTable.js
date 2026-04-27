import { View, Text } from '@react-pdf/renderer';
import { colors as defaultColors } from '../shared/typography';

const styles = {
  section:    { marginBottom: 12 },
  band:       { paddingHorizontal: 4, paddingVertical: 3, marginBottom: 4 },
  bandText:   { color: 'white', fontSize: 7, fontWeight: 'bold', textTransform: 'uppercase' },
  headerRow:  { flexDirection: 'row', backgroundColor: defaultColors.tableHeader, paddingVertical: 6, paddingHorizontal: 4, borderBottomWidth: 1, borderBottomColor: defaultColors.border },
  row:        { flexDirection: 'row', paddingVertical: 6, paddingHorizontal: 4, borderBottomWidth: 1, borderBottomColor: defaultColors.border },
  headerText: { fontWeight: 'bold', fontSize: 8, color: defaultColors.muted, textTransform: 'uppercase' },
  emptyRow:   { paddingVertical: 12, paddingHorizontal: 4, color: defaultColors.muted, fontStyle: 'italic', textAlign: 'center', fontSize: 10 },
};

// Column widths sum to 100% — order must match OpenInvoicesTablePreview's column order
const COLUMNS = [
  { key: 'invoice_number',     label: 'Invoice #',         width: '14%', align: 'left'  },
  { key: 'invoice_date',       label: 'Inv. Date',         width: '11%', align: 'left'  },
  { key: 'due_date',           label: 'Due Date',          width: '11%', align: 'left'  },
  { key: 'days_past_due',      label: 'Days Past Due',     width: '14%', align: 'right' },
  { key: 'customer_reference', label: 'PO #',              width: '14%', align: 'left'  },
  { key: 'original_amount',    label: 'Original',          width: '13%', align: 'right' },
  { key: 'balance_due',        label: 'Balance Due',       width: '23%', align: 'right' },
];

function fmtDollars(cents) {
  if (cents == null) return '—';
  return `$${(cents / 100).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`;
}

function daysPastDueColor(daysPastDue) {
  if (daysPastDue == null)   return '#374151';
  if (daysPastDue <= 0)      return '#059669';
  if (daysPastDue <= 30)     return '#d97706';
  if (daysPastDue <= 90)     return '#dc2626';
  return '#7f1d1d';
}

function daysPastDueLabel(daysPastDue) {
  if (daysPastDue == null) return '—';
  if (daysPastDue <= 0)    return 'Current';
  return `${daysPastDue} days`;
}

/**
 * Open Invoices section — list of unpaid invoices. Color-codes the
 * "Days Past Due" cell (green/amber/red/dark-red). Honors per-column
 * toggles via opts.fields[col.key].
 *
 * `data` shape: Array<{
 *   invoice_id, invoice_number, invoice_date, due_date,
 *   days_past_due, customer_reference,
 *   original_amount_cents, balance_due_cents
 * }>
 * `opts.fields`: { invoice_number, invoice_date, due_date, days_past_due,
 *                  customer_reference, original_amount, balance_due }
 */
export default function OpenInvoicesTable({ data, opts, colors }) {
  if (!Array.isArray(data)) return null;
  const accent = colors?.accent || '#3B82F6';
  const fields = opts?.fields || {};
  const visibleCols = COLUMNS.filter((c) => fields[c.key] !== false);

  if (visibleCols.length === 0) return null;

  return (
    <View style={styles.section}>
      <View style={[styles.band, { backgroundColor: accent }]}>
        <Text style={styles.bandText}>Open Invoices</Text>
      </View>

      <View style={styles.headerRow}>
        {visibleCols.map((c) => (
          <Text
            key={c.key}
            style={[styles.headerText, { width: c.width, textAlign: c.align, paddingHorizontal: 2 }]}
          >
            {c.label}
          </Text>
        ))}
      </View>

      {data.length === 0 ? (
        <Text style={styles.emptyRow}>(No outstanding invoices)</Text>
      ) : (
        data.map((inv, idx) => (
          <View key={inv.invoice_id || idx} style={styles.row}>
            {visibleCols.map((c) => {
              let value = '—';
              let cellStyle = { color: '#111827', fontWeight: 'normal' };
              switch (c.key) {
                case 'invoice_number':
                  value = inv.invoice_number || '—';
                  cellStyle = { color: '#111827', fontWeight: 'bold' };
                  break;
                case 'invoice_date':
                  value = inv.invoice_date || '—';
                  cellStyle = { color: '#374151' };
                  break;
                case 'due_date':
                  value = inv.due_date || '—';
                  cellStyle = { color: '#374151' };
                  break;
                case 'days_past_due':
                  value = daysPastDueLabel(inv.days_past_due);
                  cellStyle = { color: daysPastDueColor(inv.days_past_due), fontWeight: 'bold' };
                  break;
                case 'customer_reference':
                  value = inv.customer_reference || '—';
                  cellStyle = { color: '#374151' };
                  break;
                case 'original_amount':
                  value = fmtDollars(inv.original_amount_cents);
                  cellStyle = { color: '#374151' };
                  break;
                case 'balance_due':
                  value = fmtDollars(inv.balance_due_cents);
                  cellStyle = { color: '#111827', fontWeight: 'bold' };
                  break;
              }
              return (
                <Text
                  key={c.key}
                  style={[
                    { width: c.width, textAlign: c.align, paddingHorizontal: 2, fontSize: 9 },
                    cellStyle,
                  ]}
                >
                  {value}
                </Text>
              );
            })}
          </View>
        ))
      )}
    </View>
  );
}
