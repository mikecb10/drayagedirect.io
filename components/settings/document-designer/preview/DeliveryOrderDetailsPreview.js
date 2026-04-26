/**
 * HTML preview of the Delivery Order Details section. Mirrors
 * components/pdf/sections/DeliveryOrderDetails.js as a 5-col flex row of
 * label-value pairs.
 *
 * `opts.fields`: { delivery_order_number, pickup_number, driver_name,
 *                  delivery_appointment, reference_number }
 */
export default function DeliveryOrderDetailsPreview({ data, opts }) {
  if (!data) return null;
  const fields = opts?.fields || {};
  const rows = [
    fields.delivery_order_number !== false && data.delivery_order_number
      ? ['Delivery Order #', data.delivery_order_number] : null,
    fields.pickup_number !== false && data.pickup_number
      ? ['Pickup #', data.pickup_number] : null,
    fields.driver_name !== false && data.driver_name
      ? ['Driver', data.driver_name] : null,
    fields.delivery_appointment !== false && data.delivery_appointment
      ? ['Delivery Appt', data.delivery_appointment] : null,
    fields.reference_number !== false && data.reference_number
      ? ['Reference #', data.reference_number] : null,
  ].filter(Boolean);

  if (rows.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-x-6 gap-y-2 mb-4 pb-3 border-b border-gray-200">
      {rows.map(([label, value]) => (
        <div key={label} className="min-w-[100px]">
          <div className="text-[10px] uppercase tracking-wider font-semibold text-gray-500">
            {label}
          </div>
          <div className="text-xs text-gray-900">{value}</div>
        </div>
      ))}
    </div>
  );
}
