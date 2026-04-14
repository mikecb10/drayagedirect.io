/**
 * AR (Accounts Receivable) shared utilities.
 */

/**
 * Format cents to dollar string.
 * @param {number} cents
 * @returns {string} e.g. "$1,234.56"
 */
export function formatCents(cents) {
  if (cents == null) return '$0.00';
  return `$${(cents / 100).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/**
 * Get aging bucket label from due date.
 * @param {string|Date} dueDate
 * @returns {{ bucket: string, days: number }}
 */
export function getAgingBucket(dueDate) {
  if (!dueDate) return { bucket: 'current', days: 0 };
  const due = new Date(dueDate);
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  due.setHours(0, 0, 0, 0);
  const days = Math.floor((now - due) / (1000 * 60 * 60 * 24));

  if (days <= 0) return { bucket: 'current', days: 0 };
  if (days <= 30) return { bucket: '1-30', days };
  if (days <= 60) return { bucket: '31-60', days };
  if (days <= 90) return { bucket: '61-90', days };
  return { bucket: '90+', days };
}

/**
 * Compute invoice due date from invoice date + payment terms.
 * @param {string|Date} invoiceDate
 * @param {number} paymentTermsDays - default 30
 * @returns {string} ISO date string
 */
export function computeInvoiceDueDate(invoiceDate, paymentTermsDays = 30) {
  const d = new Date(invoiceDate || new Date());
  d.setDate(d.getDate() + (paymentTermsDays || 30));
  return d.toISOString().split('T')[0];
}

/**
 * Combination rule display labels.
 */
export const COMBINATION_RULE_OPTIONS = [
  { value: 'by_load', label: 'By Load (1 invoice per load)' },
  { value: 'manual', label: 'Manual (billing user selects)' },
  { value: 'by_day', label: 'By Day (group by completion date)' },
  { value: 'by_week', label: 'By Week (group by completion week)' },
  { value: 'by_reference', label: 'By Reference # (when all completed)' },
  { value: 'all_completed', label: 'All Completed Loads (batch)' },
];

/**
 * Get display label for a combination rule value.
 */
export function getCombinationRuleLabel(value) {
  return COMBINATION_RULE_OPTIONS.find((o) => o.value === value)?.label || value;
}
