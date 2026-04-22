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

/**
 * Batch-load revenue and cost sums for a set of orders.
 *
 * Runs two queries (one per side — revenue via order_charge_set_line_items,
 * cost via order_driver_pay_lines). Returns a Map keyed by order_id.
 *
 * When includeDryRuns is false, both queries add a
 *   .is('dry_run_attempt_id', null)
 * filter. Revenue is always computed from line_items (not
 * order_charge_sets.total_cents) so the dry-run filter applies uniformly.
 *
 * @param {object}  svc                 Supabase service-role client
 * @param {object}  args
 * @param {string}  args.tenantId
 * @param {string[]} args.orderIds     Scoped set of order UUIDs
 * @param {boolean} args.includeDryRuns
 * @returns {Promise<Map<string, { revenueCents: number, costCents: number }>>}
 */
export async function fetchLoadMarginInputs(svc, { tenantId, orderIds, includeDryRuns }) {
  const out = new Map();
  if (!orderIds || orderIds.length === 0) return out;
  for (const id of orderIds) out.set(id, { revenueCents: 0, costCents: 0 });

  // ── Revenue: line items → charge_set → order_id
  // First, get the charge_set → order_id mapping.
  const { data: chargeSets, error: csErr } = await svc
    .from('order_charge_sets')
    .select('id, order_id')
    .eq('tenant_id', tenantId)
    .in('order_id', orderIds);
  if (csErr) throw csErr;

  const csToOrder = new Map();
  for (const cs of chargeSets ?? []) csToOrder.set(cs.id, cs.order_id);
  const csIds = [...csToOrder.keys()];

  // Now sum line items, filtered by dry-run inclusion.
  if (csIds.length > 0) {
    let liQ = svc
      .from('order_charge_set_line_items')
      .select('charge_set_id, total_cents, dry_run_attempt_id')
      .eq('tenant_id', tenantId)
      .in('charge_set_id', csIds);
    if (!includeDryRuns) liQ = liQ.is('dry_run_attempt_id', null);
    const { data: lineItems, error: liErr } = await liQ;
    if (liErr) throw liErr;
    for (const li of lineItems ?? []) {
      const orderId = csToOrder.get(li.charge_set_id);
      if (!orderId) continue;
      const row = out.get(orderId);
      if (row) row.revenueCents += li.total_cents ?? 0;
    }
  }

  // ── Cost: driver pay lines, grouped by order_id directly
  let plQ = svc
    .from('order_driver_pay_lines')
    .select('order_id, amount_cents, dry_run_attempt_id')
    .eq('tenant_id', tenantId)
    .in('order_id', orderIds);
  if (!includeDryRuns) plQ = plQ.is('dry_run_attempt_id', null);
  const { data: payLines, error: plErr } = await plQ;
  if (plErr) throw plErr;
  for (const pl of payLines ?? []) {
    const row = out.get(pl.order_id);
    if (row) row.costCents += pl.amount_cents ?? 0;
  }

  return out;
}
