import {
  requireTenantUser,
  requirePermission,
  getServiceClient,
} from '../../../../../lib/tenant-api';
import { logTenantAction, getClientIp } from '../../../../../lib/tenant-audit';
import { PERMISSIONS, hasPermission } from '../../../../../lib/permissions';
import { assignInvoiceNumberBase } from '../../../../../lib/invoice-utils';
import { computeInvoiceDueDate } from '../../../../../lib/ar-utils';
import { parseCsvParam } from '../../../../../lib/ar-filter-params';
import { fetchLoadMarginInputs, computeLoadMargin } from '../../../../../lib/load-margin';
import { transitionChargeSetStatus } from '../../../../../lib/charge-sets/transition.js';

/**
 * /api/tenant/ar/invoices
 *
 * GET  — list invoices with filters
 * POST — create invoice from approved charge set(s)
 */
export default async function handler(req, res) {
  const ctx = await requireTenantUser(req, res);
  if (!ctx) return;
  if (!requirePermission(ctx, [PERMISSIONS.ACCOUNTS_RECEIVABLE], res)) return;

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

    // Exclude variants
    const customerIdsExclude    = parseCsvParam(req.query.customer_ids_exclude);
    const branchIdsExclude      = parseCsvParam(req.query.branch_ids_exclude);
    const loadTypesExclude      = parseCsvParam(req.query.load_types_exclude);
    const containerTypesExclude = parseCsvParam(req.query.container_types_exclude);
    const containerSizesExclude = parseCsvParam(req.query.container_sizes_exclude);
    const flagKeysExclude       = parseCsvParam(req.query.flags_exclude);
    const sslCodesExclude       = parseCsvParam(req.query.ssl_codes_exclude);
    const driverIdsExclude      = parseCsvParam(req.query.driver_ids_exclude);
    // New dimensions
    const { invoiced_from, invoiced_to } = req.query;
    const pickupLocationIds   = parseCsvParam(req.query.pickup_location_ids);
    const deliveryLocationIds = parseCsvParam(req.query.delivery_location_ids);
    const returnLocationIds   = parseCsvParam(req.query.return_location_ids);

    // Phase B4
    const billToPrimaryCustomerIds        = parseCsvParam(req.query.bill_to_primary_customer_ids);
    const billToPrimaryCustomerIdsExclude = parseCsvParam(req.query.bill_to_primary_customer_ids_exclude);
    const billToAdditionalCustomerIds     = parseCsvParam(req.query.bill_to_additional_customer_ids);
    const billToAdditionalCustomerIdsExclude = parseCsvParam(req.query.bill_to_additional_customer_ids_exclude);
    const { factor_company } = req.query;

    // Phase C: invoice-email-sent Y/N
    const { invoice_email_sent_y } = req.query;

    let query = svc
      .from('invoices')
      .select(`
        *,
        customer:customers!customer_id(id, name),
        charge_sets:invoice_charge_sets(
          charge_set:order_charge_sets(id, charge_set_number, order_id, total_cents, bill_to_customer_id,
            bill_to:customers!order_charge_sets_bill_to_customer_id_fkey(id, name, pay_type),
            order:orders(id, order_number, load_type, customer_reference, branch_id, driver_id, container_type, container_size, steamship_line_scac, is_hazmat, is_overweight, is_overheight, is_liquor, is_hot, is_genset, is_scale, is_ev, is_street_turn, is_oog, is_bonded, is_double, is_tanker, pickup_location_id, delivery_location_id, return_location_id)
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
    // Invoice-level excludes (not order-level)
    if (customerIdsExclude.length === 1) query = query.neq('customer_id', customerIdsExclude[0]);
    else if (customerIdsExclude.length > 1) query = query.not('customer_id', 'in', '(' + customerIdsExclude.join(',') + ')');
    if (branchIdsExclude.length === 1) query = query.neq('branch_id', branchIdsExclude[0]);
    else if (branchIdsExclude.length > 1) query = query.not('branch_id', 'in', '(' + branchIdsExclude.join(',') + ')');
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
      // Phase B2 exclude variants
      if (loadTypesExclude.length > 0 && order.load_type && loadTypesExclude.includes(order.load_type)) return false;
      if (containerTypesExclude.length > 0 && order.container_type && containerTypesExclude.includes(order.container_type)) return false;
      if (containerSizesExclude.length > 0 && order.container_size && containerSizesExclude.includes(order.container_size)) return false;
      if (flagKeysExclude.length > 0 && !flagKeysExclude.every((key) => order[`is_${key}`] !== true)) return false;
      if (sslCodesExclude.length > 0) {
        const codes = new Set(sslCodesExclude.map((c) => c.toUpperCase()));
        if (order.steamship_line_scac && codes.has(order.steamship_line_scac.toUpperCase())) return false;
      }
      if (driverIdsExclude.length > 0 && order.driver_id && driverIdsExclude.includes(order.driver_id)) return false;
      // Phase B2 locations
      if (pickupLocationIds.length > 0 && !(order.pickup_location_id && pickupLocationIds.includes(order.pickup_location_id))) return false;
      if (deliveryLocationIds.length > 0 && !(order.delivery_location_id && deliveryLocationIds.includes(order.delivery_location_id))) return false;
      if (returnLocationIds.length > 0 && !(order.return_location_id && returnLocationIds.includes(order.return_location_id))) return false;
      return true;
    };

    const SECONDARY_PATTERN = /_\d+$/;
    const isPrimaryCs = (cs) => cs && !SECONDARY_PATTERN.test(cs.charge_set_number || '');

    const chargeSetBillToMatches = (cs) => {
      if (!cs) return false;
      const isPrimary = isPrimaryCs(cs);
      // Primary include — passes through additional rows, requires primary rows to match
      if (billToPrimaryCustomerIds.length > 0 && isPrimary) {
        if (!(cs.bill_to_customer_id && billToPrimaryCustomerIds.includes(cs.bill_to_customer_id))) return false;
      }
      // Primary exclude — rejects primary rows matching the list, passes additional through
      if (billToPrimaryCustomerIdsExclude.length > 0 && isPrimary) {
        if (cs.bill_to_customer_id && billToPrimaryCustomerIdsExclude.includes(cs.bill_to_customer_id)) return false;
      }
      // Additional include — passes primary through, requires additional rows to match
      if (billToAdditionalCustomerIds.length > 0 && !isPrimary) {
        if (!(cs.bill_to_customer_id && billToAdditionalCustomerIds.includes(cs.bill_to_customer_id))) return false;
      }
      // Additional exclude — rejects additional rows matching the list, passes primary through
      if (billToAdditionalCustomerIdsExclude.length > 0 && !isPrimary) {
        if (cs.bill_to_customer_id && billToAdditionalCustomerIdsExclude.includes(cs.bill_to_customer_id)) return false;
      }
      // Factor company
      if (factor_company === 'yes') {
        if (cs.bill_to?.pay_type !== 'factoring') return false;
      } else if (factor_company === 'no') {
        // NULL pay_type defaults to direct-pay; reject only if explicitly factoring.
        if (cs.bill_to?.pay_type === 'factoring') return false;
      }
      return true;
    };

    const hasChargeSetFilters =
      billToPrimaryCustomerIds.length > 0 ||
      billToPrimaryCustomerIdsExclude.length > 0 ||
      billToAdditionalCustomerIds.length > 0 ||
      billToAdditionalCustomerIdsExclude.length > 0 ||
      factor_company === 'yes' || factor_company === 'no';

    const hasOrderFilters =
      (reference_number && typeof reference_number === 'string' && reference_number.trim().length > 0) ||
      loadTypes.length > 0 || containerTypes.length > 0 || containerSizes.length > 0 ||
      flagKeys.length > 0 || sslCodes.length > 0 || driverIds.length > 0 ||
      loadTypesExclude.length > 0 || containerTypesExclude.length > 0 || containerSizesExclude.length > 0 ||
      flagKeysExclude.length > 0 || sslCodesExclude.length > 0 || driverIdsExclude.length > 0 ||
      pickupLocationIds.length > 0 || deliveryLocationIds.length > 0 || returnLocationIds.length > 0;

    if (hasOrderFilters) {
      filtered = filtered.filter((inv) => {
        const sets = inv.charge_sets || [];
        return sets.some((cs) => orderMatches(cs?.charge_set?.order));
      });
    }

    if (hasChargeSetFilters) {
      filtered = filtered.filter((inv) => {
        const sets = inv.charge_sets || [];
        return sets.some((cs) => chargeSetBillToMatches(cs?.charge_set));
      });
    }

    // Phase B2: invoiced date range — invoices.created_at is when the
    // invoice row was generated, which equals the invoicing moment.
    if (invoiced_from && typeof invoiced_from === 'string') {
      filtered = filtered.filter((inv) => inv.created_at && inv.created_at >= invoiced_from);
    }
    if (invoiced_to && typeof invoiced_to === 'string') {
      filtered = filtered.filter((inv) => inv.created_at && inv.created_at <= invoiced_to);
    }

    // ── Phase C: invoice-email-sent Y/N ────────────────────────────────
    // Signal from email_trigger_log event_name in manual invoice send events.
    // Single sends stash invoice ID at umbrella_decisions[0].related_entity.id;
    // bulk sends stash invoice_ids array at umbrella_decisions[0].invoice_ids.
    if (invoice_email_sent_y === 'yes' || invoice_email_sent_y === 'no') {
      const { data: logRows } = await svc
        .from('email_trigger_log')
        .select('event_name, umbrella_decisions, outcome')
        .eq('tenant_id', ctx.tenantId)
        .in('event_name', ['manual:invoice_send', 'manual:invoice_bulk_send'])
        .eq('outcome', 'fired');

      const sentInvoiceIds = new Set();
      for (const row of logRows || []) {
        const decisions = Array.isArray(row.umbrella_decisions) ? row.umbrella_decisions : [];
        for (const d of decisions) {
          if (d?.related_entity?.type?.startsWith('invoice') && d.related_entity.id) {
            for (const id of String(d.related_entity.id).split(',')) {
              const trimmed = id.trim();
              if (trimmed) sentInvoiceIds.add(trimmed);
            }
          }
          if (Array.isArray(d?.invoice_ids)) {
            for (const id of d.invoice_ids) {
              if (id) sentInvoiceIds.add(id);
            }
          }
        }
      }

      if (invoice_email_sent_y === 'yes') {
        filtered = filtered.filter((inv) => sentInvoiceIds.has(inv.id));
      } else {
        filtered = filtered.filter((inv) => !sentInvoiceIds.has(inv.id));
      }
    }

    // ── Load Margin: attach margin object per invoice row ─────────────────
    // Invoices are load-level documents; collect distinct order IDs from
    // their nested charge_sets, compute margin once per order, then attach.
    // Gated on ACCOUNTS_RECEIVABLE | REPORTING | super_admin — consistent
    // with loads list and AR endpoints.
    const canSeeMargin = hasPermission(ctx, [PERMISSIONS.ACCOUNTS_RECEIVABLE, PERMISSIONS.REPORTING]);
    if (canSeeMargin && filtered.length > 0) {
      try {
        const { data: tenant, error: tErr } = await svc
          .from('tenants')
          .select('margin_red_threshold, margin_yellow_threshold, margin_include_dry_runs')
          .eq('id', ctx.tenantId)
          .single();
        if (!tErr && tenant) {
          // Collect distinct order IDs from nested charge_sets structure.
          const distinctOrderIds = [...new Set(
            filtered.flatMap((inv) =>
              (inv.charge_sets || [])
                .map((cs) => cs?.charge_set?.order_id)
                .filter(Boolean)
            )
          )];
          if (distinctOrderIds.length > 0) {
            const inputs = await fetchLoadMarginInputs(svc, {
              tenantId: ctx.tenantId,
              orderIds: distinctOrderIds,
              includeDryRuns: tenant.margin_include_dry_runs,
            });
            const marginByOrder = new Map();
            for (const id of distinctOrderIds) {
              const { revenueCents, costCents } = inputs.get(id) ?? { revenueCents: 0, costCents: 0 };
              marginByOrder.set(id, computeLoadMargin({
                revenueCents,
                costCents,
                redThreshold:    Number(tenant.margin_red_threshold),
                yellowThreshold: Number(tenant.margin_yellow_threshold),
              }));
            }
            // Attach margin to each invoice. An invoice may span multiple
            // charge sets / orders (consolidated); attach the first resolved
            // order's margin, or null for multi-order invoices where it's
            // ambiguous at the invoice level.
            for (const inv of filtered) {
              const orderIds = (inv.charge_sets || [])
                .map((cs) => cs?.charge_set?.order_id)
                .filter(Boolean);
              const uniqueOrderIds = [...new Set(orderIds)];
              if (uniqueOrderIds.length === 1) {
                inv.margin = marginByOrder.get(uniqueOrderIds[0]) ?? null;
              } else if (uniqueOrderIds.length > 1) {
                // Consolidated invoice: aggregate revenue + cost across all
                // constituent orders, then compute a single invoice-level margin.
                let aggRevenue = 0;
                let aggCost = 0;
                for (const id of uniqueOrderIds) {
                  const { revenueCents, costCents } = inputs.get(id) ?? { revenueCents: 0, costCents: 0 };
                  aggRevenue += revenueCents;
                  aggCost    += costCents;
                }
                inv.margin = computeLoadMargin({
                  revenueCents:    aggRevenue,
                  costCents:       aggCost,
                  redThreshold:    Number(tenant.margin_red_threshold),
                  yellowThreshold: Number(tenant.margin_yellow_threshold),
                });
              } else {
                inv.margin = null;
              }
            }
          }
        }
      } catch (err) {
        console.error('AR invoices margin attach failed', err);
      }
    }

    // ── Margin range filter ─────────────────────────────────────────────
    // Runs after the margin-attach block so inv.margin is populated.
    // Neutral-bucket rows (no revenue or no cost) are excluded from numeric ranges.
    // Skip entirely when the caller lacks the margin-view permission — no rows
    // have .margin attached, so filtering would produce an empty result set.
    const { margin_from, margin_to } = req.query;
    const marginFrom = margin_from !== '' && margin_from != null
      ? Number(margin_from) : null;
    const marginTo   = margin_to   !== '' && margin_to   != null
      ? Number(margin_to)   : null;

    if (canSeeMargin && (Number.isFinite(marginFrom) || Number.isFinite(marginTo))) {
      filtered = filtered.filter((inv) => {
        const m = inv.margin;
        if (!m || m.bucket === 'neutral') return false;
        if (Number.isFinite(marginFrom) && m.marginPct < marginFrom) return false;
        if (Number.isFinite(marginTo)   && m.marginPct > marginTo)   return false;
        return true;
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

    // Create invoice. invoice_date is the business-meaningful "issue date"
    // (separate from created_at, which is the insert timestamp). Used as
    // the anchor for due-date computation so edits to invoice_date can
    // recompute due_date predictably.
    const todayIso = new Date().toISOString().split('T')[0]; // YYYY-MM-DD, date-only
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
        invoice_date: todayIso,
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

    // Update charge sets to 'invoiced' status and link invoice_id.
    // Loop-serial through transitionChargeSetStatus so each transition
    // gets a history row. N is small (1-10 charge_sets per invoice typical).
    const invoicedAt = new Date().toISOString();
    try {
      for (const chargeSetId of charge_set_ids) {
        await transitionChargeSetStatus(svc, {
          tenantId: ctx.tenantId,
          chargeSetId,
          newStatus: 'invoiced',
          actorUserId: ctx.userId,
          extraFields: { invoice_id: invoice.id, invoiced_at: invoicedAt },
        });
      }
    } catch (transitionErr) {
      // Pre-refactor this was a single bulk UPDATE and was atomic. Now it's a
      // serial loop — partial failure would leave charge_sets split between
      // two states (some 'invoiced' with invoice_id, rest 'approved' with null),
      // pointing to a freshly-committed invoice.
      // Roll back: clear any partially-stamped charge_sets, then soft-delete the invoice
      // and junction rows (same rollback shape as the junctionErr handler above).
      await svc.from('order_charge_sets')
        .update({ status: 'approved', invoice_id: null, invoiced_at: null })
        .eq('tenant_id', ctx.tenantId)
        .in('id', charge_set_ids)
        .eq('invoice_id', invoice.id);
      await svc.from('invoice_charge_sets').delete().eq('invoice_id', invoice.id).eq('tenant_id', ctx.tenantId);
      await svc.from('invoices').delete().eq('id', invoice.id).eq('tenant_id', ctx.tenantId);
      return res.status(500).json({
        error: `Failed to transition charge sets to 'invoiced': ${transitionErr.message}`,
      });
    }

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
