/**
 * Section registries per document type. The Document Designer
 * (FU-035) uses these as the palette of available toggles.
 *
 * Section flags:
 *   defaultVisible: shown by default unless overridden in tenant config
 *   toggleable:     can be turned off in the Document Designer.
 *                   `false` means load-bearing — the document is
 *                   meaningless without it (e.g., move_block on a
 *                   Delivery Order is the routing itself).
 */

export const DELIVERY_ORDER_SECTIONS = [
  { id: 'load_metadata',       label: 'Load metadata',                defaultVisible: true,  toggleable: false },
  { id: 'bill_to',             label: 'Bill-to customer',             defaultVisible: true,  toggleable: true  },
  { id: 'customer_contact',    label: 'Customer phone / email',       defaultVisible: true,  toggleable: true  },
  { id: 'equipment_details',   label: 'Container / chassis details',  defaultVisible: true,  toggleable: true  },
  { id: 'hazmat_details',      label: 'Hazmat details',               defaultVisible: true,  toggleable: true  },
  { id: 'instructions',        label: 'Driver notes / instructions',  defaultVisible: true,  toggleable: true  },
  { id: 'appointment_details', label: 'Appointment #s / gate codes',  defaultVisible: true,  toggleable: true  },
  { id: 'move_block',          label: 'Routing (moves + events)',     defaultVisible: true,  toggleable: false },
  { id: 'driver_per_move',     label: 'Driver name per move',         defaultVisible: true,  toggleable: true  },
  { id: 'signature_block',     label: 'Signature block',              defaultVisible: false, toggleable: true  },
  { id: 'barcode',             label: 'Load # barcode',               defaultVisible: false, toggleable: true  },
  { id: 'footer',              label: 'Footer (timestamp, page #)',   defaultVisible: true,  toggleable: false },
];

export const SECTIONS_BY_DOCUMENT_TYPE = {
  delivery_order_full: DELIVERY_ORDER_SECTIONS,
  delivery_order_next_move: DELIVERY_ORDER_SECTIONS,
};

export function getSectionsForDocumentType(value) {
  return SECTIONS_BY_DOCUMENT_TYPE[value] || [];
}

/**
 * Compute the effective visibility map for a document type given an
 * optional sectionConfig override. Used by the composer.
 */
export function computeVisibility(sections, sectionConfig) {
  const out = {};
  for (const s of sections) {
    if (!s.toggleable) {
      out[s.id] = true;
      continue;
    }
    const override = sectionConfig?.visibility?.[s.id];
    out[s.id] = override === undefined ? s.defaultVisible : override;
  }
  return out;
}
