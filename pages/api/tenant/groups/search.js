/**
 * Pure helper — search groups across the tenant by name. Returns up to
 * 25 rows with `organization_name` joined from `customers` and
 * `member_count` derived from `organization_group_members` aggregate.
 *
 * Kept free of top-level auth imports so it can be loaded by the unit
 * test runner (bare Node ESM) without pulling in the Next.js auth stack.
 *
 * @throws Error with statusCode=400 if q is empty/whitespace.
 */
export async function searchGroups(svc, ctx, q) {
  const trimmed = (q || '').trim();
  if (!trimmed) {
    const e = new Error('q is required');
    e.statusCode = 400;
    throw e;
  }
  const escaped = trimmed.replace(/[%_]/g, '\\$&');
  const pattern = `%${escaped}%`;

  const { data } = await svc
    .from('organization_groups')
    .select('id, name, organization_id, organization:customers(name), members:organization_group_members(count)')
    .eq('tenant_id', ctx.tenantId)
    .ilike('name', pattern)
    .order('name', { ascending: true })
    .limit(25);

  const groups = (data || []).map((r) => ({
    id: r.id,
    name: r.name,
    organization_id: r.organization_id,
    organization_name: r.organization?.name || null,
    member_count: r.members?.[0]?.count ?? 0,
  }));

  return { groups };
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  // Dynamic imports keep the module top-level free of Next.js/auth deps so
  // the pure searchGroups helper above remains testable under bare Node ESM.
  const { requireTenantUser, requirePermission, getServiceClient } =
    await import('../../../../lib/tenant-api.js');
  const { PERMISSIONS } = await import('../../../../lib/permissions.js');

  const PERMS = [
    PERMISSIONS.MANAGE_SYSTEM_EMAILS,
    PERMISSIONS.SETTINGS,
    PERMISSIONS.ALL,
  ];

  const ctx = await requireTenantUser(req, res);
  if (!ctx) return;
  if (!requirePermission(ctx, PERMS, res)) return;

  const svc = getServiceClient();
  try {
    const result = await searchGroups(svc, ctx, req.query.q);
    return res.status(200).json(result);
  } catch (e) {
    return res.status(e.statusCode || 500).json({ error: e.message });
  }
}
