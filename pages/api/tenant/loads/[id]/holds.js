import {
  requireTenantUser,
  requirePermission,
  getServiceClient,
} from '../../../../../lib/tenant-api';
import { logTenantAction, getClientIp } from '../../../../../lib/tenant-audit';
import { PERMISSIONS } from '../../../../../lib/permissions';

const VALID_HOLD_TYPES = ['freight', 'custom', 'terminal', 'fees_storage', 'carrier', 'other'];
const VALID_STATUSES = ['hold', 'released'];

export default async function handler(req, res) {
  const ctx = await requireTenantUser(req, res);
  if (!ctx) return;

  const { id } = req.query;
  const svc = getServiceClient();

  if (req.method === 'GET') {
    if (
      !requirePermission(
        ctx,
        [PERMISSIONS.DISPATCHING, PERMISSIONS.ORDER_ENTRY, PERMISSIONS.ALL],
        res
      )
    )
      return;

    const { data, error } = await svc
      .from('order_holds')
      .select('*')
      .eq('tenant_id', ctx.tenantId)
      .eq('order_id', id);

    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ holds: data || [] });
  }

  if (req.method === 'PUT') {
    if (
      !requirePermission(
        ctx,
        [PERMISSIONS.DISPATCHING, PERMISSIONS.ORDER_ENTRY, PERMISSIONS.ALL],
        res
      )
    )
      return;

    const { hold_type, status, note } = req.body || {};
    if (!VALID_HOLD_TYPES.includes(hold_type)) {
      return res.status(400).json({ error: 'Invalid hold_type' });
    }
    if (!VALID_STATUSES.includes(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }

    // Upsert on unique (tenant_id, order_id, hold_type)
    const { data, error } = await svc
      .from('order_holds')
      .upsert(
        {
          tenant_id: ctx.tenantId,
          order_id: id,
          hold_type,
          status,
          note: note || null,
          updated_by: ctx.userId,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'tenant_id,order_id,hold_type' }
      )
      .select()
      .single();

    if (error) return res.status(500).json({ error: error.message });

    await logTenantAction(svc, {
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      action: 'load.hold_update',
      entityType: 'order',
      entityId: id,
      newValues: { hold_type, status, note },
      ipAddress: getClientIp(req),
    });

    return res.status(200).json({ hold: data });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
