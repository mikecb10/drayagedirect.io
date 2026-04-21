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

const ALL_B2_KEYS = [
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
];

const SECTION_KEYS = {
  billing:  ALL_B2_KEYS,
  invoices: ALL_B2_KEYS,
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
