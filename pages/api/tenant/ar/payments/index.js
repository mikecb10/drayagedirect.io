import {
  requireTenantUser,
  requirePermission,
  getServiceClient,
} from '../../../../../lib/tenant-api';
import { logTenantAction, getClientIp } from '../../../../../lib/tenant-audit';
import { PERMISSIONS } from '../../../../../lib/permissions';
import { parseCsvParam } from '../../../../../lib/ar-filter-params';

/**
 * /api/tenant/ar/payments
 *
 * GET  — list payments with filters
 * POST — record a new payment
 */
export default async function handler(req, res) {
  const ctx = await requireTenantUser(req, res);
  if (!ctx) return;
  if (!requirePermission(ctx, [PERMISSIONS.ACCOUNTS_RECEIVABLE, PERMISSIONS.ALL], res)) return;

  const svc = getServiceClient();

  if (req.method === 'GET') {
    const { customer_id, from, to, payment_method, reference_number } = req.query;
    const customerIdsRaw = parseCsvParam(req.query.customer_ids);
    const customerIdsExclude = parseCsvParam(req.query.customer_ids_exclude);
    // Backward-compat: fold single `customer_id` into the include array.
    const customerIds = customer_id
      ? Array.from(new Set([...customerIdsRaw, customer_id]))
      : customerIdsRaw;

    let query = svc
      .from('payments_received')
      .select(`
        *,
        customer:customers!customer_id(id, name),
        invoice:invoices!invoice_id(id, invoice_number),
        applications:payment_applications(id, amount_cents, invoice_id,
          applied_invoice:invoices!invoice_id(id, invoice_number)
        )
      `)
      .eq('tenant_id', ctx.tenantId)
      .order('payment_date', { ascending: false });

    if (customerIds.length === 1) query = query.eq('customer_id', customerIds[0]);
    else if (customerIds.length > 1) query = query.in('customer_id', customerIds);
    if (customerIdsExclude.length === 1) query = query.neq('customer_id', customerIdsExclude[0]);
    else if (customerIdsExclude.length > 1) query = query.not('customer_id', 'in', '(' + customerIdsExclude.join(',') + ')');
    if (payment_method) query = query.eq('payment_method', payment_method);
    if (from) query = query.gte('payment_date', from);
    if (to) query = query.lte('payment_date', to);

    if (reference_number && typeof reference_number === 'string' && reference_number.trim().length > 0) {
      query = query.ilike('reference_number', `%${reference_number.trim()}%`);
    }

    const { data, error } = await query;
    if (error) return res.status(500).json({ error: error.message });

    const payments = data || [];
    const stats = {
      count: payments.length,
      total_cents: payments.reduce((s, p) => s + (p.amount_cents || 0), 0),
      unapplied_cents: payments.reduce((s, p) => s + (p.unapplied_cents || 0), 0),
    };

    return res.status(200).json({ payments, stats });
  }

  if (req.method === 'POST') {
    const body = req.body || {};
    if (!body.customer_id) return res.status(400).json({ error: 'Customer is required' });
    if (!body.amount_cents || body.amount_cents <= 0) return res.status(400).json({ error: 'Amount must be positive' });
    if (!body.payment_date) return res.status(400).json({ error: 'Payment date is required' });

    const insertData = {
      tenant_id: ctx.tenantId,
      customer_id: body.customer_id,
      invoice_id: body.invoice_id || null,
      amount_cents: body.amount_cents,
      unapplied_cents: body.amount_cents, // Starts fully unapplied
      payment_method: body.payment_method || 'check',
      payment_date: body.payment_date,
      reference_number: body.reference_number || null,
      notes: body.notes || null,
      recorded_by: ctx.userId,
    };

    const { data, error } = await svc
      .from('payments_received')
      .insert(insertData)
      .select()
      .single();

    if (error) return res.status(500).json({ error: error.message });

    await logTenantAction(svc, {
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      action: 'payment.record',
      entityType: 'payment',
      entityId: data.id,
      newValues: { amount_cents: data.amount_cents, customer_id: data.customer_id },
      ipAddress: getClientIp(req),
    });

    return res.status(201).json({ payment: data });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
