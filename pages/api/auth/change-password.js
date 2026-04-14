import { createClient } from '@supabase/supabase-js';
import { getSupabaseServerClient } from '../../../lib/supabase-server';

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

  const { newPassword } = req.body;

  if (!newPassword || newPassword.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters' });
  }

  try {
    // Get current user from session cookies
    const supabaseUser = getSupabaseServerClient(req, res);
    const { data: { user }, error: userError } = await supabaseUser.auth.getUser();

    if (userError || !user) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    // Update password via admin API
    const serviceClient = getServiceClient();
    const { error: updateError } = await serviceClient.auth.admin.updateUserById(
      user.id,
      { password: newPassword }
    );

    if (updateError) {
      return res.status(400).json({ error: updateError.message });
    }

    // Clear the password_change_required flag
    await serviceClient
      .from('users')
      .update({
        password_change_required: false,
        temp_password_flag: false,
      })
      .eq('auth_uid', user.id);

    return res.status(200).json({ message: 'Password updated successfully' });
  } catch (err) {
    console.error('Change password error:', err);
    return res.status(500).json({ error: 'An unexpected error occurred' });
  }
}
