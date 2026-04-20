/**
 * Email Variable Catalog
 *
 * Single source of truth for every {{variable.path}} token available in
 * email templates. Used by:
 *
 *   1. The template editor's "@Insert Variable" picker (UI list)
 *   2. The variable resolver at send time (data shape + formatting kind)
 *   3. The template validator (prevents users from saving templates that
 *      reference variables that don't exist)
 *   4. The live preview pane (maps a sample load to the rendered body)
 *
 * ## Shape
 *
 * Each variable has:
 *   - path:        The dotted key used inside {{...}} — e.g. "load.container_number"
 *   - label:       Short human label shown in the picker
 *   - description: One-sentence explanation shown as a tooltip
 *   - category:    Top-level grouping in the picker (Load, Container, Customer, ...)
 *   - kind:        Formatting kind handled by the resolver:
 *                  'text' | 'date' | 'datetime' | 'currency' | 'number' | 'weight' |
 *                  'distance' | 'phone' | 'address' | 'container_number' | 'email' | 'url'
 *   - required:    true if empty values should abort the send when
 *                  tenant_format_preferences.strict_empty_mode is on
 *   - sample:      A sample rendered value for the live preview / picker hint
 *
 * ## Categories
 *
 * Variables are grouped into the categories listed in VARIABLE_CATEGORIES.
 * The picker UI renders them in this order.
 */

// ──────────────────────────────────────────────────────────────
// Categories (ordered for the picker)
// ──────────────────────────────────────────────────────────────
export const VARIABLE_CATEGORIES = [
  { key: 'load', label: 'Load', description: 'Order-level info — order #, type, status, dates' },
  { key: 'container', label: 'Container', description: 'Container number, seal, size, type, SSL' },
  { key: 'chassis', label: 'Chassis', description: 'Chassis number, type, size, owner' },
  { key: 'customer', label: 'Customer', description: 'Bill-to customer org details + primary contact' },
  { key: 'pickup', label: 'Pickup Location', description: 'Origin terminal / warehouse + its schedule window' },
  { key: 'delivery', label: 'Delivery Location', description: 'Destination warehouse + its appointment window' },
  { key: 'return', label: 'Return Location', description: 'Empty-return terminal + its appointment window' },
  { key: 'driver', label: 'Driver', description: 'Assigned driver details' },
  { key: 'truck', label: 'Truck', description: 'Assigned truck / tractor details' },
  { key: 'charges', label: 'Charges & Billing', description: 'Line items, totals, invoice references' },
  { key: 'dates', label: 'Dates & Appointments', description: 'Key dates (appt, cutoff, LFD, dispatched)' },
  { key: 'tenant', label: 'Carrier (You)', description: 'Your company info — name, SCAC, contact' },
  { key: 'user', label: 'Sender', description: 'The user who triggered / is sending this email' },
  { key: 'system', label: 'System', description: 'App URLs, tracking links, current date/time' },
];

