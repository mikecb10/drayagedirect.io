/**
 * Single source of truth for document types. Mirrors the shape of
 * lib/constants/load-types.js so the Document Designer (FU-035)
 * can iterate this list as its palette of available types.
 *
 * Adding a new document type:
 *   1. Append entry below
 *   2. If the type has its own section composition, register sections
 *      in lib/constants/document-sections.js
 */

export const DOCUMENT_TYPES = [
  {
    value: 'delivery_order_full',
    label: 'Delivery Order — Full',
    description: 'Entire routing across all moves',
    category: 'load',
  },
  {
    value: 'delivery_order_next_move',
    label: 'Delivery Order — Next Move',
    description: 'Only the next non-completed move',
    category: 'load',
  },
  {
    value: 'invoice',
    label: 'Invoice',
    description: 'AR invoice for a customer',
    category: 'ar',
  },
  {
    value: 'rate_con',
    label: 'Rate Confirmation',
    description: 'Confirmation of a negotiated rate sent to a carrier',
    category: 'ar',
  },
];

export const VALID_DOCUMENT_TYPES = DOCUMENT_TYPES.map((t) => t.value);
export const DOCUMENT_TYPE_LABELS = Object.fromEntries(
  DOCUMENT_TYPES.map((t) => [t.value, t.label])
);

export function getDocumentType(value) {
  return DOCUMENT_TYPES.find((t) => t.value === value) || null;
}

export function isValidDocumentType(value) {
  return VALID_DOCUMENT_TYPES.includes(value);
}
