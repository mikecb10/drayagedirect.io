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
  'customer_ids',
  'branch_ids',
  'load_types',
  'container_types',
  'container_sizes',
  'flags',
  'ssl_codes',
  'driver_ids',
];

const STRING_KEYS = [
  'from',
  'to',
  'reference_number',
];

const KNOWN_KEYS = [...ARRAY_KEYS, ...STRING_KEYS];

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
