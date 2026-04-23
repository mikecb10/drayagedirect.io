import {
  requireTenantUser,
  requirePermission,
  getServiceClient,
} from '../../../../../lib/tenant-api';
import { PERMISSIONS } from '../../../../../lib/permissions';

export const config = { runtime: 'nodejs' };

/**
 * GET /api/tenant/loads/[id]/payments
 *
 * Returns every payment applied to this load, walking the indirect chain:
 *
 *   orders.id (= load id)
 *     → order_charge_sets.order_id
 *     → invoice_charge_sets.charge_set_id
 *     → invoice_charge_sets.invoice_id
 *     → payment_applications.invoice_id
 *     → payments_received.id
 *
 * Shape:
 *   {
 *     load_id: UUID,
 *     applications: [
 *       {
 *         application_id: UUID,
 *         invoice_id: UUID,
 *         invoice_number: string,
 *         amount_cents: integer,    // amount of THIS application to THIS invoice
 *         applied_at: ISO,
 *         payment: {
 *           id: UUID,
 *           amount_cents: integer,  // full payment total
 *           unapplied_cents: integer,
 *           payment_method: string,
 *           payment_date: ISO,
 *           reference_number: string | null,
 *           document_url: string | null,
 *           document_filename: string | null,
 *           customer: { id, name } | null
 *         }
 *       },
 *       ...
 *     ],
 *     total_applied_cents: integer
 *   }
 *
 * Empty array is a valid response — load with no payments applied yet.
 */
export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const ctx = await requireTenantUser(req, res);
  if (!ctx) return;
  if (!requirePermission(ctx, [PERMISSIONS.ACCOUNTS_RECEIVABLE, PERMISSIONS.ALL, PERMISSIONS.DISPATCHING], res)) return;

  const { id } = req.query;
  const svc = getServiceClient();

  // Step 1: confirm load belongs to tenant. Guards against cross-tenant
  // ID guessing. Uses the soft-delete guard via live_orders view is not
  // needed — we only care the row exists and is ours.
  const { data: order, error: orderErr } = await svc
    .from('orders')
    .select('id')
    .eq('id', id)
    .eq('tenant_id', ctx.tenantId)
    .maybeSingle();
  if (orderErr) return res.status(500).json({ error: orderErr.message });
  if (!order) return res.status(404).json({ error: 'Load not found' });

  // Step 2: charge set IDs tied to this load. One-shot query; the FK
  // relationship means these are always same-tenant already, but filter
  // by tenant_id too for defense-in-depth.
  const { data: chargeSets, error: csErr } = await svc
    .from('order_charge_sets')
    .select('id')
    .eq('tenant_id', ctx.tenantId)
    .eq('order_id', id);
  if (csErr) return res.status(500).json({ error: csErr.message });
  const chargeSetIds = (chargeSets || []).map((c) => c.id);
  if (chargeSetIds.length === 0) {
    return res.status(200).json({ load_id: id, applications: [], total_applied_cents: 0 });
  }

  // Step 3: invoice IDs these charge sets feed into.
  const { data: icsRows, error: icsErr } = await svc
    .from('invoice_charge_sets')
    .select('invoice_id')
    .eq('tenant_id', ctx.tenantId)
    .in('charge_set_id', chargeSetIds);
  if (icsErr) return res.status(500).json({ error: icsErr.message });
  const invoiceIds = Array.from(new Set((icsRows || []).map((r) => r.invoice_id)));
  if (invoiceIds.length === 0) {
    return res.status(200).json({ load_id: id, applications: [], total_applied_cents: 0 });
  }

  // Step 4 — split-billing share calculation.
  //
  // An invoice can span multiple loads (one customer, one invoice,
  // charge sets from several loads — e.g. drayage + storage). When a
  // payment applies to that invoice, each constituent load should see
  // only its proportional share, not the full amount. Otherwise both
  // loads display the same $X and the totals get double-counted.
  //
  // Share = (this load's charge set dollars on invoice N) ÷ (total
  //          charge set dollars on invoice N).
  //
  // To compute: fetch EVERY charge set linked to any invoice in our
  // set (not just this load's), along with its order_id + total_cents.
  // Then per-invoice, sum the totals with a filter on order_id === load.
  const { data: allCsLinks, error: linksErr } = await svc
    .from('invoice_charge_sets')
    .select('invoice_id, charge_set:order_charge_sets!charge_set_id(id, order_id, total_cents)')
    .eq('tenant_id', ctx.tenantId)
    .in('invoice_id', invoiceIds);
  if (linksErr) return res.status(500).json({ error: linksErr.message });

  const shareByInvoice = new Map(); // invoice_id → { load, total, share }
  for (const link of (allCsLinks || [])) {
    const cs = link.charge_set;
    if (!cs) continue;
    const cents = cs.total_cents || 0;
    const entry = shareByInvoice.get(link.invoice_id) || { load: 0, total: 0 };
    entry.total += cents;
    if (cs.order_id === id) entry.load += cents;
    shareByInvoice.set(link.invoice_id, entry);
  }
  for (const [invId, entry] of shareByInvoice) {
    // total can be 0 if all charge sets on an invoice have total_cents = 0
    // (shouldn't happen in practice but guard to avoid NaN). Fall back to
    // the simple case — this load owns 100% — which preserves the prior
    // non-split behavior for those edge-case invoices.
    entry.share = entry.total > 0 ? entry.load / entry.total : 1;
    shareByInvoice.set(invId, entry);
  }

  // Step 5: payment applications against those invoices, joined with the
  // payment details (including optional document_url + filename) and
  // invoice number for display.
  const { data: apps, error: appErr } = await svc
    .from('payment_applications')
    .select(`
      id, invoice_id, amount_cents, created_at,
      invoice:invoices!invoice_id(id, invoice_number),
      payment:payments_received!payment_id(
        id, amount_cents, unapplied_cents, payment_method, payment_date,
        reference_number, document_url, document_filename,
        customer:customers!customer_id(id, name)
      )
    `)
    .eq('tenant_id', ctx.tenantId)
    .in('invoice_id', invoiceIds)
    .order('created_at', { ascending: false });
  if (appErr) return res.status(500).json({ error: appErr.message });

  // Apply share to each application. Round to nearest cent; over a payment's
  // applications the rounded sum may differ from the unrounded total by
  // a cent or two, which matches the general-ledger convention of per-
  // line rounding over totals.
  const applications = (apps || []).map((a) => {
    const share = shareByInvoice.get(a.invoice_id)?.share ?? 1;
    const fullAmount = a.amount_cents || 0;
    const loadShareAmount = Math.round(fullAmount * share);
    return {
      application_id: a.id,
      invoice_id: a.invoice_id,
      invoice_number: a.invoice?.invoice_number ?? null,
      amount_cents: loadShareAmount,                  // proportional to this load
      full_application_cents: fullAmount,             // full amount applied to the invoice
      share,                                          // 0..1, this load's share of the invoice
      applied_at: a.created_at,
      payment: a.payment ?? null,
    };
  });
  const total_applied_cents = applications.reduce((s, a) => s + (a.amount_cents || 0), 0);

  return res.status(200).json({
    load_id: id,
    applications,
    total_applied_cents,
  });
}
