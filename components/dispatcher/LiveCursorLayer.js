import LiveCursor from './LiveCursor';

/**
 * LiveCursorLayer — overlay container for all remote cursors. Rendered inside
 * the dispatcher board's scroll container so its coordinate space matches the
 * content (cursors move with horizontal/vertical scroll).
 *
 * @param {object} props
 * @param {Array} props.cursors — from useLiveCursors
 */
export default function LiveCursorLayer({ cursors = [] }) {
  if (!cursors || cursors.length === 0) return null;

  return (
    <div
      className="absolute top-0 left-0 pointer-events-none"
      style={{ width: '100%', height: '100%', overflow: 'visible' }}
    >
      {cursors.map((c) => (
        <LiveCursor key={c.userId} x={c.x} y={c.y} name={c.name} color={c.color} />
      ))}
    </div>
  );
}
