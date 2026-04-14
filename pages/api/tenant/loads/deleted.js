import {
  requireTenantUser,
  requirePermission,
  getServiceClient,
} from '../../../../lib/tenant-api';
import { logTenantAction, getClientIp } from '../../../../lib/tenant-audit';
import { PERMISSIONS } from '../../../../lib/permissions';

/**
 * /api/tenant/loads/deleted
 *
 * GET  — list all soft-deleted loads
 * PUT  — restore a deleted load (set deleted_at = null, status = pending)
 */
export default async function handler(req, res) {
  const ctx = await requireTenantUser(req, res);
  if (!ctx) return;

  if (!requirePermission(ctx, [PERMISSIONS.ORDER_ENTRY, PERMISSIONS.ALL], res)) return;

  const svc = getServiceClient();

  if (req.method === 'GET') {
    const { data, error } = await svc
      .from('orders')
      .select(`
        id, order_number, load_type, status, container_number, deleted_at,
        customer:customers!orders_customer_id_fkey(id, name),
        pickup_org:customers!orders_pickup_location_id_fkey(id, name),
        delivery_org:customers!orders_delivery_location_id_fkey(id, name)
      `)
      .eq('tenant_id', ctx.tenantId)
      .not('deleted_at', 'is', null)
      .order('deleted_at', { ascending: false });

    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ loads: data || [] });
  }

  if (req.method === 'PUT') {
    const { load_id } = req.body || {};
    if (!load_id) return res.status(400).json({ error: 'load_id required' });

    const { data, error } = await svc
      .from('orders')
      .update({ deleted_at: null, status: 'pending' })
      .eq('tenant_id', ctx.tenantId)
      .eq('id', load_id)
      .select()
      .single();

    if (error) return res.status(500).json({ error: error.message });

    await logTenantAction(svc, {
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      action: 'load.restore',
      entityType: 'order',
      entityId: load_id,
      ipAddress: getClientIp(req),
    });

    return res.status(200).json({ load: data });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
