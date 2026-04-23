import {
  requireTenantUser,
  requirePermission,
  getServiceClient,
} from '../../../../../lib/tenant-api';
import { logTenantAction, getClientIp } from '../../../../../lib/tenant-audit';
import { PERMISSIONS } from '../../../../../lib/permissions';

/**
 * /api/tenant/ar/invoices/[invoiceId]
 *
 * GET — single invoice with line items, charge sets, payments
 * PUT — update status (draft→sent→paid→void)
 */
export default async function handler(req, res) {
  const ctx = await requireTenantUser(req, res);
  if (!ctx) return;
  if (!requirePermission(ctx, [PERMISSIONS.ACCOUNTS_RECEIVABLE, PERMISSIONS.ALL], res)) return;

  const { invoiceId } = req.query;
  const svc = getServiceClient();

  if (req.method === 'GET') {
    const { data, error } = await svc
      .from('invoices')
      .select(`
        *,
        customer:customers!customer_id(id, name, billing_email),
        rebilled_by:users!rebilled_by_user_id(id, name, email),
        line_items:invoice_line_items(*),
        charge_sets:invoice_charge_sets(
          charge_set:order_charge_sets(id, charge_set_number, order_id, total_cents, status,
            order:orders(id, order_number)
          )
        ),
        payments:payment_applications(id, amount_cents, created_at,
          payment:payments_received(id, amount_cents, payment_method, payment_date, reference_number)
        ),
        credits:credit_memos!invoice_id(id, amount_cents, reason, status, applied_at)
      `)
      .eq('id', invoiceId)
      .eq('tenant_id', ctx.tenantId)
      .is('deleted_at', null)
      .single();

    if (error || !data) return res.status(404).json({ error: 'Invoice not found' });
    return res.status(200).json({ invoice: data });
  }

  if (req.method === 'PUT') {
    const { status, void_reason, mark_rebilled } = req.body || {};

    // Fetch existing
    const { data: existing } = await svc
      .from('invoices')
      .select('*')
      .eq('id', invoiceId)
      .eq('tenant_id', ctx.tenantId)
      .is('deleted_at', null)
      .single();

    if (!existing) return res.status(404).json({ error: 'Invoice not found' });

    const updates = {};

    // mark_rebilled is a non-status flag used by the Rebill flow to stamp
    // the pivot moment (who clicked Rebill, when) on the ORIGINAL invoice
    // BEFORE its charge sets transition to rebilling. The replacement
    // invoice gets linked back to this row later when it's created from
    // the rebilling charge sets (see POST handler's forward-link logic).
    if (mark_rebilled === true) {
      if (existing.rebilled_at) {
        return res.status(409).json({ error: 'Invoice already marked as rebilled' });
      }
      // Lock check: reject rebill if any applied credit memo or payment
      // application targets this invoice. The accountant must reverse
      // the payment/credit before the invoice can be re-opened.
      const [creditsRes, paymentsRes] = await Promise.all([
        svc.from('credit_memos')
          .select('id')
          .eq('tenant_id', ctx.tenantId)
          .eq('applied_to_invoice_id', invoiceId)
          .eq('status', 'applied')
          .limit(1),
        svc.from('payment_applications')
          .select('id')
          .eq('tenant_id', ctx.tenantId)
          .eq('invoice_id', invoiceId)
          .limit(1),
      ]);
      if ((creditsRes.data?.length || 0) > 0 || (paymentsRes.data?.length || 0) > 0) {
        return res.status(409).json({
          error: 'Cannot rebill — this invoice has an applied payment or credit memo. Reverse it first.',
          code: 'INVOICE_LOCKED',
        });
      }
      updates.rebilled_at = new Date().toISOString();
      updates.rebilled_by_user_id = ctx.userId;
      const { data, error } = await svc
        .from('invoices')
        .update(updates)
        .eq('id', invoiceId)
        .eq('tenant_id', ctx.tenantId)
        .select()
        .single();
      if (error) return res.status(500).json({ error: error.message });
      await logTenantAction(svc, {
        tenantId: ctx.tenantId,
        userId: ctx.userId,
        action: 'invoice.rebilled',
        entityType: 'invoice',
        entityId: invoiceId,
        newValues: updates,
        ipAddress: getClientIp(req),
      });
      return res.status(200).json({ invoice: data });
    }

    if (status === 'sent') {
      updates.status = 'sent';
      updates.sent_at = new Date().toISOString();
    } else if (status === 'paid') {
      if (existing.balance_due_cents > 0) {
        return res.status(400).json({ error: 'Cannot mark as paid — balance is not zero' });
      }
      updates.status = 'paid';
      updates.paid_at = new Date().toISOString();
    } else if (status === 'void') {
      updates.status = 'void';
      updates.void_reason = void_reason || null;
      // Restore charge sets to approved
      const { data: junctions } = await svc
        .from('invoice_charge_sets')
        .select('charge_set_id')
        .eq('invoice_id', invoiceId)
        .eq('tenant_id', ctx.tenantId);
      if (junctions?.length) {
        await svc
          .from('order_charge_sets')
          .update({ status: 'approved', invoice_id: null })
          .eq('tenant_id', ctx.tenantId)
          .in('id', junctions.map((j) => j.charge_set_id));
      }
    } else if (status === 'overdue') {
      updates.status = 'overdue';
    } else {
      return res.status(400).json({ error: `Invalid status transition: ${status}` });
    }

    const { data, error } = await svc
      .from('invoices')
      .update(updates)
      .eq('id', invoiceId)
      .eq('tenant_id', ctx.tenantId)
      .select()
      .single();

    if (error) return res.status(500).json({ error: error.message });

    await logTenantAction(svc, {
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      action: `invoice.${status}`,
      entityType: 'invoice',
      entityId: invoiceId,
      oldValues: { status: existing.status },
      newValues: { status },
      ipAddress: getClientIp(req),
    });

    return res.status(200).json({ invoice: data });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
