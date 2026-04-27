/**
 * Pure helper — search contacts across the tenant by name or email.
 * Returns up to 25 rows with `organization_name` joined from `customers`.
 *
 * Kept free of top-level auth imports so it can be loaded by the unit
 * test runner (bare Node ESM) without pulling in the Next.js auth stack.
 *
 * @throws Error with statusCode=400 if q is empty/whitespace.
 */
export async function searchContacts(svc, ctx, q) {
  const trimmed = (q || '').trim();
  if (!trimmed) {
    const e = new Error('q is required');
    e.statusCode = 400;
    throw e;
  }
  // Escape SQL wildcards (% and _) AND PostgREST .or() delimiters (, ( ))
  const escaped = trimmed.replace(/[%_]/g, '\\$&').replace(/[,()]/g, ' ');
  const pattern = `%${escaped}%`;

  // Use Postgres OR across first_name, last_name, email
  const { data } = await svc
    .from('organization_contacts')
    .select('id, first_name, last_name, email, organization_id, organization:customers(name)')
    .eq('tenant_id', ctx.tenantId)
    .or(`first_name.ilike.${pattern},last_name.ilike.${pattern},email.ilike.${pattern}`)
    .order('last_name', { ascending: true, nullsFirst: false })
    .limit(25);

  const contacts = (data || []).map((r) => ({
    id: r.id,
    first_name: r.first_name,
    last_name: r.last_name,
    email: r.email,
    organization_id: r.organization_id,
    organization_name: r.organization?.name || null,
  }));

  return { contacts };
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  // Dynamic imports keep the module top-level free of Next.js/auth deps so
  // the pure searchContacts helper above remains testable under bare Node ESM.
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
    const result = await searchContacts(svc, ctx, req.query.q);
    return res.status(200).json(result);
  } catch (e) {
    return res.status(e.statusCode || 500).json({ error: e.message });
  }
}
