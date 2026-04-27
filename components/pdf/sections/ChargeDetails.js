import { View, Text } from '@react-pdf/renderer';
import { colors as defaultColors } from '../shared/typography';

const styles = {
  section: { marginBottom: 12 },
  band: {
    paddingHorizontal: 4,
    paddingVertical: 3,
    marginBottom: 4,
  },
  bandText: {
    color: 'white',
    fontSize: 7,
    fontWeight: 'bold',
    textTransform: 'uppercase',
  },
  table: {},
  headerRow: {
    flexDirection: 'row',
    backgroundColor: defaultColors.tableHeader,
    paddingVertical: 6,
    paddingHorizontal: 4,
    borderBottomWidth: 1,
    borderBottomColor: defaultColors.border,
  },
  row: {
    flexDirection: 'row',
    paddingVertical: 6,
    paddingHorizontal: 4,
    borderBottomWidth: 1,
    borderBottomColor: defaultColors.border,
  },
  totalsRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    paddingVertical: 4,
    paddingHorizontal: 4,
  },
  totalsBoldRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    paddingVertical: 4,
    paddingHorizontal: 4,
    borderTopWidth: 1,
    borderTopColor: defaultColors.border,
    marginTop: 2,
  },
  cellName:   { flex: 4, fontSize: 10 },
  cellUnits:  { flex: 1, fontSize: 10, textAlign: 'right' },
  cellRates:  { flex: 1, fontSize: 10, textAlign: 'right' },
  cellCharge: { flex: 1, fontSize: 10, textAlign: 'right' },
  headerText: {
    fontWeight: 'bold',
    fontSize: 9,
    color: defaultColors.muted,
    textTransform: 'uppercase',
  },
  emptyRow: {
    paddingVertical: 12,
    paddingHorizontal: 4,
    color: defaultColors.muted,
    fontStyle: 'italic',
    textAlign: 'center',
    fontSize: 10,
  },
  groupHeader: {
    paddingHorizontal: 4,
    paddingVertical: 4,
    backgroundColor: defaultColors.tableHeader,
    marginTop: 6,
  },
  groupHeaderText: {
    fontSize: 10,
    fontWeight: 'bold',
    color: defaultColors.muted,
  },
  totalsLabel: { width: 80, fontSize: 10, textAlign: 'right' },
  totalsValue: { width: 90, fontSize: 10, textAlign: 'right', paddingLeft: 8 },
  totalsLabelBold: { width: 80, fontSize: 10, textAlign: 'right', fontWeight: 'bold' },
  totalsValueBold: { width: 90, fontSize: 10, textAlign: 'right', paddingLeft: 8, fontWeight: 'bold' },
};

