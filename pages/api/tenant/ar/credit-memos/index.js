import {
  requireTenantUser,
  requirePermission,
  getServiceClient,
} from '../../../../../lib/tenant-api';
import { logTenantAction, getClientIp } from '../../../../../lib/tenant-audit';
import { PERMISSIONS } from '../../../../../lib/permissions';

/**
 * /api/tenant/ar/credit-memos
 *
 * GET  — list credit memos
 * POST — create credit memo
 */
export default async function handler(req, res) {
  const ctx = await requireTenantUser(req, res);
  if (!ctx) return;
  if (!requirePermission(ctx, [PERMISSIONS.ACCOUNTS_RECEIVABLE, PERMISSIONS.ALL], res)) return;

  const svc = getServiceClient();

  if (req.method === 'GET') {
    const { customer_id, status } = req.query;

    let query = svc
      .from('credit_memos')
      .select(`
        *,
        customer:customers!customer_id(id, name),
        invoice:invoices!invoice_id(id, invoice_number),
        applied_invoice:invoices!applied_to_invoice_id(id, invoice_number)
      `)
      .eq('tenant_id', ctx.tenantId)
      .is('deleted_at', null)
      .order('created_at', { ascending: false });

    if (customer_id) query = query.eq('customer_id', customer_id);
    if (status) query = query.eq('status', status);

    const { data, error } = await query;
    if (error) return res.status(500).json({ error: error.message });

    return res.status(200).json({ credit_memos: data || [] });
  }

  if (req.method === 'POST') {
    const body = req.body || {};
    if (!body.customer_id) return res.status(400).json({ error: 'Customer is required' });
    if (!body.amount_cents || body.amount_cents <= 0) return res.status(400).json({ error: 'Amount must be positive' });

    const { data, error } = await svc
      .from('credit_memos')
      .insert({
        tenant_id: ctx.tenantId,
        customer_id: body.customer_id,
        amount_cents: body.amount_cents,
        reason: body.reason || null,
        notes: body.notes || null,
        invoice_id: body.invoice_id || null,
        created_by: ctx.userId,
      })
      .select()
      .single();

    if (error) return res.status(500).json({ error: error.message });

    await logTenantAction(svc, {
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      action: 'credit_memo.create',
      entityType: 'credit_memo',
      entityId: data.id,
      newValues: { amount_cents: data.amount_cents, customer_id: data.customer_id },
      ipAddress: getClientIp(req),
    });

    return res.status(201).json({ credit_memo: data });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
