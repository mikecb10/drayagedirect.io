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
         line_items:order_charge_set_line_items(*)`
      )
      .eq('tenant_id', ctx.tenantId)
      .eq('order_id', id)
      .order('created_at', { ascending: true });

    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ charge_sets: data || [] });
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
