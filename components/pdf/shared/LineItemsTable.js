import { View, Text } from '@react-pdf/renderer';
import { colors } from './typography';

const styles = {
  table: { marginTop: 12, marginBottom: 12 },
  row: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    paddingVertical: 6,
    paddingHorizontal: 4,
  },
  headerRow: {
    flexDirection: 'row',
    backgroundColor: colors.tableHeader,
    paddingVertical: 6,
    paddingHorizontal: 4,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  colDescription: { flex: 3, fontSize: 10 },
  colQty: { flex: 1, fontSize: 10, textAlign: 'right' },
  colRate: { flex: 1, fontSize: 10, textAlign: 'right' },
  colAmount: { flex: 1, fontSize: 10, textAlign: 'right' },
  headerText: { fontWeight: 'bold', fontSize: 9, color: colors.muted, textTransform: 'uppercase' },
  emptyRow: {
    flexDirection: 'row',
    paddingVertical: 12,
    paddingHorizontal: 4,
    color: colors.muted,
    fontStyle: 'italic',
    textAlign: 'center',
  },
};

function formatCents(cents) {
  const num = (cents || 0) / 100;
  return `$${num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export default function LineItemsTable({ items }) {
  if (!items || items.length === 0) {
    return (
      <View style={styles.table}>
        <View style={styles.headerRow}>
          <Text style={[styles.colDescription, styles.headerText]}>Description</Text>
          <Text style={[styles.colQty, styles.headerText]}>Qty</Text>
          <Text style={[styles.colRate, styles.headerText]}>Rate</Text>
          <Text style={[styles.colAmount, styles.headerText]}>Amount</Text>
        </View>
        <Text style={styles.emptyRow}>(No line items)</Text>
      </View>
    );
  }

  return (
    <View style={styles.table}>
      <View style={styles.headerRow}>
        <Text style={[styles.colDescription, styles.headerText]}>Description</Text>
        <Text style={[styles.colQty, styles.headerText]}>Qty</Text>
        <Text style={[styles.colRate, styles.headerText]}>Rate</Text>
        <Text style={[styles.colAmount, styles.headerText]}>Amount</Text>
      </View>
      {items.map((item, idx) => (
        <View key={item.id || idx} style={styles.row}>
          <Text style={styles.colDescription}>{item.description || item.name || '—'}</Text>
          <Text style={styles.colQty}>{item.quantity || item.unit_count || 1}</Text>
          <Text style={styles.colRate}>
            {formatCents(item.unit_amount_cents ?? item.per_unit_price_cents ?? 0)}
          </Text>
          <Text style={styles.colAmount}>
            {formatCents(item.total_amount_cents ?? item.total_cents ?? 0)}
          </Text>
        </View>
      ))}
    </View>
  );
}
