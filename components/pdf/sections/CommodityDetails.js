import { View, Text } from '@react-pdf/renderer';
import { typography } from '../shared/typography';

/**
 * Commodity Details section — 5-col table mirroring CommodityDetailsPreview.
 * Renders one sample row per load (the actual commodity-data source doesn't
 * exist yet; a future FU plugs it in).
 *
 * `opts.fields`: { commodity, description, weight, pallets, pieces }.
 * Default-true. If a column toggled off, that <th>/<td> is omitted.
 *
 * `colors.accent`: hex color for the table header band.
 */
const COL_ORDER = [
  ['commodity',   'Commodity'],
  ['description', 'Description'],
  ['weight',      'Weight'],
  ['pallets',     'Pallets'],
  ['pieces',      'Pieces'],
];

export default function CommodityDetails({ data, opts, colors }) {
  if (!data) return null;
  const fields = opts?.fields || {};
  const accent = colors?.accent || '#3B82F6';
  const cols = COL_ORDER.filter(([key]) => fields[key] !== false);
  if (cols.length === 0) return null;

  return (
    <View style={{ marginBottom: 12 }}>
      <View style={{ flexDirection: 'row', backgroundColor: accent }}>
        {cols.map(([key, label]) => (
          <View key={key} style={{ flex: 1, padding: 4 }}>
            <Text style={[typography.label, { color: 'white', fontSize: 8 }]}>{label}</Text>
          </View>
        ))}
      </View>
      <View
        style={{
          flexDirection: 'row',
          borderBottom: '1pt solid #ccc',
          borderLeft: '1pt solid #ccc',
          borderRight: '1pt solid #ccc',
        }}
      >
        {cols.map(([key]) => (
          <View key={key} style={{ flex: 1, padding: 4, borderRight: '1pt solid #eee' }}>
            <Text style={typography.value}>{data[key] || '—'}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}
