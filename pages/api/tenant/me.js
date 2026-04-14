import { requireTenantUser, getServiceClient } from '../../../lib/tenant-api';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const ctx = await requireTenantUser(req, res);
  if (!ctx) return;

  // Fetch tenant settings for branding (company name, logos)
  const svc = getServiceClient();
  let branding = {};
  try {
    const { data } = await svc
      .from('tenant_settings')
      .select('company_display_name, logo_small_url, logo_large_url')
      .eq('tenant_id', ctx.tenantId)
      .single();
    if (data) {
      branding = {
        companyName: data.company_display_name || null,
        logoSmall: data.logo_small_url || null,
        logoLarge: data.logo_large_url || null,
      };
    }
  } catch { /* ignore — settings might not exist yet */ }

  // Also get the tenant name as fallback
  try {
    const { data } = await svc
      .from('tenants')
      .select('name')
      .eq('id', ctx.tenantId)
      .single();
    if (data && !branding.companyName) {
      branding.companyName = data.name;
    }
    branding.tenantName = data?.name || null;
  } catch { /* ignore */ }

  // Fetch branch names for client display
  let branches = [];
  if (ctx.branchIds && ctx.branchIds.length > 0) {
    try {
      const { data } = await svc
        .from('branches')
        .select('id, name, code')
        .in('id', ctx.branchIds)
        .is('deleted_at', null);
      branches = data || [];
    } catch { /* ignore */ }
  }

  return res.status(200).json({
    id: ctx.userId,
    tenantId: ctx.tenantId,
    email: ctx.email,
    name: ctx.name,
    role: ctx.role,
    permissions: ctx.permissions,
    branchIds: ctx.branchIds || [],
    branches,
    branding,
  });
}
