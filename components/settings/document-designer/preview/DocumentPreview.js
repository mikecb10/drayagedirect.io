import sampleDataDeliveryOrder from '../../../../lib/document-designer/sample-data-delivery-order';
import sampleDataInvoice       from '../../../../lib/document-designer/sample-data-invoice';
import sampleDataRateCon       from '../../../../lib/document-designer/sample-data-rate-con';
import sampleDataCombinedInvoice from '../../../../lib/document-designer/sample-data-combined-invoice';
import sampleDataPod              from '../../../../lib/document-designer/sample-data-pod';
import sampleDataStatement        from '../../../../lib/document-designer/sample-data-statement';
import HeaderPreview               from './HeaderPreview';
import DeliveryOrderDetailsPreview from './DeliveryOrderDetailsPreview';
import InvoiceDetailsPreview        from './InvoiceDetailsPreview';
import RateConDetailsPreview        from './RateConDetailsPreview';
import PodDetailsPreview            from './PodDetailsPreview';
import AttachedDocumentsPreview     from './AttachedDocumentsPreview';
import AddressDetailsPreview       from './AddressDetailsPreview';
import LoadsSummaryPreview         from './LoadsSummaryPreview';
import OrderDetailsPreview         from './OrderDetailsPreview';
import CommodityDetailsPreview     from './CommodityDetailsPreview';
import ChargeDetailsPreview         from './ChargeDetailsPreview';
import NotesPreview                from './NotesPreview';
import SignaturePreview            from './SignaturePreview';
import DisclaimerPreview           from './DisclaimerPreview';

const SAMPLE_BY_DOCUMENT_TYPE = {
  delivery_order_full:      sampleDataDeliveryOrder,
  delivery_order_next_move: sampleDataDeliveryOrder,
  invoice:                  sampleDataInvoice,
  rate_con:                 sampleDataRateCon,
  combined_invoice:         sampleDataCombinedInvoice,
  pod:                      sampleDataPod,
  statement:                sampleDataStatement,
};

/**
 * Maps section ID → its HTML preview component. Sections without preview
 * components (move_events / barcode / footer) are intentionally absent —
 * the preview pane is a one-page snapshot, not a multi-page render.
 */
const PREVIEW_BY_SECTION_ID = {
  header:                 HeaderPreview,
  delivery_order_details: DeliveryOrderDetailsPreview,
  invoice_details:        InvoiceDetailsPreview,
  rate_con_details:       RateConDetailsPreview,
  pod_details:            PodDetailsPreview,
  address_details:        AddressDetailsPreview,
  loads_summary:          LoadsSummaryPreview,
  order_details:          OrderDetailsPreview,
  commodity_details:      CommodityDetailsPreview,
  attached_documents:     AttachedDocumentsPreview,
  charge_details:         ChargeDetailsPreview,
  notes:                  NotesPreview,
  signature:              SignaturePreview,
  disclaimer:             DisclaimerPreview,
};

/**
 * Live HTML preview of the document. Iterates the section registry, renders
 * each visible section through its corresponding preview component, passing
 * sample data + resolved field-visibility map + per-template colors.
 *
 * `documentType`: 'delivery_order_full' | 'delivery_order_next_move' | 'invoice'
 *                 | 'rate_con' | 'combined_invoice' | 'pod' | 'statement'
 *                 — picks the per-doc-type sample data slice
 * `visibility`:   { [sectionId]: boolean }
 * `fields`:       { [sectionId]: { [fieldId]: boolean } }
 * `sections`:     the section registry array
 * `colors`:       { accent, text } — per-template colors with defaults applied
 * `branding`:     { tenantName, logo_url } — overrides sample-data values for the header section
 */
export default function DocumentPreview({ documentType, visibility, fields, sections, colors, branding }) {
  const sampleData = SAMPLE_BY_DOCUMENT_TYPE[documentType] || sampleDataDeliveryOrder;

  return (
    <div className="bg-white rounded-lg shadow-lg ring-1 ring-gray-200 p-8 text-sm text-gray-900">
      {sections.map((s) => {
        if (!visibility[s.id]) return null;
        const Component = PREVIEW_BY_SECTION_ID[s.id];
        if (!Component) return null;
        let data = sampleData[s.id];
        // Apply branding override to the header section's data.
        if (s.id === 'header' && branding) {
          data = {
            ...data,
            tenantName: branding.tenantName || data.tenantName,
            tenantInfo: {
              ...data.tenantInfo,
              logo_url: branding.logo_url || data.tenantInfo?.logo_url,
            },
          };
        }
        const opts = { fields: fields[s.id] || {} };
        if (s.id === 'address_details' && documentType === 'invoice') {
          opts.customerLabel = 'Bill To';
          // Field-ID translation to keep AddressDetailsPreview's internal API stable:
          // INVOICE_SECTIONS uses bill_to; AddressDetailsPreview reads opts.fields.customer.
          opts.fields = { ...opts.fields, customer: opts.fields?.bill_to !== false };
        }
        if (s.id === 'address_details' && documentType === 'combined_invoice') {
          // Same field-ID translation as Invoice. INVOICE_SECTIONS uses bill_to;
          // AddressDetailsPreview reads opts.fields.customer.
          // Mirrored in components/pdf/CombinedInvoiceTemplate.js renderSection().
          opts.customerLabel = 'Bill To';
          opts.fields = { ...opts.fields, customer: opts.fields?.bill_to !== false };
        }
        if (s.id === 'address_details' && documentType === 'pod') {
          // Same field-ID translation as Invoice / Combined Invoice.
          // POD_SECTIONS uses bill_to; AddressDetailsPreview reads opts.fields.customer.
          // Mirrored in components/pdf/PodTemplate.js renderSection() for the print path.
          opts.customerLabel = 'Bill To';
          opts.fields = { ...opts.fields, customer: opts.fields?.bill_to !== false };
        }
        if (s.id === 'charge_details' && documentType === 'rate_con') {
          // Rate Con's charge_set.total_cents is the only authoritative total — there
          // is no subtotal_cents column. Suppress the Subtotal row in the totals footer.
          // Mirrored in components/pdf/RateConTemplate.js renderSection() for the
          // print path — keep the two in sync.
          opts.showSubtotal = false;
        }
        if (s.id === 'charge_details' && documentType === 'combined_invoice') {
          // Combined invoice groups line items by load. ChargeDetailsPreview reads
          // data.charge_groups (per-load buckets) instead of data.charge_lines.
          // Mirrored in components/pdf/CombinedInvoiceTemplate.js renderSection().
          opts.groupByLoad = true;
        }
        return <Component key={s.id} data={data} opts={opts} colors={colors} />;
      })}
    </div>
  );
}
