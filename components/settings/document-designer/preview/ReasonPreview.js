/**
 * HTML preview of Reason. Mirrors components/pdf/sections/Reason.js.
 */
export default function ReasonPreview({ data, colors }) {
  if (!data || !data.text || !String(data.text).trim()) return null;

  return (
    <div className="mb-4 pb-3">
      <div className="text-[10px] uppercase tracking-wider font-bold mb-1" style={{ color: '#92400e' }}>
        Reason
      </div>
      <div
        className="px-3 py-2 rounded-sm text-[12px] leading-relaxed"
        style={{
          backgroundColor: '#fef3c7',
          borderLeft: '3px solid #f59e0b',
          color: '#78350f',
        }}
      >
        {String(data.text).trim()}
      </div>
    </div>
  );
}
