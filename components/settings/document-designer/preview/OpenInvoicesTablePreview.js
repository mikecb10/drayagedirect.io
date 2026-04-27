/**
 * HTML preview of Open Invoices. Mirrors components/pdf/sections/OpenInvoicesTable.js.
 * Accent-banded header + 7-column table with color-coded Days Past Due cell.
 */
const COLUMNS = [
  { key: 'invoice_number',     label: 'Invoice #',     align: 'left'  },
  { key: 'invoice_date',       label: 'Inv. Date',     align: 'left'  },
  { key: 'due_date',           label: 'Due Date',      align: 'left'  },
  { key: 'days_past_due',      label: 'Days Past Due', align: 'right' },
  { key: 'customer_reference', label: 'PO #',          align: 'left'  },
  { key: 'original_amount',    label: 'Original',      align: 'right' },
  { key: 'balance_due',        label: 'Balance Due',   align: 'right' },
];

function fmtDollars(cents) {
  if (cents == null) return '—';
  return `$${(cents / 100).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`;
}

function daysPastDueColor(daysPastDue) {
  if (daysPastDue == null)   return '#374151';
  if (daysPastDue <= 0)      return '#059669';
  if (daysPastDue <= 30)     return '#d97706';
  if (daysPastDue <= 90)     return '#dc2626';
  return '#7f1d1d';
}

function daysPastDueLabel(daysPastDue) {
  if (daysPastDue == null) return '—';
  if (daysPastDue <= 0)    return 'Current';
  return `${daysPastDue} days`;
}

export default function OpenInvoicesTablePreview({ data, opts, colors }) {
  if (!Array.isArray(data)) return null;
  const accent = colors?.accent || '#3B82F6';
  const fields = opts?.fields || {};
  const visibleCols = COLUMNS.filter((c) => fields[c.key] !== false);
  if (visibleCols.length === 0) return null;

  return (
    <div className="mb-4">
      <div
        className="px-2 py-1 mb-1 text-[10px] uppercase tracking-wider font-bold text-white"
        style={{ backgroundColor: accent }}
      >
        Open Invoices
      </div>
      <table className="w-full text-[11px]">
        <thead>
          <tr className="bg-gray-50 border-b border-gray-200">
            {visibleCols.map((c) => (
              <th
                key={c.key}
                className="px-2 py-1.5 font-bold uppercase text-gray-600 text-[9px] tracking-wider"
                style={{ textAlign: c.align }}
              >
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.length === 0 ? (
            <tr>
              <td colSpan={visibleCols.length} className="text-center italic text-gray-500 py-3">
                (No outstanding invoices)
              </td>
            </tr>
          ) : (
            data.map((inv, idx) => (
              <tr key={inv.invoice_id || idx} className="border-b border-gray-100">
                {visibleCols.map((c) => {
                  let value = '—';
                  let cellClass = 'px-2 py-1.5';
                  let cellStyle = { textAlign: c.align };
                  switch (c.key) {
                    case 'invoice_number':
                      value = inv.invoice_number || '—';
                      cellClass += ' font-bold text-gray-900';
                      break;
                    case 'invoice_date':
                      value = inv.invoice_date || '—';
                      cellClass += ' text-gray-700';
                      break;
                    case 'due_date':
                      value = inv.due_date || '—';
                      cellClass += ' text-gray-700';
                      break;
                    case 'days_past_due':
                      value = daysPastDueLabel(inv.days_past_due);
                      cellClass += ' font-bold';
                      cellStyle = { ...cellStyle, color: daysPastDueColor(inv.days_past_due) };
                      break;
                    case 'customer_reference':
                      value = inv.customer_reference || '—';
                      cellClass += ' text-gray-700';
                      break;
                    case 'original_amount':
                      value = fmtDollars(inv.original_amount_cents);
                      cellClass += ' text-gray-700';
                      break;
                    case 'balance_due':
                      value = fmtDollars(inv.balance_due_cents);
                      cellClass += ' font-bold text-gray-900';
                      break;
                  }
                  return (
                    <td key={c.key} className={cellClass} style={cellStyle}>
                      {value}
                    </td>
                  );
                })}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
