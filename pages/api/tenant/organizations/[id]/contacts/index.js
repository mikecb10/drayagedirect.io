import { requireTenantUser, requirePermission, getServiceClient } from '../../../../../../lib/tenant-api';
import { PERMISSIONS } from '../../../../../../lib/permissions';

/**
 * /api/tenant/organizations/[id]/contacts
 * GET  — list contacts for this org (with their group memberships)
 * POST — create a new contact
 */
export default async function handler(req, res) {
  const ctx = await requireTenantUser(req, res);
  if (!ctx) return;

  const { id } = req.query;
  const svc = getServiceClient();

  if (req.method === 'GET') {
    const { data, error } = await svc
      .from('organization_contacts')
      .select('*, memberships:organization_group_members(group_id, group:organization_groups(id, name))')
      .eq('tenant_id', ctx.tenantId)
      .eq('organization_id', id)
      .order('is_primary', { ascending: false })
      .order('first_name', { ascending: true });

    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ contacts: data || [] });
  }

  if (req.method === 'POST') {
    if (!requirePermission(ctx, [PERMISSIONS.ORDER_ENTRY, PERMISSIONS.ALL], res)) return;

    const { first_name, last_name, email, phone, title, department, is_primary, notes } = req.body || {};
    if (!first_name) return res.status(400).json({ error: 'First name is required' });

    const { data, error } = await svc
      .from('organization_contacts')
      .insert({
        tenant_id: ctx.tenantId,
        organization_id: id,
        first_name, last_name: last_name || null,
        email: email || null, phone: phone || null,
        title: title || null, department: department || null,
        is_primary: is_primary || false, notes: notes || null,
      })
      .select()
      .single();

    if (error) return res.status(500).json({ error: error.message });
    return res.status(201).json({ contact: data });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
