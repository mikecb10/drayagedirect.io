import { createClient } from '@supabase/supabase-js';
import { requireAdmin } from '../../../../lib/admin-auth';

function getServiceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const admin = requireAdmin(req, res);
  if (!admin) return;

  const supabase = getServiceClient();

  const [tenantsRes, lockedRes, auditRes] = await Promise.all([
    supabase
      .from('tenants')
      .select('status', { count: 'exact' })
      .is('deleted_at', null),
    supabase
      .from('account_lockouts')
      .select('id', { count: 'exact' })
      .gte('failed_attempts', 5)
      .not('locked_at', 'is', null),
    supabase
      .from('admin_audit_log')
      .select('id, action, created_at, dd_employee_id, target_tenant_id, details')
      .order('created_at', { ascending: false })
      .limit(10),
  ]);

  const tenants = tenantsRes.data || [];
  const totalTenants = tenantsRes.count || 0;
  const activeTenants = tenants.filter((t) => t.status === 'active').length;
  const suspendedTenants = tenants.filter((t) => t.status === 'suspended').length;
  const lockedAccounts = lockedRes.count || 0;

  // Enrich audit entries with employee names
  const auditEntries = auditRes.data || [];
  let enrichedAudit = auditEntries;
  if (auditEntries.length > 0) {
    const empIds = [...new Set(auditEntries.map((a) => a.dd_employee_id))];
    const { data: employees } = await supabase
      .from('dd_employees')
      .select('id, name')
      .in('id', empIds);

    const empMap = Object.fromEntries((employees || []).map((e) => [e.id, e.name]));
    enrichedAudit = auditEntries.map((a) => ({
      ...a,
      admin_name: empMap[a.dd_employee_id] || 'Unknown',
    }));
  }

  return res.status(200).json({
    totalTenants,
    activeTenants,
    suspendedTenants,
    lockedAccounts,
    recentActivity: enrichedAudit,
  });
}
