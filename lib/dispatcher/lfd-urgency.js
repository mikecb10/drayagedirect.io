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
export function lfdPillClass(lfdDateString) {
  if (!lfdDateString) return null;

  const lfd = new Date(lfdDateString);
  if (Number.isNaN(lfd.getTime())) return null;

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
 * Format a YYYY-MM-DD or ISO datetime as MM/DD for the LFD pill.
 * Returns null on invalid input.
 */
export function fmtLfdShort(lfdDateString) {
  if (!lfdDateString) return null;
  const d = new Date(lfdDateString);
  if (Number.isNaN(d.getTime())) return null;
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${mm}/${dd}`;
}
