import {
  requireTenantUser,
  requirePermission,
  getServiceClient,
} from '../../../../../../lib/tenant-api';
import { logTenantAction, getClientIp } from '../../../../../../lib/tenant-audit';
import { PERMISSIONS } from '../../../../../../lib/permissions';

export default async function handler(req, res) {
  const ctx = await requireTenantUser(req, res);
  if (!ctx) return;

  const { id, noteId } = req.query;
  const svc = getServiceClient();

  if (req.method === 'PUT') {
    if (!requirePermission(ctx, [PERMISSIONS.ORDER_ENTRY, PERMISSIONS.ALL], res)) return;

    const { body } = req.body || {};
    if (!body || !body.trim()) {
      return res.status(400).json({ error: 'Note body is required' });
    }

    const { data, error } = await svc
      .from('order_notes')
      .update({ body: body.trim(), updated_at: new Date().toISOString() })
      .eq('tenant_id', ctx.tenantId)
      .eq('order_id', id)
      .eq('id', noteId)
      .select()
      .single();

    if (error) return res.status(500).json({ error: error.message });

    await logTenantAction(svc, {
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      action: 'load.note_update',
      entityType: 'order',
      entityId: id,
      newValues: { note_id: noteId, audience: data.audience, body: body.trim() },
      ipAddress: getClientIp(req),
    });

    return res.status(200).json({ note: data });
  }

  if (req.method === 'DELETE') {
    if (!requirePermission(ctx, [PERMISSIONS.ORDER_ENTRY, PERMISSIONS.ALL], res)) return;

    const { error } = await svc
      .from('order_notes')
      .delete()
      .eq('tenant_id', ctx.tenantId)
      .eq('order_id', id)
      .eq('id', noteId);

    if (error) return res.status(500).json({ error: error.message });

    await logTenantAction(svc, {
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      action: 'load.note_delete',
      entityType: 'order',
      entityId: id,
      newValues: { note_id: noteId },
      ipAddress: getClientIp(req),
    });

    return res.status(200).json({ success: true });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
