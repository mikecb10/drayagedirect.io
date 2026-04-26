/**
 * Section registries per document type. The Document Designer
 * (FU-035) uses these as the palette of available toggles.
 *
 * Each section may declare optional `fields` (leaf-level toggles).
 * Storage:
 *   - master toggle  → section_config.visibility[sectionId]
 *   - field toggles  → section_config.perSection[sectionId].fields[fieldId]
 *
 * Default-true semantics: any field not present in config defaults to true.
 *
 * Section flags:
 *   defaultVisible: shown by default unless overridden in tenant config
 *   toggleable:     can be turned off in the Document Designer.
 */

export const DELIVERY_ORDER_SECTIONS = [
  {
    id: 'header',
    label: 'Header',
    defaultVisible: true,
    toggleable: true,
    fields: [
      { id: 'logo',         label: 'Logo',         defaultVisible: true },
      { id: 'address',      label: 'Address',      defaultVisible: true },
      { id: 'phone',        label: 'Phone',        defaultVisible: true },
      { id: 'website',      label: 'Website',      defaultVisible: false },
      { id: 'company_name', label: 'Company Name', defaultVisible: true },
    ],
  },
  {
    id: 'delivery_order_details',
    label: 'Delivery Order Details',
    defaultVisible: true,
    toggleable: true,
    fields: [
      { id: 'delivery_order_number', label: 'Delivery Order #',     defaultVisible: true },
      { id: 'pickup_number',         label: 'Pickup #',             defaultVisible: true },
      { id: 'driver_name',           label: 'Driver Name',          defaultVisible: true },
      { id: 'delivery_appointment',  label: 'Delivery Appointment', defaultVisible: true },
      { id: 'reference_number',      label: 'Reference #',          defaultVisible: true },
    ],
  },
  {
    id: 'address_details',
    label: 'Address Details',
    defaultVisible: true,
    toggleable: true,
    fields: [
      { id: 'customer',                                  label: 'Customer',           defaultVisible: true },
      { id: 'pickup_location',                           label: 'Pick Up Location',   defaultVisible: true },
      { id: 'delivery_location',                         label: 'Delivery Location',  defaultVisible: true },
      { id: 'return_location',                           label: 'Return Location',    defaultVisible: true },
      { id: 'appointment_times',                         label: 'Appointment Times',  defaultVisible: true },
      { id: 'display_pickup_for_operational_street_turns', label: 'Display Pickup Location for Operational Street Turns', defaultVisible: false },
    ],
  },
  {
    id: 'move_events',
    label: 'Move Events',
    defaultVisible: true,
    toggleable: true,
  },
  {
    id: 'order_details',
    label: 'Order Details',
    defaultVisible: true,
    toggleable: true,
    fields: [
      { id: 'reference_number',      label: 'Reference #',           defaultVisible: true },
      { id: 'booking_bl',            label: 'Booking/BL',            defaultVisible: true },
      { id: 'mbol',                  label: 'MBOL #',                defaultVisible: true },
      { id: 'hbol',                  label: 'HBOL #',                defaultVisible: true },
      { id: 'container_number',      label: 'Container #',           defaultVisible: true },
      { id: 'container_size',        label: 'Container Size',        defaultVisible: true },
      { id: 'container_type',        label: 'Container Type',        defaultVisible: true },
      { id: 'chassis_number',        label: 'Chassis #',             defaultVisible: true },
      { id: 'chassis_size',          label: 'Chassis Size',          defaultVisible: true },
      { id: 'chassis_type',          label: 'Chassis Type',          defaultVisible: true },
      { id: 'chassis_owner',         label: 'Chassis Owner',         defaultVisible: true },
      { id: 'steamship_line',        label: 'Steamship Line',        defaultVisible: true },
      { id: 'seal',                  label: 'Seal #',                defaultVisible: true },
      { id: 'hazmat',                label: 'Hazmat',                defaultVisible: true },
      { id: 'pickup_number',         label: 'Pickup #',              defaultVisible: true },
      { id: 'pull_container_date',   label: 'Pull Container Date',   defaultVisible: true },
      { id: 'return_container_date', label: 'Return Container Date', defaultVisible: true },
      { id: 'last_free_day',         label: 'Last Free Day',         defaultVisible: true },
      { id: 'per_diem_free_day',     label: 'Per Diem Free Day',     defaultVisible: true },
    ],
  },
  {
    id: 'commodity_details',
    label: 'Commodity Details',
    defaultVisible: false, // soft until D2
    toggleable: true,
    fields: [
      { id: 'commodity',   label: 'Commodity',   defaultVisible: true },
      { id: 'description', label: 'Description', defaultVisible: true },
      { id: 'weight',      label: 'Weight',      defaultVisible: true },
      { id: 'pallets',     label: 'Pallets',     defaultVisible: true },
      { id: 'pieces',      label: 'Pieces',      defaultVisible: true },
    ],
  },
  {
    id: 'notes',
    label: 'Notes',
    defaultVisible: true,
    toggleable: true,
    fields: [
      { id: 'driver_notes',   label: 'Driver Notes',   defaultVisible: true },
      { id: 'yard_notes',     label: 'Yard Notes',     defaultVisible: true },
      { id: 'customer_notes', label: 'Customer Notes', defaultVisible: true },
      { id: 'billing_notes',  label: 'Billing Notes',  defaultVisible: false },
      { id: 'load_notes',     label: 'Load Notes',     defaultVisible: true },
    ],
  },
  {
    id: 'signature',
    label: 'Signature Block',
    defaultVisible: false, // soft until D2
    toggleable: true,
  },
  {
    id: 'disclaimer',
    label: 'Disclaimer',
    defaultVisible: false, // soft until G
    toggleable: true,
  },
  {
    id: 'barcode',
    label: 'Load # Barcode',
    defaultVisible: false,
    toggleable: true,
  },
  {
    id: 'footer',
    label: 'Footer',
    defaultVisible: true,
    toggleable: false,
  },
];

