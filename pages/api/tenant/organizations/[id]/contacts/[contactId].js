import {
  requireTenantUser,
  requirePermission,
  getServiceClient,
} from '../../../../../../lib/tenant-api';
import { logTenantAction, getClientIp } from '../../../../../../lib/tenant-audit';
import { PERMISSIONS } from '../../../../../../lib/permissions';

const EDITABLE = ['name', 'email', 'phone', 'role', 'is_primary', 'notes'];

export default async function handler(req, res) {
  const ctx = await requireTenantUser(req, res);
  if (!ctx) return;

  const { id, contactId } = req.query;
  const svc = getServiceClient();

  if (req.method === 'PUT') {
    if (!requirePermission(ctx, [PERMISSIONS.ORDER_ENTRY, PERMISSIONS.ALL], res)) return;

    const updates = {};
    for (const f of EDITABLE) {
      if (req.body[f] !== undefined) updates[f] = req.body[f];
    }

    const { data, error } = await svc
      .from('customer_contacts')
      .update(updates)
      .eq('tenant_id', ctx.tenantId)
      .eq('customer_id', id)
      .eq('id', contactId)
      .select()
      .single();

    if (error) return res.status(500).json({ error: error.message });

    await logTenantAction(svc, {
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      action: 'contact.update',
      entityType: 'contact',
      entityId: contactId,
      newValues: updates,
      ipAddress: getClientIp(req),
    });

    return res.status(200).json({ contact: data });
  }

  if (req.method === 'DELETE') {
    if (!requirePermission(ctx, [PERMISSIONS.ORDER_ENTRY, PERMISSIONS.ALL], res)) return;

    const { error } = await svc
      .from('customer_contacts')
      .delete()
      .eq('tenant_id', ctx.tenantId)
      .eq('customer_id', id)
      .eq('id', contactId);

    if (error) return res.status(500).json({ error: error.message });

    await logTenantAction(svc, {
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      action: 'contact.delete',
      entityType: 'contact',
      entityId: contactId,
      ipAddress: getClientIp(req),
    });

    return res.status(200).json({ success: true });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
