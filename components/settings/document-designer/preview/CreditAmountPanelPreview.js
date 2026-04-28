/**
 * HTML preview of Credit Amount panel. Mirrors components/pdf/sections/CreditAmountPanel.js.
 */
function fmtDollars(cents) {
  if (cents == null) return '—';
  return `$${(cents / 100).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`;
}

export default function CreditAmountPanelPreview({ data, opts, colors }) {
  if (!data) return null;
  const fields = opts?.fields || {};
  if (fields.total === false) return null;

  return (
    <div className="mb-4 flex justify-end">
      <div
        className="px-5 py-3.5 rounded text-right"
        style={{
          backgroundColor: '#f0fdf4',
          border: '1.5px solid #16a34a',
          minWidth: '220px',
        }}
      >
        <div
          className="text-[10px] uppercase tracking-widest font-bold mb-0.5"
          style={{ color: '#15803d' }}
        >
          Credit Amount
        </div>
        <div className="text-[24px] font-extrabold" style={{ color: '#15803d' }}>
          {fmtDollars(data.total_cents)}
        </div>
      </div>
    </div>
  );
}
