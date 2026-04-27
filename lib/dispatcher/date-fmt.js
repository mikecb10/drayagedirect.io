/**
 * Date formatting helpers for the dispatcher / planner UI.
 *
 * Both functions are null-safe: invalid / missing inputs return null so
 * callers can short-circuit rendering with a falsy guard.
 *
 * Exists to deduplicate three previously-identical copies that lived in
 * MoveCardCompact.jsx, MoveCardExpanded.jsx, and MoveCell.jsx.
 */

/**
 * Format an ISO datetime as "MM/DD HH:mm" using the runtime's local time.
 *
 * @param {string|null|undefined} iso  — ISO 8601 datetime, or null/undefined
 * @returns {string|null}
 */
export function fmtAptShort(iso) {
  if (!iso) return null;
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return null;
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    const hh = String(d.getHours()).padStart(2, '0');
    const mi = String(d.getMinutes()).padStart(2, '0');
    return `${mm}/${dd} ${hh}:${mi}`;
  } catch {
    return null;
  }
}

/**
 * Alias of fmtAptShort kept for backwards-compat with `fmtApt` callers in
 * MoveCell.jsx. Same behavior.
 */
export const fmtApt = fmtAptShort;
