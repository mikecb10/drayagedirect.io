import { requireTenantUser, requirePermission, getServiceClient } from '../../../../../../../lib/tenant-api';
import { logTenantAction, getClientIp } from '../../../../../../../lib/tenant-audit';
import { PERMISSIONS } from '../../../../../../../lib/permissions';
import { swapDefaultGroup } from '../../../../../../../lib/organizations/default-group-swap.js';

export default async function handler(req, res) {
  const ctx = await requireTenantUser(req, res);
  if (!ctx) return;
  if (!requirePermission(ctx, [PERMISSIONS.ORDER_ENTRY, PERMISSIONS.ALL], res)) return;

  const { id, groupId } = req.query;
  const svc = getServiceClient();

  if (req.method === 'PUT') {
    const {
      name,
      description,
      purpose,
      is_default_for_purpose,
    } = req.body || {};

    const validPurposes = ['billing', 'operations', 'dispatch', 'rate_confirmation', 'management', 'custom'];
    if (purpose !== undefined && purpose !== null && !validPurposes.includes(purpose)) {
      return res.status(400).json({ error: `Invalid purpose. Must be one of: ${validPurposes.join(', ')}` });
    }

    // Swap logic: if setting default, unset any OTHER group with same purpose as default
    if (is_default_for_purpose && purpose) {
      const { error: swapErr } = await swapDefaultGroup(svc, {
        tenantId: ctx.tenantId,
        organizationId: id,
        purpose,
        excludeGroupId: groupId,
      });
      if (swapErr) {
        return res.status(500).json({ error: `Default swap failed: ${swapErr.message}` });
      }
    }

    const updates = {};
    if (name !== undefined) updates.name = name;
    if (description !== undefined) updates.description = description;
    if (purpose !== undefined) updates.purpose = purpose || null;
    if (is_default_for_purpose !== undefined) updates.is_default_for_purpose = !!is_default_for_purpose;
    updates.updated_at = new Date().toISOString();

    const { data, error } = await svc.from('organization_groups').update(updates)
      .eq('tenant_id', ctx.tenantId).eq('organization_id', id).eq('id', groupId).select().single();
    if (error) return res.status(500).json({ error: error.message });

    await logTenantAction(svc, {
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      action: 'contact_group.update',
      entityType: 'contact_group',
      entityId: groupId,
      newValues: updates,
      ipAddress: getClientIp(req),
    });

    return res.status(200).json({ group: data });
  }

  if (req.method === 'DELETE') {
    const { error } = await svc.from('organization_groups').delete()
      .eq('tenant_id', ctx.tenantId).eq('organization_id', id).eq('id', groupId);
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ success: true });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
