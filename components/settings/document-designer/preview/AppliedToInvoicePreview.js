/**
 * HTML preview of Applied To Invoice. Mirrors components/pdf/sections/AppliedToInvoice.js.
 * Hardcoded green palette (semantic — see AppliedToInvoice.js JSDoc); composer
 * passes `colors` for call-uniformity but this component ignores it.
 */
function fmtDollars(cents) {
  if (cents == null) return '—';
  return `$${(cents / 100).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`;
}

export default function AppliedToInvoicePreview({ data, opts }) {
  if (!data) return null;
  const fields = opts?.fields || {};

  const showInv      = fields.invoice_number  !== false;
  const showInvD     = fields.invoice_date    !== false;
  const showBalance  = fields.balance_due     !== false;
  const showApplied  = fields.applied_amount  !== false;
  const showAppliedD = fields.applied_date    !== false;

  const balanceLabel = showBalance && data.balance_due_cents != null
    ? `Bal: ${fmtDollars(data.balance_due_cents)}`
    : null;

  const meta = [];
  if (showInvD && data.invoice_date) meta.push(`Issued ${data.invoice_date}`);
  if (showApplied && data.applied_amount_cents != null) {
    const amount = fmtDollars(data.applied_amount_cents);
    if (showAppliedD && data.applied_date) {
      meta.push(`Reduced by ${amount} on ${data.applied_date}`);
    } else {
      meta.push(`Reduced by ${amount}`);
    }
  } else if (showAppliedD && data.applied_date) {
    meta.push(`Applied ${data.applied_date}`);
  }

  const hasTopRow = showInv || balanceLabel;
  const hasMeta   = meta.length > 0;
  if (!hasTopRow && !hasMeta) return null;  // every leaf hidden — drop the empty card

  return (
    <div className="mb-4">
      <div className="text-[10px] uppercase tracking-wider font-bold mb-1" style={{ color: '#166534' }}>
        Applied To Invoice
      </div>
      <div
        className="px-3 py-2 rounded text-[12px]"
        style={{
          backgroundColor: '#fafbfc',
          border: '1px solid #e2e8f0',
          borderLeft: '3px solid #10b981',
        }}
      >
        {hasTopRow && (
          <div className="flex justify-between items-baseline mb-1">
            {showInv ? (
              <span className="font-bold text-[12px]" style={{ color: '#0f172a' }}>
                {data.invoice_number || '—'}
              </span>
            ) : (
              <span className="font-bold text-[12px]" style={{ color: '#0f172a' }}>—</span>
            )}
            {balanceLabel ? (
              <span className="font-bold text-[13px]" style={{ color: '#0f172a' }}>
                {balanceLabel}
              </span>
            ) : null}
          </div>
        )}
        {hasMeta && (
          <div className="text-[10px]" style={{ color: '#64748b' }}>
            {meta.join(' · ')}
          </div>
        )}
      </div>
    </div>
  );
}
