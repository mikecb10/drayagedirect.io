import {
  requireTenantUser,
  requirePermission,
  getServiceClient,
} from '../../../../../lib/tenant-api';
import { logTenantAction, getClientIp } from '../../../../../lib/tenant-audit';
import { PERMISSIONS } from '../../../../../lib/permissions';

const BLOCKED_STATUSES = new Set(['in_progress', 'completed', 'cancelled']);

export default async function handler(req, res) {
  const ctx = await requireTenantUser(req, res);
  if (!ctx) return;

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!requirePermission(ctx, [PERMISSIONS.DISPATCHING, PERMISSIONS.ALL], res)) return;

  const { moveId, driverId, truckId = null, chassisId = null, date, insertAfterMoveId = null, positionIndex = null } = req.body || {};

  if (!moveId || !driverId || !date) {
    return res.status(400).json({ error: 'moveId, driverId, and date are required' });
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return res.status(400).json({ error: 'date must be YYYY-MM-DD' });
  }
  const hasAfter = insertAfterMoveId != null;
  const hasIndex = positionIndex != null;
  if (hasAfter === hasIndex) {
    return res.status(400).json({ error: 'Exactly one of insertAfterMoveId or positionIndex is required' });
  }

  const svc = getServiceClient();

  // Load the move; check tenant + status
  const { data: move, error: moveErr } = await svc
    .from('order_container_moves')
    .select('id, tenant_id, driver_id, status, scheduled_date, sort_order')
    .eq('id', moveId)
    .eq('tenant_id', ctx.tenantId)
    .maybeSingle();
  if (moveErr) return res.status(500).json({ error: moveErr.message });
  if (!move) return res.status(404).json({ error: 'Move not found' });
  if (BLOCKED_STATUSES.has(move.status)) {
    return res.status(409).json({ error: `Cannot assign a move with status ${move.status}` });
  }

  // Verify driver exists in this tenant
  const { data: driver, error: driverErr } = await svc
    .from('drivers')
    .select('id')
    .eq('id', driverId)
    .eq('tenant_id', ctx.tenantId)
    .is('deleted_at', null)
    .maybeSingle();
  if (driverErr) return res.status(500).json({ error: driverErr.message });
  if (!driver) return res.status(404).json({ error: 'Driver not found' });

  // Compute target sort_order based on current row
  const { data: rowMoves, error: rowErr } = await svc
    .from('order_container_moves')
    .select('id, sort_order')
    .eq('tenant_id', ctx.tenantId)
    .eq('driver_id', driverId)
    .eq('scheduled_date', date)
    .is('deleted_at', null)
    .order('sort_order', { ascending: true });
  if (rowErr) return res.status(500).json({ error: rowErr.message });

  // Build target order of IDs — excluding the incoming move (if it was already in this row)
  const currentIds = (rowMoves || []).map((r) => r.id).filter((id) => id !== moveId);
  let insertAt = 0;
  if (hasAfter) {
    const idx = currentIds.indexOf(insertAfterMoveId);
    insertAt = idx < 0 ? currentIds.length : idx + 1;
  } else {
    insertAt = Math.max(0, Math.min(positionIndex, currentIds.length));
  }
  const newOrder = [...currentIds.slice(0, insertAt), moveId, ...currentIds.slice(insertAt)];

  const prevStatus = move.status;
  const newStatus =
    move.status === 'unassigned' ? 'pending' : move.status; // preserve pending/dispatched

  // Transactional-ish update: in one pass update the moved row + dense-resequence everyone.
  // Supabase JS doesn't have multi-row transactions directly; do it as an upsert per row in a Promise.all.
  const updates = newOrder.map((id, idx) => {
    const fields = { sort_order: idx };
    if (id === moveId) {
      Object.assign(fields, {
        driver_id: driverId,
        truck_id: truckId,
        chassis_id: chassisId,
        scheduled_date: date,
        status: newStatus,
        assigned_at: new Date().toISOString(),
      });
    }
    return svc
      .from('order_container_moves')
      .update(fields)
      .eq('id', id)
      .eq('tenant_id', ctx.tenantId);
  });
  const results = await Promise.all(updates);
  const anyErr = results.find((r) => r.error);
  if (anyErr) return res.status(500).json({ error: anyErr.error.message });

  await logTenantAction(svc, {
    tenantId: ctx.tenantId,
    userId: ctx.userId,
    action: 'assign',
    entityType: 'order_container_move',
    entityId: moveId,
    oldValues: { driver_id: move.driver_id, status: prevStatus, scheduled_date: move.scheduled_date, sort_order: move.sort_order },
    newValues: { driver_id: driverId, truck_id: truckId, chassis_id: chassisId, scheduled_date: date, status: newStatus, insertAfterMoveId, positionIndex },
    ipAddress: getClientIp(req),
  });

  // Return the updated move (fresh read)
  const { data: updated } = await svc
    .from('order_container_moves')
    .select('id, driver_id, truck_id, chassis_id, scheduled_date, sort_order, status, assigned_at')
    .eq('id', moveId)
    .maybeSingle();

  return res.status(200).json({ move: updated });
}
