import { createClient } from '@supabase/supabase-js';
import { requireAdmin } from '../../../lib/admin-auth';

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
  const { action, tenant_id, page = 1, limit = 25 } = req.query;
  const offset = (page - 1) * limit;

  let query = supabase
    .from('admin_audit_log')
    .select('*', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (action) query = query.eq('action', action);
  if (tenant_id) query = query.eq('target_tenant_id', tenant_id);

  const { data, count, error } = await query;
  if (error) return res.status(500).json({ error: error.message });

  // Enrich with employee and tenant names
  const entries = data || [];
  const empIds = [...new Set(entries.map((e) => e.dd_employee_id))];
  const tenantIds = [...new Set(entries.filter((e) => e.target_tenant_id).map((e) => e.target_tenant_id))];

  const [empRes, tenantRes] = await Promise.all([
    empIds.length > 0
      ? supabase.from('dd_employees').select('id, name').in('id', empIds)
      : { data: [] },
    tenantIds.length > 0
      ? supabase.from('tenants').select('id, name').in('id', tenantIds)
      : { data: [] },
  ]);

  const empMap = Object.fromEntries((empRes.data || []).map((e) => [e.id, e.name]));
  const tenantMap = Object.fromEntries((tenantRes.data || []).map((t) => [t.id, t.name]));

  const enriched = entries.map((e) => ({
    ...e,
    admin_name: empMap[e.dd_employee_id] || 'Unknown',
    tenant_name: e.target_tenant_id ? tenantMap[e.target_tenant_id] || 'Unknown' : '—',
  }));

  return res.status(200).json({
    data: enriched,
    total: count || 0,
    page: Number(page),
    totalPages: Math.ceil((count || 0) / limit),
  });
}
