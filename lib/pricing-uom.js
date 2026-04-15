/**
 * Pricing UOM Helper
 *
 * Multiplies a per-unit rate by a measured quantity (currently time;
 * Plan C adds distance/weight). Rate is stored in cents per unit.
 *
 * The free_units concept lets tariffs say "first 2 hours free, then
 * $75/hr" — we subtract free_units from the measured quantity before
 * multiplying. When the remaining quantity is negative, the result is 0.
 */

const SECONDS_PER_UNIT = {
  per_hour:  3600,
  per_day:   86400,
  per_15min: 900,
  per_30min: 1800,
  per_45min: 2700,
};

/**
 * True if the UOM represents a rate that must be multiplied by elapsed time.
 * `fixed` and `percentage` are flat and return their stored amount directly.
 */
export function isTimeBased(uom) {
  return Object.prototype.hasOwnProperty.call(SECONDS_PER_UNIT, uom);
}

/**
 * Apply a time-based UOM to a rate and a measured duration.
 *
 * @param {number} amountCents — rate per unit (e.g. 7500 = $75/hr)
 * @param {number} durationSeconds — measured elapsed time
 * @param {string} uom — 'per_hour' | 'per_day' | 'per_15min' | 'per_30min' | 'per_45min'
 * @param {number} freeUnits — number of units to subtract before billing
 * @returns {number} — total cents to bill
 */
export function applyTimeUom(amountCents, durationSeconds, uom, freeUnits = 0) {
  if (!isTimeBased(uom)) return amountCents; // caller shouldn't hit this, but safe
  const secondsPerUnit = SECONDS_PER_UNIT[uom];
  const rawUnits = durationSeconds / secondsPerUnit;
  const billableUnits = Math.max(0, rawUnits - (freeUnits || 0));
  return Math.round(amountCents * billableUnits);
}

/**
 * Produce a human-readable duration label for diagnostics / debugging.
 * Used by the AP recalculate-driver-pay diagnostic to explain why a
 * detention charge resolved to a particular amount.
 */
export function formatDuration(durationSeconds) {
  if (!durationSeconds || durationSeconds < 0) return '0s';
  const h = Math.floor(durationSeconds / 3600);
  const m = Math.floor((durationSeconds % 3600) / 60);
  if (h > 0 && m > 0) return `${h}h ${m}m`;
  if (h > 0) return `${h}h`;
  return `${m}m`;
}
