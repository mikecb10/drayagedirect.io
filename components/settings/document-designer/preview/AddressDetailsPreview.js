function AddressBlock({ label, org }) {
  if (!org || !org.name) return null;
  const cityLine = [org.city, org.state, org.zip].filter(Boolean).join(', ');
  return (
    <div>
      <div className="px-2 py-1 bg-blue-600 text-white text-[10px] uppercase tracking-wider font-semibold rounded-t">
        {label}
      </div>
      <div className="px-2 py-1.5 border border-gray-200 border-t-0 rounded-b">
        <div className="text-xs font-semibold text-gray-900">{org.name}</div>
        {org.address_line1 ? (
          <div className="text-[11px] text-gray-700">{org.address_line1}</div>
        ) : null}
        {cityLine ? <div className="text-[11px] text-gray-700">{cityLine}</div> : null}
      </div>
    </div>
  );
}

/**
 * HTML preview of the Address Details section. Mirrors
 * components/pdf/sections/AddressDetails.js. Renders 1-4 address blocks in
 * a horizontal grid (Customer / Pickup / Delivery / Return), then optional
 * contact + appointment-times rows below.
 *
 * `opts.fields`: { customer, pickup_location, delivery_location,
 *                  return_location, appointment_times,
 *                  display_pickup_for_operational_street_turns }
 */
export default function AddressDetailsPreview({ data, opts }) {
  if (!data) return null;
  const fields = opts?.fields || {};
  const showCustomer  = fields.customer          !== false;
  const showPickup    = fields.pickup_location   !== false;
  const showDelivery  = fields.delivery_location !== false;
  const showReturn    = fields.return_location   !== false;
  const showApptTimes = fields.appointment_times !== false;
  const showStreetTurn = fields.display_pickup_for_operational_street_turns === true;

  const blocks = [];
  if (showCustomer && data.customer) {
    blocks.push(<AddressBlock key="customer" label="Customer" org={data.customer} />);
  }
  if (showPickup && data.pickup_location) {
    blocks.push(<AddressBlock key="pickup" label="Pick Up Location" org={data.pickup_location} />);
  }
  if (showDelivery && data.delivery_location) {
    blocks.push(<AddressBlock key="delivery" label="Delivery Location" org={data.delivery_location} />);
  }
  if (showReturn && data.return_location) {
    blocks.push(<AddressBlock key="return" label="Return Location" org={data.return_location} />);
  }

  const phone = data.customer?.phone;
  const email = data.customer?.email;
  const apptPickup = data.appointment_times?.pickup;
  const apptDelivery = data.appointment_times?.delivery;

  if (blocks.length === 0 && !phone && !email && !showApptTimes && !showStreetTurn) return null;

  return (
    <div className="mb-4 pb-3 border-b border-gray-200">
      {blocks.length > 0 ? (
        <div
          className="grid gap-3"
          style={{ gridTemplateColumns: `repeat(${blocks.length}, minmax(0, 1fr))` }}
        >
          {blocks}
        </div>
      ) : null}
      {showCustomer && (phone || email) ? (
        <div className="flex gap-6 mt-2">
          {phone ? (
            <div>
              <div className="text-[10px] uppercase tracking-wider font-semibold text-gray-500">
                Phone
              </div>
              <div className="text-xs text-gray-900">{phone}</div>
            </div>
          ) : null}
          {email ? (
            <div>
              <div className="text-[10px] uppercase tracking-wider font-semibold text-gray-500">
                Email
              </div>
              <div className="text-xs text-gray-900">{email}</div>
            </div>
          ) : null}
        </div>
      ) : null}
      {showApptTimes && (apptPickup || apptDelivery) ? (
        <div className="flex gap-6 mt-2">
          {apptPickup ? (
            <div>
              <div className="text-[10px] uppercase tracking-wider font-semibold text-gray-500">
                Pickup Time
              </div>
              <div className="text-xs text-gray-900">{apptPickup}</div>
            </div>
          ) : null}
          {apptDelivery ? (
            <div>
              <div className="text-[10px] uppercase tracking-wider font-semibold text-gray-500">
                Delivery Time
              </div>
              <div className="text-xs text-gray-900">{apptDelivery}</div>
            </div>
          ) : null}
        </div>
      ) : null}
      {showStreetTurn && data.is_operational_street_turn ? (
        <div className="mt-2 italic text-xs text-gray-700">Operational Street Turn</div>
      ) : null}
    </div>
  );
}
