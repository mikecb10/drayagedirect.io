/**
 * HTML preview of Aging Summary. Mirrors components/pdf/sections/AgingSummary.js.
 */
const BUCKETS = [
  { key: 'current',      label: 'Current',     bg: '#ecfdf5', border: '#a7f3d0', textLight: '#059669', textDark: '#065f46' },
  { key: 'days_1_30',    label: '1-30 Days',   bg: '#fffbeb', border: '#fde68a', textLight: '#d97706', textDark: '#92400e' },
  { key: 'days_31_60',   label: '31-60 Days',  bg: '#fef2f2', border: '#fecaca', textLight: '#dc2626', textDark: '#991b1b' },
  { key: 'days_61_90',   label: '61-90 Days',  bg: '#f9fafb', border: '#e5e7eb', textLight: '#6b7280', textDark: '#9ca3af' },
  { key: 'days_90_plus', label: '90+ Days',    bg: '#fef2f2', border: '#dc2626', textLight: '#7f1d1d', textDark: '#7f1d1d', emphasized: true },
];

function fmtDollars(cents) {
  if (cents == null) return '$0.00';
  return `$${(cents / 100).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`;
}

export default function AgingSummaryPreview({ data, opts, colors }) {
  if (!data) return null;
  const accent = colors?.accent || '#3B82F6';

  return (
    <div className="mb-4">
      <div
        className="px-2 py-1 mb-1 text-[10px] uppercase tracking-wider font-bold text-white"
        style={{ backgroundColor: accent }}
      >
        Aging Summary
      </div>
      <div className="grid grid-cols-5 gap-1.5">
        {BUCKETS.map((b) => {
          const cents = data[b.key] || 0;
          return (
            <div
              key={b.key}
              className="text-center py-2 px-1.5 rounded"
              style={{
                backgroundColor: b.bg,
                border: `${b.emphasized ? 2 : 1}px solid ${b.border}`,
              }}
            >
              <div
                className="text-[9px] uppercase font-bold tracking-wider mb-0.5"
                style={{ color: b.textLight }}
              >
                {b.label}
              </div>
              <div className="text-[12px] font-bold" style={{ color: b.textDark }}>
                {fmtDollars(cents)}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
