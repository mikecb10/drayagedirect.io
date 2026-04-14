/**
 * Organization Form Configuration
 *
 * Determines which form sections and fields are visible based on the
 * selected organization type(s). When multiple types are selected,
 * the UNION of all fields is shown (largest set wins).
 */

// Which sections each org type needs
const TYPE_SECTIONS = {
  customer: {
    terminalHeader: false,
    company: true,
    email: true,        // full: billing, receiver, QB, portal, domain
    payment: true,      // full: credit limit, account hold, currency
    contact: true,      // with office hours
    orgSubtype: true,
    quickbooks: true,   // both QB email and QB company field
    preferences: true,
    paymentTerms: true,
    invoiceCombination: true,
    requiredDocuments: true,
  },
  warehouse: {
    terminalHeader: false,
    company: true,
    email: 'partial',   // receiver email, portal, domain — NO billing, NO QB email
    payment: 'light',   // account hold, currency — NO credit limit
    contact: true,      // with office hours
    orgSubtype: true,
    quickbooks: false,
    preferences: true,
    paymentTerms: true,
    invoiceCombination: false,
  },
  yard: {
    terminalHeader: false,
    company: true,
    email: false,
    payment: false,
    contact: 'basic',   // no office hours
    orgSubtype: true,
    quickbooks: 'company_only', // QB company field only, no QB email
    preferences: false,
    paymentTerms: true,
    invoiceCombination: false,
  },
  terminal: {
    terminalHeader: true,
    company: true,
    email: false,
    payment: false,
    contact: true,      // with office hours
    orgSubtype: true,
    quickbooks: false,
    preferences: true,
    paymentTerms: true,
    invoiceCombination: false,
  },
  final_destination: {
    terminalHeader: false,
    company: true,
    email: false,
    payment: false,
    contact: true,      // with office hours
    orgSubtype: true,
    quickbooks: false,
    preferences: false,
    paymentTerms: true,
    invoiceCombination: false,
  },
};

/**
 * Given an array of selected org types, compute which sections to show.
 * Uses UNION logic — if ANY selected type needs a section, show it.
 * Returns the "highest" level for each section.
 */
export function getVisibleSections(customerTypes = []) {
  if (customerTypes.length === 0) return {};

  const result = {};
  const allSections = Object.keys(TYPE_SECTIONS.customer);

  for (const section of allSections) {
    let highest = false;
    for (const type of customerTypes) {
      const config = TYPE_SECTIONS[type];
      if (!config) continue;
      const val = config[section];
      if (val === true) { highest = true; break; }
      if (val === 'partial' && highest !== true) highest = 'partial';
      if (val === 'light' && highest !== true && highest !== 'partial') highest = 'light';
      if (val === 'basic' && !highest) highest = 'basic';
      if (val === 'company_only' && !highest) highest = 'company_only';
    }
    result[section] = highest;
  }

  return result;
}

/**
 * Organization Subtype options — tags describing what the org does in the industry.
 */
export const ORG_SUBTYPES = [
  'MVOCC',
  'Freight Forwarder',
  'Truck Broker',
  'Importer/Exporter',
  'Customs Brokerage',
  'Terminal',
  'Rail',
  'Yard',
  'Warehouse',
  'Bill to Customer',
  'Container Depot',
  'Port',
  'Shipping Line',
  'Retail',
  '3PL',
  'Other',
];

/**
 * Invoice combination options
 */
export const INVOICE_COMBINATIONS = [
  { value: 'manually', label: 'Manually' },
  { value: 'by_load', label: 'By Load' },
  { value: 'by_day', label: 'By Day' },
  { value: 'by_week', label: 'By Week' },
  { value: 'by_reference', label: 'By Reference # (when all completed)' },
  { value: 'all_completed', label: 'All Completed Loads' },
];

/**
 * Payment terms "from" options
 */
export const PAYMENT_TERMS_FROM = [
  { value: 'invoice_date', label: 'Invoice Date' },
  { value: 'last_day_of_month', label: 'Last Day of Invoice Month' },
];

/**
 * Pay type options
 */
export const PAY_TYPES = [
  { value: 'direct_pay', label: 'Direct Pay' },
  { value: 'factoring', label: 'Factoring' },
];

/**
 * Required Document Types — documents the driver MUST upload via mobile
 * app before marking a load as completed for this customer.
 * Dispatchers can still manually complete loads without these docs.
 */
