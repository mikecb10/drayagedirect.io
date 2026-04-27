/**
 * Compute aging-bucket totals for a Statement of Account.
 *
 * @param {Array<{due_date: string|Date, balance_due_cents: number}>} invoices
 * @param {Date} asOfDate - the reference date for "today"
 * @returns {{current: number, days_1_30: number, days_31_60: number, days_61_90: number, days_90_plus: number}}
 *
 * Bucket definitions (must agree with lib/ar-utils.js's getAgingBucket):
 *   current:      daysPastDue <= 0       (due today or in the future)
 *   days_1_30:    1 <= daysPastDue <= 30
 *   days_31_60:   31 <= daysPastDue <= 60
 *   days_61_90:   61 <= daysPastDue <= 90
 *   days_90_plus: daysPastDue > 90
 *
 * Returned amounts are in CENTS (matches invoice.balance_due_cents).
 *
 * Implementation note: getAgingBucket() in lib/ar-utils.js normalizes both
 * the dueDate and "now" to local midnight (setHours(0,0,0,0)) before
 * computing day diff. We mirror that exactly so per-invoice classification
 * is identical between the two helpers.
 *
 * NOTE: This duplicates per-invoice classification logic from lib/ar-utils.js.
 * tests/statement-compute-aging.test.mjs has a parity test that asserts both
 * helpers agree. Cleanup-FU FU-035-H5-followup-E will factor into a single
 * shared helper.
 */
export function computeAging(invoices, asOfDate) {
  const buckets = {
    current: 0,
    days_1_30: 0,
    days_31_60: 0,
    days_61_90: 0,
    days_90_plus: 0,
  };

  const MS_PER_DAY = 1000 * 60 * 60 * 24;

  // Normalize asOf to local midnight to match getAgingBucket().
  const asOfMidnight = new Date(asOfDate);
  asOfMidnight.setHours(0, 0, 0, 0);
  const asOfTs = asOfMidnight.getTime();

  for (const inv of invoices || []) {
    if (!inv.due_date) {
      // Match getAgingBucket null/undefined behavior → current bucket.
      buckets.current += inv.balance_due_cents || 0;
      continue;
    }

    const due = new Date(inv.due_date);
    due.setHours(0, 0, 0, 0);
    const daysPastDue = Math.floor((asOfTs - due.getTime()) / MS_PER_DAY);
    const cents = inv.balance_due_cents || 0;

    if (daysPastDue <= 0)        buckets.current      += cents;
    else if (daysPastDue <= 30)  buckets.days_1_30    += cents;
    else if (daysPastDue <= 60)  buckets.days_31_60   += cents;
    else if (daysPastDue <= 90)  buckets.days_61_90   += cents;
    else                         buckets.days_90_plus += cents;
  }

  return buckets;
}