// ──────────────────────────────────────────────────────────────
// Variable definitions
// ──────────────────────────────────────────────────────────────
/** @type {Array<{path:string,label:string,description:string,category:string,kind:string,required?:boolean,sample?:string}>} */
export const EMAIL_VARIABLES = [
  // ── Load ──
  { path: 'load.order_number', label: 'Order Number', description: 'The carrier-prefixed order number (e.g. ABC001234)', category: 'load', kind: 'text', required: true, sample: 'ABC001234' },
  { path: 'load.customer_reference', label: 'Customer Reference', description: "Customer's own reference / PO / booking number", category: 'load', kind: 'text', sample: 'PO-887744' },
  { path: 'load.type', label: 'Load Type', description: 'Import / Export / Outbound / Inbound', category: 'load', kind: 'text', sample: 'Import' },
  { path: 'load.status', label: 'Load Status', description: 'Current status of the load', category: 'load', kind: 'text', sample: 'In Transit' },
  { path: 'load.state_label', label: 'Live State', description: 'Derived live state (Enroute to Pickup, Arrived at Delivery, etc.)', category: 'load', kind: 'text', sample: 'Enroute to Delivery' },
  { path: 'load.appointment_date', label: 'Appointment Date', description: 'Next scheduled appointment on this load', category: 'load', kind: 'date', sample: 'Apr 12, 2026' },
  { path: 'load.appointment_time', label: 'Appointment Time', description: 'Next scheduled appointment time', category: 'load', kind: 'datetime', sample: '2:30 PM EDT' },
  { path: 'load.cutoff_date', label: 'Cutoff Date', description: 'Export cutoff date set by the SSL', category: 'load', kind: 'date', sample: 'Apr 15, 2026' },
  { path: 'load.last_free_day', label: 'Last Free Day', description: 'Last free day at the terminal before per diem accrues', category: 'load', kind: 'date', sample: 'Apr 14, 2026' },
  { path: 'load.discharge_date', label: 'Discharge Date', description: 'Date the container discharged from the vessel', category: 'load', kind: 'date', sample: 'Apr 10, 2026' },
  { path: 'load.available_date', label: 'Available Date', description: 'Date the container became available at the terminal', category: 'load', kind: 'date', sample: 'Apr 11, 2026' },
  { path: 'load.dispatched_date', label: 'Dispatched Date', description: 'When the load was dispatched to a driver', category: 'load', kind: 'datetime', sample: 'Apr 11, 2026 at 8:15 AM' },
  { path: 'load.delivered_date', label: 'Delivered Date', description: 'When the load was marked delivered', category: 'load', kind: 'datetime' },
  { path: 'load.completed_date', label: 'Completed Date', description: 'When the load was marked complete', category: 'load', kind: 'datetime' },
  { path: 'load.piece_count', label: 'Piece Count', description: 'Number of pieces on the load', category: 'load', kind: 'number', sample: '18' },
  { path: 'load.weight', label: 'Weight', description: 'Load weight (formatted per tenant units)', category: 'load', kind: 'weight', sample: '41,250 lbs' },
  { path: 'load.commodity', label: 'Commodity', description: 'Commodity description', category: 'load', kind: 'text', sample: 'Electronics' },
  { path: 'load.hazmat', label: 'Hazmat', description: '"Yes" or "No"', category: 'load', kind: 'text', sample: 'No' },
  { path: 'load.overweight', label: 'Overweight', description: '"Yes" or "No"', category: 'load', kind: 'text', sample: 'No' },
  { path: 'load.notes', label: 'Load Notes', description: 'Public notes visible to customers', category: 'load', kind: 'text' },
  { path: 'load.tracking_url', label: 'Tracking URL', description: 'Public customer tracking page for this load', category: 'load', kind: 'url', sample: 'https://portal.example.com/t/xyz' },

  // ── Container ──
  { path: 'container.number', label: 'Container #', description: 'ISO container number', category: 'container', kind: 'container_number', sample: 'MSCU1234567' },
  { path: 'container.seal', label: 'Seal #', description: 'Seal number', category: 'container', kind: 'text', sample: 'SL889900' },
  { path: 'container.size', label: 'Container Size', description: '20, 40, 40HC, 45, etc.', category: 'container', kind: 'text', sample: '40HC' },
  { path: 'container.type', label: 'Container Type', description: 'Standard / Reefer / Open-top / Tank / Flatrack', category: 'container', kind: 'text', sample: 'Standard' },
  { path: 'container.owner', label: 'SSL / Container Owner', description: 'Steamship line or container owner (SCAC)', category: 'container', kind: 'text', sample: 'MSC' },
  { path: 'container.vessel', label: 'Vessel Name', description: 'Arriving vessel (import only)', category: 'container', kind: 'text', sample: 'MSC GAIA' },
  { path: 'container.voyage', label: 'Voyage Number', description: 'Vessel voyage number', category: 'container', kind: 'text', sample: 'FJ425W' },
  { path: 'container.genset', label: 'Genset', description: '"Yes" or "No"', category: 'container', kind: 'text', sample: 'No' },
  { path: 'container.reefer_temp', label: 'Reefer Temperature', description: 'Set temperature for reefer containers', category: 'container', kind: 'text', sample: '34°F' },

  // ── Chassis ──
  { path: 'chassis.number', label: 'Chassis #', description: 'Chassis equipment number', category: 'chassis', kind: 'text', sample: 'FLXZ445566' },
  { path: 'chassis.type', label: 'Chassis Type', description: 'Chassis configuration type', category: 'chassis', kind: 'text', sample: 'Standard' },
  { path: 'chassis.size', label: 'Chassis Size', description: 'Chassis size (20, 40, etc.)', category: 'chassis', kind: 'text', sample: '40' },
  { path: 'chassis.owner', label: 'Chassis Pool Owner', description: 'Owning chassis pool', category: 'chassis', kind: 'text', sample: 'FLXI' },

  // ── Customer ──
  { path: 'customer.name', label: 'Customer Name', description: 'Bill-to customer org name', category: 'customer', kind: 'text', required: true, sample: 'ACME Imports LLC' },
  { path: 'customer.code', label: 'Customer Code', description: 'Internal customer short code', category: 'customer', kind: 'text', sample: 'ACME01' },
  { path: 'customer.email', label: 'Customer Primary Email', description: 'Primary contact email for the customer', category: 'customer', kind: 'email', sample: 'ops@acme.com' },
  { path: 'customer.phone', label: 'Customer Primary Phone', description: 'Primary contact phone for the customer', category: 'customer', kind: 'phone', sample: '(555) 123-4567' },
  { path: 'customer.address', label: 'Customer Address', description: 'Customer billing address', category: 'customer', kind: 'address' },
  { path: 'customer.primary_contact_name', label: 'Primary Contact Name', description: 'Primary contact full name', category: 'customer', kind: 'text', sample: 'Jane Doe' },
  { path: 'customer.primary_contact_email', label: 'Primary Contact Email', description: 'Primary contact direct email', category: 'customer', kind: 'email', sample: 'jane@acme.com' },
  { path: 'customer.primary_contact_phone', label: 'Primary Contact Phone', description: 'Primary contact direct phone', category: 'customer', kind: 'phone', sample: '(555) 123-4599' },

  // ── Pickup Location ──
  { path: 'pickup.name', label: 'Pickup Org Name', description: 'Origin terminal / warehouse name', category: 'pickup', kind: 'text', sample: 'APM Terminal Pier 400' },
  { path: 'pickup.city', label: 'Pickup City', description: 'Origin city', category: 'pickup', kind: 'text', sample: 'Long Beach' },
  { path: 'pickup.state', label: 'Pickup State', description: 'Origin state', category: 'pickup', kind: 'text', sample: 'CA' },
  { path: 'pickup.zip', label: 'Pickup ZIP', description: 'Origin ZIP code', category: 'pickup', kind: 'text', sample: '90802' },
  { path: 'pickup.address', label: 'Pickup Full Address', description: 'Full origin address', category: 'pickup', kind: 'address' },
  { path: 'pickup.firms_code', label: 'Pickup FIRMS Code', description: 'Origin terminal FIRMS code', category: 'pickup', kind: 'text', sample: 'Y792' },
  { path: 'pickup.scac', label: 'Pickup SCAC', description: 'Origin terminal SCAC code', category: 'pickup', kind: 'text', sample: 'APMT' },
  { path: 'pickup.appointment_date', label: 'Pickup Appt Date', description: 'Scheduled pickup appointment date', category: 'pickup', kind: 'date' },
  { path: 'pickup.appointment_time', label: 'Pickup Appt Time', description: 'Scheduled pickup appointment time', category: 'pickup', kind: 'datetime' },
  { path: 'pickup.arrived_at', label: 'Pickup Arrived', description: 'When the driver arrived at pickup', category: 'pickup', kind: 'datetime' },
  { path: 'pickup.departed_at', label: 'Pickup Departed', description: 'When the driver departed from pickup', category: 'pickup', kind: 'datetime' },

  // ── Delivery Location ──
  { path: 'delivery.name', label: 'Delivery Name', description: 'Consignee / warehouse name', category: 'delivery', kind: 'text', required: true, sample: 'ACME DC-Ontario' },
  { path: 'delivery.city', label: 'Delivery City', description: 'Destination city', category: 'delivery', kind: 'text', sample: 'Ontario' },
  { path: 'delivery.state', label: 'Delivery State', description: 'Destination state', category: 'delivery', kind: 'text', sample: 'CA' },
  { path: 'delivery.zip', label: 'Delivery ZIP', description: 'Destination ZIP code', category: 'delivery', kind: 'text' },
  { path: 'delivery.address', label: 'Delivery Full Address', description: 'Full destination address', category: 'delivery', kind: 'address' },
  { path: 'delivery.appointment_date', label: 'Delivery Appt Date', description: 'Scheduled delivery appointment date', category: 'delivery', kind: 'date' },
  { path: 'delivery.appointment_time', label: 'Delivery Appt Time', description: 'Scheduled delivery appointment time', category: 'delivery', kind: 'datetime' },
  { path: 'delivery.arrived_at', label: 'Delivery Arrived', description: 'When the driver arrived at delivery', category: 'delivery', kind: 'datetime' },
  { path: 'delivery.departed_at', label: 'Delivery Departed', description: 'When the driver departed from delivery', category: 'delivery', kind: 'datetime' },

  // ── Return Location ──
  { path: 'return.name', label: 'Return Name', description: 'Empty return terminal name', category: 'return', kind: 'text', sample: 'PCT Pier T' },
  { path: 'return.city', label: 'Return City', description: 'Return terminal city', category: 'return', kind: 'text' },
  { path: 'return.state', label: 'Return State', description: 'Return terminal state', category: 'return', kind: 'text' },
  { path: 'return.zip', label: 'Return ZIP', description: 'Return terminal ZIP', category: 'return', kind: 'text' },
  { path: 'return.address', label: 'Return Full Address', description: 'Full return terminal address', category: 'return', kind: 'address' },
  { path: 'return.appointment_date', label: 'Return Appt Date', description: 'Scheduled return appointment date', category: 'return', kind: 'date' },
  { path: 'return.appointment_time', label: 'Return Appt Time', description: 'Scheduled return appointment time', category: 'return', kind: 'datetime' },
  { path: 'return.arrived_at', label: 'Returned Arrived', description: 'When the driver arrived at return', category: 'return', kind: 'datetime' },
  { path: 'return.empty_returned_at', label: 'Empty Returned At', description: 'When the empty container was actually returned', category: 'return', kind: 'datetime' },

  // ── Driver ──
  { path: 'driver.first_name', label: 'Driver First Name', description: 'Assigned driver first name', category: 'driver', kind: 'text', sample: 'Miguel' },
  { path: 'driver.last_name', label: 'Driver Last Name', description: 'Assigned driver last name', category: 'driver', kind: 'text', sample: 'Garcia' },
  { path: 'driver.full_name', label: 'Driver Full Name', description: 'Assigned driver full name', category: 'driver', kind: 'text', sample: 'Miguel Garcia' },
  { path: 'driver.phone', label: 'Driver Phone', description: 'Assigned driver phone number', category: 'driver', kind: 'phone', sample: '(555) 789-4411' },
  { path: 'driver.email', label: 'Driver Email', description: 'Assigned driver email', category: 'driver', kind: 'email' },
  { path: 'driver.cdl_number', label: 'Driver CDL #', description: "Driver's CDL license number", category: 'driver', kind: 'text' },

  // ── Truck ──
  { path: 'truck.unit_number', label: 'Truck Unit #', description: 'Unit / fleet number of the tractor', category: 'truck', kind: 'text', sample: 'T-142' },
  { path: 'truck.plate', label: 'Truck License Plate', description: 'Tractor license plate number', category: 'truck', kind: 'text' },
  { path: 'truck.vin', label: 'Truck VIN', description: 'Tractor VIN (last 6 typical)', category: 'truck', kind: 'text' },

  // ── Charges ──
  { path: 'charges.linehaul_amount', label: 'Linehaul Amount', description: 'Total linehaul charge', category: 'charges', kind: 'currency', sample: '$875.00' },
  { path: 'charges.fuel_surcharge_amount', label: 'Fuel Surcharge', description: 'Fuel surcharge line total', category: 'charges', kind: 'currency', sample: '$131.25' },
  { path: 'charges.accessorials_amount', label: 'Accessorials Total', description: 'Total of all accessorial line items', category: 'charges', kind: 'currency', sample: '$150.00' },
  { path: 'charges.subtotal', label: 'Subtotal', description: 'Pre-tax subtotal of all charges', category: 'charges', kind: 'currency', sample: '$1,156.25' },
  { path: 'charges.total', label: 'Invoice Total', description: 'Total amount due on this load', category: 'charges', kind: 'currency', required: true, sample: '$1,156.25' },
  { path: 'charges.invoice_number', label: 'Invoice Number', description: 'Issued invoice number (if one has been created)', category: 'charges', kind: 'text', sample: 'INV-ABC001234' },
  { path: 'charges.invoice_date', label: 'Invoice Date', description: 'Date the invoice was issued', category: 'charges', kind: 'date' },
  { path: 'charges.payment_terms_days', label: 'Payment Terms', description: 'Days until payment is due', category: 'charges', kind: 'number', sample: '30' },
  { path: 'charges.due_date', label: 'Payment Due Date', description: 'Calculated payment due date', category: 'charges', kind: 'date' },
  { path: 'charges.charge_set_status', label: 'Charge Set Status', description: 'Status of the charge set (Draft / Ready / Invoiced / Paid)', category: 'charges', kind: 'text', sample: 'Ready to Invoice' },
  { path: 'charges.line_items_table', label: 'Line Items Table', description: 'HTML table of all line items (for invoice templates)', category: 'charges', kind: 'text' },

  // ── Dates ──
  { path: 'dates.now', label: 'Current Date/Time', description: 'Current moment at send time, in the tenant timezone', category: 'dates', kind: 'datetime' },
  { path: 'dates.today', label: 'Today', description: "Today's date at send time", category: 'dates', kind: 'date' },

  // ── Tenant (Carrier) ──
  { path: 'tenant.name', label: 'Carrier Name', description: 'Your company name', category: 'tenant', kind: 'text', sample: 'Test Truck Lines' },
  { path: 'tenant.display_name', label: 'Carrier Display Name', description: 'Your company display name (if set), else legal name', category: 'tenant', kind: 'text' },
  { path: 'tenant.scac_code', label: 'Carrier SCAC', description: 'Your 4-letter SCAC code', category: 'tenant', kind: 'text', sample: 'TSTT' },
  { path: 'tenant.mc_number', label: 'MC Number', description: 'Your MC authority number', category: 'tenant', kind: 'text' },
  { path: 'tenant.dot_number', label: 'DOT Number', description: 'Your DOT number', category: 'tenant', kind: 'text' },
  { path: 'tenant.phone', label: 'Carrier Main Phone', description: 'Main company contact phone', category: 'tenant', kind: 'phone' },
  { path: 'tenant.email', label: 'Carrier Main Email', description: 'Main company contact email', category: 'tenant', kind: 'email' },
  { path: 'tenant.address', label: 'Carrier Address', description: 'Company mailing address', category: 'tenant', kind: 'address' },
  { path: 'tenant.logo_url', label: 'Carrier Logo URL', description: 'Full URL to the company large logo', category: 'tenant', kind: 'url' },

  // ── User (Sender) ──
  { path: 'user.first_name', label: 'Sender First Name', description: 'First name of the user who triggered the send', category: 'user', kind: 'text' },
  { path: 'user.last_name', label: 'Sender Last Name', description: 'Last name of the user who triggered the send', category: 'user', kind: 'text' },
  { path: 'user.full_name', label: 'Sender Full Name', description: 'Full name of the sender', category: 'user', kind: 'text', sample: 'Bento Box' },
  { path: 'user.email', label: 'Sender Email', description: 'Email address of the sender', category: 'user', kind: 'email' },
  { path: 'user.title', label: 'Sender Title', description: 'Job title of the sender (if set)', category: 'user', kind: 'text' },
  { path: 'user.phone', label: 'Sender Phone', description: 'Direct phone number of the sender', category: 'user', kind: 'phone' },

  // ── System ──
  { path: 'system.app_url', label: 'App URL', description: 'Base URL of the DrayageDirect app', category: 'system', kind: 'url', sample: 'https://app.drayagedirect.io' },
  { path: 'system.load_url', label: 'Load Detail URL', description: 'Direct URL to the load detail page (dispatcher view)', category: 'system', kind: 'url' },
  { path: 'system.tracking_url', label: 'Customer Tracking URL', description: 'Public customer tracking URL for the load', category: 'system', kind: 'url' },
  { path: 'system.unsubscribe_url', label: 'Unsubscribe URL', description: 'One-click unsubscribe link (required on marketing sends)', category: 'system', kind: 'url' },

  // ── Invoice ──
  { path: 'invoice.number', label: 'Invoice Number', description: 'Issued invoice number (single-send; falls back to first invoice in bulk)', category: 'charges', kind: 'text', sample: 'INV-00042' },
  { path: 'invoice.total', label: 'Invoice Total', description: 'Total amount due on the invoice', category: 'charges', kind: 'currency', sample: '$1,250.00' },
  { path: 'invoice.subtotal', label: 'Invoice Subtotal', description: 'Pre-tax subtotal on the invoice', category: 'charges', kind: 'currency', sample: '$1,250.00' },
  { path: 'invoice.due_date', label: 'Invoice Due Date', description: 'Payment due date on the invoice', category: 'charges', kind: 'date', sample: 'May 17, 2026' },
  { path: 'invoice.issue_date', label: 'Invoice Issue Date', description: 'Date the invoice was issued / sent', category: 'charges', kind: 'date', sample: 'Apr 17, 2026' },
  { path: 'invoice.reference_number', label: 'Invoice Reference Number', description: "Customer reference or order number linked to this invoice", category: 'charges', kind: 'text', sample: 'PO-887744' },

  // ── Invoice (bulk-aware) ──
  // Context contract: the bulk context builder pre-computes these into
  // context.invoice.* so getByPath resolves them transparently. Currency
  // kind receives dollar values (not cents) — the context builder divides.
  { path: 'invoice.numbers', label: 'Invoice Numbers (bulk)', description: 'Comma-joined list of all invoice numbers in this bulk send group', category: 'charges', kind: 'text', sample: 'INV-00042, INV-00043, INV-00044' },
  { path: 'invoice.count', label: 'Invoice Count', description: 'Number of invoices in this bulk email', category: 'charges', kind: 'text', sample: '3' },
  { path: 'invoice.total_bulk', label: 'Invoice Total (bulk-aware)', description: 'Sum of all invoice totals in the group (pre-divided to dollars by context builder)', category: 'charges', kind: 'currency', sample: '$3,500.00' },
  { path: 'invoice.earliest_due', label: 'Earliest Due Date (bulk-aware)', description: 'Earliest payment due date across all invoices in the group', category: 'charges', kind: 'date', sample: 'May 1, 2026' },

  // ── Charge Set ──
  { path: 'charge_set.number', label: 'Charge Set Number', description: 'Charge set identifier number', category: 'charges', kind: 'text', sample: 'CS-00099' },
  { path: 'charge_set.total', label: 'Charge Set Total', description: 'Total amount on this charge set', category: 'charges', kind: 'currency', sample: '$1,250.00' },
  { path: 'charge_set.reference_number', label: 'Charge Set Reference', description: "Customer reference or order number on this charge set", category: 'charges', kind: 'text', sample: 'PO-887744' },
  // Bulk-only tokens populated by buildBulkChargeSetContext. In single-send
  // context they fall through to the resolver's empty placeholder.
  { path: 'charge_set.numbers', label: 'Charge Set Numbers (bulk)', description: 'Comma-joined list of all charge-set numbers in this bulk send group', category: 'charges', kind: 'text', sample: 'CS-00099, CS-00100, CS-00101' },
  { path: 'charge_set.count', label: 'Charge Set Count', description: 'Number of charge sets in this bulk email', category: 'charges', kind: 'text', sample: '3' },
  { path: 'charge_set.total_bulk', label: 'Charge Set Total (bulk-aware)', description: 'Sum of all charge-set totals in the group (pre-divided to dollars by context builder)', category: 'charges', kind: 'currency', sample: '$3,750.00' },
];

