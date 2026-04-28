/**
 * HTML preview of Total Outstanding. Mirrors components/pdf/sections/TotalOutstanding.js.
 */
function fmtDollars(cents) {
  if (cents == null) return '$0.00';
  return `$${(cents / 100).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`;
}

export default function TotalOutstandingPreview({ data, opts, colors }) {
  if (!data) return null;
  if (opts?.fields?.total === false) return null;
  const accent = colors?.accent || '#1e40af';
  const cents = data.total_outstanding_cents ?? 0;

  return (
    <div className="flex justify-end mb-4">
      <div
        className="rounded px-5 py-2.5 min-w-[280px] flex justify-between items-center"
        style={{ backgroundColor: accent }}
      >
        <div className="text-white text-[11px] uppercase tracking-wider font-bold">
          Total Outstanding
        </div>
        <div className="text-white text-[18px] font-bold">{fmtDollars(cents)}</div>
      </div>
    </div>
  );
}
