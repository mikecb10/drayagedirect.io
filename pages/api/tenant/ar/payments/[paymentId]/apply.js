import {
  requireTenantUser,
  requirePermission,
  getServiceClient,
} from '../../../../../../lib/tenant-api';
import { logTenantAction, getClientIp } from '../../../../../../lib/tenant-audit';
import { PERMISSIONS } from '../../../../../../lib/permissions';

/**
 * /api/tenant/ar/payments/[paymentId]/apply
 *
 * POST — apply payment to one or more invoices (split-apply)
 * Body: { applications: [{ invoice_id, amount_cents }] }
 */
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const ctx = await requireTenantUser(req, res);
  if (!ctx) return;
  if (!requirePermission(ctx, [PERMISSIONS.ACCOUNTS_RECEIVABLE, PERMISSIONS.ALL], res)) return;

  const { paymentId } = req.query;
  const { applications = [] } = req.body || {};
  const svc = getServiceClient();

  if (!applications.length) {
    return res.status(400).json({ error: 'At least one application is required' });
  }

  // Fetch payment
  const { data: payment } = await svc
    .from('payments_received')
    .select('*')
    .eq('id', paymentId)
    .eq('tenant_id', ctx.tenantId)
    .single();

  if (!payment) return res.status(404).json({ error: 'Payment not found' });

  // Validate total doesn't exceed unapplied
  const totalApplying = applications.reduce((s, a) => s + (a.amount_cents || 0), 0);
  if (totalApplying > payment.unapplied_cents) {
    return res.status(400).json({
      error: `Cannot apply $${(totalApplying / 100).toFixed(2)} — only $${(payment.unapplied_cents / 100).toFixed(2)} unapplied`,
    });
  }

  // Process each application
  for (const app of applications) {
    if (!app.invoice_id || !app.amount_cents || app.amount_cents <= 0) continue;

    // Verify invoice exists and has balance
    const { data: invoice } = await svc
      .from('invoices')
      .select('id, balance_due_cents, status, customer_id')
      .eq('id', app.invoice_id)
      .eq('tenant_id', ctx.tenantId)
      .single();

    if (!invoice) continue;
    // Cross-customer guard: the UI normally scopes allocation to a single
    // customer, but the global-overview mode + direct API calls can produce
    // mismatched payment↔invoice pairs. Reject them here so we never post a
    // payment to another customer's invoice.
    if (invoice.customer_id !== payment.customer_id) {
      return res.status(400).json({
        error: 'Cannot apply payment — invoice belongs to a different customer',
      });
    }
    if (app.amount_cents > invoice.balance_due_cents) {
      return res.status(400).json({
        error: `Application exceeds invoice balance ($${(invoice.balance_due_cents / 100).toFixed(2)})`,
      });
    }

    // Create application row
    await svc.from('payment_applications').insert({
      tenant_id: ctx.tenantId,
      payment_id: paymentId,
      invoice_id: app.invoice_id,
      amount_cents: app.amount_cents,
    });

    // Update invoice balance
    const newBalance = invoice.balance_due_cents - app.amount_cents;
    const invoiceUpdates = { balance_due_cents: newBalance };

    // Auto-transition to paid when balance reaches 0
    if (newBalance <= 0) {
      invoiceUpdates.status = 'paid';
      invoiceUpdates.paid_at = new Date().toISOString();
    }

    await svc
      .from('invoices')
      .update(invoiceUpdates)
      .eq('id', app.invoice_id)
      .eq('tenant_id', ctx.tenantId);
  }

  // Update payment unapplied
  await svc
    .from('payments_received')
    .update({ unapplied_cents: payment.unapplied_cents - totalApplying })
    .eq('id', paymentId)
    .eq('tenant_id', ctx.tenantId);

  await logTenantAction(svc, {
    tenantId: ctx.tenantId,
    userId: ctx.userId,
    action: 'payment.apply',
    entityType: 'payment',
    entityId: paymentId,
    newValues: { applications, total_applied_cents: totalApplying },
    ipAddress: getClientIp(req),
  });

  return res.status(200).json({ success: true, applied_cents: totalApplying });
}
