/**
 * RBAC — Role-Based Access Control constants and helpers.
 *
 * System roles are predefined templates. Each role pre-fills a set of
 * granular permissions. Admins can override with "Custom Permission".
 *
 * Granular permissions are organized into collapsible categories,
 * matching the PP-style checkbox tree in the Permissions tab.
 */

// ── System Roles ─────────────────────────────────────────────
export const SYSTEM_ROLES = [
  { value: 'super_admin', label: 'Super Admin', description: 'Full access. Tenant owner.' },
  { value: 'admin', label: 'Admin', description: 'Full access. Can manage users & settings.' },
  { value: 'dispatcher', label: 'Dispatcher', description: 'Dispatch board, loads, routing, drivers.' },
  { value: 'billing', label: 'Billing', description: 'Billing, charge profiles, tariffs, driver pay.' },
  { value: 'operations', label: 'Operations', description: 'Loads, routing, organizations, tracking.' },
  { value: 'sales_agent', label: 'Sales Agent', description: 'View loads & orgs. Create loads.' },
  { value: 'custom', label: 'Custom Permission', description: 'Pick-and-choose from permissions.' },
];

// ── Permission Categories & Items ────────────────────────────
// Each category has a key, label, and array of permission items.
// Items have: { key, label } — the key is stored in the DB.
export const PERMISSION_CATEGORIES = [
  {
    key: 'dispatcher',
    label: 'Dispatcher',
    permissions: [
      { key: 'dispatcher.view', label: 'View Dispatcher Board' },
      { key: 'dispatcher.edit', label: 'Edit Loads on Board' },
      { key: 'dispatcher.assign_driver', label: 'Assign Drivers' },
      { key: 'dispatcher.bulk_actions', label: 'Bulk Actions' },
      { key: 'dispatcher.export', label: 'Export Data' },
    ],
  },
  {
    key: 'loads',
    label: 'Organization Service',
    permissions: [
      { key: 'loads.create', label: 'Create Load' },
      { key: 'loads.edit', label: 'Edit Load' },
      { key: 'loads.delete', label: 'Delete Load' },
      { key: 'loads.duplicate', label: 'Duplicate Load' },
      { key: 'loads.view_deleted', label: 'View Deleted Loads' },
      { key: 'loads.restore_deleted', label: 'Restore Deleted Loads' },
    ],
  },
  {
    key: 'load_tabs',
    label: 'Load Detail Tabs',
    permissions: [
      { key: 'tabs.billing', label: 'Billing' },
      { key: 'tabs.driver_pay', label: 'Driver Pay' },
      { key: 'tabs.routing', label: 'Routing' },
      { key: 'tabs.tracking', label: 'Tracking' },
      { key: 'tabs.communication', label: 'Communication' },
      { key: 'tabs.documents', label: 'Documents' },
      { key: 'tabs.audit', label: 'Audit' },
      { key: 'tabs.notes', label: 'Notes' },
    ],
  },
  {
    key: 'accounts_receivable',
    label: 'Accounts Receivable',
    permissions: [
      { key: 'ar.billing_edit', label: 'Edit Billing' },
      { key: 'ar.billing_approve', label: 'Approve Billing' },
      { key: 'ar.invoices', label: 'Invoices' },
      { key: 'ar.apply_payment', label: 'Apply Payment' },
      { key: 'ar.credit_memo', label: 'Credit Memo' },
    ],
  },
  {
    key: 'accounts_payable',
    label: 'Accounts Payable',
    permissions: [
      { key: 'ap.driver_pay', label: 'Driver Pay' },
      { key: 'ap.driver_pay_approve', label: 'Approve Driver Pay' },
      { key: 'ap.driver_pay_delete', label: 'Delete Driver Pay' },
      { key: 'ap.driver_deductions', label: 'Driver Deductions' },
      { key: 'ap.settlements', label: 'Driver Settlements' },
    ],
  },
  {
    key: 'drivers',
    label: 'Drivers',
    permissions: [
      { key: 'drivers.profile', label: 'Driver Profile' },
      { key: 'drivers.pay_rates', label: 'Driver Pay Rates' },
      { key: 'drivers.assignments', label: 'Truck Assignments' },
    ],
  },
  {
    key: 'organizations',
    label: 'Organizations',
    permissions: [
      { key: 'orgs.view', label: 'View Organizations' },
      { key: 'orgs.create_edit', label: 'Create / Edit Organizations' },
      { key: 'orgs.people', label: 'People & Groups' },
      { key: 'orgs.geofence', label: 'Geofences' },
      { key: 'orgs.documents', label: 'Documents' },
      { key: 'orgs.tariff', label: 'Tariff' },
    ],
  },
  {
    key: 'pricing',
    label: 'Pricing',
    permissions: [
      { key: 'pricing.charge_profiles', label: 'Charge Profiles' },
      { key: 'pricing.load_tariffs', label: 'Load Tariffs' },
      { key: 'pricing.per_diem', label: 'Per Diem Rules' },
    ],
  },
  {
    key: 'settings',
    label: 'Settings',
    permissions: [
      { key: 'settings.company', label: 'Company Info' },
      { key: 'settings.team', label: 'Users & Permissions' },
      { key: 'settings.equipment', label: 'Equipment Reference' },
      { key: 'settings.terminals', label: 'Terminals & Markets' },
      { key: 'settings.dispatcher_appearance', label: 'Dispatcher Appearance' },
      { key: 'settings.container_owners', label: 'Container Owners' },
    ],
  },
  {
    key: 'reports',
    label: 'Reports',
    permissions: [
      { key: 'reports.loads', label: 'Loads Report' },
      { key: 'reports.revenue', label: 'Revenue Report' },
      { key: 'reports.driver_pay', label: 'Driver Pay Report' },
      { key: 'reports.aging', label: 'Aging Report' },
      { key: 'reports.profitability', label: 'Profitability Report' },
    ],
  },
  {
    key: 'branches',
    label: 'Branches',
    permissions: [
      { key: 'branches.view', label: 'View Branches' },
      { key: 'branches.manage', label: 'Create / Edit Branches' },
      { key: 'branches.assign', label: 'Assign Entities to Branches' },
    ],
  },
  {
    key: 'other',
    label: 'Other',
    permissions: [
      { key: 'other.view_margin', label: 'View Load Margin' },
      { key: 'other.export_data', label: 'Export Data' },
    ],
  },
];

