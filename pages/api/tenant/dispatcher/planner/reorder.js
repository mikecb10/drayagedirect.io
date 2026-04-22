import {
  requireTenantUser,
  requirePermission,
  getServiceClient,
} from '../../../../../lib/tenant-api';
import { logTenantAction, getClientIp } from '../../../../../lib/tenant-audit';
import { PERMISSIONS } from '../../../../../lib/permissions';

export default async function handler(req, res) {
  const ctx = await requireTenantUser(req, res);
  if (!ctx) return;

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!requirePermission(ctx, [PERMISSIONS.DISPATCHING, PERMISSIONS.ALL], res)) return;

  const { driverId, date, orderedMoveIds } = req.body || {};
  if (!driverId || !date || !Array.isArray(orderedMoveIds) || orderedMoveIds.length === 0) {
    return res.status(400).json({ error: 'driverId, date, orderedMoveIds[] required' });
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return res.status(400).json({ error: 'date must be YYYY-MM-DD' });
  }

  const svc = getServiceClient();

  // Validate that every move belongs to this driver/date/tenant
  const { data: rows, error: rowsErr } = await svc
    .from('order_container_moves')
    .select('id, driver_id, scheduled_date')
    .in('id', orderedMoveIds)
    .eq('tenant_id', ctx.tenantId);
  if (rowsErr) return res.status(500).json({ error: rowsErr.message });

  const badRow = (rows || []).find(
    (r) => r.driver_id !== driverId || r.scheduled_date !== date
  );
  if (badRow) {
    return res
      .status(400)
      .json({ error: `Move ${badRow.id} does not belong to this driver/date` });
  }
  if ((rows || []).length !== orderedMoveIds.length) {
    return res.status(400).json({ error: 'One or more moves not found' });
  }

  // Completeness: ensure orderedMoveIds covers EVERY move on this driver+date,
  // not just the subset the caller provided. Otherwise un-supplied moves keep
  // their old sort_order and collide with the new dense sequence.
  const { count: totalOnRow, error: countErr } = await svc
    .from('order_container_moves')
    .select('id', { count: 'exact', head: true })
    .eq('tenant_id', ctx.tenantId)
    .eq('driver_id', driverId)
    .eq('scheduled_date', date);
  if (countErr) return res.status(500).json({ error: countErr.message });
  if ((totalOnRow ?? 0) !== orderedMoveIds.length) {
    return res.status(400).json({
      error: `orderedMoveIds must cover all ${totalOnRow} moves for this driver+date; got ${orderedMoveIds.length}`,
    });
  }

  // Dense resequence
  const results = await Promise.all(
    orderedMoveIds.map((id, idx) =>
      svc
        .from('order_container_moves')
        .update({ sort_order: idx })
        .eq('id', id)
        .eq('tenant_id', ctx.tenantId)
    )
  );
  const anyErr = results.find((r) => r.error);
  if (anyErr) return res.status(500).json({ error: anyErr.error.message });

  await logTenantAction(svc, {
    tenantId: ctx.tenantId,
    userId: ctx.userId,
    action: 'reorder',
    entityType: 'driver',
    entityId: driverId,
    oldValues: null,
    newValues: { driverId, date, orderedMoveIds },
    ipAddress: getClientIp(req),
  });

  return res.status(200).json({ ok: true, count: orderedMoveIds.length });
}
