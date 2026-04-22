/**
 * Declarative per-section filter visibility for the AR FilterSidebar + endpoints.
 *
 * Phase B1 wires Billing + Invoices only; both consume every filter key. Phase B2
 * adds Apply Payments / Payments / Credits / Aging with narrower subsets (e.g.
 * Payments probably only sees customer / branch / invoiced date range, not load
 * flags or container size).
 *
 * The FilterSidebar reads `filterKeysForSection(section)` and only renders
 * sections whose key is in the returned array. Endpoints never look at this —
 * they just parse everything they receive (unknown keys get stripped by
 * sanitizeFilterSet anyway).
 */

export const ALL_B2_KEYS = [
  // Phase A + B1
  'customer_ids',
  'branch_ids',
  'from',
  'to',
  'reference_number',
  'load_types',
  'container_types',
  'container_sizes',
  'flags',
  'ssl_codes',
  'driver_ids',
  // Phase B2: exclude variants (same keys with _exclude suffix)
  'customer_ids_exclude',
  'branch_ids_exclude',
  'load_types_exclude',
  'container_types_exclude',
  'container_sizes_exclude',
  'flags_exclude',
  'ssl_codes_exclude',
  'driver_ids_exclude',
  // Phase B2: new dimensions
  'invoiced_from',
  'invoiced_to',
  'pickup_location_ids',
  'delivery_location_ids',
  'return_location_ids',
  // Phase B4: bill-to primary / additional + factor company
  'bill_to_primary_customer_ids',
  'bill_to_primary_customer_ids_exclude',
  'bill_to_additional_customer_ids',
  'bill_to_additional_customer_ids_exclude',
  'factor_company',
  // Phase C: "is X sent?" Y/N filters
  'rate_con_sent_y',
  'invoice_email_sent_y',
  // Load Margin % numeric range
  'margin_from',
  'margin_to',
];

export const SECTION_KEYS = {
  // Billing gets every key EXCEPT invoice_email_sent_y (invoice-level; Billing has charge-set-level rate-con signal)
  billing:  ALL_B2_KEYS.filter((k) => k !== 'invoice_email_sent_y'),
  // Invoices gets every key EXCEPT rate_con_sent_y (charge-set-level; rate cons are per-charge-set not per-invoice)
  invoices: ALL_B2_KEYS.filter((k) => k !== 'rate_con_sent_y'),
  // Phase B3: applicable subsets per section. ApplyPaymentsTab has its own
  // OrgPicker customer flow — leaving its filter list empty avoids a
  // conflict between the sidebar's customer filter and the tab's picker.
  apply_payments: [],
  payments:       ['customer_ids', 'customer_ids_exclude', 'from', 'to', 'reference_number'],
  credit_memos:   ['customer_ids', 'customer_ids_exclude', 'from', 'to'],
  aging:          ['customer_ids', 'customer_ids_exclude', 'invoiced_from', 'invoiced_to'],
};

/**
 * Return the filter-keys visible for the given AR sub-tab id. Unknown sections
 * fall back to the full list (safer than hiding filters unexpectedly).
 */
export function filterKeysForSection(section) {
  return SECTION_KEYS[section] ?? ALL_B2_KEYS;
}