// Flat list of all permission keys
export const ALL_PERMISSION_KEYS = PERMISSION_CATEGORIES.flatMap((cat) =>
  cat.permissions.map((p) => p.key)
);

// ── Role → Default Permissions Mapping ───────────────────────
// When a system role is selected, these permissions are pre-filled.
const ALL_KEYS = ALL_PERMISSION_KEYS;

export const ROLE_DEFAULTS = {
  super_admin: ALL_KEYS,
  admin: ALL_KEYS,
  dispatcher: [
    'dispatcher.view', 'dispatcher.edit', 'dispatcher.assign_driver', 'dispatcher.bulk_actions', 'dispatcher.export',
    'loads.create', 'loads.edit', 'loads.duplicate',
    'tabs.routing', 'tabs.tracking', 'tabs.communication', 'tabs.notes',
    'drivers.profile', 'drivers.assignments',
    'orgs.view',
  ],
  billing: [
    'tabs.billing', 'tabs.driver_pay',
    'ar.billing_edit', 'ar.billing_approve', 'ar.invoices', 'ar.apply_payment', 'ar.credit_memo',
    'ap.driver_pay', 'ap.driver_pay_approve', 'ap.driver_pay_delete', 'ap.driver_deductions', 'ap.settlements',
    'pricing.charge_profiles', 'pricing.load_tariffs', 'pricing.per_diem',
    'reports.revenue', 'reports.driver_pay', 'reports.aging', 'reports.profitability',
    'other.view_margin',
  ],
  operations: [
    'dispatcher.view', 'dispatcher.edit', 'dispatcher.assign_driver',
    'loads.create', 'loads.edit', 'loads.duplicate',
    'tabs.routing', 'tabs.tracking', 'tabs.communication', 'tabs.documents', 'tabs.notes',
    'drivers.profile', 'drivers.assignments',
    'orgs.view', 'orgs.create_edit', 'orgs.people', 'orgs.geofence',
    'reports.loads',
  ],
  sales_agent: [
    'dispatcher.view',
    'loads.create',
    'tabs.routing', 'tabs.notes',
    'orgs.view',
  ],
  custom: [], // empty — user picks individually
};

// ── Helper Functions ─────────────────────────────────────────

/**
 * Get the default permission keys for a system role.
 */
export function getDefaultPermissions(role) {
  return ROLE_DEFAULTS[role] || [];
}

/**
 * Check if a user has a specific granular permission.
 * Super admins and users with 'all' in legacy permissions bypass all checks.
 *
 * @param {object} user — { role, permissions, granular_permissions }
 * @param {string|string[]} required — permission key(s), any match = pass
 * @returns {boolean}
 */
export function hasGranularPermission(user, required) {
  if (!user) return false;
  if (user.role === 'super_admin' || user.role === 'admin') return true;

  // Legacy check
  const legacyPerms = user.permissions || [];
  if (legacyPerms.includes('all')) return true;

  // Granular check
  const granular = user.granular_permissions || [];
  if (!required) return true;
  const list = Array.isArray(required) ? required : [required];
  return list.some((p) => granular.includes(p));
}

/**
 * Check if a user has permission for a specific category (any permission in that category).
 */
export function hasCategoryAccess(user, categoryKey) {
  if (!user) return false;
  if (user.role === 'super_admin' || user.role === 'admin') return true;

  const category = PERMISSION_CATEGORIES.find((c) => c.key === categoryKey);
  if (!category) return false;

  const granular = user.granular_permissions || [];
  return category.permissions.some((p) => granular.includes(p.key));
}
