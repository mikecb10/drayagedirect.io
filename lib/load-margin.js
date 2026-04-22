/**
 * Pure functions for load-level margin %.
 *
 * See docs/superpowers/specs/2026-04-24-load-margin-percent-design.md
 * for design rationale.
 */

/**
 * Compute load-level margin from pre-fetched revenue + cost sums.
 *
 * @param {object}  args
 * @param {number}  args.revenueCents    SUM of order_charge_sets.total_cents (or line items when excluding dry runs)
 * @param {number}  args.costCents       SUM of order_driver_pay_lines.amount_cents
 * @param {number}  args.redThreshold    tenant.margin_red_threshold as a whole-number percent (e.g. 15)
 * @param {number}  args.yellowThreshold tenant.margin_yellow_threshold as a whole-number percent (e.g. 30)
 * @returns {{
 *   revenueCents: number,
 *   costCents: number,
 *   marginCents: number,
 *   marginPct: number|null,
 *   bucket: 'red'|'yellow'|'green'|'neutral',
 * }}
 */
export function computeLoadMargin({ revenueCents, costCents, redThreshold, yellowThreshold }) {
  const r = Number.isFinite(revenueCents) ? revenueCents : 0;
  const c = Number.isFinite(costCents)    ? costCents    : 0;
  const marginCents = r - c;

  // Neutral: insufficient data on either side of the equation.
  if (r <= 0 || c <= 0) {
    return { revenueCents: r, costCents: c, marginCents, marginPct: null, bucket: 'neutral' };
  }

  const marginPct = (marginCents / r) * 100;

  let bucket;
  if (marginPct <= redThreshold)         bucket = 'red';
  else if (marginPct <= yellowThreshold) bucket = 'yellow';
  else                                    bucket = 'green';

  return { revenueCents: r, costCents: c, marginCents, marginPct, bucket };
}
