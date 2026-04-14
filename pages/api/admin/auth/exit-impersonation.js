import { serialize, parse } from 'cookie';
import { createClient } from '@supabase/supabase-js';
import { getAdminFromRequest } from '../../../../lib/admin-auth';
import { logAdminAction, getClientIp } from '../../../../lib/admin-audit';

function getServiceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const cookies = parse(req.headers.cookie || '');
  const impersonation = cookies.dd_impersonation;

  let returnUrl = '/admin';
  let impData = null;

  if (impersonation) {
    try {
      impData = JSON.parse(impersonation);
      returnUrl = impData.returnUrl || '/admin';
    } catch {}
  }

  // Clear impersonation cookie
  res.setHeader('Set-Cookie', serialize('dd_impersonation', '', {
    httpOnly: false,
    sameSite: 'lax',
    path: '/',
    maxAge: 0,
  }));

  // Audit log
  if (impData) {
    const admin = getAdminFromRequest(req);
    if (admin) {
      const supabase = getServiceClient();
      await logAdminAction(supabase, {
        employeeId: admin.id,
        action: 'impersonation_end',
        details: { impersonated_email: impData.impersonatedUser },
        ipAddress: getClientIp(req),
      });
    }
  }

  return res.status(200).json({ redirectUrl: returnUrl });
}
