import {
  requireTenantUser,
  getServiceClient,
} from '../../../lib/tenant-api';

/**
 * /api/tenant/charge-profile-tags
 *
 * GET  — list all tenant-global charge profile tags (for autocomplete)
 * POST — create a new tag
 */
export default async function handler(req, res) {
  const ctx = await requireTenantUser(req, res);
  if (!ctx) return;

  const svc = getServiceClient();

  if (req.method === 'GET') {
    const { data, error } = await svc
      .from('charge_profile_tags')
      .select('*')
      .eq('tenant_id', ctx.tenantId)
      .order('name', { ascending: true });

    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ tags: data || [] });
  }

  if (req.method === 'POST') {
    const { name } = req.body || {};
    if (!name?.trim()) return res.status(400).json({ error: 'Tag name is required' });

    const { data, error } = await svc
      .from('charge_profile_tags')
      .upsert(
        { tenant_id: ctx.tenantId, name: name.trim() },
        { onConflict: 'tenant_id,name' }
      )
      .select()
      .single();

    if (error) return res.status(500).json({ error: error.message });
    return res.status(201).json({ tag: data });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