export const REQUIRED_DOCUMENT_TYPES = [
  // Gate & Terminal
  { value: 'TIR_IN', label: 'TIR In' },
  { value: 'TIR_OUT', label: 'TIR Out' },
  { value: 'TIR', label: 'TIR' },
  { value: 'TIR_CHASSIS', label: 'TIR Chassis' },
  { value: 'DELIVERY_ORDER', label: 'Delivery Order' },
  { value: '635_INGATE', label: '635 Ingate Receipt' },
  { value: '635_OUTGATE', label: '635 Outgate Receipt' },
  { value: 'PIER_PASS', label: 'Pier Pass (Receipt)' },
  { value: 'LIFT_TICKET', label: 'Lift Ticket' },
  { value: 'VOID_OUT_TICKET', label: 'Void Out Ticket' },
  // Pricing & Billing
  { value: 'QUOTE', label: 'Quote' },
  { value: 'RATE_CONFIRMATION', label: 'Rate Confirmation' },
  { value: 'RATE_CON', label: 'Rate Con' },
  { value: 'INVOICE', label: 'Invoice' },
  { value: 'VENDOR_INVOICE', label: 'Vendor Invoice' },
  { value: 'CHARGE_APPROVAL_EMAIL', label: 'Charge Approval Email' },
  { value: 'BOOKING_CONFIRMATION', label: 'Booking Confirmation' },
  { value: '204_X12', label: '204 x12' },
  // Cargo & Shipping
  { value: 'PACKING_SLIP', label: 'Packing Slip' },
  { value: 'DOCK_RECEIPT', label: 'Dock Receipt' },
  { value: 'SCALE_TICKET', label: 'Scale Ticket' },
  { value: 'RECEIVING_TALLY', label: 'Receiving Tally' },
  { value: 'SHIPPING_TALLY', label: 'Shipping Tally' },
  // Seals
  { value: 'SEAL_IMPORT', label: 'Seal Import' },
  { value: 'SEAL_EXPORT', label: 'Seal Export' },
  { value: 'SEAL_IMPROPER', label: 'Seal Improper' },
  // Equipment Photos & Inspection
  { value: 'CONTAINER_CHASSIS_IN', label: 'Container/Chassis In - Picture' },
  { value: 'CONTAINER_CHASSIS_OUT', label: 'Container/Chassis Out - Picture' },
  { value: 'GENSET_IN_OUT', label: 'Genset Picture In/Out' },
  { value: 'TEMPERATURE_UNIT', label: 'Temperature Unit' },
  { value: 'SETPOINT_SETTINGS', label: 'Setpoint / Settings' },
  { value: 'PTI_STICKER', label: 'PTI Sticker' },
  { value: 'INTERIOR_CONDITION', label: 'Interior Condition' },
  { value: 'DRAIN_CONDITION', label: 'Drain Condition' },
  { value: 'CSC_PLATE', label: 'CSC Plate' },
  { value: 'FUNCTIONALITY_CHECK', label: 'Functionality Check' },
  { value: 'EXTERIOR_CONDITION', label: 'Exterior Condition' },
  { value: 'INSPECTION_SHEET', label: 'Inspection Sheet' },
  // Damage & Issues
  { value: 'DAMAGED_CARGO_BOX', label: 'Damaged Cargo/Box' },
  { value: 'DEBRIS_PICS', label: 'Debris Pics' },
  { value: 'DETENTION_PICS', label: 'Detention PICs' },
  { value: 'CITATION', label: 'Citation' },
  // Fees & Charges
  { value: 'TOLLS', label: 'Tolls' },
  { value: 'LUMPER_RECEIPT', label: 'Lumper Receipt' },
  { value: 'DEMURRAGE', label: 'Demurrage (Receipt)' },
  { value: 'PER_DIEM', label: 'Per Diem' },
  { value: 'WAIT_TIME', label: 'Wait Time' },
  // Hazmat & Compliance
  { value: 'HAZ_MAT', label: 'Haz Mat' },
  { value: 'SDS', label: 'SDS' },
  { value: 'MSDS', label: 'MSDS' },
  { value: 'DG', label: 'DG (Dangerous Goods)' },
  { value: 'CUSTOMS_FORM', label: 'Customs Form' },
  { value: 'BOND_PAPERWORK', label: 'Bond Paperwork' },
  { value: 'CARTA_PORTE', label: 'Carta Porte' },
  // Driver & Settlement
  { value: 'J1', label: 'J1' },
  { value: 'J2', label: 'J2' },
  { value: 'SOP', label: 'SOP' },
  // Other
  { value: 'OTHER', label: 'Other' },
];
