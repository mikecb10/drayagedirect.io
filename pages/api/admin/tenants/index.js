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

  if (!/^[a-zA-Z0-9._-]+$/.test(slug)) {
    return res.status(400).json({ error: 'Slug must contain only letters, digits, periods, underscores, or hyphens.' });
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

  // Auto-provision platform sender address + default email config.
  // Outcome captured in `senderProvisioning` so the audit trail records
  // whether the auto-provision succeeded or failed silently — otherwise
  // the only evidence of failure is a server-side console.error.
  let senderProvisioning;

  const { data: platformDomain } = await supabase
    .from('tenant_sender_domains')
    .select('id')
    .is('tenant_id', null)
    .maybeSingle();

  if (!platformDomain) {
    console.error('[tenant-create] Platform tenant_sender_domains row missing — skipping auto-provision');
    senderProvisioning = { status: 'skipped_no_platform_domain' };
  } else {
    const { data: newAddress, error: addrErr } = await supabase
      .from('tenant_sender_addresses')
      .insert({
        tenant_id:    tenant.id,
        local_part:   tenant.slug,
        display_name: tenant.name,
        domain_id:    platformDomain.id,
        is_default:   true,
      })
      .select('id')
      .single();

    if (addrErr) {
      console.error('[tenant-create] Sender address provisioning failed:', addrErr.message);
      senderProvisioning = { status: 'failed_address', error: addrErr.message };
    } else {
      const { error: configErr } = await supabase.from('email_configurations').insert({
        tenant_id:         tenant.id,
        name:              'Default (DrayageDirect Sender)',
        sender_address_id: newAddress.id,
        is_active:         true,
        is_default:        true,
        priority:          100,
      });

      if (configErr) {
        console.error('[tenant-create] Default config provisioning failed:', configErr.message);
        senderProvisioning = { status: 'failed_config', error: configErr.message };
      } else {
        senderProvisioning = { status: 'success', sender_address_id: newAddress.id };
      }
    }
  }

  // Audit log
  await logAdminAction(supabase, {
    employeeId: admin.id,
    action: 'tenant_created',
    targetTenantId: tenant.id,
    details: { name, slug, contact_email, sender_provisioning: senderProvisioning },
    ipAddress: getClientIp(req),
  });

  return res.status(201).json({ tenant });
}
