import { createClient } from '@supabase/supabase-js';
import { requireAdmin } from '../../../lib/admin-auth';
import { logAdminAction, getClientIp } from '../../../lib/admin-audit';

function getServiceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}

export default async function handler(req, res) {
  if (req.method === 'GET') return handleGet(req, res);
  if (req.method === 'PUT') return handlePut(req, res);
  return res.status(405).json({ error: 'Method not allowed' });
}

async function handleGet(req, res) {
  const admin = requireAdmin(req, res);
  if (!admin) return;

  const { tenant_id, user_id } = req.query;
  const supabase = getServiceClient();

  // Get all feature flags
  const { data: flags } = await supabase
    .from('feature_flags')
    .select('*')
    .eq('is_active', true)
    .order('name');

  if (!tenant_id) {
    // Return just the flag definitions + all tenants for dropdown
    const { data: tenants } = await supabase
      .from('tenants')
      .select('id, name')
      .is('deleted_at', null)
      .order('name');

    return res.status(200).json({ flags, tenants });
  }

  // Get tenant's tier
  const { data: tenant } = await supabase
    .from('tenants')
    .select('id, subscription_tier_id, subscription_tiers(name)')
    .eq('id', tenant_id)
    .single();

  if (!tenant) return res.status(404).json({ error: 'Tenant not found' });

  // Get overrides
  let overrideQuery = supabase
    .from('tenant_feature_flags')
    .select('*')
    .eq('tenant_id', tenant_id);

  if (user_id) {
    overrideQuery = overrideQuery.or(`user_id.is.null,user_id.eq.${user_id}`);
  } else {
    overrideQuery = overrideQuery.is('user_id', null);
  }

  const { data: overrides } = await overrideQuery;
  const overrideMap = {};
  (overrides || []).forEach((o) => {
    overrideMap[o.feature_flag_id] = o;
  });

  const tierName = tenant.subscription_tiers?.name;
  const tierOrder = { basic: 1, pro: 2, enterprise: 3 };
  const tenantTierLevel = tierOrder[tierName] || 0;

  // Get users for this tenant (for the user dropdown)
  const { data: users } = await supabase
    .from('users')
    .select('id, name, email')
    .eq('tenant_id', tenant_id)
    .is('deleted_at', null)
    .order('name');

  const resolvedFlags = (flags || []).map((flag) => {
    const flagTierLevel = tierOrder[flag.tier_required] || 0;
    const grantedByTier = flagTierLevel > 0 && tenantTierLevel >= flagTierLevel;
    const override = overrideMap[flag.id];

    let enabled = grantedByTier;
    let source = grantedByTier ? 'tier' : 'disabled';

    if (override) {
      enabled = override.enabled;
      source = override.enabled ? 'override' : 'disabled_override';
    }

    return {
      ...flag,
      enabled,
      source,
      granted_by_tier: grantedByTier,
      override_id: override?.id || null,
    };
  });

  return res.status(200).json({ flags: resolvedFlags, users: users || [] });
}

async function handlePut(req, res) {
  const admin = requireAdmin(req, res, ['super_admin', 'admin']);
  if (!admin) return;

  const { tenant_id, user_id, flags } = req.body;
  if (!tenant_id || !Array.isArray(flags)) {
    return res.status(400).json({ error: 'tenant_id and flags array are required.' });
  }

  const supabase = getServiceClient();

  for (const flag of flags) {
    const { feature_flag_id, enabled } = flag;

    // Upsert into tenant_feature_flags
    const { error } = await supabase
      .from('tenant_feature_flags')
      .upsert(
        {
          tenant_id,
          feature_flag_id,
          enabled,
          user_id: user_id || null,
        },
        { onConflict: 'tenant_id,feature_flag_id,user_id' }
      );

    if (error) console.error('Flag upsert error:', error.message);
  }

  await logAdminAction(supabase, {
    employeeId: admin.id,
    action: 'feature_flags_updated',
    targetTenantId: tenant_id,
    details: { flags_changed: flags.length, user_id: user_id || 'all' },
    ipAddress: getClientIp(req),
  });

  return res.status(200).json({ message: 'Feature flags updated.' });
}
