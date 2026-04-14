import {
  requireTenantUser,
  requirePermission,
  getServiceClient,
} from '../../../../../lib/tenant-api';
import { logTenantAction, getClientIp } from '../../../../../lib/tenant-audit';
import { PERMISSIONS } from '../../../../../lib/permissions';

/**
 * /api/tenant/ar/credit-memos/[memoId]
 *
 * PUT — apply to invoice or void
 */
export default async function handler(req, res) {
  if (req.method !== 'PUT') return res.status(405).json({ error: 'Method not allowed' });

  const ctx = await requireTenantUser(req, res);
  if (!ctx) return;
  if (!requirePermission(ctx, [PERMISSIONS.ACCOUNTS_RECEIVABLE, PERMISSIONS.ALL], res)) return;

  const { memoId } = req.query;
  const svc = getServiceClient();

  const { data: memo } = await svc
    .from('credit_memos')
    .select('*')
    .eq('id', memoId)
    .eq('tenant_id', ctx.tenantId)
    .is('deleted_at', null)
    .single();

  if (!memo) return res.status(404).json({ error: 'Credit memo not found' });

  const { action, invoice_id } = req.body || {};

  if (action === 'apply') {
    if (memo.status !== 'draft') {
      return res.status(400).json({ error: 'Can only apply draft credit memos' });
    }
    if (!invoice_id) return res.status(400).json({ error: 'Invoice ID required' });

    // Reduce invoice balance
    const { data: invoice } = await svc
      .from('invoices')
      .select('id, balance_due_cents, status')
      .eq('id', invoice_id)
      .eq('tenant_id', ctx.tenantId)
      .single();

    if (!invoice) return res.status(404).json({ error: 'Invoice not found' });

    const newBalance = Math.max(0, invoice.balance_due_cents - memo.amount_cents);
    const invoiceUpdates = { balance_due_cents: newBalance };
    if (newBalance <= 0) {
      invoiceUpdates.status = 'paid';
      invoiceUpdates.paid_at = new Date().toISOString();
    }

    await svc.from('invoices').update(invoiceUpdates).eq('id', invoice_id).eq('tenant_id', ctx.tenantId);

    // Update memo
    const { data, error } = await svc
      .from('credit_memos')
      .update({
        status: 'applied',
        applied_to_invoice_id: invoice_id,
        applied_at: new Date().toISOString(),
      })
      .eq('id', memoId)
      .eq('tenant_id', ctx.tenantId)
      .select()
      .single();

    if (error) return res.status(500).json({ error: error.message });

    await logTenantAction(svc, {
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      action: 'credit_memo.apply',
      entityType: 'credit_memo',
      entityId: memoId,
      newValues: { applied_to_invoice_id: invoice_id },
      ipAddress: getClientIp(req),
    });

    return res.status(200).json({ credit_memo: data });
  }

  if (action === 'void') {
    const { data, error } = await svc
      .from('credit_memos')
      .update({ status: 'void' })
      .eq('id', memoId)
      .eq('tenant_id', ctx.tenantId)
      .select()
      .single();

    if (error) return res.status(500).json({ error: error.message });

    await logTenantAction(svc, {
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      action: 'credit_memo.void',
      entityType: 'credit_memo',
      entityId: memoId,
      ipAddress: getClientIp(req),
    });

    return res.status(200).json({ credit_memo: data });
  }

  return res.status(400).json({ error: 'Invalid action. Use "apply" or "void".' });
}
