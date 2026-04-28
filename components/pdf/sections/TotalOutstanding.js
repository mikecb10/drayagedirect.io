import { View, Text } from '@react-pdf/renderer';

/**
 * Total Outstanding — single right-aligned panel with accent background.
 * `data` shape: { total_outstanding_cents }  (cents)
 * `opts.fields.total`: false → render nothing.
 */
function fmtDollars(cents) {
  if (cents == null) return '$0.00';
  return `$${(cents / 100).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`;
}

export default function TotalOutstanding({ data, opts, colors }) {
  if (!data) return null;
  if (opts?.fields?.total === false) return null;
  const accent = colors?.accent || '#1e40af';
  const cents = data.total_outstanding_cents ?? 0;

  return (
    <View style={{ flexDirection: 'row', justifyContent: 'flex-end', marginBottom: 12 }}>
      <View
        style={{
          backgroundColor: accent,
          paddingHorizontal: 18,
          paddingVertical: 10,
          minWidth: 280,
          borderRadius: 4,
          flexDirection: 'row',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}
      >
        <Text
          style={{
            color: 'white',
            fontSize: 9,
            fontWeight: 'bold',
            textTransform: 'uppercase',
            letterSpacing: 1,
          }}
        >
          Total Outstanding
        </Text>
        <Text style={{ color: 'white', fontSize: 16, fontWeight: 'bold' }}>
          {fmtDollars(cents)}
        </Text>
      </View>
    </View>
  );
}
