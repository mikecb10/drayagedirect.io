import Avatar from '../ui/Avatar';

/**
 * PresenceAvatars — stacked avatar bubbles showing other users currently
 * viewing the dispatcher board. Shows up to 4 avatars; any extras are
 * collapsed into a "+N" overflow chip.
 *
 * @param {object} props
 * @param {Array} props.users — from useRealtimePresence (already excludes self)
 * @param {number} [props.max=4]
 */
export default function PresenceAvatars({ users = [], max = 4 }) {
  if (!users || users.length === 0) return null;

  const visible = users.slice(0, max);
  const overflow = users.length - visible.length;

  return (
    <div className="flex items-center -space-x-1.5">
      {visible.map((u) => (
        <Avatar key={u.userId || u.id} user={u} size="sm" ring />
      ))}
      {overflow > 0 && (
        <div
          title={users.slice(max).map((u) => u.name || u.email || 'User').join(', ')}
          className="w-6 h-6 rounded-full ring-2 ring-white bg-gray-200 text-gray-700 text-[10px] font-semibold flex items-center justify-center"
        >
          +{overflow}
        </div>
      )}
    </div>
  );
}
