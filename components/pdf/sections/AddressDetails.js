import { View, Text } from '@react-pdf/renderer';
import { typography } from '../shared/typography';

function AddressBlock({ label, org }) {
  if (!org || !org.name) return null;
  const cityLine = [org.city, org.state, org.zip].filter(Boolean).join(', ');
  return (
    <View style={{ marginBottom: 8 }}>
      <Text style={typography.label}>{label}</Text>
      <Text style={typography.value}>{org.name}</Text>
      {org.address_line1 ? <Text style={typography.value}>{org.address_line1}</Text> : null}
      {cityLine ? <Text style={typography.value}>{cityLine}</Text> : null}
    </View>
  );
}

/**
 * Address Details section — customer (bill-to) + pickup/delivery/return
 * locations + contact + appointment times + operational street turn flag.
 *
 * Subsumes data the old `bill_to` + `customer_contact` section IDs rendered.
 * Pickup/delivery/return locations are FU-035-D2 territory — registered as
 * fields here but data is null in D.
 *
 * `opts.fields`: { customer, pickup_location, delivery_location,
 *                  return_location, appointment_times,
 *                  display_pickup_for_operational_street_turns }
 * Default-true for any field not specified except the street turn flag
 * (which defaults false — display only when explicitly enabled).
 *
 * `data` shape:
 *   {
 *     customer:           { name, address_line1, city, state, zip, phone, email } | null,
 *     pickup_location:    Org | null,   // D2
 *     delivery_location:  Org | null,   // D2
 *     return_location:    Org | null,   // D2
 *     appointment_times:  { pickup, delivery } | null,
 *     is_operational_street_turn: boolean
 *   }
 */
export default function AddressDetails({ data, opts }) {
  if (!data) return null;
  const fields = opts?.fields || {};
  const showCustomer  = fields.customer          !== false;
  const showPickup    = fields.pickup_location   !== false;
  const showDelivery  = fields.delivery_location !== false;
  const showReturn    = fields.return_location   !== false;
  const showApptTimes = fields.appointment_times !== false;
  const showStreetTurn = fields.display_pickup_for_operational_street_turns === true;

  const rows = [];
  if (showCustomer && data.customer) {
    rows.push(<AddressBlock key="customer" label="Customer" org={data.customer} />);
  }
  if (showPickup && data.pickup_location) {
    rows.push(<AddressBlock key="pickup" label="Pick Up Location" org={data.pickup_location} />);
  }
  if (showDelivery && data.delivery_location) {
    rows.push(<AddressBlock key="delivery" label="Delivery Location" org={data.delivery_location} />);
  }
  if (showReturn && data.return_location) {
    rows.push(<AddressBlock key="return" label="Return Location" org={data.return_location} />);
  }

  const phone = data.customer?.phone;
  const email = data.customer?.email;
  const apptPickup = data.appointment_times?.pickup;
  const apptDelivery = data.appointment_times?.delivery;

  if (rows.length === 0 && !phone && !email && !showApptTimes) return null;

  return (
    <View style={{ marginBottom: 12 }}>
      {rows}
      {showCustomer && (phone || email) ? (
        <View style={{ flexDirection: 'row', gap: 16, marginTop: 4 }}>
          {phone ? (
            <View>
              <Text style={[typography.label, { fontSize: 8 }]}>Phone</Text>
              <Text style={typography.value}>{phone}</Text>
            </View>
          ) : null}
          {email ? (
            <View>
              <Text style={[typography.label, { fontSize: 8 }]}>Email</Text>
              <Text style={typography.value}>{email}</Text>
            </View>
          ) : null}
        </View>
      ) : null}
      {showApptTimes && (apptPickup || apptDelivery) ? (
        <View style={{ flexDirection: 'row', gap: 16, marginTop: 4 }}>
          {apptPickup ? (
            <View>
              <Text style={[typography.label, { fontSize: 8 }]}>Pickup Time</Text>
              <Text style={typography.value}>{apptPickup}</Text>
            </View>
          ) : null}
          {apptDelivery ? (
            <View>
              <Text style={[typography.label, { fontSize: 8 }]}>Delivery Time</Text>
              <Text style={typography.value}>{apptDelivery}</Text>
            </View>
          ) : null}
        </View>
      ) : null}
      {showStreetTurn && data.is_operational_street_turn ? (
        <Text style={[typography.value, { marginTop: 4, fontStyle: 'italic' }]}>
          Operational Street Turn
        </Text>
      ) : null}
    </View>
  );
}
