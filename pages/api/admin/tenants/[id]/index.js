import { createClient } from '@supabase/supabase-js';
import { requireAdmin } from '../../../../../lib/admin-auth';
import { logAdminAction, getClientIp } from '../../../../../lib/admin-audit';

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

  const { id } = req.query;
  const supabase = getServiceClient();

  const [tenantRes, usersRes, flagsRes, settingsRes] = await Promise.all([
    supabase
      .from('tenants')
      .select('*, subscription_tiers(id, name, display_name)')
      .eq('id', id)
      .single(),
    supabase
      .from('users')
      .select('id, email, name, role, status, last_login_at, created_at, password_change_required')
      .eq('tenant_id', id)
      .is('deleted_at', null)
      .order('created_at', { ascending: false }),
    supabase
      .from('tenant_feature_flags')
      .select('*, feature_flags(id, name, description, tier_required)')
      .eq('tenant_id', id),
    supabase
      .from('tenant_settings')
      .select('*')
      .eq('tenant_id', id)
      .single(),
  ]);

  if (tenantRes.error) return res.status(404).json({ error: 'Tenant not found' });

  return res.status(200).json({
    tenant: tenantRes.data,
    users: usersRes.data || [],
    featureFlags: flagsRes.data || [],
    settings: settingsRes.data,
  });
}

async function handlePut(req, res) {
  const admin = requireAdmin(req, res, ['super_admin', 'admin']);
  if (!admin) return;

  const { id } = req.query;
  const updates = req.body;
  const supabase = getServiceClient();

  // Handle suspension
  if (updates.status === 'suspended' && !updates.suspended_at) {
    updates.suspended_at = new Date().toISOString();
  }
  if (updates.status === 'active') {
    updates.suspended_at = null;
    updates.suspended_reason = null;
  }

  const { data, error } = await supabase
    .from('tenants')
    .update(updates)
    .eq('id', id)
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });

  await logAdminAction(supabase, {
    employeeId: admin.id,
    action: 'tenant_updated',
    targetTenantId: id,
    details: updates,
    ipAddress: getClientIp(req),
  });

  return res.status(200).json({ tenant: data });
}
