import {
  requireTenantUser,
  requirePermission,
  getServiceClient,
} from '../../../../../lib/tenant-api';
import { logTenantAction, getClientIp } from '../../../../../lib/tenant-audit';
import { PERMISSIONS } from '../../../../../lib/permissions';
import { syncLoadDriverFromMoves } from '../../../../../lib/dispatcher/sync-load-driver';

const BLOCKED_STATUSES = new Set(['in_progress', 'completed', 'cancelled']);

export default async function handler(req, res) {
  const ctx = await requireTenantUser(req, res);
  if (!ctx) return;

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!requirePermission(ctx, [PERMISSIONS.DISPATCHING, PERMISSIONS.ALL], res)) return;

  const { moveId } = req.body || {};
  if (!moveId) return res.status(400).json({ error: 'moveId required' });

  const svc = getServiceClient();

  const { data: move, error: moveErr } = await svc
    .from('order_container_moves')
    .select('id, tenant_id, order_id, driver_id, scheduled_date, sort_order, status')
    .eq('id', moveId)
    .eq('tenant_id', ctx.tenantId)
    .maybeSingle();
  if (moveErr) return res.status(500).json({ error: moveErr.message });
  if (!move) return res.status(404).json({ error: 'Move not found' });

  if (BLOCKED_STATUSES.has(move.status)) {
    return res.status(409).json({ error: `Cannot unassign a move with status ${move.status}` });
  }

  // Idempotent no-op if already unassigned
  if (move.status === 'unassigned' || move.driver_id == null) {
    return res.status(200).json({ move });
  }

  const prevDriverId = move.driver_id;
  const prevDate = move.scheduled_date;

  const { error: updErr } = await svc
    .from('order_container_moves')
    .update({
      driver_id: null,
      truck_id: null,
      chassis_id: null,
      scheduled_date: null,
      sort_order: null,
      assigned_at: null,
      status: 'unassigned',
    })
    .eq('id', moveId)
    .eq('tenant_id', ctx.tenantId);
  if (updErr) return res.status(500).json({ error: updErr.message });

  // Dense-resequence the prior row
  if (prevDriverId && prevDate) {
    const { data: rowMoves } = await svc
      .from('order_container_moves')
      .select('id')
      .eq('tenant_id', ctx.tenantId)
      .eq('driver_id', prevDriverId)
      .eq('scheduled_date', prevDate)
      .order('sort_order', { ascending: true });

    const priorResults = await Promise.all(
      (rowMoves || []).map((r, idx) =>
        svc
          .from('order_container_moves')
          .update({ sort_order: idx })
          .eq('id', r.id)
          .eq('tenant_id', ctx.tenantId)
      )
    );
    const priorErr = priorResults.find((r) => r.error);
    if (priorErr) return res.status(500).json({ error: priorErr.error.message });
  }

  // Mirror the unassignment to orders.driver_id (load-level). If this was
  // the last assigned move on the load, orders.driver_id will clear.
  // Wrapped in try/catch — a sync failure must NOT break the unassignment.
  try {
    await syncLoadDriverFromMoves(svc, move.order_id, ctx.tenantId);
  } catch (e) {
    console.error('[planner/unassign] syncLoadDriverFromMoves failed:', e?.message);
  }

  await logTenantAction(svc, {
    tenantId: ctx.tenantId,
    userId: ctx.userId,
    action: 'unassign',
    entityType: 'order_container_move',
    entityId: moveId,
    oldValues: { driver_id: prevDriverId, scheduled_date: prevDate, status: move.status, sort_order: move.sort_order },
    newValues: { driver_id: null, scheduled_date: null, status: 'unassigned', sort_order: null },
    ipAddress: getClientIp(req),
  });

  const { data: updated } = await svc
    .from('order_container_moves')
    .select('id, driver_id, truck_id, chassis_id, scheduled_date, sort_order, status')
    .eq('id', moveId)
    .maybeSingle();

  return res.status(200).json({ move: updated });
}
