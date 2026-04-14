/**
 * LiveCursor — renders a single remote user's cursor with a colored name label.
 *
 * Positioned via CSS transform (GPU-accelerated). A short transition on
 * transform smooths the motion between broadcasts so movement looks fluid
 * even though we only receive ~30-60 position updates per second.
 *
 * @param {object} props
 * @param {number} props.x — content-space X in the scroll container
 * @param {number} props.y — content-space Y in the scroll container
 * @param {string} props.name — first name / label
 * @param {string} props.color — hex color (matches user's avatar)
 */
export default function LiveCursor({ x, y, name, color }) {
  return (
    <div
      className="absolute top-0 left-0 pointer-events-none"
      style={{
        transform: `translate3d(${x}px, ${y}px, 0)`,
        transition: 'transform 80ms linear',
        willChange: 'transform',
        zIndex: 50,
      }}
    >
      {/* Arrow cursor SVG — points up-left from (0,0) */}
      <svg
        width="20"
        height="22"
        viewBox="0 0 20 22"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        style={{ filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.25))' }}
      >
        <path
          d="M1 1L1 16.5L5.5 12.5L8 18L11 16.5L8.5 11L14.5 11L1 1Z"
          fill={color}
          stroke="white"
          strokeWidth="1.2"
          strokeLinejoin="round"
        />
      </svg>
      {/* Name label */}
      {name && (
        <div
          className="absolute left-4 top-4 px-1.5 py-0.5 rounded text-[10px] font-semibold text-white whitespace-nowrap"
          style={{
            backgroundColor: color,
            boxShadow: '0 1px 3px rgba(0,0,0,0.15)',
          }}
        >
          {name}
        </div>
      )}
    </div>
  );
}
