import {
  requireTenantUser,
  requirePermission,
  getServiceClient,
} from '../../../../lib/tenant-api';
import { logTenantAction, getClientIp } from '../../../../lib/tenant-audit';
import { PERMISSIONS } from '../../../../lib/permissions';
import { setOverride } from '../../../../lib/tenant-reference-overrides';

const EDITABLE_FIELDS = [
  'name',
  'label',
  'scac_code',
  'contact_name',
  'phone',
  'email',
  'address_line1',
  'city',
  'state',
  'zip',
  'country',
  'website',
  'notes',
  'is_enabled',
];

export default async function handler(req, res) {
  const ctx = await requireTenantUser(req, res);
  if (!ctx) return;

  const { id } = req.query;
  const svc = getServiceClient();

  if (req.method === 'GET') {
    const { data, error } = await svc
      .from('container_owners')
      .select('*')
      .eq('id', id)
      .or(`is_system.eq.true,tenant_id.eq.${ctx.tenantId}`)
      .is('deleted_at', null)
      .maybeSingle();

    if (error || !data) return res.status(404).json({ error: 'Container owner not found' });
    return res.status(200).json({ container_owner: data });
  }

  if (req.method === 'PUT') {
    if (!requirePermission(ctx, [PERMISSIONS.SETTINGS, PERMISSIONS.ALL], res)) return;

    // Fetch existing row so we can check if it's system-owned
    const { data: existing } = await svc
      .from('container_owners')
      .select('*')
      .eq('id', id)
      .maybeSingle();

    if (!existing) return res.status(404).json({ error: 'Container owner not found' });

    // System rows: only allow toggling is_enabled via the override table.
    if (existing.is_system && existing.tenant_id === null) {
      if (req.body.is_enabled !== undefined) {
        await setOverride(
          svc,
          ctx.tenantId,
          'container_owners',
          id,
          !!req.body.is_enabled
        );

        await logTenantAction(svc, {
          tenantId: ctx.tenantId,
          userId: ctx.userId,
          action: 'container_owner.toggle',
          entityType: 'container_owner',
          entityId: id,
          newValues: { is_enabled: !!req.body.is_enabled },
          ipAddress: getClientIp(req),
        });

        return res.status(200).json({
          container_owner: { ...existing, effective_enabled: !!req.body.is_enabled },
        });
      }
      return res.status(403).json({
        error:
          'System container owners cannot be edited. You can toggle them on/off for your tenant.',
      });
    }

    if (existing.tenant_id !== ctx.tenantId) {
      return res.status(403).json({ error: 'Not authorized to edit this container owner' });
    }

    const updates = {};
    for (const f of EDITABLE_FIELDS) {
      if (req.body[f] !== undefined) updates[f] = req.body[f];
    }
    if (updates.scac_code) updates.scac_code = updates.scac_code.toUpperCase().trim();

    const { data, error } = await svc
      .from('container_owners')
      .update(updates)
      .eq('id', id)
      .select()
      .single();

    if (error) return res.status(500).json({ error: error.message });

    await logTenantAction(svc, {
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      action: 'container_owner.update',
      entityType: 'container_owner',
      entityId: id,
      oldValues: existing,
      newValues: data,
      ipAddress: getClientIp(req),
    });

    return res.status(200).json({ container_owner: data });
  }

  if (req.method === 'DELETE') {
    if (!requirePermission(ctx, [PERMISSIONS.SETTINGS, PERMISSIONS.ALL], res)) return;

    const { data: existing } = await svc
      .from('container_owners')
      .select('*')
      .eq('id', id)
      .maybeSingle();

    if (!existing) return res.status(404).json({ error: 'Container owner not found' });
    if (existing.is_system) {
      return res.status(403).json({ error: 'Cannot delete system container owners' });
    }
    if (existing.tenant_id !== ctx.tenantId) {
      return res.status(403).json({ error: 'Not authorized' });
    }

    const { error } = await svc
      .from('container_owners')
      .update({ deleted_at: new Date().toISOString(), is_enabled: false })
      .eq('id', id);

    if (error) return res.status(500).json({ error: error.message });

    await logTenantAction(svc, {
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      action: 'container_owner.delete',
      entityType: 'container_owner',
      entityId: id,
      ipAddress: getClientIp(req),
    });

    return res.status(200).json({ success: true });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
