import { requireTenantUser, requirePermission, getServiceClient } from '../../../../../../../lib/tenant-api';
import { PERMISSIONS } from '../../../../../../../lib/permissions';

/**
 * /api/tenant/organizations/[id]/groups/[groupId]/members
 * POST   — add a contact to the group
 * DELETE — remove a contact (pass member_id as query param)
 */
export default async function handler(req, res) {
  const ctx = await requireTenantUser(req, res);
  if (!ctx) return;
  if (!requirePermission(ctx, [PERMISSIONS.ORDER_ENTRY, PERMISSIONS.ALL], res)) return;

  const { groupId } = req.query;
  const svc = getServiceClient();

  if (req.method === 'POST') {
    const { contact_id } = req.body || {};
    if (!contact_id) return res.status(400).json({ error: 'contact_id required' });

    const { data, error } = await svc
      .from('organization_group_members')
      .insert({ group_id: groupId, contact_id })
      .select().single();

    if (error) {
      if (error.code === '23505') return res.status(409).json({ error: 'Already in group' });
      return res.status(500).json({ error: error.message });
    }
    return res.status(201).json({ member: data });
  }

  if (req.method === 'DELETE') {
    const { member_id } = req.query;
    if (!member_id) return res.status(400).json({ error: 'member_id required' });

    const { error } = await svc.from('organization_group_members').delete().eq('id', member_id);
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ success: true });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