/**
 * Index variables by path for O(1) lookup during resolution.
 * @type {Map<string, (typeof EMAIL_VARIABLES)[number]>}
 */
export const EMAIL_VARIABLES_BY_PATH = new Map(EMAIL_VARIABLES.map((v) => [v.path, v]));

/**
 * Group variables by category for the picker UI.
 */
export function groupVariablesByCategory() {
  const groups = new Map(VARIABLE_CATEGORIES.map((c) => [c.key, { ...c, variables: [] }]));
  for (const v of EMAIL_VARIABLES) {
    const g = groups.get(v.category);
    if (g) g.variables.push(v);
  }
  return Array.from(groups.values());
}

/**
 * Find all variable references inside a template body (html or text).
 * Returns an array of { path, start, end } for every {{path}} occurrence.
 *
 * Tolerates whitespace inside the braces: `{{ load.order_number }}` works.
 * Ignores `{{{foo}}}` (triple-brace raw HTML escapes — rare in our templates).
 */
export function findVariableReferences(body) {
  if (!body || typeof body !== 'string') return [];
  const out = [];
  const re = /\{\{\s*([a-zA-Z_][\w.]*)\s*\}\}/g;
  let match;
  while ((match = re.exec(body))) {
    out.push({ path: match[1], start: match.index, end: match.index + match[0].length });
  }
  return out;
}

/**
 * Validate a template body by confirming every {{path}} reference exists in
 * the catalog. Returns { valid, unknownVariables } — if valid=false, the list
 * tells the editor exactly what the user needs to fix.
 */
export function validateTemplateBody(body) {
  const refs = findVariableReferences(body);
  const unknown = new Set();
  for (const r of refs) {
    if (!EMAIL_VARIABLES_BY_PATH.has(r.path)) {
      unknown.add(r.path);
    }
  }
  return {
    valid: unknown.size === 0,
    unknownVariables: Array.from(unknown),
    totalReferences: refs.length,
  };
}

/**
 * Return the list of variable paths that a given template body references.
 * Used by the trigger engine to decide which data to hydrate before resolving.
 */
export function extractReferencedPaths(body) {
  const paths = new Set();
  for (const r of findVariableReferences(body)) {
    paths.add(r.path);
  }
  return Array.from(paths);
}
