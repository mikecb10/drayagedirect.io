import { getAdminFromRequest } from '../../../../lib/admin-auth';

export default function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const admin = getAdminFromRequest(req);
  if (!admin) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  return res.status(200).json({
    employee: {
      id: admin.id,
      email: admin.email,
      name: admin.name,
      role: admin.role,
    },
  });
}
