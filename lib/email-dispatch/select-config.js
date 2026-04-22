// lib/email-dispatch/select-config.js
/**
 * Select the active email_configuration for a send.
 *
 * Prefers a configuration scoped to the load's branch; falls back to the
 * tenant-default (branch_id IS NULL) when no branch match or when the load
 * has no branch_id.
 *
 * @param svc          service-role Supabase client
 * @param tenantId     UUID of the tenant
 * @param loadBranchId UUID of the load's branch, or null if unbranched
 * @returns { id, branch_id, priority } | null
 */
export async function selectActiveConfig(svc, tenantId, loadBranchId) {
  const { data, error } = await svc
    .from('email_configurations')
    .select('id, branch_id, priority')
    .eq('tenant_id', tenantId)
    .eq('is_active', true)
    .order('priority', { ascending: true });

  if (error) throw new Error(`selectActiveConfig failed: ${error.message}`);
  if (!data || data.length === 0) return null;

  // Prefer branch match when load has a branch. Configs are already sorted
  // by priority ASC, so find() picks the highest-priority match.
  if (loadBranchId) {
    const branchMatch = data.find((r) => r.branch_id === loadBranchId);
    if (branchMatch) return branchMatch;
  }

  // Fall back to the highest-priority tenant-default (branch_id IS NULL),
  // or the first config if none are marked branch_id=null.
  return data.find((r) => r.branch_id === null) || data[0];
}
