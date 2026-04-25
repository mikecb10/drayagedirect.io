import {
  requireTenantUser,
  requirePermission,
  getServiceClient,
} from '../../../../../lib/tenant-api';
import { logTenantAction, getClientIp } from '../../../../../lib/tenant-audit';
import { PERMISSIONS } from '../../../../../lib/permissions';

/**
 * Bulk-dispatch a list of moves in the order provided.
 *
 * POST body: { moveIds: [uuid, ...] }
 *
 * Mirrors the single-move dispatch endpoint's per-move semantics — each
 * move is validated independently (must belong to tenant, must be
 * 'pending' or already 'dispatched', must have a driver_id), then its
 * status is set to 'dispatched' and one audit row is written per move
 * (matches the per-load audit pattern from bulk-update / bulk-notes).
 *
 * Failures on individual moves don't stop the loop — they're collected
 * into `failed: [{moveId, reason}, ...]` so the dispatcher can see which
 * subset slipped through (e.g. a move just got unassigned by another
 * dispatcher, or status flipped to in_progress between the planner load
 * and the bulk-dispatch click).
 *
 * Order: moveIds are dispatched in the order received. The planner UI
 * sends them in display order (drivers left-to-right, moves within each
 * driver in sort_order) so audit timestamps preserve the dispatcher's
 * intent.
 */

const ALLOWED_STATUS = new Set(['pending', 'dispatched']);

export default async function handler(req, res) {
  const ctx = await requireTenantUser(req, res);
  if (!ctx) return;

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!requirePermission(ctx, [PERMISSIONS.DISPATCHING, PERMISSIONS.ALL], res)) return;

  const { moveIds } = req.body || {};
  if (!Array.isArray(moveIds) || moveIds.length === 0) {
    return res.status(400).json({ error: 'moveIds must be a non-empty array' });
  }

  const svc = getServiceClient();
  const ip = getClientIp(req);
  const dispatched = [];
  const failed = [];

  for (const moveId of moveIds) {
    try {
      const { data: move, error: moveErr } = await svc
        .from('order_container_moves')
        .select('id, tenant_id, driver_id, status')
        .eq('id', moveId)
        .eq('tenant_id', ctx.tenantId)
        .maybeSingle();

      if (moveErr) throw new Error(moveErr.message);
      if (!move) throw new Error('Move not found');
      if (!ALLOWED_STATUS.has(move.status)) {
        throw new Error(`Cannot dispatch a move with status ${move.status}`);
      }
      if (move.driver_id == null) {
        throw new Error('Move must be assigned to a driver before dispatch');
      }

      const action = move.status === 'dispatched' ? 'redispatch' : 'dispatch';

      const { error: updErr } = await svc
        .from('order_container_moves')
        .update({ status: 'dispatched' })
        .eq('id', moveId)
        .eq('tenant_id', ctx.tenantId);

      if (updErr) throw new Error(updErr.message);

      await logTenantAction(svc, {
        tenantId: ctx.tenantId,
        userId: ctx.userId,
        action,
        entityType: 'order_container_move',
        entityId: moveId,
        oldValues: { status: move.status },
        newValues: {
          status: 'dispatched',
          driver_id: move.driver_id,
          bulk_count: moveIds.length,
        },
        ipAddress: ip,
      });

      dispatched.push({ moveId, action });
    } catch (err) {
      failed.push({ moveId, reason: err.message });
    }
  }

  return res.status(200).json({
    dispatched: dispatched.length,
    failed,
    requested: moveIds.length,
  });
}
