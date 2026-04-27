import sampleData from '../../../../lib/document-designer/sample-data';
import HeaderPreview               from './HeaderPreview';
import DeliveryOrderDetailsPreview from './DeliveryOrderDetailsPreview';
import AddressDetailsPreview       from './AddressDetailsPreview';
import OrderDetailsPreview         from './OrderDetailsPreview';
import CommodityDetailsPreview     from './CommodityDetailsPreview';
import NotesPreview                from './NotesPreview';
import SignaturePreview            from './SignaturePreview';
import DisclaimerPreview           from './DisclaimerPreview';

/**
 * Maps section ID → its HTML preview component. Sections without preview
 * components (move_events / barcode / footer) are intentionally absent —
 * the preview pane is a one-page snapshot, not a multi-page render.
 */
const PREVIEW_BY_SECTION_ID = {
  header:                 HeaderPreview,
  delivery_order_details: DeliveryOrderDetailsPreview,
  address_details:        AddressDetailsPreview,
  order_details:          OrderDetailsPreview,
  commodity_details:      CommodityDetailsPreview,
  notes:                  NotesPreview,
  signature:              SignaturePreview,
  disclaimer:             DisclaimerPreview,
};

/**
 * Live HTML preview of the document. Iterates the section registry, renders
 * each visible section through its corresponding preview component, passing
 * sample data + resolved field-visibility map + per-template colors.
 *
 * `visibility`: { [sectionId]: boolean }
 * `fields`:     { [sectionId]: { [fieldId]: boolean } }
 * `sections`:   the section registry array
 * `colors`:     { accent, text } — per-template colors with defaults applied
 * `branding`:   { tenantName, logo_url } — overrides sample-data values for the header section
 */
export default function DocumentPreview({ visibility, fields, sections, colors, branding }) {
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
          return <Component key={s.id} data={data} opts={opts} colors={colors} />;
        })}
    </div>
  );
}
