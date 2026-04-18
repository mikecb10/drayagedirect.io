import { requireTenantUser, requirePermission, getServiceClient } from '../../../../../../lib/tenant-api';
import { PERMISSIONS } from '../../../../../../lib/permissions';
import { logTenantAction, getClientIp } from '../../../../../../lib/tenant-audit';
import { logManualSkip } from '../../../../../../lib/email-dispatch';

export const config = { runtime: 'nodejs' };

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const ctx = await requireTenantUser(req, res);
  if (!ctx) return;
  if (!requirePermission(ctx, [PERMISSIONS.ACCOUNTS_RECEIVABLE, PERMISSIONS.ALL], res)) return;

  const { invoiceId } = req.query;
  const svc = getServiceClient();

  // Verify invoice + tenant scope
  const { data: invoice, error: fetchErr } = await svc
    .from('invoices')
    .select('id, invoice_number, status')
    .eq('id', invoiceId)
    .eq('tenant_id', ctx.tenantId)
    .is('deleted_at', null)
    .maybeSingle();
  if (fetchErr) return res.status(500).json({ error: fetchErr.message });
  if (!invoice) return res.status(404).json({ error: 'Invoice not found' });

  // Mark email as skipped (does NOT change status)
  const now = new Date().toISOString();
  const { error: updErr } = await svc
    .from('invoices')
    .update({ email_skipped_at: now, email_skipped_by: ctx.userId })
    .eq('id', invoiceId)
    .eq('tenant_id', ctx.tenantId);
  if (updErr) return res.status(500).json({ error: updErr.message });

  // Write trigger-log skip row (non-blocking)
  try {
    await logManualSkip(svc, {
      tenantId: ctx.tenantId,
      templateId: null,
      loadId: null,
      relatedEntity: { type: 'invoice', id: invoiceId },
      eventName: 'manual:invoice_send',
      sentByUserId: ctx.userId,
    });
  } catch (e) {
    console.error('logManualSkip failed (non-blocking):', e.message);
  }

  // Tenant audit log
  await logTenantAction(svc, {
    tenantId: ctx.tenantId,
    userId: ctx.userId,
    action: 'invoice.skip_email',
    entityType: 'invoice',
    entityId: invoiceId,
    newValues: { email_skipped_at: now, email_skipped_by: ctx.userId },
    ipAddress: getClientIp(req),
  });

  return res.status(200).json({
    ok: true,
    email_skipped_at: now,
    email_skipped_by: ctx.userId,
  });
}
