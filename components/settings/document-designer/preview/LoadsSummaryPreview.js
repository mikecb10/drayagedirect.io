/**
 * HTML preview of the Loads Summary section. Mirrors components/pdf/sections/LoadsSummary.js.
 * Accent-banded header + 7 toggleable columns + N rows.
 */
function locationText(loc) {
  if (!loc) return '—';
  const parts = [loc.city, loc.state].filter(Boolean).join(', ');
  return parts || loc.name || '—';
}

export default function LoadsSummaryPreview({ data, opts, colors }) {
  if (!Array.isArray(data)) return null;
  const fields = opts?.fields || {};
  const accent = colors?.accent || '#3B82F6';

  const showLoad     = fields.load_number       !== false;
  const showCont     = fields.container_number  !== false;
  const showChassis  = fields.chassis_number    !== false;
  const showPickup   = fields.pickup_location   !== false;
  const showDelivery = fields.delivery_location !== false;
  const showPDate    = fields.pickup_date       !== false;
  const showDDate    = fields.delivery_date     !== false;

  return (
    <div className="mb-4">
      <div
        className="px-2 py-1 mb-1 text-[10px] uppercase tracking-wider font-bold text-white"
        style={{ backgroundColor: accent }}
      >
        Loads
      </div>
      <table className="w-full text-[11px]">
        <thead>
          <tr className="bg-gray-50 border-b border-gray-200">
            {showLoad     ? <th className="text-left px-2 py-1.5 font-bold uppercase text-gray-600 text-[9px] tracking-wider">Load #</th>    : null}
            {showCont     ? <th className="text-left px-2 py-1.5 font-bold uppercase text-gray-600 text-[9px] tracking-wider">Container</th> : null}
            {showChassis  ? <th className="text-left px-2 py-1.5 font-bold uppercase text-gray-600 text-[9px] tracking-wider">Chassis</th>   : null}
            {showPickup   ? <th className="text-left px-2 py-1.5 font-bold uppercase text-gray-600 text-[9px] tracking-wider">Pickup</th>    : null}
            {showDelivery ? <th className="text-left px-2 py-1.5 font-bold uppercase text-gray-600 text-[9px] tracking-wider">Delivery</th>  : null}
            {showPDate    ? <th className="text-left px-2 py-1.5 font-bold uppercase text-gray-600 text-[9px] tracking-wider">P. Date</th>   : null}
            {showDDate    ? <th className="text-left px-2 py-1.5 font-bold uppercase text-gray-600 text-[9px] tracking-wider">D. Date</th>   : null}
          </tr>
        </thead>
        <tbody>
          {data.length === 0 ? (
            <tr>
              <td colSpan={7} className="text-center italic text-gray-500 py-3">
                (No loads)
              </td>
            </tr>
          ) : (
            data.map((load, idx) => (
              <tr key={load.order_id || idx} className="border-b border-gray-100">
                {showLoad     ? <td className="px-2 py-1.5">{load.load_number || '—'}</td>                    : null}
                {showCont     ? <td className="px-2 py-1.5">{load.container_number || '—'}</td>               : null}
                {showChassis  ? <td className="px-2 py-1.5">{load.chassis_number || '—'}</td>                 : null}
                {showPickup   ? <td className="px-2 py-1.5">{locationText(load.pickup_location)}</td>         : null}
                {showDelivery ? <td className="px-2 py-1.5">{locationText(load.delivery_location)}</td>       : null}
                {showPDate    ? <td className="px-2 py-1.5">{load.pickup_date || '—'}</td>                    : null}
                {showDDate    ? <td className="px-2 py-1.5">{load.delivery_date || '—'}</td>                  : null}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
