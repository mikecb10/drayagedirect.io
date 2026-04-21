import {
  requireTenantUser,
  requirePermission,
  getServiceClient,
} from '../../../../../lib/tenant-api';
import { logTenantAction, getClientIp } from '../../../../../lib/tenant-audit';
import { PERMISSIONS } from '../../../../../lib/permissions';
import { assignInvoiceNumberBase } from '../../../../../lib/invoice-utils';
import { computeInvoiceDueDate } from '../../../../../lib/ar-utils';
import { parseCsvParam } from '../../../../../lib/ar-filter-params';

/**
 * /api/tenant/ar/invoices
 *
 * GET  — list invoices with filters
 * POST — create invoice from approved charge set(s)
 */
export default async function handler(req, res) {
  const ctx = await requireTenantUser(req, res);
  if (!ctx) return;
  if (!requirePermission(ctx, [PERMISSIONS.ACCOUNTS_RECEIVABLE, PERMISSIONS.ALL], res)) return;

  const svc = getServiceClient();

  // ── LIST ──
  if (req.method === 'GET') {
    const { status, customer_id, from, to, search } = req.query;
    const customerIdsRaw = parseCsvParam(req.query.customer_ids);
    const branchIds      = parseCsvParam(req.query.branch_ids);
    // Backward-compat: single `customer_id` folds into the array.
    const customerIds = customer_id
      ? Array.from(new Set([...customerIdsRaw, customer_id]))
      : customerIdsRaw;

    const { reference_number } = req.query;
    const loadTypes       = parseCsvParam(req.query.load_types);
    const containerTypes  = parseCsvParam(req.query.container_types);
    const containerSizes  = parseCsvParam(req.query.container_sizes);
    const flagKeys        = parseCsvParam(req.query.flags);
    const sslCodes        = parseCsvParam(req.query.ssl_codes);
    const driverIds       = parseCsvParam(req.query.driver_ids);

    let query = svc
      .from('invoices')
      .select(`
        *,
        customer:customers!customer_id(id, name),
        charge_sets:invoice_charge_sets(
          charge_set:order_charge_sets(id, charge_set_number, order_id, total_cents,
            order:orders(id, order_number, load_type, customer_reference, branch_id, driver_id, container_type, container_size, steamship_line_scac, is_hazmat, is_overweight, is_overheight, is_liquor, is_hot, is_genset, is_scale, is_ev, is_street_turn, is_oog, is_bonded, is_double, is_tanker)
          )
        )
      `)
      .eq('tenant_id', ctx.tenantId)
      .is('deleted_at', null)
      .order('created_at', { ascending: false });

    if (status) query = query.eq('status', status);
    if (customerIds.length === 1) query = query.eq('customer_id', customerIds[0]);
    else if (customerIds.length > 1) query = query.in('customer_id', customerIds);
    if (branchIds.length === 1) query = query.eq('branch_id', branchIds[0]);
    else if (branchIds.length > 1) query = query.in('branch_id', branchIds);
    if (from) query = query.gte('created_at', from);
    if (to)   query = query.lte('created_at', to);
    if (search) query = query.or(`invoice_number.ilike.%${search}%`);

    const { data, error } = await query;
    if (error) return res.status(500).json({ error: error.message });

    let filtered = data || [];

    // Phase B1: order-level filters. An invoice passes if ANY of its
    // constituent charge-sets' orders satisfies every active order-level
    // filter. Order lookup path: invoice.charge_sets[i].charge_set.order.
    const orderMatches = (order) => {
      if (!order) return false;
      if (reference_number && typeof reference_number === 'string' && reference_number.trim().length > 0) {
        const q = reference_number.trim().toLowerCase();
        if (!order.customer_reference?.toLowerCase().includes(q)) return false;
      }
      if (loadTypes.length > 0 && !loadTypes.includes(order.load_type)) return false;
      if (containerTypes.length > 0 && !containerTypes.includes(order.container_type)) return false;
      if (containerSizes.length > 0 && !containerSizes.includes(order.container_size)) return false;
      if (flagKeys.length > 0 && !flagKeys.every((key) => order[`is_${key}`] === true)) return false;
      if (sslCodes.length > 0) {
        const codes = new Set(sslCodes.map((c) => c.toUpperCase()));
        if (!order.steamship_line_scac || !codes.has(order.steamship_line_scac.toUpperCase())) return false;
      }
      if (driverIds.length > 0 && !driverIds.includes(order.driver_id)) return false;
      return true;
    };

    const hasOrderFilters =
      (reference_number && typeof reference_number === 'string' && reference_number.trim().length > 0) ||
      loadTypes.length > 0 ||
      containerTypes.length > 0 ||
      containerSizes.length > 0 ||
      flagKeys.length > 0 ||
      sslCodes.length > 0 ||
      driverIds.length > 0;

    if (hasOrderFilters) {
      filtered = filtered.filter((inv) => {
        const sets = inv.charge_sets || [];
        return sets.some((cs) => orderMatches(cs?.charge_set?.order));
      });
    }

    const stats = {
      total:    filtered.length,
      draft:    filtered.filter((i) => i.status === 'draft').length,
      sent:     filtered.filter((i) => i.status === 'sent').length,
      paid:     filtered.filter((i) => i.status === 'paid').length,
      overdue:  filtered.filter((i) => i.status === 'overdue').length,
      void:     filtered.filter((i) => i.status === 'void').length,
      total_outstanding_cents: filtered
        .filter((i) => ['sent', 'overdue'].includes(i.status))
        .reduce((sum, i) => sum + (i.balance_due_cents || 0), 0),
    };

    return res.status(200).json({ invoices: filtered, stats });
  }

  // ── CREATE FROM CHARGE SETS ──
  if (req.method === 'POST') {
    const { charge_set_ids = [], is_consolidated = false } = req.body || {};

    if (!charge_set_ids.length) {
      return res.status(400).json({ error: 'At least one charge set is required' });
    }

    // Fetch the charge sets
    const { data: chargeSets, error: csError } = await svc
      .from('order_charge_sets')
      .select('*, order:orders(id, order_number, customer_id, branch_id)')
      .eq('tenant_id', ctx.tenantId)
      .in('id', charge_set_ids);

    if (csError) return res.status(500).json({ error: csError.message });
    if (!chargeSets?.length) return res.status(404).json({ error: 'Charge sets not found' });

    // Validate: all must be approved status
    const nonApproved = chargeSets.filter((cs) => cs.status !== 'approved' && cs.status !== 'invoiced');
    if (nonApproved.length > 0) {
      return res.status(400).json({
        error: `Charge sets must be approved before invoicing. Found ${nonApproved.length} non-approved.`,
      });
    }

    // For consolidated: all must be same customer
    const customerIds = [...new Set(chargeSets.map((cs) => cs.order?.customer_id).filter(Boolean))];
    if (customerIds.length > 1) {
      return res.status(400).json({ error: 'Consolidated invoices must be for the same customer' });
    }

    const customerId = chargeSets[0].bill_to_customer_id || customerIds[0];
    if (!customerId) {
      return res.status(400).json({ error: 'Could not determine customer for invoice' });
    }

    // Get customer payment terms
    const { data: customer } = await svc
      .from('customers')
      .select('payment_terms, name')
      .eq('id', customerId)
      .single();

    const paymentTerms = customer?.payment_terms || 30;

    // Compute totals
    const subtotalCents = chargeSets.reduce((sum, cs) => sum + (cs.total_cents || 0), 0);
    const totalCents = subtotalCents; // No tax calc yet

    // Assign invoice number
    const invoiceNumber = await assignInvoiceNumberBase(svc, ctx.tenantId);

    // Create invoice
    const { data: invoice, error: invError } = await svc
      .from('invoices')
      .insert({
        tenant_id: ctx.tenantId,
        invoice_number: invoiceNumber,
        customer_id: customerId,
        status: 'draft',
        subtotal_cents: subtotalCents,
        total_amount_cents: totalCents,
        balance_due_cents: totalCents,
        due_date: computeInvoiceDueDate(new Date(), paymentTerms),
        payment_terms_days: paymentTerms,
        is_consolidated: charge_set_ids.length > 1,
        branch_id: chargeSets[0].order?.branch_id || null,
        created_by: ctx.userId,
      })
      .select()
      .single();

    if (invError) return res.status(500).json({ error: invError.message });

    // Create junction rows — bail and roll back the invoice if this fails,
    // otherwise we'd return 201 with an orphaned invoice that has no charge
    // sets linked (silent partial failure).
    const junctionRows = charge_set_ids.map((csId) => ({
      tenant_id: ctx.tenantId,
      invoice_id: invoice.id,
      charge_set_id: csId,
    }));
    const { error: junctionErr } = await svc
      .from('invoice_charge_sets')
      .insert(junctionRows);
    if (junctionErr) {
      await svc.from('invoices').delete().eq('id', invoice.id).eq('tenant_id', ctx.tenantId);
      return res.status(500).json({
        error: `Failed to link charge sets to invoice: ${junctionErr.message}`,
      });
    }

    // Update charge sets to 'invoiced' status and link invoice_id
    await svc
      .from('order_charge_sets')
      .update({ status: 'invoiced', invoice_id: invoice.id, invoiced_at: new Date().toISOString() })
      .eq('tenant_id', ctx.tenantId)
      .in('id', charge_set_ids);

    // Copy line items to invoice_line_items
    for (const cs of chargeSets) {
      const { data: lineItems } = await svc
        .from('order_charge_set_line_items')
        .select('*')
        .eq('charge_set_id', cs.id)
        .eq('tenant_id', ctx.tenantId);

      if (lineItems?.length) {
        await svc.from('invoice_line_items').insert(
          lineItems.map((li, idx) => ({
            tenant_id: ctx.tenantId,
            invoice_id: invoice.id,
            order_id: cs.order_id,
            description: li.name || li.description || 'Charge',
            charge_type: 'linehaul',
            quantity: li.unit_count || 1,
            unit_amount_cents: li.per_unit_price_cents || li.total_cents || 0,
            total_amount_cents: li.total_cents || 0,
            sort_order: idx,
          }))
        );
      }
    }

    await logTenantAction(svc, {
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      action: 'invoice.create',
      entityType: 'invoice',
      entityId: invoice.id,
      newValues: { invoice_number: invoiceNumber, charge_set_count: charge_set_ids.length, total_cents: totalCents },
      ipAddress: getClientIp(req),
    });

    return res.status(201).json({ invoice });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
