import { Document, Page, View, Text } from '@react-pdf/renderer';
import Header from './sections/Header';
import LineItemsTable from './shared/LineItemsTable';
import { typography, colors } from './shared/typography';

function formatCents(cents) {
  const num = (cents || 0) / 100;
  return `$${num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatDate(input) {
  if (!input) return 'TBD';
  const d = new Date(input);
  if (isNaN(d.getTime())) return 'TBD';
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

function formatLocation(loc) {
  if (!loc) return '(TBD)';
  const cityLine = [loc.city, loc.state, loc.zip].filter(Boolean).join(', ');
  return [loc.name, loc.address_line1, cityLine].filter(Boolean).join('\n');
}

export default function RateConTemplate({
  tenantName,
  confirmationNumber,
  issueDate,
  referenceNumber,
  containerNumber,
  chassisNumber,
  pickup,
  delivery,
  lineItems,
  total,
}) {
  return (
    <Document>
      <Page size="LETTER" style={typography.page}>
        <Header tenantName={tenantName} title="RATE CONFIRMATION" />

        {/* Metadata */}
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 16 }}>
          <View>
            <Text style={typography.label}>Confirmation #</Text>
            <Text style={typography.value}>{confirmationNumber || '—'}</Text>
            <Text style={typography.label}>Issue Date</Text>
            <Text style={typography.value}>{formatDate(issueDate)}</Text>
            {referenceNumber ? (
              <>
                <Text style={typography.label}>PO / Reference #</Text>
                <Text style={typography.value}>{referenceNumber}</Text>
              </>
            ) : null}
          </View>
          <View style={{ minWidth: 180 }}>
            <Text style={typography.label}>Container #</Text>
            <Text style={typography.value}>{containerNumber || '—'}</Text>
            <Text style={typography.label}>Chassis #</Text>
            <Text style={typography.value}>{chassisNumber || '—'}</Text>
          </View>
        </View>

        {/* Pickup / Delivery */}
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 16 }}>
          <View style={{ flex: 1, marginRight: 12 }}>
            <Text style={typography.label}>Pickup</Text>
            <Text style={typography.value}>{formatLocation(pickup?.location)}</Text>
            <Text style={[typography.value, typography.muted]}>Date: {formatDate(pickup?.date)}</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={typography.label}>Delivery</Text>
            <Text style={typography.value}>{formatLocation(delivery?.location)}</Text>
            <Text style={[typography.value, typography.muted]}>Date: {formatDate(delivery?.date)}</Text>
          </View>
        </View>

        <LineItemsTable items={lineItems} />

        {/* Total */}
        <View style={{ flexDirection: 'row', justifyContent: 'flex-end', marginTop: 12 }}>
          <View style={{ minWidth: 180 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4, borderTopWidth: 1, borderTopColor: colors.border }}>
              <Text style={{ fontWeight: 'bold' }}>Total</Text>
              <Text style={{ fontWeight: 'bold' }}>{formatCents(total)}</Text>
            </View>
          </View>
        </View>
      </Page>
    </Document>
  );
}
