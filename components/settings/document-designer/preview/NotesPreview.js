/**
 * HTML preview of the Notes section. Renders 5 toggleable note types as a
 * vertical list with label + body. Mirrors components/pdf/sections/Notes.js.
 *
 * `opts.fields`: { driver_notes, yard_notes, customer_notes, billing_notes, load_notes }
 * Default-true for all except billing_notes (defaultVisible: false in registry).
 */
const NOTE_ORDER = [
  ['driver_notes',   'Driver Notes'],
  ['yard_notes',     'Yard Notes'],
  ['customer_notes', 'Customer Notes'],
  ['billing_notes',  'Billing Notes'],
  ['load_notes',     'Load Notes'],
];

export default function NotesPreview({ data, opts }) {
  if (!data) return null;
  const fields = opts?.fields || {};
  const visible = NOTE_ORDER
    .map(([key, label]) => {
      const enabled = key === 'billing_notes' ? fields[key] === true : fields[key] !== false;
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
