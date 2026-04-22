import {
  requireTenantUser,
  requirePermission,
  getServiceClient,
} from '../../../../../lib/tenant-api';
import { logTenantAction, getClientIp } from '../../../../../lib/tenant-audit';
import { PERMISSIONS } from '../../../../../lib/permissions';

const ALLOWED = new Set(['pending', 'dispatched']);

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
    .select('id, tenant_id, driver_id, status')
    .eq('id', moveId)
    .eq('tenant_id', ctx.tenantId)
    .maybeSingle();
  if (moveErr) return res.status(500).json({ error: moveErr.message });
  if (!move) return res.status(404).json({ error: 'Move not found' });
  if (!ALLOWED.has(move.status)) {
    return res.status(409).json({ error: `Cannot dispatch a move with status ${move.status}` });
  }
  if (move.driver_id == null) {
    return res.status(409).json({ error: 'Move must be assigned to a driver before dispatch' });
  }

  const action = move.status === 'dispatched' ? 'redispatch' : 'dispatch';

  const { error: updErr } = await svc
    .from('order_container_moves')
    .update({ status: 'dispatched' })
    .eq('id', moveId)
    .eq('tenant_id', ctx.tenantId);
  if (updErr) return res.status(500).json({ error: updErr.message });

  await logTenantAction(svc, {
    tenantId: ctx.tenantId,
    userId: ctx.userId,
    action,
    entityType: 'order_container_move',
    entityId: moveId,
    oldValues: { status: move.status },
    newValues: { status: 'dispatched', driver_id: move.driver_id },
    ipAddress: getClientIp(req),
  });

  return res.status(200).json({ moveId, status: 'dispatched', action });
}
