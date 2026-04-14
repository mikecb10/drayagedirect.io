import jwt from 'jsonwebtoken';
import { parse, serialize } from 'cookie';

const COOKIE_NAME = 'dd_admin_session';
const JWT_SECRET = process.env.ADMIN_JWT_SECRET;
const COOKIE_MAX_AGE = 12 * 60 * 60; // 12 hours

export function signAdminToken(employee) {
  return jwt.sign(
    {
      id: employee.id,
      email: employee.email,
      name: employee.name,
      role: employee.role,
      is_dd_admin: true,
    },
    JWT_SECRET,
    { expiresIn: '12h' }
  );
}

export function verifyAdminToken(token) {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch {
    return null;
  }
}

export function setAdminCookie(res, token) {
  res.setHeader(
    'Set-Cookie',
    serialize(COOKIE_NAME, token, {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      maxAge: COOKIE_MAX_AGE,
    })
  );
}

export function clearAdminCookie(res) {
  res.setHeader(
    'Set-Cookie',
    serialize(COOKIE_NAME, '', {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      maxAge: 0,
    })
  );
}

export function getAdminFromRequest(req) {
  const cookies = parse(req.headers.cookie || '');
  const token = cookies[COOKIE_NAME];
  if (!token) return null;
  return verifyAdminToken(token);
}

export function requireAdmin(req, res, allowedRoles = ['super_admin', 'admin', 'support']) {
  const admin = getAdminFromRequest(req);
  if (!admin) {
    res.status(401).json({ error: 'Not authenticated' });
    return null;
  }
  if (!allowedRoles.includes(admin.role)) {
    res.status(403).json({ error: 'Insufficient permissions' });
    return null;
  }
  return admin;
}
