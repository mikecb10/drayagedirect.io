import bcrypt from 'bcryptjs';
import { createClient } from '@supabase/supabase-js';
import { signAdminToken, setAdminCookie } from '../../../../lib/admin-auth';
import { logAdminAction, getClientIp } from '../../../../lib/admin-audit';

const MAX_ATTEMPTS = 5;
const LOCKOUT_MINUTES = 30;

function getServiceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }

  const supabase = getServiceClient();

  try {
    // 1. Check lockout
    const { data: lockout } = await supabase
      .from('account_lockouts')
      .select('*')
      .eq('email', email.toLowerCase())
      .eq('user_type', 'dd_employee')
      .single();

    if (lockout && lockout.failed_attempts >= MAX_ATTEMPTS && lockout.locked_at) {
      const unlockAt = new Date(new Date(lockout.locked_at).getTime() + LOCKOUT_MINUTES * 60000);
      if (new Date() < unlockAt) {
        const minutesLeft = Math.ceil((unlockAt - new Date()) / 60000);
        return res.status(423).json({
          error: `Account locked. Try again in ${minutesLeft} minute${minutesLeft !== 1 ? 's' : ''}.`,
        });
      }
      await supabase
        .from('account_lockouts')
        .update({ failed_attempts: 0, locked_at: null })
        .eq('id', lockout.id);
    }

    // 2. Find employee
    const { data: employee, error: empError } = await supabase
      .from('dd_employees')
      .select('*')
      .eq('email', email.toLowerCase())
      .single();

    if (empError || !employee || !employee.is_active) {
      await incrementLockout(supabase, email.toLowerCase(), lockout);
      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    // 3. Compare password
    const valid = await bcrypt.compare(password, employee.password_hash);
    if (!valid) {
      await incrementLockout(supabase, email.toLowerCase(), lockout);
      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    // 4. Success — sign JWT, set cookie
    const token = signAdminToken(employee);
    setAdminCookie(res, token);

    // 5. Reset lockout
    if (lockout && lockout.failed_attempts > 0) {
      await supabase
        .from('account_lockouts')
        .update({ failed_attempts: 0, locked_at: null })
        .eq('id', lockout.id);
    }

    // 6. Update last_login_at
    await supabase
      .from('dd_employees')
      .update({ last_login_at: new Date().toISOString() })
      .eq('id', employee.id);

    // 7. Audit log
    await logAdminAction(supabase, {
      employeeId: employee.id,
      action: 'admin_login',
      details: { email: employee.email },
      ipAddress: getClientIp(req),
    });

    return res.status(200).json({
      employee: {
        id: employee.id,
        email: employee.email,
        name: employee.name,
        role: employee.role,
      },
    });
  } catch (err) {
    console.error('Admin login error:', err);
    return res.status(500).json({ error: 'An unexpected error occurred.' });
  }
}

async function incrementLockout(supabase, email, existingLockout) {
  const attempts = existingLockout ? existingLockout.failed_attempts + 1 : 1;
  const shouldLock = attempts >= MAX_ATTEMPTS;

  if (existingLockout) {
    await supabase
      .from('account_lockouts')
      .update({
        failed_attempts: attempts,
        last_failed_at: new Date().toISOString(),
        locked_at: shouldLock ? new Date().toISOString() : existingLockout.locked_at,
      })
      .eq('id', existingLockout.id);
  } else {
    await supabase.from('account_lockouts').insert({
      email,
      user_type: 'dd_employee',
      failed_attempts: attempts,
      last_failed_at: new Date().toISOString(),
      locked_at: shouldLock ? new Date().toISOString() : null,
    });
  }
}
