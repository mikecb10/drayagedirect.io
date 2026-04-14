import { createClient } from '@supabase/supabase-js';
import { getSupabaseServerClient } from './supabase-server';
import { hasPermission } from './permissions';

/**
 * Service-role Supabase client — bypasses RLS. Use on the server for
 * tenant API routes after explicit tenant_id filtering.
 */
export function getServiceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}

/**
 * Resolve the authenticated tenant user from the request.
 * Returns { userId, tenantId, role, permissions, email, name, authUid } on success.
 * Sends a 401/403 response and returns null on failure.
 *
 * Usage in an API route:
 *   const ctx = await requireTenantUser(req, res);
 *   if (!ctx) return;
 *   // ctx.tenantId is guaranteed
 */
export async function requireTenantUser(req, res) {
  try {
    // 1. Resolve the Supabase session from cookies
    const sessionClient = getSupabaseServerClient(req, res);
    const {
      data: { user: authUser },
      error: sessionError,
    } = await sessionClient.auth.getUser();

    if (sessionError || !authUser) {
      res.status(401).json({ error: 'Not authenticated' });
      return null;
    }

    // 2. Look up the tenant user record via auth_uid using service client
    const svc = getServiceClient();
    const { data: userRow, error: userError } = await svc
      .from('users')
      .select('id, tenant_id, email, name, role, status')
      .eq('auth_uid', authUser.id)
      .is('deleted_at', null)
      .single();

    if (userError || !userRow) {
      res.status(403).json({ error: 'User not provisioned for this tenant' });
      return null;
    }

    if (userRow.status !== 'active') {
      res.status(403).json({ error: 'Account disabled' });
      return null;
    }

    // 3. Fetch granted permissions
    const { data: permRows } = await svc
      .from('user_permissions')
      .select('permission_type')
      .eq('tenant_id', userRow.tenant_id)
      .eq('user_id', userRow.id);

    const permissions = (permRows || []).map((r) => r.permission_type);

    // 3.5 Fetch branch assignments
    const { data: branchRows } = await svc
      .from('user_branches')
      .select('branch_id')
      .eq('user_id', userRow.id);
    const branchIds = (branchRows || []).map((r) => r.branch_id);

    return {
      userId: userRow.id,
      tenantId: userRow.tenant_id,
      role: userRow.role,
      permissions,
      branchIds,
      email: userRow.email,
      name: userRow.name,
      authUid: authUser.id,
    };
  } catch (err) {
    console.error('requireTenantUser error:', err);
    res.status(500).json({ error: 'Internal server error' });
    return null;
  }
}

/**
 * Require that a tenant user context has one of the given permissions.
 * Sends a 403 response and returns false if not. Returns true on success.
 */
export function requirePermission(ctx, required, res) {
  if (hasPermission(ctx, required)) return true;
  res.status(403).json({ error: 'Insufficient permissions' });
  return false;
}
