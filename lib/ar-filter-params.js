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
 * values (empty arrays, null / undefined / '' dates). Used when persisting
 * custom-tab filter payloads so the JSONB row stays compact.
 */
const KNOWN_KEYS = ['customer_ids', 'branch_ids', 'from', 'to'];

export function sanitizeFilterSet(input) {
  if (!input || typeof input !== 'object') return {};
  const out = {};
  for (const key of KNOWN_KEYS) {
    const v = input[key];
    if (key === 'customer_ids' || key === 'branch_ids') {
      if (Array.isArray(v) && v.length > 0) out[key] = v.filter((s) => typeof s === 'string' && s.length > 0);
    } else {
      // 'from' | 'to'
      if (typeof v === 'string' && v.length > 0) out[key] = v;
    }
  }
  return out;
}
