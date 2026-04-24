/**
 * AR Charge Profile Rule Definitions
 *
 * Defines all 50+ rule types available in the AR charge profile
 * conditions engine. Each rule specifies:
 *   - key: unique identifier stored in conditions JSONB
 *   - label: display name
 *   - category: grouping in the rule picker dropdown
 *   - operators: which operators are valid for this rule
 *   - valueType: how to render the value picker
 *   - valueSource: where to fetch options (API endpoint or static list)
 */

// ── Operator definitions ─────────────────────────────────────
export const OPERATORS = {
  ANY_IN: { value: 'any_in', label: 'Any In' },
  NOT_IN: { value: 'not_in', label: 'Not In' },
  EQUAL: { value: 'equal', label: 'Equal' },
  NOT_EQUAL: { value: 'not_equal', label: 'Not Equal' },
  LARGER: { value: 'larger', label: 'Greater Than' },
  SMALLER: { value: 'smaller', label: 'Less Than' },
  LARGER_OR_EQUAL: { value: 'larger_or_equal', label: 'Greater or Equal' },
  SMALLER_OR_EQUAL: { value: 'smaller_or_equal', label: 'Less or Equal' },
  BETWEEN: { value: 'between', label: 'Between' },
  NOT_BETWEEN: { value: 'not_between', label: 'Not Between' },
};

const SET_OPS = [OPERATORS.ANY_IN, OPERATORS.NOT_IN];
const BOOL_OPS = [OPERATORS.ANY_IN, OPERATORS.NOT_IN];
const COMPARISON_OPS = [OPERATORS.EQUAL, OPERATORS.NOT_EQUAL, OPERATORS.LARGER, OPERATORS.SMALLER, OPERATORS.LARGER_OR_EQUAL, OPERATORS.SMALLER_OR_EQUAL, OPERATORS.BETWEEN, OPERATORS.NOT_BETWEEN];
const REEFER_OPS = [...SET_OPS, OPERATORS.EQUAL, OPERATORS.NOT_EQUAL, OPERATORS.LARGER_OR_EQUAL, OPERATORS.SMALLER_OR_EQUAL];

// ── Value type definitions ───────────────────────────────────
// Tells the ConditionBuilder how to render the value picker
// 'multi_select_api' = fetch from API, render as multi-select
// 'multi_select_static' = static options, render as multi-select
// 'boolean' = Yes/No toggle
// 'number' = number input (single or dual for BETWEEN)
// 'time' = time input (HH:MM, single or dual for BETWEEN)
// 'text' = freetext input
// 'city_state' = Google-powered city/state autocomplete (future)