export const SECTIONS_BY_DOCUMENT_TYPE = {
  delivery_order_full: DELIVERY_ORDER_SECTIONS,
  delivery_order_next_move: DELIVERY_ORDER_SECTIONS,
};

export function getSectionsForDocumentType(value) {
  return SECTIONS_BY_DOCUMENT_TYPE[value] || [];
}

/**
 * Compute the effective visibility map AND field-visibility map for a document
 * type given an optional sectionConfig override.
 *
 * Returns:
 *   {
 *     visibility: { [sectionId]: boolean, ... },
 *     fields:     { [sectionId]: { [fieldId]: boolean, ... }, ... }
 *   }
 *
 * Default-true semantics: any field not present in `sectionConfig.perSection[id].fields`
 * resolves to its registry `defaultVisible`. Sections without a `fields` array
 * resolve to an empty `{}` in the result's `fields` map.
 */
export function computeVisibility(sections, sectionConfig) {
  const visibility = {};
  const fields = {};
  for (const s of sections) {
    if (!s.toggleable) {
      visibility[s.id] = true;
    } else {
      const override = sectionConfig?.visibility?.[s.id];
      visibility[s.id] = override === undefined ? s.defaultVisible : override;
    }

    if (s.fields) {
      const fieldOverrides = sectionConfig?.perSection?.[s.id]?.fields || {};
      const resolved = {};
      for (const f of s.fields) {
        const v = fieldOverrides[f.id];
        resolved[f.id] = v === undefined ? f.defaultVisible : v;
      }
      fields[s.id] = resolved;
    } else {
      fields[s.id] = {};
    }
  }
  return { visibility, fields };
}

/**
 * Resolve the colors for a document, applying defaults when the section_config
 * has no `colors` key or omits one of {accent, text}.
 *
 * Defaults: accent = #3B82F6 (Tailwind blue-600), text = #111827 (Tailwind gray-900).
 */
export function extractColors(sectionConfig) {
  return {
    accent: sectionConfig?.colors?.accent || '#3B82F6',
    text:   sectionConfig?.colors?.text   || '#111827',
  };
}
