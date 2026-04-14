import { requireTenantUser, requirePermission, getServiceClient } from '../../../../lib/tenant-api';
import { logTenantAction, getClientIp } from '../../../../lib/tenant-audit';
import { PERMISSIONS } from '../../../../lib/permissions';

function generateTempPassword() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  let pwd = '';
  for (let i = 0; i < 12; i++) {
    pwd += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return pwd + '!' + Math.floor(Math.random() * 100);
}

export default async function handler(req, res) {
  const ctx = await requireTenantUser(req, res);
  if (!ctx) return;

  const svc = getServiceClient();

  if (req.method === 'GET') {
    const { data: users, error } = await svc
      .from('users')
      .select('id, email, name, first_name, last_name, phone, role, system_role, granular_permissions, status, hire_date, last_login_at, password_change_required, created_at')
      .eq('tenant_id', ctx.tenantId)
      .is('deleted_at', null)
      .order('created_at', { ascending: false });

    if (error) return res.status(500).json({ error: error.message });

    // Attach legacy permission counts
    const { data: allPerms } = await svc
      .from('user_permissions')
      .select('user_id, permission_type')
      .eq('tenant_id', ctx.tenantId);

    const permsByUser = {};
    for (const p of allPerms || []) {
      if (!permsByUser[p.user_id]) permsByUser[p.user_id] = [];
      permsByUser[p.user_id].push(p.permission_type);
    }

    const enriched = users.map((u) => ({
      ...u,
      permissions: permsByUser[u.id] || [],
    }));

    return res.status(200).json({ users: enriched });
  }

  if (req.method === 'POST') {
    if (!requirePermission(ctx, [PERMISSIONS.SETTINGS, PERMISSIONS.ALL], res)) return;

    const {
      email, name, first_name, last_name, phone, hire_date,
      role, system_role, granular_permissions, permissions = [], password,
    } = req.body;

    const displayName = name || `${first_name || ''} ${last_name || ''}`.trim();
    if (!email || !displayName) {
      return res.status(400).json({ error: 'Email and name are required' });
    }

    const normalizedEmail = String(email).toLowerCase().trim();

    // Map system_role to legacy role enum
    const legacyRole = (system_role === 'super_admin' || system_role === 'admin')
      ? system_role === 'super_admin' ? 'super_admin' : 'admin'
      : 'user';

    // Check email not already in use
    const { data: existing } = await svc
      .from('users')
      .select('id')
      .eq('tenant_id', ctx.tenantId)
      .eq('email', normalizedEmail)
      .is('deleted_at', null)
      .maybeSingle();

    if (existing) {
      return res.status(409).json({ error: 'A user with this email already exists' });
    }

    // Use provided password or generate temp
    const userPassword = password || generateTempPassword();
    const isTempPassword = !password;

    // Create Supabase Auth user
    const { data: authUser, error: authError } = await svc.auth.admin.createUser({
      email: normalizedEmail,
      password: userPassword,
      email_confirm: true,
    });

    if (authError) {
      return res.status(500).json({ error: authError.message });
    }

    // Set JWT custom claims (tenant_id, role)
    await svc.auth.admin.updateUserById(authUser.user.id, {
      app_metadata: {
        tenant_id: ctx.tenantId,
        role: legacyRole,
      },
    });

    // Insert users row
    const { data: newUser, error: insertError } = await svc
      .from('users')
      .insert({
        tenant_id: ctx.tenantId,
        auth_uid: authUser.user.id,
        email: normalizedEmail,
        name: displayName,
        first_name: first_name || null,
        last_name: last_name || null,
        phone: phone || null,
        hire_date: hire_date || null,
        role: legacyRole,
        system_role: system_role || 'custom',
        granular_permissions: granular_permissions || [],
        status: 'active',
        temp_password_flag: isTempPassword,
        password_change_required: isTempPassword,
      })
      .select()
      .single();

    if (insertError) {
      await svc.auth.admin.deleteUser(authUser.user.id);
      return res.status(500).json({ error: insertError.message });
    }

    // Insert legacy permissions (for backward compat)
    const legacyPerms = permissions.length > 0 ? permissions :
      (system_role === 'admin' || system_role === 'super_admin') ? ['all'] : [];
    if (legacyPerms.length > 0) {
      const permRows = legacyPerms.map((p) => ({
        tenant_id: ctx.tenantId,
        user_id: newUser.id,
        permission_type: p,
        granted_by: ctx.userId,
      }));
      await svc.from('user_permissions').insert(permRows);
    }

    await logTenantAction(svc, {
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      action: 'user.create',
      entityType: 'user',
      entityId: newUser.id,
      newValues: { email: normalizedEmail, name: displayName, system_role: system_role || 'custom' },
      ipAddress: getClientIp(req),
    });

    return res.status(201).json({
      user: newUser,
      tempPassword: isTempPassword ? userPassword : undefined,
    });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
