import { createClient } from '@supabase/supabase-js';
import { serialize } from 'cookie';
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
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const admin = requireAdmin(req, res, ['super_admin', 'admin']);
  if (!admin) return;

  const { id: tenantId } = req.query;
  const { user_id } = req.body;

  if (!user_id) return res.status(400).json({ error: 'user_id is required.' });

  const supabase = getServiceClient();

  // Get the user to impersonate
  const { data: user } = await supabase
    .from('users')
    .select('id, email, name, auth_uid, tenant_id')
    .eq('id', user_id)
    .eq('tenant_id', tenantId)
    .single();

  if (!user) return res.status(404).json({ error: 'User not found.' });

  // Generate magic link for the user
  const { data: linkData, error: linkError } = await supabase.auth.admin.generateLink({
    type: 'magiclink',
    email: user.email,
  });

  if (linkError) return res.status(500).json({ error: linkError.message });

  // Set impersonation cookie
  res.setHeader('Set-Cookie', serialize('dd_impersonation', JSON.stringify({
    adminId: admin.id,
    adminName: admin.name,
    adminEmail: admin.email,
    impersonatedUser: user.email,
    impersonatedName: user.name,
    returnUrl: `/admin/tenants/${tenantId}`,
  }), {
    httpOnly: false, // Readable by client for the banner
    sameSite: 'lax',
    path: '/',
    maxAge: 3600, // 1 hour
  }));

  // Audit log
  await logAdminAction(supabase, {
    employeeId: admin.id,
    action: 'impersonation_start',
    targetTenantId: tenantId,
    targetUserId: user_id,
    details: { impersonated_email: user.email, impersonated_name: user.name },
    ipAddress: getClientIp(req),
  });

  // Return the hashed token for client-side auth
  return res.status(200).json({
    token_hash: linkData.properties?.hashed_token,
    email: user.email,
  });
}
