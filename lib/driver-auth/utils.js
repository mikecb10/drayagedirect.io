/**
 * Driver-auth utilities: JWT signing/verification, bcrypt password hashing,
 * temp-password generation. Driver tokens are 30-day TTL with `iat` claim
 * for revocation pivot (drivers.session_min_iat).
 *
 * Spec: docs/superpowers/specs/2026-04-24-driver-move-tracking-design.md §4
 */

import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { randomBytes } from 'node:crypto';

export const TOKEN_TTL_DAYS = 30;
const BCRYPT_ROUNDS = 10;
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';  // no 0/O/1/I/l

export async function hashPassword(plaintext) {
  return bcrypt.hash(plaintext, BCRYPT_ROUNDS);
}

export async function verifyPassword(plaintext, hash) {
  if (!hash) return false;
  return bcrypt.compare(plaintext, hash);
}

/**
 * Sign a driver JWT.
 * @param {object} payload  { driverId, tenantId }
 * @param {string} secret   defaults to process.env.DRIVER_JWT_SECRET
 * @returns {string} JWT
 */
export function signDriverJWT(payload, secret) {
  const finalSecret = secret ?? process.env.DRIVER_JWT_SECRET;
  if (!finalSecret) throw new Error('DRIVER_JWT_SECRET is not set');
  return jwt.sign(
    { driverId: payload.driverId, tenantId: payload.tenantId },
    finalSecret,
    {
      expiresIn: `${TOKEN_TTL_DAYS}d`,
      issuer: 'drayagedirect-driver',
    },
  );
}

/**
 * Verify a driver JWT. Throws on invalid/expired/tampered.
 * @returns {object} decoded claims (includes iat, exp, driverId, tenantId)
 */
export function verifyDriverJWT(token, secret) {
  const finalSecret = secret ?? process.env.DRIVER_JWT_SECRET;
  if (!finalSecret) throw new Error('DRIVER_JWT_SECRET is not set');
  return jwt.verify(token, finalSecret, { issuer: 'drayagedirect-driver' });
}

/**
 * Generate a random 8-char alphanumeric password (no ambiguous chars).
 * For dispatcher-handed-off temporary passwords.
 */
export function generateTempPassword() {
  const bytes = randomBytes(8);
  let out = '';
  for (let i = 0; i < 8; i++) {
    out += ALPHABET[bytes[i] % ALPHABET.length];
  }
  return out;
}
