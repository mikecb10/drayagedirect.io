/**
 * Shared user display utilities — initials, colors, display names.
 */

/**
 * Extract initials from a user's name or email.
 * Returns up to 2 characters, uppercased.
 *
 * Examples:
 *   initials('John Doe') → 'JD'
 *   initials('john@acme.com') → 'J'
 *   initials(null, 'john.doe@acme.com') → 'J'
 *   initials(null, null) → '?'
 */
export function initials(name, email) {
  const source = (name || email || '').trim();
  if (!source) return '?';
  const parts = source.split(/\s+/);
  if (parts.length >= 2 && parts[0][0] && parts[1][0]) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  return (source[0] || '?').toUpperCase();
}

/**
 * Get first name from a full name, falling back to email prefix.
 *
 * Examples:
 *   firstName('John Doe') → 'John'
 *   firstName('', 'jane.doe@acme.com') → 'Jane'
 */
export function firstName(name, email) {
  const source = (name || '').trim();
  if (source) return source.split(/\s+/)[0];
  const emailSource = (email || '').trim();
  if (emailSource) {
    const prefix = emailSource.split('@')[0] || '';
    // Capitalize first letter, strip dots/underscores
    const cleaned = prefix.split(/[._]/)[0] || prefix;
    return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
  }
  return 'User';
}

/**
 * Deterministic color from a user ID. The same user always gets
 * the same color across the app (avatar circle + cursor label).
 *
 * Uses a small curated palette of vivid mid-brightness colors
 * that pop on both light and dark backgrounds.
 */
const PALETTE = [
  '#3b82f6', // blue-500
  '#8b5cf6', // violet-500
  '#ec4899', // pink-500
  '#f59e0b', // amber-500
  '#10b981', // emerald-500
  '#06b6d4', // cyan-500
  '#ef4444', // red-500
  '#84cc16', // lime-500
  '#f97316', // orange-500
  '#6366f1', // indigo-500
];

export function hashColor(id) {
  if (!id) return PALETTE[0];
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = (hash * 31 + id.charCodeAt(i)) | 0;
  }
  return PALETTE[Math.abs(hash) % PALETTE.length];
}
