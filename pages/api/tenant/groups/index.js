const MAX_BATCH = 100;

/**
 * Pure helper — batch-hydrate groups by id list. Returns rows for each
 * id that exists in the tenant with `member_count` derived. Missing ids
 * are silently omitted (UI handles dead-ref display).
 *
 * Kept free of top-level auth imports so it can be loaded by the unit
 * test runner (bare Node ESM) without pulling in the Next.js auth stack.
 *
 * @throws Error with statusCode=400 if ids is empty or over MAX_BATCH.
 */
export async function hydrateGroups(svc, ctx, ids) {
  if (!Array.isArray(ids) || ids.length === 0) {
    const e = new Error('ids is required');
    e.statusCode = 400;
    throw e;
  }
  if (ids.length > MAX_BATCH) {
    const e = new Error(`ids exceeds max batch size of ${MAX_BATCH}`);
    e.statusCode = 400;
    throw e;
  }

  const { data } = await svc
    .from('organization_groups')
    .select('id, name, organization_id, organization:customers(name), members:organization_group_members(count)')
    .eq('tenant_id', ctx.tenantId)
    .in('id', ids);

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
  // the pure hydrateGroups helper above remains testable under bare Node ESM.
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
  const idsParam = (req.query.ids || '').toString();
  const ids = idsParam.split(',').map((s) => s.trim()).filter(Boolean);

  try {
    const result = await hydrateGroups(svc, ctx, ids);
    return res.status(200).json(result);
  } catch (e) {
    return res.status(e.statusCode || 500).json({ error: e.message });
  }
}
