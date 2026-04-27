/**
 * Format a date or timestamp for printed PDFs. Mirrors the legacy
 * formatDate() that lived inside the hardcoded InvoiceTemplate.js and
 * RateConTemplate.js. Returns null for null/undefined/invalid input
 * so section components can short-circuit via their existing empty-skip
 * logic (they treat null/undefined/'' as missing).
 *
 * Output: "Apr 26, 2026" style — en-US, abbreviated month, no time
 * component. Sufficient for invoice / rate con / DO date display.
 *
 * @param {string|Date|null|undefined} input
 * @returns {string|null}
 */
export function formatDate(input) {
  if (!input) return null;
  const d = new Date(input);
  if (isNaN(d.getTime())) return null;
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

/**
 * Format a date or timestamp's TIME component for printed PDFs.
 * Sibling to formatDate(); paired with it for fields like POD's
 * delivery_date + delivery_time, where tenants can toggle either or
 * both. Returns null for null/undefined/invalid input.
 *
 * Output: "2:30 PM" style — en-US, 12-hour, no seconds.
 *
 * @param {string|Date|null|undefined} input
 * @returns {string|null}
 */
export function formatTime(input) {
  if (!input) return null;
  const d = new Date(input);
  if (isNaN(d.getTime())) return null;
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
}
