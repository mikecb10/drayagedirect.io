/**
 * Normalize POST/PUT body values that may arrive as strings.
 *
 * Used by API endpoints that need flexible boolean/integer coercion
 * (e.g., admin forms send "true"/"false" as strings).
 */

export function coerceBool(v, fallback) {
  if (v === undefined || v === null) return fallback;
  if (typeof v === 'boolean') return v;
  if (typeof v === 'string') {
    const lower = v.toLowerCase().trim();
    if (lower === 'true') return true;
    if (lower === 'false') return false;
  }
  return Boolean(v);
}

export function coerceInt(v, fallback) {
  if (v === undefined || v === null) return fallback;
  if (typeof v === 'number' && Number.isInteger(v)) return v;
  const parsed = parseInt(v, 10);
  return Number.isInteger(parsed) ? parsed : fallback;
}
