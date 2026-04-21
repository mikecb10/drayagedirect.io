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

const ALL_B1_KEYS = [
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
];

const SECTION_KEYS = {
  billing:        ALL_B1_KEYS,
  invoices:       ALL_B1_KEYS,
  // Phase B2 will wire these tabs + their endpoints with narrower
  // per-section filter lists. Until then they'd be silent no-ops,
  // so hide every filter section from the sidebar when active.
  apply_payments: [],
  payments:       [],
  credit_memos:   [],
  aging:          [],
};

/**
 * Return the filter-keys visible for the given AR sub-tab id. Unknown sections
 * fall back to the full list (safer than hiding filters unexpectedly).
 */
export function filterKeysForSection(section) {
  return SECTION_KEYS[section] ?? ALL_B1_KEYS;
}
