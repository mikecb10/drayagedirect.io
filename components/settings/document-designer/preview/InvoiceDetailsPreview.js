/**
 * HTML preview of Invoice Details. Mirrors components/pdf/sections/InvoiceDetails.js.
 * 3-col label-value grid; skips empty values; consolidated footnote.
 */
const FIELD_ORDER = [
  ['invoice_number',     'Invoice Number'],
  ['load_number',        'Load Number'],
  ['customer_reference', 'Customer Reference / PO #'],
  ['invoice_date',       'Invoice Date'],
  ['terms',              'Terms'],
  ['due_date',           'Due Date'],
];

export default function InvoiceDetailsPreview({ data, opts, colors }) {
  if (!data) return null;
  const fields = opts?.fields || {};
  const textColor = colors?.text || '#111827';
  const termsLabel = data.terms_days > 0 ? `Net ${data.terms_days}` : null;

  const rows = FIELD_ORDER
    .map(([key, label]) => {
      if (fields[key] === false) return null;
      const value = key === 'terms' ? termsLabel : data[key];
      if (value === undefined || value === null || value === '') return null;
      return [label, value];
    })
    .filter(Boolean);

  if (rows.length === 0 && !(data.consolidated_count > 1)) return null;

  return (
    <div className="mb-4 pb-3 border-b border-gray-200">
      <div className="grid grid-cols-3 gap-x-4 gap-y-2">
        {rows.map(([label, value]) => (
          <div key={label}>
            <div className="text-[10px] uppercase tracking-wider font-bold" style={{ color: textColor }}>
              {label}
            </div>
            <div className="text-[12px] text-gray-900">{String(value)}</div>
          </div>
        ))}
      </div>
      {data.consolidated_count > 1 ? (
        <div className="mt-2 text-[11px] text-gray-500 italic">
          Includes charges from {data.consolidated_count} loads
        </div>
      ) : null}
    </div>
  );
}
