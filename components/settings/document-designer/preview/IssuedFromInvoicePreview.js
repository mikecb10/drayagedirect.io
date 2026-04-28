/**
 * HTML preview of Issued From Invoice. Mirrors components/pdf/sections/IssuedFromInvoice.js.
 * Hardcoded blue palette (semantic — see IssuedFromInvoice.js JSDoc); composer
 * passes `colors` for call-uniformity but this component ignores it.
 */
function fmtDollars(cents) {
  if (cents == null) return '—';
  return `$${(cents / 100).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`;
}

export default function IssuedFromInvoicePreview({ data, opts }) {
  if (!data) return null;
  const fields = opts?.fields || {};

  const showInv  = fields.invoice_number !== false;
  const showInvD = fields.invoice_date   !== false;
  const showDue  = fields.due_date       !== false;
  const showTot  = fields.total          !== false;

  const meta = [];
  if (showInvD && data.invoice_date) meta.push(`Issued ${data.invoice_date}`);
  if (showDue  && data.due_date)     meta.push(`Due ${data.due_date}`);

  const hasTopRow = showInv || showTot;
  const hasMeta   = meta.length > 0;
  if (!hasTopRow && !hasMeta) return null;  // every leaf hidden — drop the empty card

  return (
    <div className="mb-4">
      <div className="text-[10px] uppercase tracking-wider font-bold mb-1" style={{ color: '#1e40af' }}>
        Issued From Invoice
      </div>
      <div
        className="px-3 py-2 rounded text-[12px]"
        style={{
          backgroundColor: '#fafbfc',
          border: '1px solid #e2e8f0',
          borderLeft: '3px solid #3b82f6',
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
            {showTot ? (
              <span className="font-bold text-[13px]" style={{ color: '#0f172a' }}>
                {fmtDollars(data.total_cents)}
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