// ── Rule definitions ─────────────────────────────────────────
export const AR_RULES = [
  // ── Load & Customer Context ──
  {
    key: 'load_type',
    label: 'Load Type',
    category: 'Load & Customer',
    operators: SET_OPS,
    valueType: 'multi_select_static',
    options: [
      { value: 'import', label: 'Import' },
      { value: 'export', label: 'Export' },
      { value: 'road', label: 'Road' },
      { value: 'bill_only', label: 'Bill Only' },
      { value: 'inbound', label: 'Inbound' },
      { value: 'outbound', label: 'Outbound' },
    ],
  },
  {
    key: 'customer',
    label: 'Customer',
    category: 'Load & Customer',
    operators: SET_OPS,
    valueType: 'multi_select_api',
    valueSource: '/api/tenant/organizations?type=customer',
    valueKey: 'organizations',
    labelField: 'name',
    idField: 'id',
  },
  {
    key: 'terminal',
    label: 'Terminal',
    category: 'Load & Customer',
    operators: SET_OPS,
    valueType: 'multi_select_api',
    valueSource: '/api/tenant/organizations?type=terminal',
    valueKey: 'organizations',
    labelField: 'name',
    idField: 'id',
  },
  {
    key: 'warehouse',
    label: 'Warehouse',
    category: 'Load & Customer',
    operators: SET_OPS,
    valueType: 'multi_select_api',
    valueSource: '/api/tenant/organizations?type=warehouse',
    valueKey: 'organizations',
    labelField: 'name',
    idField: 'id',
  },
  {
    key: 'branch',
    label: 'Branch',
    category: 'Load & Customer',
    operators: SET_OPS,
    valueType: 'multi_select_api',
    valueSource: '/api/tenant/branches?status=active',
    valueKey: 'branches',
    labelField: 'name',
    idField: 'id',
  },
  {
    key: 'csr',
    label: 'CSR',
    category: 'Load & Customer',
    operators: SET_OPS,
    valueType: 'multi_select_api',
    valueSource: '/api/tenant/users?status=active',
    valueKey: 'users',
    labelField: 'name',
    idField: 'id',
  },

  // ── Locations & Routing ──
  {
    key: 'chassis_pickup',
    label: 'Chassis Pick Up',
    category: 'Locations',
    operators: SET_OPS,
    valueType: 'multi_select_api',
    valueSource: '/api/tenant/organizations?type=yard',
    valueKey: 'organizations',
    labelField: 'name',
    idField: 'id',
  },
  {
    key: 'hook_chassis',
    label: 'Hook Chassis',
    category: 'Locations',
    operators: SET_OPS,
    valueType: 'multi_select_api',
    valueSource: '/api/tenant/organizations',
    valueKey: 'organizations',
    labelField: 'name',
    idField: 'id',
    helpText: 'Pick up event location',
  },
  {
    key: 'container_return',
    label: 'Container Return',
    category: 'Locations',
    operators: SET_OPS,
    valueType: 'multi_select_api',
    valueSource: '/api/tenant/organizations?type=terminal',
    valueKey: 'organizations',
    labelField: 'name',
    idField: 'id',
  },
  {
    key: 'chassis_termination',
    label: 'Chassis Termination',
    category: 'Locations',
    operators: SET_OPS,
    valueType: 'multi_select_api',
    valueSource: '/api/tenant/organizations',
    valueKey: 'organizations',
    labelField: 'name',
    idField: 'id',
    helpText: 'Return or delivery event location',
  },
  {
    key: 'drop_location',
    label: 'Drop Location',
    category: 'Locations',
    operators: SET_OPS,
    valueType: 'multi_select_api',
    valueSource: '/api/tenant/organizations?type=warehouse',
    valueKey: 'organizations',
    labelField: 'name',
    idField: 'id',
    helpText: 'Warehouses & Yards',
  },
  {
    key: 'city_state',
    label: 'City-State',
    category: 'Locations',
    operators: SET_OPS,
    valueType: 'text_tags',
    helpText: 'Enter city, state (e.g. Houston, TX)',
  },
  {
    key: 'state',
    label: 'State',
    category: 'Locations',
    operators: SET_OPS,
    valueType: 'multi_select_static',
    options: [
      'AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA','KS','KY','LA','ME','MD',
      'MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK','OR','PA','RI','SC',
      'SD','TN','TX','UT','VT','VA','WA','WV','WI','WY','DC',
    ].map((s) => ({ value: s, label: s })),
  },
  {
    key: 'delivery_country',
    label: 'Delivery Country',
    category: 'Locations',
    operators: SET_OPS,
    valueType: 'multi_select_static',
    options: [
      { value: 'US', label: 'United States' },
      { value: 'CA', label: 'Canada' },
      { value: 'MX', label: 'Mexico' },
    ],
  },
  {
    key: 'postal_zip_code',
    label: 'Postal/Zip Code',
    category: 'Locations',
    operators: SET_OPS,
    valueType: 'text_tags',
    helpText: 'Enter zip codes',
  },

  // ── Equipment ──
  {
    key: 'container_type',
    label: 'Container Type',
    category: 'Equipment',
    operators: SET_OPS,
    valueType: 'multi_select_api',
    valueSource: '/api/tenant/container-types?enabled=true',
    valueKey: 'items',
    labelField: 'label',
    idField: 'code',
  },
  {
    key: 'container_size',
    label: 'Container Size',
    category: 'Equipment',
    operators: SET_OPS,
    valueType: 'multi_select_api',
    valueSource: '/api/tenant/container-sizes?enabled=true',
    valueKey: 'items',
    labelField: 'label',
    idField: 'code',
  },
  {
    key: 'steamship_line',
    label: 'Steamship Line',
    category: 'Equipment',
    operators: SET_OPS,
    valueType: 'multi_select_api',
    valueSource: '/api/tenant/container-owners',
    valueKey: 'container_owners',
    labelField: 'name',
    idField: 'id',
  },
  {
    key: 'chassis_type',
    label: 'Chassis Type',
    category: 'Equipment',
    operators: SET_OPS,
    valueType: 'multi_select_api',
    valueSource: '/api/tenant/chassis-types?enabled=true',
    valueKey: 'items',
    labelField: 'label',
    idField: 'code',
  },
  {
    key: 'chassis_size',
    label: 'Chassis Size',
    category: 'Equipment',
    operators: SET_OPS,
    valueType: 'multi_select_api',
    valueSource: '/api/tenant/chassis-sizes?enabled=true',
    valueKey: 'items',
    labelField: 'label',
    idField: 'code',
  },
  {
    key: 'chassis_owner',
    label: 'Chassis Owner',
    category: 'Equipment',
    operators: SET_OPS,
    valueType: 'multi_select_api',
    valueSource: '/api/tenant/chassis-owners?enabled=true',
    valueKey: 'chassis_owners',
    labelField: 'name',
    idField: 'id',
  },
  {
    key: 'chassis_prefix',
    label: 'Chassis Prefix',
    category: 'Equipment',
    operators: SET_OPS,
    valueType: 'text_tags',
    helpText: 'Enter chassis prefix codes',
  },

  // ── Boolean Flags ──
  { key: 'is_hot', label: 'Hot', category: 'Flags', operators: BOOL_OPS, valueType: 'boolean' },
  { key: 'is_hazmat', label: 'Hazmat', category: 'Flags', operators: BOOL_OPS, valueType: 'boolean' },
  { key: 'is_overweight', label: 'Overweight', category: 'Flags', operators: BOOL_OPS, valueType: 'boolean' },
  { key: 'is_genset', label: 'Genset', category: 'Flags', operators: BOOL_OPS, valueType: 'boolean' },
  { key: 'is_scale', label: 'Scale', category: 'Flags', operators: BOOL_OPS, valueType: 'boolean' },
  { key: 'is_ev', label: 'EV', category: 'Flags', operators: BOOL_OPS, valueType: 'boolean' },
  { key: 'is_bonded', label: 'Bonded', category: 'Flags', operators: BOOL_OPS, valueType: 'boolean' },
  { key: 'is_oog', label: 'OOG', category: 'Flags', operators: BOOL_OPS, valueType: 'boolean' },
  { key: 'is_double', label: 'Double', category: 'Flags', operators: BOOL_OPS, valueType: 'boolean' },
  { key: 'is_tanker', label: 'Tanker', category: 'Flags', operators: BOOL_OPS, valueType: 'boolean' },
  { key: 'is_liquor', label: 'Liquor', category: 'Flags', operators: BOOL_OPS, valueType: 'boolean' },
  { key: 'is_street_turn', label: 'Street Turn', category: 'Flags', operators: BOOL_OPS, valueType: 'boolean' },
  { key: 'dual_transaction', label: 'Dual Transaction', category: 'Flags', operators: BOOL_OPS, valueType: 'boolean' },
  {
    key: 'is_reefer',
    label: 'Reefer',
    category: 'Flags',
    operators: REEFER_OPS,
    valueType: 'boolean_or_number',
    helpText: 'Yes/No or enter temperature value',
  },

  // ── Time & Schedule ──
  {
    key: 'delivery_day',
    label: 'Delivery Day',
    category: 'Time & Schedule',
    operators: SET_OPS,
    valueType: 'multi_select_static',
    options: [
      { value: 'sunday', label: 'Sunday' },
      { value: 'monday', label: 'Monday' },
      { value: 'tuesday', label: 'Tuesday' },
      { value: 'wednesday', label: 'Wednesday' },
      { value: 'thursday', label: 'Thursday' },
      { value: 'friday', label: 'Friday' },
      { value: 'saturday', label: 'Saturday' },
    ],
  },
  {
    key: 'delivery_time',
    label: 'Delivery Time (24hrs)',
    category: 'Time & Schedule',
    operators: COMPARISON_OPS,
    valueType: 'time',
    helpText: 'Enter time in 24hr format (HH:MM)',
  },

  // ── Weight & Distance ──
  {
    key: 'commodities_weight',
    label: 'Commodities Weight',
    category: 'Weight & Distance',
    operators: COMPARISON_OPS,
    valueType: 'number',
    helpText: 'Weight in lbs',
  },
  {
    key: 'leg_distance',
    label: 'Leg Based Distance Validation',
    category: 'Weight & Distance',
    operators: COMPARISON_OPS,
    valueType: 'number',
    helpText: 'Distance in miles',
  },

  // ── Conditional Status ──
  {
    key: 'dropped',
    label: 'Dropped',
    category: 'Status',
    operators: SET_OPS,
    valueType: 'multi_select_static',
    options: [
      { value: 'after_delivery', label: 'After Delivery' },
      { value: 'before_delivery', label: 'Before Delivery' },
    ],
  },
  {
    key: 'stopoff',
    label: 'Stopoff',
    category: 'Status',
    operators: SET_OPS,
    valueType: 'multi_select_static',
    options: [], // TBD — stopoff types not yet discussed
    helpText: 'Stopoff types (coming soon)',
  },

  // ── Stop-Off Types (migration 100) ──
  // Keyed on routing-event rollups: "load has at least one event of this
  // stop-off type" / "load has at least one event whose stop-off type has
  // this behavior flag set". Paired with the stop_off_type join in the
  // tariff + driver-tariff engines so these work for both AR and AP.
  {
    key: 'event_stop_off_type_id',
    label: 'Has Stop-Off of Type',
    category: 'Stop-Offs',
    operators: SET_OPS,
    valueType: 'multi_select_api',
    valueSource: '/api/tenant/stop-off-types',
    valueKey: 'stop_off_types',
    labelField: 'name',
    idField: 'id',
    helpText: 'Match loads with at least one routing event of the selected stop-off type',
  },
  {
    key: 'event_has_cargo_transfer',
    label: 'Has Cargo-Transfer Stop-Off',
    category: 'Stop-Offs',
    operators: BOOL_OPS,
    valueType: 'boolean',
    helpText: 'True if any routing event is a cargo-transfer stop-off (cross-dock, trans-load)',
  },
  {
    key: 'event_is_paid_to_driver',
    label: 'Has Driver-Paid Stop-Off',
    category: 'Stop-Offs',
    operators: BOOL_OPS,
    valueType: 'boolean',
    helpText: 'True if any routing event is a stop-off type flagged as paid to driver',
  },
  {
    key: 'event_is_billable_to_customer',
    label: 'Has Customer-Billable Stop-Off',
    category: 'Stop-Offs',
    operators: BOOL_OPS,
    valueType: 'boolean',
    helpText: 'True if any routing event is a stop-off type flagged as billable to customer',
  },
  {
    key: 'event_counts_toward_detention',
    label: 'Has Detention-Counting Stop-Off',
    category: 'Stop-Offs',
    operators: BOOL_OPS,
    valueType: 'boolean',
    helpText: 'True if any routing event is a stop-off type flagged as counting toward detention',
  },
  {
    key: 'event_requires_location_pick',
    label: 'Has Location-Required Stop-Off',
    category: 'Stop-Offs',
    operators: BOOL_OPS,
    valueType: 'boolean',
    helpText: 'True if any routing event is a stop-off type that requires a picked location',
  },
  {
    key: 'street_turn_type',
    label: 'Street Turn Type',
    category: 'Status',
    operators: SET_OPS,
    valueType: 'multi_select_static',
    options: [
      { value: 'commercial', label: 'Commercial' },
      { value: 'operational', label: 'Operational' },
    ],
  },

  // ── Groups (future settings) ──
  {
    key: 'commodity_profile',
    label: 'Commodity Profile',
    category: 'Groups',
    operators: SET_OPS,
    valueType: 'multi_select_api',
    valueSource: '/api/tenant/commodity-profiles', // TBD
    valueKey: 'profiles',
    labelField: 'name',
    idField: 'id',
    helpText: 'Commodities created in settings (coming soon)',
  },
  {
    key: 'city_groups',
    label: 'City Groups',
    category: 'Groups',
    operators: SET_OPS,
    valueType: 'multi_select_api',
    valueSource: '/api/tenant/city-groups', // TBD
    valueKey: 'groups',
    labelField: 'name',
    idField: 'id',
    helpText: 'City groups (coming soon)',
  },
  {
    key: 'postal_zip_groups',
    label: 'Postal/Zip Code Groups',
    category: 'Groups',
    operators: SET_OPS,
    valueType: 'multi_select_api',
    valueSource: '/api/tenant/zip-groups', // TBD
    valueKey: 'groups',
    labelField: 'name',
    idField: 'id',
    helpText: 'Zip code groups (coming soon)',
  },
];

// ── Helpers ──────────────────────────────────────────────────

/** Get all unique categories for the rule picker dropdown grouping */
export const RULE_CATEGORIES = [...new Set(AR_RULES.map((r) => r.category))];

/** Find a rule definition by key */
export function getRuleByKey(key) {
  return AR_RULES.find((r) => r.key === key) || null;
}

/** Get rules grouped by category */
export function getRulesByCategory() {
  const grouped = {};
  for (const rule of AR_RULES) {
    if (!grouped[rule.category]) grouped[rule.category] = [];
    grouped[rule.category].push(rule);
  }
  return grouped;
}

/** Check if an operator requires two values (BETWEEN/NOT BETWEEN) */
export function isRangeOperator(op) {
  return op === 'between' || op === 'not_between';
}
