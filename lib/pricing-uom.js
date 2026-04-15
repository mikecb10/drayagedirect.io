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

// Pound-based UOMs — one unit per pound. If future plans add per_ton
// or per_kg, multiply through here (e.g. per_ton = 2000 lb per unit).
const POUNDS_PER_UNIT = {
  per_pounds: 1,
};

// Mile-based UOMs. per_road_toll_miles would go here once we have
// a toll-aware routing source (deferred to Plan D).
const MILES_PER_UNIT = {
  per_miles: 1,
};

/**
 * True if the UOM represents a rate that must be multiplied by elapsed time.
 * `fixed` and `percentage` are flat and return their stored amount directly.
 */
export function isTimeBased(uom) {
  return Object.prototype.hasOwnProperty.call(SECONDS_PER_UNIT, uom);
}

/**
 * True if the UOM represents a rate that must be multiplied by load weight.
 */
export function isWeightBased(uom) {
  return Object.prototype.hasOwnProperty.call(POUNDS_PER_UNIT, uom);
}

/**
 * True if the UOM represents a rate that must be multiplied by load miles.
 * Excludes radius_rate — that one uses tiered pricing, not a flat multiplier.
 */
export function isDistanceBased(uom) {
  return Object.prototype.hasOwnProperty.call(MILES_PER_UNIT, uom);
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
 * Apply a weight-based UOM. Rate is cents per unit (default: per pound).
 *
 * @param {number} amountCents — rate per unit (e.g. 250 = $2.50/lb)
 * @param {number} pounds — load weight in pounds
 * @param {string} uom — 'per_pounds' (extensible)
 * @param {number} freeUnits — free pounds (e.g. first 100 lbs free)
 * @returns {number} — total cents to bill; 0 if pounds is missing
 */
export function applyWeightUom(amountCents, pounds, uom, freeUnits = 0) {
  if (!isWeightBased(uom)) return amountCents;
  if (pounds == null || pounds <= 0) return 0; // fail-closed on missing weight
  const lbPerUnit = POUNDS_PER_UNIT[uom];
  const rawUnits = pounds / lbPerUnit;
  const billableUnits = Math.max(0, rawUnits - (freeUnits || 0));
  return Math.round(amountCents * billableUnits);
}

/**
 * Apply a distance-based UOM. Rate is cents per unit (default: per mile).
 *
 * @param {number} amountCents — rate per unit (e.g. 275 = $2.75/mi)
 * @param {number} miles — load distance in miles (from orders.actual_miles)
 * @param {string} uom — 'per_miles' (extensible)
 * @param {number} freeUnits — free miles (e.g. first 25 mi free)
 * @returns {number} — total cents to bill; 0 if miles is missing
 */
export function applyDistanceUom(amountCents, miles, uom, freeUnits = 0) {
  if (!isDistanceBased(uom)) return amountCents;
  if (miles == null || miles <= 0) return 0; // fail-closed on missing miles
  const miPerUnit = MILES_PER_UNIT[uom];
  const rawUnits = miles / miPerUnit;
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

/**
 * Human-readable pounds label for diagnostics.
 * e.g. formatPounds(43500) → "43,500 lb"
 */
export function formatPounds(pounds) {
  if (pounds == null || pounds <= 0) return '0 lb';
  return `${Math.round(pounds).toLocaleString()} lb`;
}

/**
 * Human-readable distance label for diagnostics.
 * e.g. formatMiles(124.73) → "124.73 mi"
 */
export function formatMiles(miles) {
  if (miles == null || miles <= 0) return '0 mi';
  return `${Number(miles).toFixed(2)} mi`;
}
