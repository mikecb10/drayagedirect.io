/**
 * Branch filtering helpers.
 *
 * Branches are a secondary scoping layer within a tenant.
 * Admins and super_admins bypass branch filtering entirely.
 * Users with no branch assignments also bypass (backwards compat).
 * Users WITH branches see: their branch data + unassigned (null) data.
 */

/**
 * Returns true if the user should have branch filtering applied.
 * Admins, super_admins, and users with no branch assignments skip filtering.
 */
export function shouldFilterByBranch(ctx) {
  if (!ctx) return false;
  if (ctx.role === 'super_admin' || ctx.role === 'admin') return false;
  if (!ctx.branchIds || ctx.branchIds.length === 0) return false;
  return true;
}

/**
 * Apply branch filtering to a Supabase query.
 * Shows entities belonging to the user's branches + unassigned entities (null branch_id).
 *
 * @param {object} query - Supabase query builder
 * @param {object} ctx - User context from requireTenantUser (must have branchIds)
 * @param {string} col - Column name to filter on (default: 'branch_id')
 * @returns {object} The (possibly filtered) query
 */
export function applyBranchFilter(query, ctx, col = 'branch_id') {
  if (!shouldFilterByBranch(ctx)) return query;
  // Show user's branch data + unassigned (null) entities
  return query.or(`${col}.is.null,${col}.in.(${ctx.branchIds.join(',')})`);
}

/**
 * For many-to-many entities (customers), get the list of entity IDs
 * visible to the user's branches from a junction table.
 *
 * @param {object} svc - Supabase service client
 * @param {object} ctx - User context
 * @param {string} junctionTable - e.g. 'customer_branches'
 * @param {string} entityIdCol - e.g. 'customer_id'
 * @returns {string[]|null} Array of visible entity IDs, or null if no filtering needed
 */
export async function getVisibleEntityIds(svc, ctx, junctionTable, entityIdCol) {
  if (!shouldFilterByBranch(ctx)) return null; // null = no filtering, show all

  const { data } = await svc
    .from(junctionTable)
    .select(entityIdCol)
    .eq('tenant_id', ctx.tenantId)
    .in('branch_id', ctx.branchIds);

  return (data || []).map((r) => r[entityIdCol]);
}
