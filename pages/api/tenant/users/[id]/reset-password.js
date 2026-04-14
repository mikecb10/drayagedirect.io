import { requireTenantUser, requirePermission, getServiceClient } from '../../../../../lib/tenant-api';
import { logTenantAction, getClientIp } from '../../../../../lib/tenant-audit';
import { PERMISSIONS } from '../../../../../lib/permissions';

function generateTempPassword() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  let pwd = '';
  for (let i = 0; i < 12; i++) {
    pwd += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return pwd + '!' + Math.floor(Math.random() * 100);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const ctx = await requireTenantUser(req, res);
  if (!ctx) return;
  if (!requirePermission(ctx, [PERMISSIONS.SETTINGS, PERMISSIONS.ALL], res)) return;

  const { id } = req.query;
  const svc = getServiceClient();

  const { data: targetUser } = await svc
    .from('users')
    .select('id, auth_uid, email')
    .eq('tenant_id', ctx.tenantId)
    .eq('id', id)
    .is('deleted_at', null)
    .single();

  if (!targetUser) {
    return res.status(404).json({ error: 'User not found' });
  }

  if (!targetUser.auth_uid) {
    return res.status(400).json({ error: 'User has no auth record' });
  }

  const tempPassword = generateTempPassword();

  const { error: authError } = await svc.auth.admin.updateUserById(targetUser.auth_uid, {
    password: tempPassword,
  });

  if (authError) {
    return res.status(500).json({ error: authError.message });
  }

  await svc
    .from('users')
    .update({
      temp_password_flag: true,
      password_change_required: true,
      login_attempts: 0,
      locked_at: null,
    })
    .eq('id', id);

  await logTenantAction(svc, {
    tenantId: ctx.tenantId,
    userId: ctx.userId,
    action: 'user.reset_password',
    entityType: 'user',
    entityId: id,
    ipAddress: getClientIp(req),
  });

  return res.status(200).json({ tempPassword });
}
