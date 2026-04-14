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

function generateTempPassword() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#$';
  let password = '';
  for (let i = 0; i < 12; i++) {
    password += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return password;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const admin = requireAdmin(req, res, ['super_admin', 'admin']);
  if (!admin) return;

  const { id: tenantId } = req.query;
  const { email, name, role = 'super_admin' } = req.body;

  if (!email || !name) {
    return res.status(400).json({ error: 'Email and name are required.' });
  }

  const supabase = getServiceClient();

  // Verify tenant exists
  const { data: tenant } = await supabase
    .from('tenants')
    .select('id, name')
    .eq('id', tenantId)
    .single();

  if (!tenant) return res.status(404).json({ error: 'Tenant not found.' });

  // Check if user already exists for this tenant
  const { data: existingUser } = await supabase
    .from('users')
    .select('id')
    .eq('tenant_id', tenantId)
    .eq('email', email.toLowerCase())
    .is('deleted_at', null)
    .single();

  if (existingUser) {
    return res.status(409).json({ error: 'A user with this email already exists for this tenant.' });
  }

  const tempPassword = generateTempPassword();

  try {
    // Create Supabase Auth user
    const { data: authUser, error: authError } = await supabase.auth.admin.createUser({
      email: email.toLowerCase(),
      password: tempPassword,
      email_confirm: true,
    });

    if (authError) {
      // If user already exists in auth, just get the existing one
      if (authError.message.includes('already been registered')) {
        const { data: { users } } = await supabase.auth.admin.listUsers();
        const existing = users.find((u) => u.email === email.toLowerCase());
        if (existing) {
          authUser = { user: existing };
        } else {
          return res.status(500).json({ error: authError.message });
        }
      } else {
        return res.status(500).json({ error: authError.message });
      }
    }

    const authUid = authUser.user.id;

    // Create users table record
    const { data: user, error: userError } = await supabase
      .from('users')
      .insert({
        tenant_id: tenantId,
        auth_uid: authUid,
        email: email.toLowerCase(),
        name,
        role,
        status: 'active',
        temp_password_flag: true,
        password_change_required: true,
      })
      .select()
      .single();

    if (userError) return res.status(500).json({ error: userError.message });

    // Set app_metadata on auth user
    await supabase.auth.admin.updateUserById(authUid, {
      app_metadata: {
        tenant_id: tenantId,
        role,
        user_id: user.id,
      },
    });

    // Audit log
    await logAdminAction(supabase, {
      employeeId: admin.id,
      action: 'user_created',
      targetTenantId: tenantId,
      targetUserId: user.id,
      details: { email, name, role, tenant_name: tenant.name },
      ipAddress: getClientIp(req),
    });

    return res.status(201).json({
      user,
      tempPassword,
    });
  } catch (err) {
    console.error('Create user error:', err);
    return res.status(500).json({ error: 'Failed to create user.' });
  }
}
