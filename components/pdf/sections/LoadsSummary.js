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
  cell: { flex: 1, fontSize: 9 },
  cellLoad:    { flex: 1, fontSize: 9 },
  cellCont:    { flex: 1.4, fontSize: 9 },
  cellChassis: { flex: 1, fontSize: 9 },
  cellLoc:     { flex: 1.6, fontSize: 9 },
  cellDate:    { flex: 1, fontSize: 9 },
  headerText: {
    fontWeight: 'bold',
    fontSize: 8,
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
};

function locationText(loc) {
  if (!loc) return '—';
  const parts = [loc.city, loc.state].filter(Boolean).join(', ');
  return parts || loc.name || '—';
}

/**
 * Loads Summary section — toggle-aware N-row table for consolidated invoices.
 *   Header band (accent-color) + column header row + N body rows (one per load).
 *
 * `data` shape: Array<{ order_id, load_number, container_number, chassis_number,
 *                       pickup_location: { name, city, state } | null,
 *                       delivery_location: { name, city, state } | null,
 *                       pickup_date, delivery_date }>
 *
 * `opts.fields`: { load_number, container_number, chassis_number,
 *                  pickup_location, delivery_location, pickup_date, delivery_date }
 *   Default-true semantics (chassis_number defaults false per registry).
 */
export default function LoadsSummary({ data, opts, colors }) {
  if (!Array.isArray(data)) return null;
  const fields = opts?.fields || {};
  const accent = colors?.accent || '#3B82F6';

  const showLoad     = fields.load_number       !== false;
  const showCont     = fields.container_number  !== false;
  const showChassis  = fields.chassis_number    !== false;
  const showPickup   = fields.pickup_location   !== false;
  const showDelivery = fields.delivery_location !== false;
  const showPDate    = fields.pickup_date       !== false;
  const showDDate    = fields.delivery_date     !== false;

  return (
    <View style={styles.section}>
      <View style={[styles.band, { backgroundColor: accent }]}>
        <Text style={styles.bandText}>Loads</Text>
      </View>

      <View style={styles.headerRow}>
        {showLoad     ? <Text style={[styles.cellLoad,    styles.headerText]}>Load #</Text>     : null}
        {showCont     ? <Text style={[styles.cellCont,    styles.headerText]}>Container</Text>  : null}
        {showChassis  ? <Text style={[styles.cellChassis, styles.headerText]}>Chassis</Text>    : null}
        {showPickup   ? <Text style={[styles.cellLoc,     styles.headerText]}>Pickup</Text>     : null}
        {showDelivery ? <Text style={[styles.cellLoc,     styles.headerText]}>Delivery</Text>   : null}
        {showPDate    ? <Text style={[styles.cellDate,    styles.headerText]}>P. Date</Text>    : null}
        {showDDate    ? <Text style={[styles.cellDate,    styles.headerText]}>D. Date</Text>    : null}
      </View>

      {data.length === 0 ? (
        <Text style={styles.emptyRow}>(No loads)</Text>
      ) : (
        data.map((load, idx) => (
          <View key={load.order_id || idx} style={styles.row}>
            {showLoad     ? <Text style={styles.cellLoad}>{load.load_number || '—'}</Text>                    : null}
            {showCont     ? <Text style={styles.cellCont}>{load.container_number || '—'}</Text>               : null}
            {showChassis  ? <Text style={styles.cellChassis}>{load.chassis_number || '—'}</Text>              : null}
            {showPickup   ? <Text style={styles.cellLoc}>{locationText(load.pickup_location)}</Text>          : null}
            {showDelivery ? <Text style={styles.cellLoc}>{locationText(load.delivery_location)}</Text>        : null}
            {showPDate    ? <Text style={styles.cellDate}>{load.pickup_date || '—'}</Text>                    : null}
            {showDDate    ? <Text style={styles.cellDate}>{load.delivery_date || '—'}</Text>                  : null}
          </View>
        ))
      )}
    </View>
  );
}
