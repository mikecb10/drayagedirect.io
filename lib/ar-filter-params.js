// lib/ar-filter-params.js

/**
 * Parse a comma-separated query-string param into a clean string[].
 * Always returns an array. Trims whitespace, drops empty segments,
 * returns [] for undefined / non-string / empty input.
 */
export function parseCsvParam(raw) {
  if (typeof raw !== 'string' || raw.length === 0) return [];
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Narrow a filter object to only the canonical keys and drop empty
 * values (empty arrays, null / undefined / '' dates and strings). Used
 * when persisting custom-tab filter payloads so the JSONB row stays
 * compact, and when merging client-supplied filter patches into a
 * URLSearchParams-shaped fetch payload.
 *
 * Keys are grouped by coercion:
 *   - ARRAY_KEYS:  arrays of non-empty strings (ids, codes, flag names)
 *   - STRING_KEYS: non-empty strings (text search, ISO dates)
 */
const ARRAY_KEYS = [
  // Include variants (Phase A + B1)
  'customer_ids',
  'branch_ids',
  'load_types',
  'container_types',
  'container_sizes',
  'flags',
  'ssl_codes',
  'driver_ids',
  // Exclude variants (Phase B2)
  'customer_ids_exclude',
  'branch_ids_exclude',
  'load_types_exclude',
  'container_types_exclude',
  'container_sizes_exclude',
  'flags_exclude',
  'ssl_codes_exclude',
  'driver_ids_exclude',
  // Location multi-selects (Phase B2)
  'pickup_location_ids',
  'delivery_location_ids',
  'return_location_ids',
  // Bill-to primary + additional (Phase B4)
  'bill_to_primary_customer_ids',
  'bill_to_primary_customer_ids_exclude',
  'bill_to_additional_customer_ids',
  'bill_to_additional_customer_ids_exclude',
];

const STRING_KEYS = [
  'from',
  'to',
  'reference_number',
  // Invoiced date range (Phase B2)
  'invoiced_from',
  'invoiced_to',
  // Factor company Y/N (Phase B4) — string 'yes' | 'no'
  'factor_company',
  // Phase C: "is X sent?" Y/N filters
  'rate_con_sent_y',
  'invoice_email_sent_y',
  // Load Margin % numeric range (stored as numeric strings; endpoint coerces with Number())
  'margin_from',
  'margin_to',
];

const KNOWN_KEYS = [...ARRAY_KEYS, ...STRING_KEYS];

/**
 * Append the canonical AR filter dimensions onto a URLSearchParams.
 * Covers customer/branch/date ranges, include + exclude lists across
 * load/container/flag/ssl/driver, locations, bill-to primary/additional,
 * factor_company, and the margin numeric range.
 *
 * Caller-specific params (status, load_status, search, rate_con_sent_y,
 * invoice_email_sent_y) are set inline by each caller — they're not in
 * the shared shape.
 *
 * @param {URLSearchParams} params - mutated in place
 * @param {object} filters         - filter object from useArFilters / similar
 */
export function appendArFilterParams(params, filters) {
  if (!filters) return;
  // Customer / branch / dates / reference (Phase B1+B2)
  if (filters.customer_ids?.length) params.set('customer_ids', filters.customer_ids.join(','));
  if (filters.branch_ids?.length)   params.set('branch_ids',   filters.branch_ids.join(','));
  if (filters.from)                 params.set('from',         filters.from);
  if (filters.to)                   params.set('to',           filters.to);
  if (filters.invoiced_from)        params.set('invoiced_from', filters.invoiced_from);
  if (filters.invoiced_to)          params.set('invoiced_to',   filters.invoiced_to);
  if (filters.reference_number)     params.set('reference_number', filters.reference_number);
  // Includes (Phase B3)
  if (filters.load_types?.length)       params.set('load_types',       filters.load_types.join(','));
  if (filters.container_types?.length) params.set('container_types', filters.container_types.join(','));
  if (filters.container_sizes?.length) params.set('container_sizes', filters.container_sizes.join(','));
  if (filters.flags?.length) params.set('flags', filters.flags.join(','));
  if (filters.ssl_codes?.length) params.set('ssl_codes', filters.ssl_codes.join(','));
  if (filters.driver_ids?.length) params.set('driver_ids', filters.driver_ids.join(','));
  // Excludes
  if (filters.customer_ids_exclude?.length)    params.set('customer_ids_exclude',    filters.customer_ids_exclude.join(','));
  if (filters.branch_ids_exclude?.length)      params.set('branch_ids_exclude',      filters.branch_ids_exclude.join(','));
  if (filters.load_types_exclude?.length)      params.set('load_types_exclude',      filters.load_types_exclude.join(','));
  if (filters.container_types_exclude?.length) params.set('container_types_exclude', filters.container_types_exclude.join(','));
  if (filters.container_sizes_exclude?.length) params.set('container_sizes_exclude', filters.container_sizes_exclude.join(','));
  if (filters.flags_exclude?.length)           params.set('flags_exclude',           filters.flags_exclude.join(','));
  if (filters.ssl_codes_exclude?.length)       params.set('ssl_codes_exclude',       filters.ssl_codes_exclude.join(','));
  if (filters.driver_ids_exclude?.length)      params.set('driver_ids_exclude',      filters.driver_ids_exclude.join(','));
  // Phase B2 locations
  if (filters.pickup_location_ids?.length)   params.set('pickup_location_ids',   filters.pickup_location_ids.join(','));
  if (filters.delivery_location_ids?.length) params.set('delivery_location_ids', filters.delivery_location_ids.join(','));
  if (filters.return_location_ids?.length)   params.set('return_location_ids',   filters.return_location_ids.join(','));
  // Phase B4 bill-to primary/additional
  if (filters.bill_to_primary_customer_ids?.length)    params.set('bill_to_primary_customer_ids',    filters.bill_to_primary_customer_ids.join(','));
  if (filters.bill_to_primary_customer_ids_exclude?.length) params.set('bill_to_primary_customer_ids_exclude', filters.bill_to_primary_customer_ids_exclude.join(','));
  if (filters.bill_to_additional_customer_ids?.length) params.set('bill_to_additional_customer_ids', filters.bill_to_additional_customer_ids.join(','));
  if (filters.bill_to_additional_customer_ids_exclude?.length) params.set('bill_to_additional_customer_ids_exclude', filters.bill_to_additional_customer_ids_exclude.join(','));
  // Factor + margin range (Load Margin Phase 1)
  if (filters.factor_company === 'yes' || filters.factor_company === 'no') {
    params.set('factor_company', filters.factor_company);
  }
  if (filters.margin_from && String(filters.margin_from).trim()) {
    params.set('margin_from', filters.margin_from);
  }
  if (filters.margin_to && String(filters.margin_to).trim()) {
    params.set('margin_to', filters.margin_to);
  }
}

export function sanitizeFilterSet(input) {
  if (!input || typeof input !== 'object') return {};
  const out = {};
  for (const key of KNOWN_KEYS) {
    const v = input[key];
    if (ARRAY_KEYS.includes(key)) {
      if (Array.isArray(v) && v.length > 0) {
        const cleaned = v.filter((s) => typeof s === 'string' && s.length > 0);
        if (cleaned.length > 0) out[key] = cleaned;
      }
    } else {
      if (typeof v === 'string' && v.length > 0) out[key] = v;
    }
  }
  return out;
}
