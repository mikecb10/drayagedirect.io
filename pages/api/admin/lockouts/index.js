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

  const { data: lockouts, error } = await supabase
    .from('account_lockouts')
    .select('*')
    .gte('failed_attempts', 5)
    .not('locked_at', 'is', null)
    .order('locked_at', { ascending: false });

  if (error) return res.status(500).json({ error: error.message });

  // Enrich with tenant names
  const tenantIds = [...new Set((lockouts || []).filter((l) => l.tenant_id).map((l) => l.tenant_id))];
  let tenantMap = {};
  if (tenantIds.length > 0) {
    const { data: tenants } = await supabase
      .from('tenants')
      .select('id, name')
      .in('id', tenantIds);
    tenantMap = Object.fromEntries((tenants || []).map((t) => [t.id, t.name]));
  }

  const enriched = (lockouts || []).map((l) => ({
    ...l,
    tenant_name: l.tenant_id ? tenantMap[l.tenant_id] || 'Unknown' : '—',
  }));

  return res.status(200).json({ data: enriched });
}
