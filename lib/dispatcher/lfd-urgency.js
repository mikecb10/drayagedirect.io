/**
 * LFD pill urgency classes. Used by MoveCardCompact to color the
 * "LFD MM/DD" pill based on how close the deadline is.
 *
 * Tiers:
 *   - past:    LFD < today          → red
 *   - urgent:  LFD <= today + 1 day → amber
 *   - normal:  else                 → neutral slate
 *   - missing: null/undefined LFD   → null (caller should hide pill)
 *
 * Returns a Tailwind className string ready to drop on a span.
 */

/**
 * Parse an LFD value (date-only "YYYY-MM-DD" or ISO datetime) into a Date
 * representing local midnight on that calendar date. Avoids the
 * `new Date('2026-04-25')` UTC-midnight pitfall that shifts the date back
 * by one in any non-UTC timezone.
 *
 * Returns null on invalid input.
 */
function parseLfdLocal(lfdDateString) {
  if (!lfdDateString) return null;
  const datePart = String(lfdDateString).split('T')[0];
  const [y, m, d] = datePart.split('-').map(Number);
  if (!y || !m || !d) return null;
  const out = new Date(y, m - 1, d);
  if (Number.isNaN(out.getTime())) return null;
  return out;
}

export function lfdPillClass(lfdDateString) {
  const lfd = parseLfdLocal(lfdDateString);
  if (!lfd) return null;

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  if (lfd < today) {
    return 'bg-red-900/40 text-red-200 dark:bg-red-900/40 dark:text-red-200';
  }
  if (lfd <= tomorrow) {
    return 'bg-amber-900/40 text-amber-200 dark:bg-amber-900/40 dark:text-amber-200';
  }
  return 'bg-slate-800 text-slate-300 dark:bg-slate-800 dark:text-slate-300';
}

/**
 * Format an LFD value (date-only "YYYY-MM-DD" or ISO datetime) as MM/DD
 * for the LFD pill. Uses local-date components to avoid the UTC-shift
 * pitfall described in parseLfdLocal.
 *
 * Returns null on invalid input.
 */
export function fmtLfdShort(lfdDateString) {
  const d = parseLfdLocal(lfdDateString);
  if (!d) return null;
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${mm}/${dd}`;
}
