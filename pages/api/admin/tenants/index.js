import { createClient } from '@supabase/supabase-js';
import { requireAdmin } from '../../../../lib/admin-auth';
import { logAdminAction, getClientIp } from '../../../../lib/admin-audit';

function getServiceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}

export default async function handler(req, res) {
  if (req.method === 'GET') return handleGet(req, res);
  if (req.method === 'POST') return handlePost(req, res);
  return res.status(405).json({ error: 'Method not allowed' });
}

async function handleGet(req, res) {
  const admin = requireAdmin(req, res);
  if (!admin) return;

  const supabase = getServiceClient();
  const { search, status, page = 1, limit = 20 } = req.query;
  const offset = (page - 1) * limit;

  let query = supabase
    .from('tenants')
    .select('*, subscription_tiers(name, display_name)', { count: 'exact' })
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (search) query = query.ilike('name', `%${search}%`);
  if (status) query = query.eq('status', status);

  const { data, count, error } = await query;
  if (error) return res.status(500).json({ error: error.message });

  return res.status(200).json({
    data: data || [],
    total: count || 0,
    page: Number(page),
    totalPages: Math.ceil((count || 0) / limit),
  });
}

async function handlePost(req, res) {
  const admin = requireAdmin(req, res, ['super_admin', 'admin']);
  if (!admin) return;

  const { name, slug, contact_email, subscription_tier_id, mc_number, dot_number } = req.body;

  if (!name || !slug || !contact_email || !subscription_tier_id) {
    return res.status(400).json({ error: 'Name, slug, contact email, and subscription tier are required.' });
  }

  const supabase = getServiceClient();

  // Check slug uniqueness
  const { data: existing } = await supabase
    .from('tenants')
    .select('id')
    .eq('slug', slug.toLowerCase())
    .single();

  if (existing) {
    return res.status(409).json({ error: 'A tenant with this slug already exists.' });
  }

  // Create tenant
  const { data: tenant, error: createError } = await supabase
    .from('tenants')
    .insert({
      name,
      slug: slug.toLowerCase(),
      contact_email,
      subscription_tier_id,
      mc_number: mc_number || null,
      dot_number: dot_number || null,
    })
    .select()
    .single();

  if (createError) return res.status(500).json({ error: createError.message });

  // Seed tenant defaults
  await supabase.rpc('seed_new_tenant', { p_tenant_id: tenant.id });

  // Audit log
  await logAdminAction(supabase, {
    employeeId: admin.id,
    action: 'tenant_created',
    targetTenantId: tenant.id,
    details: { name, slug, contact_email },
    ipAddress: getClientIp(req),
  });

  return res.status(201).json({ tenant });
}
