import {
  requireTenantUser,
  requirePermission,
  getServiceClient,
} from '../../../../../../lib/tenant-api';
import { logTenantAction, getClientIp } from '../../../../../../lib/tenant-audit';
import { PERMISSIONS } from '../../../../../../lib/permissions';
import { assignInvoiceNumberBase } from '../../../../../../lib/invoice-utils';

const VALID_STATUSES = [
  'draft',
  'rate_con_sent',
  'unapproved',
  'approved',
  'invoiced',
  'billed',
  'rebilling',
  'void',
];

async function recomputeTotals(svc, tenantId, csId) {
  const { data: items } = await svc
    .from('order_charge_set_line_items')
    .select('total_cents')
    .eq('tenant_id', tenantId)
    .eq('charge_set_id', csId);
  const subtotal = (items || []).reduce((sum, li) => sum + (li.total_cents || 0), 0);
  await svc
    .from('order_charge_sets')
    .update({ subtotal_cents: subtotal, total_cents: subtotal })
    .eq('tenant_id', tenantId)
    .eq('id', csId);
  return subtotal;
}

export default async function handler(req, res) {
  const ctx = await requireTenantUser(req, res);
  if (!ctx) return;

  const { id, csId } = req.query;
  const svc = getServiceClient();

  if (req.method === 'PUT') {
    if (
      !requirePermission(
        ctx,
        [PERMISSIONS.ORDER_ENTRY, PERMISSIONS.ACCOUNTS_RECEIVABLE, PERMISSIONS.ALL],
        res
      )
    )
      return;

    const updates = {};
    if (req.body.bill_to_customer_id !== undefined)
      updates.bill_to_customer_id = req.body.bill_to_customer_id;
    if (req.body.notes !== undefined) updates.notes = req.body.notes;
    if (req.body.status !== undefined) {
      if (!VALID_STATUSES.includes(req.body.status)) {
        return res.status(400).json({ error: 'Invalid status' });
      }
      updates.status = req.body.status;
    }

    // If we're transitioning to 'invoiced', handle invoice number assignment.
    // Fetch current row so we know the previous status + existing invoice fields.
    let invoiceNumberAssigned = false;
    if (updates.status === 'invoiced') {
      const { data: current, error: currentErr } = await svc
        .from('order_charge_sets')
        .select('status, invoice_number_base, rebill_count')
        .eq('tenant_id', ctx.tenantId)
        .eq('id', csId)
        .single();

      if (currentErr) {
        return res.status(500).json({ error: currentErr.message });
      }

      try {
        if (!current?.invoice_number_base) {
          // First time being invoiced — assign a new base number
          const base = await assignInvoiceNumberBase(svc, ctx.tenantId);
          updates.invoice_number_base = base;
          updates.invoiced_at = new Date().toISOString();
          updates.rebill_count = 0;
          invoiceNumberAssigned = true;
        } else if (current.status === 'rebilling') {
          // Returning from rebilling — bump the rebill counter, keep the base
          updates.rebill_count = (current.rebill_count || 0) + 1;
          updates.last_rebilled_at = new Date().toISOString();
        }
        // else: was invoiced → voided → invoiced again; keep existing base
      } catch (err) {
        return res.status(400).json({ error: err.message });
      }
    }

    const { data, error } = await svc
      .from('order_charge_sets')
      .update(updates)
      .eq('tenant_id', ctx.tenantId)
      .eq('order_id', id)
      .eq('id', csId)
      .select()
      .single();

    if (error) return res.status(500).json({ error: error.message });

    await logTenantAction(svc, {
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      action: invoiceNumberAssigned
        ? 'billing.invoice_number_assigned'
        : 'load.charge_set_update',
      entityType: 'order',
      entityId: id,
      newValues: updates,
      ipAddress: getClientIp(req),
    });

    return res.status(200).json({ charge_set: data });
  }

  if (req.method === 'DELETE') {
    if (!requirePermission(ctx, [PERMISSIONS.ALL], res)) return;

    const { error } = await svc
      .from('order_charge_sets')
      .delete()
      .eq('tenant_id', ctx.tenantId)
      .eq('order_id', id)
      .eq('id', csId);

    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ success: true });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}

export { recomputeTotals };
