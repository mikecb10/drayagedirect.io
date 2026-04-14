// Permission constants — must match permission_type_enum in the database
export const PERMISSIONS = {
  ORDER_ENTRY: 'order_entry',
  DISPATCHING: 'dispatching',
  ACCOUNTS_PAYABLE: 'accounts_payable',
  ACCOUNTS_RECEIVABLE: 'accounts_receivable',
  REPORTING: 'reporting',
  SETTINGS: 'settings',
  MANAGE_SYSTEM_EMAILS: 'manage_system_emails',
  MANAGE_BRANCHES: 'manage_branches',
  ALL: 'all',
};

export const PERMISSION_META = {
  order_entry: {
    label: 'Order Entry',
    description: 'Create, edit, and manage drayage orders and customers',
  },
  dispatching: {
    label: 'Dispatching',
    description: 'Assign drivers, update load status, and manage the dispatch board',
  },
  accounts_payable: {
    label: 'Accounts Payable',
    description: 'Manage driver pay, carrier bills, and outgoing payments',
  },
  accounts_receivable: {
    label: 'Accounts Receivable',
    description: 'Create and send invoices, record customer payments',
  },
  reporting: {
    label: 'Reporting',
    description: 'Access business reports, analytics, and exports',
  },
  settings: {
    label: 'Settings',
    description: 'Manage company settings, team members, and permissions',
  },
  manage_system_emails: {
    label: 'Manage System Emails',
    description:
      'Create and edit email templates, umbrellas, triggers, and tenant email format preferences. Separate from Settings so ops leads can tune automation without full settings access.',
  },
  manage_branches: {
    label: 'Manage Branches',
    description: 'Create, edit, and assign regional branches. Only super admins can create branches.',
  },
  all: {
    label: 'Full Access',
    description: 'Full administrative access to every feature',
  },
};

/**
 * Check if a user has a given permission.
 * @param {object} user - { role, permissions } — typically from useAuth() or requireTenantUser()
 * @param {string|string[]} required - single permission or array (any match)
 * @returns {boolean}
 */
export function hasPermission(user, required) {
  if (!user) return false;
  // super_admin role bypasses all checks
  if (user.role === 'super_admin') return true;

  const permissions = user.permissions || [];
  // Users with 'all' permission bypass all checks
  if (permissions.includes('all')) return true;

  if (!required) return true;
  const list = Array.isArray(required) ? required : [required];
  return list.some((p) => permissions.includes(p));
}

/**
 * Filter a nav/settings item list by permission.
 * Items without a requiredPermission are always visible.
 */
export function filterByPermissions(items, user) {
  return items.filter((item) => {
    if (!item.requiredPermission) return true;
    return hasPermission(user, item.requiredPermission);
  });
}
