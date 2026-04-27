/**
 * HTML preview of Charge Details. Mirrors components/pdf/sections/ChargeDetails.js.
 * Accent-banded header + dynamic columns + totals footer.
 */
function formatCents(cents) {
  const num = (cents || 0) / 100;
  return `$${num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export default function ChargeDetailsPreview({ data, opts, colors }) {
  if (!data) return null;
  const fields = opts?.fields || {};
  const accent = colors?.accent || '#3B82F6';
  const showSubtotal = opts?.showSubtotal !== false;

  const showName    = fields.charge_name !== false;
  const showUnits   = fields.units       !== false;
  const showRates   = fields.rates       !== false;
  const showCharges = fields.charges     !== false;

  const lines = data.charge_lines || [];
  const totals = data.totals || {};

  return (
    <div className="mb-4">
      <div
        className="px-2 py-1 mb-1 text-[10px] uppercase tracking-wider font-bold text-white"
        style={{ backgroundColor: accent }}
      >
        Charge Details
      </div>
      <table className="w-full text-[11px]">
        <thead>
          <tr className="bg-gray-50 border-b border-gray-200">
            {showName    ? <th className="text-left  px-2 py-1.5 font-bold uppercase text-gray-600 text-[9px] tracking-wider">Charge Name</th> : null}
            {showUnits   ? <th className="text-right px-2 py-1.5 font-bold uppercase text-gray-600 text-[9px] tracking-wider">Units</th>       : null}
            {showRates   ? <th className="text-right px-2 py-1.5 font-bold uppercase text-gray-600 text-[9px] tracking-wider">Rates</th>       : null}
            {showCharges ? <th className="text-right px-2 py-1.5 font-bold uppercase text-gray-600 text-[9px] tracking-wider">Charges</th>     : null}
          </tr>
        </thead>
        <tbody>
          {lines.length === 0 ? (
            <tr>
              <td colSpan={4} className="text-center italic text-gray-500 py-3">
                (No charges)
              </td>
            </tr>
          ) : (
            lines.map((line, idx) => (
              <tr key={idx} className="border-b border-gray-100">
                {showName    ? <td className="px-2 py-1.5">{line.description || '—'}</td>                                : null}
                {showUnits   ? <td className="text-right px-2 py-1.5">{line.quantity ?? 1}</td>                            : null}
                {showRates   ? <td className="text-right px-2 py-1.5">{formatCents(line.unit_amount_cents)}</td>           : null}
                {showCharges ? <td className="text-right px-2 py-1.5">{formatCents(line.total_amount_cents)}</td>          : null}
              </tr>
            ))
          )}
        </tbody>
        {lines.length > 0 ? (
          <tfoot>
            {showSubtotal ? (
              <tr>
                <td colSpan={3} className="text-right px-2 py-1 text-gray-600">Subtotal</td>
                <td className="text-right px-2 py-1">{formatCents(totals.subtotal_cents)}</td>
              </tr>
            ) : null}
            <tr className="border-t border-gray-300">
              <td colSpan={3} className="text-right px-2 py-1 font-bold">Total Due</td>
              <td className="text-right px-2 py-1 font-bold">{formatCents(totals.total_cents)}</td>
            </tr>
          </tfoot>
        ) : null}
      </table>
    </div>
  );
}
