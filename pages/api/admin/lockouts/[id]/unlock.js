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
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const admin = requireAdmin(req, res);
  if (!admin) return;

  const { id } = req.query;
  const supabase = getServiceClient();

  // Get lockout record
  const { data: lockout } = await supabase
    .from('account_lockouts')
    .select('*')
    .eq('id', id)
    .single();

  if (!lockout) return res.status(404).json({ error: 'Lockout record not found.' });

  // Reset lockout
  await supabase
    .from('account_lockouts')
    .update({
      failed_attempts: 0,
      locked_at: null,
      unlocked_by: admin.id,
      unlocked_at: new Date().toISOString(),
    })
    .eq('id', id);

  // If tenant user, also reset on users table
  if (lockout.user_type === 'tenant_user' && lockout.tenant_id) {
    await supabase
      .from('users')
      .update({ login_attempts: 0, locked_at: null })
      .eq('email', lockout.email)
      .eq('tenant_id', lockout.tenant_id);
  }

  await logAdminAction(supabase, {
    employeeId: admin.id,
    action: 'account_unlocked',
    targetTenantId: lockout.tenant_id,
    details: { email: lockout.email, user_type: lockout.user_type },
    ipAddress: getClientIp(req),
  });

  return res.status(200).json({ message: 'Account unlocked.' });
}
