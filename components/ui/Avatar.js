import { initials, hashColor } from '../../lib/user-utils';

/**
 * Avatar — reusable avatar circle.
 *
 * Renders:
 * - An <img> if user.avatar_url is present
 * - Otherwise a colored circle with initials (color derived from user.id)
 *
 * @param {object} props
 * @param {object} props.user — { id, name, email, avatar_url }
 * @param {'xs'|'sm'|'md'|'lg'} [props.size='sm']
 * @param {boolean} [props.ring] — white ring for stacked/overlapping layouts
 * @param {string} [props.title] — tooltip (defaults to name || email)
 */
export default function Avatar({ user, size = 'sm', ring = false, title, className = '' }) {
  const u = user || {};
  const sizes = {
    xs: { box: 'w-5 h-5', text: 'text-[9px]' },
    sm: { box: 'w-6 h-6', text: 'text-[10px]' },
    md: { box: 'w-8 h-8', text: 'text-xs' },
    lg: { box: 'w-10 h-10', text: 'text-sm' },
  };
  const s = sizes[size] || sizes.sm;
  const ringCls = ring ? 'ring-2 ring-white' : '';
  const tooltip = title || u.name || u.email || '';

  if (u.avatar_url) {
    return (
      <img
        src={u.avatar_url}
        alt={tooltip}
        title={tooltip}
        className={`${s.box} ${ringCls} rounded-full object-cover ${className}`}
      />
    );
  }

  const bg = hashColor(u.id || u.userId || u.email || '');

  return (
    <div
      title={tooltip}
      className={`${s.box} ${s.text} ${ringCls} rounded-full flex items-center justify-center font-semibold text-white ${className}`}
      style={{ backgroundColor: bg }}
    >
      {initials(u.name, u.email)}
    </div>
  );
}
