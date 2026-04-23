import {
  requireTenantUser,
  requirePermission,
  getServiceClient,
} from '../../../../../../lib/tenant-api';
import { logTenantAction, getClientIp } from '../../../../../../lib/tenant-audit';
import { PERMISSIONS } from '../../../../../../lib/permissions';
import { generateChargeSetNumber } from '../../../../../../lib/charge-set-utils';

export default async function handler(req, res) {
  const ctx = await requireTenantUser(req, res);
  if (!ctx) return;

  const { id } = req.query;
  const svc = getServiceClient();

  if (req.method === 'GET') {
    if (
      !requirePermission(
        ctx,
        [
          PERMISSIONS.DISPATCHING,
          PERMISSIONS.ORDER_ENTRY,
          PERMISSIONS.ACCOUNTS_RECEIVABLE,
          PERMISSIONS.ALL,
        ],
        res
      )
    )
      return;

    const { data, error } = await svc
      .from('order_charge_sets')
      .select(
        `*,
         bill_to:customers!order_charge_sets_bill_to_customer_id_fkey(id, name),
         line_items:order_charge_set_line_items(*),
         invoice:invoices!invoice_id(
           id,
           invoice_number,
           status,
           applied_credits:credit_memos!applied_to_invoice_id(id, status, amount_cents),
           payment_applications:payment_applications(id, amount_cents)
         )`
      )
      .eq('tenant_id', ctx.tenantId)
      .eq('order_id', id)
      .order('created_at', { ascending: true });

    if (error) return res.status(500).json({ error: error.message });

    // Derive a single `invoice_locked` flag per charge set for the UI to
    // key off. An invoice is locked (non-editable, non-rebillable) when
    // it has any applied credit memos or any payment applications —
    // touching a charge set under a settled invoice would put the AR
    // books and GL out of sync. The flag is nullable — charge sets
    // without an invoice have invoice = null, invoice_locked = false.
    const withLock = (data || []).map((cs) => {
      const inv = cs.invoice;
      const hasAppliedCredit = (inv?.applied_credits || []).some(
        (c) => c.status === 'applied'
      );
      const hasPaymentApplied = (inv?.payment_applications || []).length > 0;
      return {
        ...cs,
        invoice_locked: Boolean(inv) && (hasAppliedCredit || hasPaymentApplied),
        invoice_lock_reason: hasAppliedCredit && hasPaymentApplied
          ? 'payment_and_credit_applied'
          : hasAppliedCredit
          ? 'credit_applied'
          : hasPaymentApplied
          ? 'payment_applied'
          : null,
      };
    });

    return res.status(200).json({ charge_sets: withLock });
  }

  if (req.method === 'POST') {
    if (
      !requirePermission(
        ctx,
        [PERMISSIONS.ORDER_ENTRY, PERMISSIONS.ACCOUNTS_RECEIVABLE, PERMISSIONS.ALL],
        res
      )
    )
      return;

    const { bill_to_customer_id, notes } = req.body || {};
    const chargeSetNumber = await generateChargeSetNumber(svc, ctx.tenantId, id);

    const { data, error } = await svc
      .from('order_charge_sets')
      .insert({
        tenant_id: ctx.tenantId,
        order_id: id,
        charge_set_number: chargeSetNumber,
        bill_to_customer_id: bill_to_customer_id || null,
        status: 'draft',
        notes: notes || null,
      })
      .select()
      .single();

    if (error) return res.status(500).json({ error: error.message });

    await logTenantAction(svc, {
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      action: 'load.charge_set_create',
      entityType: 'order',
      entityId: id,
      newValues: { charge_set_number: chargeSetNumber },
      ipAddress: getClientIp(req),
    });

    return res.status(201).json({ charge_set: data });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
