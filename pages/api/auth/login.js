import { createClient } from '@supabase/supabase-js';
import { MAX_ATTEMPTS, LOCKOUT_MINUTES } from '../../../lib/auth-config';

function getServiceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}

function getAnonClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
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
    // 1. Check lockout status
    const { data: lockout } = await supabase
      .from('account_lockouts')
      .select('*')
      .eq('email', email.toLowerCase())
      .eq('user_type', 'tenant_user')
      .single();

    if (lockout && lockout.failed_attempts >= MAX_ATTEMPTS && lockout.locked_at) {
      const lockedAt = new Date(lockout.locked_at);
      const unlockAt = new Date(lockedAt.getTime() + LOCKOUT_MINUTES * 60 * 1000);
      if (new Date() < unlockAt) {
        const minutesLeft = Math.ceil((unlockAt - new Date()) / 60000);
        return res.status(423).json({
          error: `Account locked. Try again in ${minutesLeft} minute${minutesLeft !== 1 ? 's' : ''} or contact support.`,
        });
      }
      // Lockout expired, reset
      await supabase
        .from('account_lockouts')
        .update({ failed_attempts: 0, locked_at: null })
        .eq('id', lockout.id);
    }

    // 2. Authenticate with Supabase Auth (use anon client for user auth)
    const anonClient = getAnonClient();
    const { data: authData, error: authError } =
      await anonClient.auth.signInWithPassword({ email, password });

    if (authError) {
      // Increment failed attempts
      const currentAttempts = lockout ? lockout.failed_attempts + 1 : 1;
      const shouldLock = currentAttempts >= MAX_ATTEMPTS;

      if (lockout) {
        await supabase
          .from('account_lockouts')
          .update({
            failed_attempts: currentAttempts,
            last_failed_at: new Date().toISOString(),
            locked_at: shouldLock ? new Date().toISOString() : lockout.locked_at,
          })
          .eq('id', lockout.id);
      } else {
        await supabase.from('account_lockouts').insert({
          email: email.toLowerCase(),
          user_type: 'tenant_user',
          failed_attempts: currentAttempts,
          last_failed_at: new Date().toISOString(),
          locked_at: shouldLock ? new Date().toISOString() : null,
        });
      }

      const attemptsLeft = MAX_ATTEMPTS - currentAttempts;
      if (shouldLock) {
        return res.status(423).json({
          error: `Account locked after ${MAX_ATTEMPTS} failed attempts. Try again in ${LOCKOUT_MINUTES} minutes or contact support.`,
        });
      }

      return res.status(401).json({
        error: 'Invalid email or password.',
        attemptsLeft: attemptsLeft > 0 ? attemptsLeft : 0,
      });
    }

    // 3. Resolve user profile from users table
    const { data: profile, error: profileError } = await supabase
      .from('users')
      .select('id, tenant_id, email, name, role, password_change_required, status')
      .eq('auth_uid', authData.user.id)
      .is('deleted_at', null)
      .single();

    if (profileError || !profile) {
      return res.status(403).json({
        error: 'Your account has not been provisioned. Contact your administrator.',
      });
    }

    if (profile.status !== 'active') {
      return res.status(403).json({
        error: 'Your account has been disabled. Contact your administrator.',
      });
    }

    // 4. Set JWT custom claims (tenant_id in app_metadata)
    await supabase.auth.admin.updateUserById(authData.user.id, {
      app_metadata: {
        tenant_id: profile.tenant_id,
        role: profile.role,
        user_id: profile.id,
      },
    });

    // 5. Reset lockout on successful login
    if (lockout && lockout.failed_attempts > 0) {
      await supabase
        .from('account_lockouts')
        .update({ failed_attempts: 0, locked_at: null })
        .eq('id', lockout.id);
    }

    // 6. Update last_login_at
    await supabase
      .from('users')
      .update({ last_login_at: new Date().toISOString(), login_attempts: 0 })
      .eq('id', profile.id);

    // 7. Return session and profile
    return res.status(200).json({
      session: authData.session,
      profile: {
        id: profile.id,
        tenant_id: profile.tenant_id,
        email: profile.email,
        name: profile.name,
        role: profile.role,
        password_change_required: profile.password_change_required,
      },
    });
  } catch (err) {
    console.error('Login error:', err);
    return res.status(500).json({ error: 'An unexpected error occurred. Please try again.' });
  }
}
