import { clearAdminCookie } from '../../../../lib/admin-auth';

export default function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  clearAdminCookie(res);
  return res.status(200).json({ message: 'Logged out' });
}
