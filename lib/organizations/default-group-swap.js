/**
 * When setting a group as is_default_for_purpose=true, unset any other
 * group with the same (tenant, organization, purpose) that's currently
 * the default. Optionally exclude a specific group_id (used on PUT when
 * updating the group that's already the default — don't unset itself).
 *
 * Matches the partial unique index constraint on
 * organization_groups(tenant_id, organization_id, purpose)
 * WHERE is_default_for_purpose = true AND purpose IS NOT NULL.
 *
 * @param {SupabaseClient} svc service-role Supabase client
 * @param {{ tenantId: string, organizationId: string, purpose: string, excludeGroupId?: string }} params
 * @returns {Promise<{ error: Error | null }>}
 */
export async function swapDefaultGroup(svc, { tenantId, organizationId, purpose, excludeGroupId }) {
  if (!purpose) {
    return { error: new Error('swapDefaultGroup: purpose is required') };
  }
  let query = svc
    .from('organization_groups')
    .update({ is_default_for_purpose: false })
    .eq('tenant_id', tenantId)
    .eq('organization_id', organizationId)
    .eq('purpose', purpose)
    .eq('is_default_for_purpose', true);
  if (excludeGroupId) {
    query = query.neq('id', excludeGroupId);
  }
  const { error } = await query;
  return { error };
}
