import {
  requireTenantUser,
  requirePermission,
  getServiceClient,
} from '../../../../../../../lib/tenant-api';
import { logTenantAction, getClientIp } from '../../../../../../../lib/tenant-audit';
import { PERMISSIONS } from '../../../../../../../lib/permissions';

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
}

function computeLineTotal(line) {
  const qty = parseFloat(line.unit_count || 0);
  const free = parseFloat(line.free_units || 0);
  const billable = Math.max(0, qty - free);
  const price = parseInt(line.per_unit_price_cents || 0, 10);
  return Math.round(billable * price);
}

export default async function handler(req, res) {
  const ctx = await requireTenantUser(req, res);
  if (!ctx) return;

  const { id, csId } = req.query;
  const svc = getServiceClient();

  if (req.method === 'POST') {
    if (
      !requirePermission(
        ctx,
        [PERMISSIONS.ORDER_ENTRY, PERMISSIONS.ACCOUNTS_RECEIVABLE, PERMISSIONS.ALL],
        res
      )
    )
      return;

    const {
      name,
      description,
      unit_of_measure,
      unit_count,
      free_units,
      per_unit_price_cents,
    } = req.body || {};

    if (!name) return res.status(400).json({ error: 'Name is required' });

    const totalCents = computeLineTotal(req.body || {});

    const { data, error } = await svc
      .from('order_charge_set_line_items')
      .insert({
        tenant_id: ctx.tenantId,
        charge_set_id: csId,
        name,
        description: description || null,
        unit_of_measure: unit_of_measure || 'fixed',
        unit_count: unit_count ?? 1,
        free_units: free_units ?? 0,
        per_unit_price_cents: per_unit_price_cents ?? 0,
        total_cents: totalCents,
      })
      .select()
      .single();

    if (error) return res.status(500).json({ error: error.message });
    await recomputeTotals(svc, ctx.tenantId, csId);

    await logTenantAction(svc, {
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      action: 'load.line_item_create',
      entityType: 'order',
      entityId: id,
      newValues: { name: data.name, amount: data.total_cents, unit_of_measure: data.unit_of_measure, charge_set_id: csId },
      ipAddress: getClientIp(req),
    });

    return res.status(201).json({ line_item: data });
  }

  if (req.method === 'PUT') {
    if (
      !requirePermission(
        ctx,
        [PERMISSIONS.ORDER_ENTRY, PERMISSIONS.ACCOUNTS_RECEIVABLE, PERMISSIONS.ALL],
        res
      )
    )
      return;

    const { line_item_id, ...fields } = req.body || {};
    if (!line_item_id) return res.status(400).json({ error: 'line_item_id required' });

    fields.total_cents = computeLineTotal(fields);

    const { data, error } = await svc
      .from('order_charge_set_line_items')
      .update(fields)
      .eq('tenant_id', ctx.tenantId)
      .eq('charge_set_id', csId)
      .eq('id', line_item_id)
      .select()
      .single();

    if (error) return res.status(500).json({ error: error.message });
    await recomputeTotals(svc, ctx.tenantId, csId);

    await logTenantAction(svc, {
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      action: 'load.line_item_update',
      entityType: 'order',
      entityId: id,
      newValues: { name: data.name, amount: data.total_cents, charge_set_id: csId },
      ipAddress: getClientIp(req),
    });

    return res.status(200).json({ line_item: data });
  }

  if (req.method === 'DELETE') {
    if (
      !requirePermission(
        ctx,
        [PERMISSIONS.ORDER_ENTRY, PERMISSIONS.ACCOUNTS_RECEIVABLE, PERMISSIONS.ALL],
        res
      )
    )
      return;

    const { line_item_id } = req.query;
    if (!line_item_id) return res.status(400).json({ error: 'line_item_id required' });

    const { error } = await svc
      .from('order_charge_set_line_items')
      .delete()
      .eq('tenant_id', ctx.tenantId)
      .eq('charge_set_id', csId)
      .eq('id', line_item_id);

    if (error) return res.status(500).json({ error: error.message });
    await recomputeTotals(svc, ctx.tenantId, csId);

    await logTenantAction(svc, {
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      action: 'load.line_item_delete',
      entityType: 'order',
      entityId: id,
      newValues: { line_item_id, charge_set_id: csId },
      ipAddress: getClientIp(req),
    });

    return res.status(200).json({ success: true });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
