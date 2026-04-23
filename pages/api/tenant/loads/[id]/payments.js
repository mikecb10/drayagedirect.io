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

  // Step 4: all payment applications against those invoices, joined with
  // the payment details (including optional document_url + filename) and
  // the invoice number for display.
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

  const applications = (apps || []).map((a) => ({
    application_id: a.id,
    invoice_id: a.invoice_id,
    invoice_number: a.invoice?.invoice_number ?? null,
    amount_cents: a.amount_cents,
    applied_at: a.created_at,
    payment: a.payment ?? null,
  }));
  const total_applied_cents = applications.reduce((s, a) => s + (a.amount_cents || 0), 0);

  return res.status(200).json({
    load_id: id,
    applications,
    total_applied_cents,
  });
}
