/**
 * HTML preview of the Notes section. Mirrors components/pdf/sections/Notes.js.
 * Renders a superset of doc-type-specific note fields:
 *   - DO-family: driver_notes / yard_notes / customer_notes / billing_notes / load_notes
 *   - AR-family (Statement / Credit Memo): payment_instructions / custom_notes
 *
 * Each registry declares its own `notes` section field set; `opts.fields` gates
 * visibility and absent values are skipped via empty-value check.
 *
 * Default-off: billing_notes, custom_notes (match registry defaultVisible: false).
 */
const NOTE_ORDER = [
  ['driver_notes',         'Driver Notes'],
  ['yard_notes',           'Yard Notes'],
  ['customer_notes',       'Customer Notes'],
  ['billing_notes',        'Billing Notes'],
  ['load_notes',           'Load Notes'],
  ['payment_instructions', 'Payment Instructions'],
  ['custom_notes',         'Custom Notes'],
];

const DEFAULT_OFF_FIELDS = new Set(['billing_notes', 'custom_notes']);

export default function NotesPreview({ data, opts }) {
  if (!data) return null;
  const fields = opts?.fields || {};
  const visible = NOTE_ORDER
    .map(([key, label]) => {
      const enabled = DEFAULT_OFF_FIELDS.has(key)
        ? fields[key] === true
        : fields[key] !== false;
      if (!enabled) return null;
      const value = data[key];
      if (!value) return null;
      return [label, value];
    })
    .filter(Boolean);

  if (visible.length === 0) return null;

  return (
    <div className="mb-4 pb-3 border-b border-gray-200 space-y-1.5">
      {visible.map(([label, value]) => (
        <div key={label}>
          <span className="text-[11px] font-semibold text-gray-700">{label}: </span>
          <span className="text-[11px] text-gray-900">{value}</span>
        </div>
      ))}
    </div>
  );
}
