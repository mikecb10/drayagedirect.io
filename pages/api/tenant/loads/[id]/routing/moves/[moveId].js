import {
  requireTenantUser,
  requirePermission,
  getServiceClient,
} from '../../../../../../../lib/tenant-api';
import { logTenantAction, getClientIp } from '../../../../../../../lib/tenant-audit';
import { PERMISSIONS } from '../../../../../../../lib/permissions';

const EDITABLE_FIELDS = [
  'driver_id',
  'truck_id',
  'chassis_id',
  'status',
  'move_type',
  'sequence',
  'started_at',
  'completed_at',
];

/**
 * /api/tenant/loads/[id]/routing/moves/[moveId]
 *
 * PUT    — partial update of a container move (driver, status, timestamps, ...)
 * DELETE — hard delete (FK cascades to child events)
 *
 * When a move's driver_id is updated AND it's the first (sequence=0) move on
 * the load, the parent order's driver_id is mirrored so the dispatcher board
 * still reflects "who is on this load" at the row level.
 */
export default async function handler(req, res) {
  const ctx = await requireTenantUser(req, res);
  if (!ctx) return;

  if (
    !requirePermission(
      ctx,
      [PERMISSIONS.DISPATCHING, PERMISSIONS.ORDER_ENTRY, PERMISSIONS.ALL],
      res
    )
  )
    return;

  const { id, moveId } = req.query;
  const svc = getServiceClient();

  if (req.method === 'PUT') {
    const patch = {};
    for (const k of EDITABLE_FIELDS) {
      if (req.body[k] !== undefined) patch[k] = req.body[k];
    }

    const { data: move, error } = await svc
      .from('order_container_moves')
      .update(patch)
      .eq('tenant_id', ctx.tenantId)
      .eq('order_id', id)
      .eq('id', moveId)
      .select('*, driver:drivers(id, name)')
      .single();

    if (error) return res.status(500).json({ error: error.message });

    // If this is the first move and the driver changed, mirror to order
    if ('driver_id' in patch && move.sequence === 0) {
      await svc
        .from('orders')
        .update({ driver_id: patch.driver_id })
        .eq('tenant_id', ctx.tenantId)
        .eq('id', id)
        .is('deleted_at', null);
    }

    await logTenantAction(svc, {
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      action: 'load.move_update',
      entityType: 'order',
      entityId: id,
      newValues: patch,
      ipAddress: getClientIp(req),
    });

    return res.status(200).json({ move });
  }

  if (req.method === 'DELETE') {
    const { error } = await svc
      .from('order_container_moves')
      .delete()
      .eq('tenant_id', ctx.tenantId)
      .eq('order_id', id)
      .eq('id', moveId);

    if (error) return res.status(500).json({ error: error.message });

    await logTenantAction(svc, {
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      action: 'load.move_delete',
      entityType: 'order',
      entityId: id,
      ipAddress: getClientIp(req),
    });

    return res.status(200).json({ success: true });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
