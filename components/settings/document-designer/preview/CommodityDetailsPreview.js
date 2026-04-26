/**
 * HTML preview of the Commodity Details section. Renders a 5-column table
 * (Commodity / Description / Weight / Pallets / Pieces) with one sample row.
 *
 * `opts.fields`: { commodity, description, weight, pallets, pieces }.
 * Default-true. If a column is toggled off, that <th>/<td> isn't rendered.
 */
const COL_ORDER = [
  ['commodity',   'Commodity'],
  ['description', 'Description'],
  ['weight',      'Weight'],
  ['pallets',     'Pallets'],
  ['pieces',      'Pieces'],
];

export default function CommodityDetailsPreview({ data, opts }) {
  if (!data) return null;
  const fields = opts?.fields || {};
  const cols = COL_ORDER.filter(([key]) => fields[key] !== false);
  if (cols.length === 0) return null;

  return (
    <div className="mb-4">
      <table className="w-full border-collapse text-xs">
        <thead>
          <tr>
            {cols.map(([key, label]) => (
              <th
                key={key}
                className="px-2 py-1.5 bg-blue-600 text-white text-[10px] uppercase tracking-wider font-semibold text-left border border-blue-700"
              >
                {label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          <tr>
            {cols.map(([key]) => (
              <td key={key} className="px-2 py-1.5 border border-gray-200 text-gray-900">
                {data[key] || '—'}
              </td>
            ))}
          </tr>
        </tbody>
      </table>
    </div>
  );
}
