import { requireTenantUser, getServiceClient } from '../../../../lib/tenant-api';

/**
 * GET /api/tenant/settings/company-colors
 *
 * Returns the tenant-level dispatcher colors (set by the super admin).
 * Non-admin users can call this to copy the admin's color preferences.
 */
export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const ctx = await requireTenantUser(req, res);
  if (!ctx) return;

  const svc = getServiceClient();

  const { data, error } = await svc
    .from('tenant_settings')
    .select('state_colors, load_type_colors')
    .eq('tenant_id', ctx.tenantId)
    .single();

  if (error) return res.status(500).json({ error: error.message });

  return res.status(200).json({
    state_colors: data?.state_colors || {},
    load_type_colors: data?.load_type_colors || {},
  });
}