function formatCents(cents) {
  const num = (cents || 0) / 100;
  return `$${num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/**
 * Charge Details section — toggle-aware table.
 *   Header band (accent-color) + column header row + body rows + totals footer.
 *
 * `data` shape: { charge_lines: [...], totals: { subtotal_cents, total_cents } }
 *   charge_lines[]: { description, quantity, unit_amount_cents, total_amount_cents }
 *
 * `opts.fields`: { charge_name, units, rates, charges } — column visibility.
 *   Default-true semantics: any field not specified is shown.
 */
export default function ChargeDetails({ data, opts, colors }) {
  if (!data) return null;
  const fields = opts?.fields || {};
  const accent = colors?.accent || '#3B82F6';
  const showSubtotal = opts?.showSubtotal !== false;
  const groupByLoad = opts?.groupByLoad === true;

  const showName    = fields.charge_name !== false;
  const showUnits   = fields.units       !== false;
  const showRates   = fields.rates       !== false;
  const showCharges = fields.charges     !== false;

  const lines = data.charge_lines || [];
  const totals = data.totals || {};

  return (
    <View style={styles.section}>
      <View style={[styles.band, { backgroundColor: accent }]}>
        <Text style={styles.bandText}>Charge Details</Text>
      </View>

      <View style={styles.table}>
        {groupByLoad ? (
          // Grouped mode (Combined Invoice): render data.charge_groups
          // Each group: Load # sub-header → group's lines → "Subtotal: $X" row
          // After all groups: "GRAND TOTAL: $Y" bold row
          (() => {
            const groups = data.charge_groups || [];
            const grand = data.totals?.total_cents ?? groups.reduce((sum, g) => sum + (g.subtotal_cents || 0), 0);

            if (groups.length === 0) {
              return <Text style={styles.emptyRow}>(No charges)</Text>;
            }

            return (
              <>
                {groups.map((g, gIdx) => (
                  <View key={g.order_id || gIdx}>
                    {/* Group sub-header */}
                    <View style={styles.groupHeader}>
                      <Text style={styles.groupHeaderText}>Load #{g.load_number || '—'}</Text>
                    </View>
                    {/* Column header row inside each group */}
                    <View style={styles.headerRow}>
                      {fields.charge_name !== false ? <Text style={[styles.cellName,   styles.headerText]}>Charge Name</Text> : null}
                      {fields.units       !== false ? <Text style={[styles.cellUnits,  styles.headerText]}>Units</Text>       : null}
                      {fields.rates       !== false ? <Text style={[styles.cellRates,  styles.headerText]}>Rates</Text>       : null}
                      {fields.charges     !== false ? <Text style={[styles.cellCharge, styles.headerText]}>Charges</Text>     : null}
                    </View>
                    {/* Group's line items */}
                    {(g.lines || []).map((line, lIdx) => (
                      <View key={lIdx} style={styles.row}>
                        {fields.charge_name !== false ? <Text style={styles.cellName}>{line.description || '—'}</Text>                 : null}
                        {fields.units       !== false ? <Text style={styles.cellUnits}>{line.quantity ?? 1}</Text>                       : null}
                        {fields.rates       !== false ? <Text style={styles.cellRates}>{formatCents(line.unit_amount_cents)}</Text>      : null}
                        {fields.charges     !== false ? <Text style={styles.cellCharge}>{formatCents(line.total_amount_cents)}</Text>    : null}
                      </View>
                    ))}
                    {/* Group subtotal */}
                    <View style={styles.totalsRow}>
                      <Text style={styles.totalsLabel}>Subtotal</Text>
                      <Text style={styles.totalsValue}>{formatCents(g.subtotal_cents)}</Text>
                    </View>
                  </View>
                ))}
                {/* Grand total */}
                <View style={styles.totalsBoldRow}>
                  <Text style={styles.totalsLabelBold}>GRAND TOTAL</Text>
                  <Text style={styles.totalsValueBold}>{formatCents(grand)}</Text>
                </View>
              </>
            );
          })()
        ) : (
          <>
            <View style={styles.headerRow}>
              {showName    ? <Text style={[styles.cellName,   styles.headerText]}>Charge Name</Text> : null}
              {showUnits   ? <Text style={[styles.cellUnits,  styles.headerText]}>Units</Text>       : null}
              {showRates   ? <Text style={[styles.cellRates,  styles.headerText]}>Rates</Text>       : null}
              {showCharges ? <Text style={[styles.cellCharge, styles.headerText]}>Charges</Text>     : null}
            </View>

            {lines.length === 0 ? (
              <Text style={styles.emptyRow}>(No charges)</Text>
            ) : (
              lines.map((line, idx) => (
                <View key={idx} style={styles.row}>
                  {showName    ? <Text style={styles.cellName}>{line.description || '—'}</Text>                 : null}
                  {showUnits   ? <Text style={styles.cellUnits}>{line.quantity ?? 1}</Text>                     : null}
                  {showRates   ? <Text style={styles.cellRates}>{formatCents(line.unit_amount_cents)}</Text>    : null}
                  {showCharges ? <Text style={styles.cellCharge}>{formatCents(line.total_amount_cents)}</Text>  : null}
                </View>
              ))
            )}

            {lines.length > 0 ? (
              <>
                {showSubtotal ? (
                  <View style={styles.totalsRow}>
                    <Text style={styles.totalsLabel}>Subtotal</Text>
                    <Text style={styles.totalsValue}>{formatCents(totals.subtotal_cents)}</Text>
                  </View>
                ) : null}
                <View style={styles.totalsBoldRow}>
                  <Text style={styles.totalsLabelBold}>Total Due</Text>
                  <Text style={styles.totalsValueBold}>{formatCents(totals.total_cents)}</Text>
                </View>
              </>
            ) : null}
          </>
        )}
      </View>
    </View>
  );
}
