import { requireTenantUser, requirePermission, getServiceClient } from '../../../../../../lib/tenant-api';
import { logTenantAction, getClientIp } from '../../../../../../lib/tenant-audit';
import { PERMISSIONS } from '../../../../../../lib/permissions';

/**
 * /api/tenant/organizations/[id]/groups
 * GET  — list custom groups with members
 * POST — create a new group (fully custom name)
 */
export default async function handler(req, res) {
  const ctx = await requireTenantUser(req, res);
  if (!ctx) return;

  const { id } = req.query;
  const svc = getServiceClient();

  if (req.method === 'GET') {
    const { data: groups, error } = await svc
      .from('organization_groups')
      .select('*, members:organization_group_members(id, contact:organization_contacts(id, first_name, last_name, email, phone, title))')
      .eq('tenant_id', ctx.tenantId)
      .eq('organization_id', id)
      .order('name', { ascending: true });

    if (error) return res.status(500).json({ error: error.message });

    // Enrich with member count
    const enriched = (groups || []).map((g) => ({
      ...g,
      member_count: (g.members || []).length,
    }));

    return res.status(200).json({ groups: enriched });
  }

  if (req.method === 'POST') {
    if (!requirePermission(ctx, [PERMISSIONS.ORDER_ENTRY, PERMISSIONS.ALL], res)) return;

    const {
      name,
      description,
      member_ids,
      purpose,
      is_default_for_purpose,
    } = req.body || {};
    if (!name) return res.status(400).json({ error: 'Group name is required' });

    // Validate purpose if provided
    const validPurposes = ['billing', 'operations', 'dispatch', 'rate_confirmation', 'management', 'custom'];
    if (purpose && !validPurposes.includes(purpose)) {
      return res.status(400).json({ error: `Invalid purpose. Must be one of: ${validPurposes.join(', ')}` });
    }

    // If setting as default for a purpose, unset any existing default first
    // (partial unique index would reject otherwise; also keeps API behavior
    //  matching user intent)
    if (is_default_for_purpose && purpose) {
      const { error: swapErr } = await svc
        .from('organization_groups')
        .update({ is_default_for_purpose: false })
        .eq('tenant_id', ctx.tenantId)
        .eq('organization_id', id)
        .eq('purpose', purpose)
        .eq('is_default_for_purpose', true);
      if (swapErr) {
        return res.status(500).json({ error: `Default swap failed: ${swapErr.message}` });
      }
    }

    const { data: group, error } = await svc
      .from('organization_groups')
      .insert({
        tenant_id: ctx.tenantId,
        organization_id: id,
        name,
        description: description || null,
        purpose: purpose || null,
        is_default_for_purpose: !!is_default_for_purpose,
      })
      .select().single();

    if (error) return res.status(500).json({ error: error.message });

    // Add members if provided
    if (member_ids?.length > 0) {
      await svc.from('organization_group_members').insert(
        member_ids.map((cid) => ({ group_id: group.id, contact_id: cid }))
      );
    }

    await logTenantAction(svc, {
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      action: 'contact_group.create',
      entityType: 'contact_group',
      entityId: group.id,
      newValues: { name, organization_id: id, purpose, is_default_for_purpose },
      ipAddress: getClientIp(req),
      // actorType defaults to 'human' (human-initiated via UI)
    });

    return res.status(201).json({ group: { ...group, members: [], member_count: 0 } });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
