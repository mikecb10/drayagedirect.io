import { Document, Page, View, Text } from '@react-pdf/renderer';
import Header from './sections/Header';
import LineItemsTable from './shared/LineItemsTable';
import { typography, colors } from './shared/typography';

function formatCents(cents) {
  const num = (cents || 0) / 100;
  return `$${num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatDate(input) {
  if (!input) return '—';
  const d = new Date(input);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

/**
 * Minimal default invoice template.
 * Data shape is documented at lib/pdf/render-invoice.js.
 *
 * IMPORTANT: this is an intentionally plain default. The document
 * designer sub-project (future) will replace all of this.
 */
export default function InvoiceTemplate({
  tenantName,
  invoiceNumber,
  invoiceDate,
  dueDate,
  referenceNumber,
  customer,
  lineItems,
  subtotal,
  total,
  notes,
}) {
  const customerAddress = customer
    ? [customer.address_line1, customer.address_line2, [customer.city, customer.state, customer.zip].filter(Boolean).join(', ')]
        .filter(Boolean).join('\n')
    : '';

  return (
    <Document>
      <Page size="LETTER" style={typography.page}>
        <Header tenantName={tenantName} title="INVOICE" />

        {/* Metadata block */}
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 16 }}>
          <View>
            <Text style={typography.label}>Bill To</Text>
            <Text style={typography.value}>{customer?.name || '(unknown customer)'}</Text>
            <Text style={[typography.value, typography.muted]}>{customerAddress}</Text>
          </View>
          <View style={{ minWidth: 180 }}>
            <Text style={typography.label}>Invoice #</Text>
            <Text style={typography.value}>{invoiceNumber || '—'}</Text>
            <Text style={typography.label}>Invoice Date</Text>
            <Text style={typography.value}>{formatDate(invoiceDate)}</Text>
            <Text style={typography.label}>Due Date</Text>
            <Text style={typography.value}>{formatDate(dueDate)}</Text>
            {referenceNumber ? (
              <>
                <Text style={typography.label}>PO / Reference #</Text>
                <Text style={typography.value}>{referenceNumber}</Text>
              </>
            ) : null}
          </View>
        </View>

        <LineItemsTable items={lineItems} />

        {/* Totals */}
        <View style={{ flexDirection: 'row', justifyContent: 'flex-end', marginTop: 12 }}>
          <View style={{ minWidth: 180 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 2 }}>
              <Text style={typography.muted}>Subtotal</Text>
              <Text>{formatCents(subtotal)}</Text>
            </View>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4, borderTopWidth: 1, borderTopColor: colors.border }}>
              <Text style={{ fontWeight: 'bold' }}>Total Due</Text>
              <Text style={{ fontWeight: 'bold' }}>{formatCents(total)}</Text>
            </View>
          </View>
        </View>

        {/* Notes */}
        {notes ? (
          <View style={{ marginTop: 24 }}>
            <Text style={typography.label}>Notes</Text>
            <Text style={typography.value}>{notes}</Text>
          </View>
        ) : null}
      </Page>
    </Document>
  );
}
