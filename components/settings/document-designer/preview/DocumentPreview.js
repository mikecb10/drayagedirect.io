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
 * sample data + resolved field-visibility map.
 *
 * `visibility`: { [sectionId]: boolean }
 * `fields`:     { [sectionId]: { [fieldId]: boolean } }
 * `sections`:   the section registry array (DELIVERY_ORDER_SECTIONS or future per-doc-type)
 *
 * The preview pane has a paper-like styling (white bg, shadow, ring). Stays
 * light even in dark mode — printed documents don't have dark mode.
 */
export default function DocumentPreview({ visibility, fields, sections }) {
  return (
    <div className="space-y-3">
      <div className="text-[11px] px-3 py-1.5 rounded bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-900/40 text-amber-900 dark:text-amber-200">
        Preview reflects the upcoming document layout. Printed PDFs use the current layout until the rendering update ships.
      </div>
      <div className="bg-white rounded-lg shadow-lg ring-1 ring-gray-200 p-8 text-sm text-gray-900">
        {sections.map((s) => {
          if (!visibility[s.id]) return null;
          const Component = PREVIEW_BY_SECTION_ID[s.id];
          if (!Component) return null;
          const data = sampleData[s.id];
          const opts = { fields: fields[s.id] || {} };
          return <Component key={s.id} data={data} opts={opts} />;
        })}
      </div>
    </div>
  );
}
