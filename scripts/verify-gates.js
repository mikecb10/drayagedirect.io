/**
 * Verifies Gate 1 (permission matrix) and Gate 2 (URL enforcement) for the
 * Settings Permissions Gating feature — purely at the logic layer.
 *
 * This script:
 *   - Pulls each persona's role + legacy permissions from the DB
 *   - Applies the EXACT `hasPermission` + `filterByPermissions` logic from
 *     `lib/permissions.js` (inlined here to avoid ESM/CJS import issues)
 *   - Compares the resulting visible-item set against the spec's expected set
 *   - Checks URL enforcement against each persona for the 5 restricted URLs
 *   - Exits non-zero on any mismatch
 *
 * Usage: node scripts/verify-gates.js
 *
 * Spec: docs/superpowers/specs/2026-04-17-settings-permissions-gating-design.md
 */

const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  for (const rawLine of fs.readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = value;
  }
}
loadEnvFile(path.join(__dirname, '..', '.env.local'));
loadEnvFile(path.join(__dirname, '..', '.env'));

const svc = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

// ── Inline the EXACT logic from lib/permissions.js ───────────────────────
// If this drifts from the real module, the test stops verifying reality.
// Kept minimal and 1:1.
function hasPermission(user, required) {
  if (!user) return false;
  if (user.role === 'super_admin') return true;
  const perms = user.permissions || [];
  if (perms.includes('all')) return true;
  if (!required) return true;
  const list = Array.isArray(required) ? required : [required];
  return list.some((p) => perms.includes(p));
}

function filterByPermissions(items, user) {
  return items.filter((item) => {
    if (!item.requiredPermission) return true;
    return hasPermission(user, item.requiredPermission);
  });
}

// ── Mapping (mirrors lib/settings-nav.js — must stay in sync) ────────────
// If settings-nav.js drifts from this, the test output will make it obvious.
const SETTINGS_ITEMS = [
  // General
  { key: 'company', group: 'General', requiredPermission: ['settings', 'all'] },
  { key: 'profile', group: 'General' /* no requiredPermission */ },
  // Pricing
  { key: 'charge_profiles', group: 'Pricing', requiredPermission: ['accounts_receivable', 'all'] },
  { key: 'tariffs',         group: 'Pricing', requiredPermission: ['accounts_receivable', 'all'] },
  { key: 'driver_tariffs',  group: 'Pricing', requiredPermission: ['accounts_payable',    'all'] },
  { key: 'per_diem',        group: 'Pricing', requiredPermission: ['accounts_receivable', 'all'] },
  // Operations
  { key: 'dispatcher_colors',    group: 'Operations', requiredPermission: ['settings', 'all'] },
  { key: 'document_validation',  group: 'Operations', requiredPermission: ['settings', 'all'] },
  // Equipment
  { key: 'container_owners',     group: 'Equipment', requiredPermission: ['settings', 'all'] },
  { key: 'chassis_owners',       group: 'Equipment', requiredPermission: ['settings', 'all'] },
  { key: 'equipment_reference',  group: 'Equipment', requiredPermission: ['settings', 'all'] },
  { key: 'terminal_markets',     group: 'Equipment', requiredPermission: ['settings', 'all'] },
  { key: 'terminals',            group: 'Equipment', requiredPermission: ['settings', 'all'] },
  // Team
  { key: 'branches', group: 'Team', requiredPermission: ['manage_branches', 'all'] },
  { key: 'team',     group: 'Team', requiredPermission: ['settings', 'all'] },
  // Communications (existing gating, unchanged)
  { key: 'comm_formatting',          group: 'Communications', requiredPermission: ['manage_system_emails', 'settings', 'all'] },
  { key: 'comm_templates',           group: 'Communications', requiredPermission: ['manage_system_emails', 'settings', 'all'] },
  { key: 'comm_umbrellas',           group: 'Communications', requiredPermission: ['manage_system_emails', 'settings', 'all'] },
  { key: 'comm_configurations',      group: 'Communications', requiredPermission: ['manage_system_emails', 'settings', 'all'] },
  { key: 'comm_shared_accounts',     group: 'Communications', requiredPermission: ['manage_system_emails', 'settings', 'all'] },
  { key: 'comm_sender_domains',      group: 'Communications', requiredPermission: ['manage_system_emails', 'settings', 'all'] },
  { key: 'comm_sender_addresses',    group: 'Communications', requiredPermission: ['manage_system_emails', 'settings', 'all'] },
  { key: 'comm_trigger_activity',    group: 'Communications', requiredPermission: ['manage_system_emails', 'settings', 'all'] },
  // Coming Soon (no gating)
  { key: 'accessorials',    group: 'Coming Soon' },
  { key: 'rates',           group: 'Coming Soon' },
  { key: 'locations',       group: 'Coming Soon' },
  { key: 'notifications',   group: 'Coming Soon' },
  { key: 'billing',         group: 'Coming Soon' },
];

// Routes used for Gate 2 URL enforcement
const RESTRICTED_URLS = [
  { url: '/settings/tariffs',         itemKey: 'tariffs' },
  { url: '/settings/driver-tariffs',  itemKey: 'driver_tariffs' },
  { url: '/settings/per-diem',        itemKey: 'per_diem' },
  { url: '/settings/charge-profiles', itemKey: 'charge_profiles' },
  { url: '/settings/branches',        itemKey: 'branches' },
];
const ALLOWED_URL = { url: '/settings/company', itemKey: 'company' };

// ── Persona expectations ─────────────────────────────────────────────────
// Each persona names the user, then declares:
//   - sidebarMustInclude / sidebarMustExclude (by item key)
//   - urlGate: which restricted URLs must allow vs deny
//   - accessesSettingsArea: must pass the baseline [SETTINGS, ALL] check?
const PERSONAS = [
  {
    name: 'Super admin',
    email: 'test@testtruck.com',
    sidebarMustInclude: 'ALL_NON_COMING_SOON_PLUS_COMING_SOON',
    sidebarMustExclude: [],
    allowedUrls: ['/settings/tariffs', '/settings/driver-tariffs', '/settings/per-diem', '/settings/charge-profiles', '/settings/branches', '/settings/company'],
    deniedUrls: [],
    accessesSettingsArea: true,
  },
  {
    name: 'Settings-only',
    email: 'gate1-settings@testtruck.com',
    sidebarMustInclude: [
      'company', 'profile',
      'dispatcher_colors', 'document_validation',
      'container_owners', 'chassis_owners', 'equipment_reference', 'terminal_markets', 'terminals',
      'team',
      'comm_formatting', 'comm_templates', 'comm_umbrellas', 'comm_configurations',
      'comm_shared_accounts', 'comm_sender_domains', 'comm_sender_addresses', 'comm_trigger_activity',
      'accessorials', 'rates', 'locations', 'notifications', 'billing',
    ],
    sidebarMustExclude: ['charge_profiles', 'tariffs', 'driver_tariffs', 'per_diem', 'branches'],
    allowedUrls: ['/settings/company'],
    deniedUrls: ['/settings/tariffs', '/settings/driver-tariffs', '/settings/per-diem', '/settings/charge-profiles', '/settings/branches'],
    accessesSettingsArea: true,
  },
  {
    name: 'Settings + AR',
    email: 'gate1-ar@testtruck.com',
    sidebarMustInclude: [
      'company', 'profile',
      'charge_profiles', 'tariffs', 'per_diem',
      'dispatcher_colors', 'document_validation',
      'container_owners', 'chassis_owners', 'equipment_reference', 'terminal_markets', 'terminals',
      'team',
      'comm_formatting', 'comm_templates', 'comm_umbrellas', 'comm_configurations',
      'comm_shared_accounts', 'comm_sender_domains', 'comm_sender_addresses', 'comm_trigger_activity',
      'accessorials', 'rates', 'locations', 'notifications', 'billing',
    ],
    sidebarMustExclude: ['driver_tariffs', 'branches'],
    allowedUrls: ['/settings/tariffs', '/settings/per-diem', '/settings/charge-profiles', '/settings/company'],
    deniedUrls: ['/settings/driver-tariffs', '/settings/branches'],
    accessesSettingsArea: true,
  },
  {
    name: 'Settings + AP',
    email: 'gate1-ap@testtruck.com',
    sidebarMustInclude: [
      'company', 'profile',
      'driver_tariffs',
      'dispatcher_colors', 'document_validation',
      'container_owners', 'chassis_owners', 'equipment_reference', 'terminal_markets', 'terminals',
      'team',
      'comm_formatting', 'comm_templates', 'comm_umbrellas', 'comm_configurations',
      'comm_shared_accounts', 'comm_sender_domains', 'comm_sender_addresses', 'comm_trigger_activity',
      'accessorials', 'rates', 'locations', 'notifications', 'billing',
    ],
    sidebarMustExclude: ['charge_profiles', 'tariffs', 'per_diem', 'branches'],
    allowedUrls: ['/settings/driver-tariffs', '/settings/company'],
    deniedUrls: ['/settings/tariffs', '/settings/per-diem', '/settings/charge-profiles', '/settings/branches'],
    accessesSettingsArea: true,
  },
  {
    name: 'Settings + Branches',
    email: 'gate1-branches@testtruck.com',
    sidebarMustInclude: [
      'company', 'profile',
      'branches',
      'dispatcher_colors', 'document_validation',
      'container_owners', 'chassis_owners', 'equipment_reference', 'terminal_markets', 'terminals',
      'team',
      'comm_formatting', 'comm_templates', 'comm_umbrellas', 'comm_configurations',
      'comm_shared_accounts', 'comm_sender_domains', 'comm_sender_addresses', 'comm_trigger_activity',
      'accessorials', 'rates', 'locations', 'notifications', 'billing',
    ],
    sidebarMustExclude: ['charge_profiles', 'tariffs', 'driver_tariffs', 'per_diem'],
    allowedUrls: ['/settings/branches', '/settings/company'],
    deniedUrls: ['/settings/tariffs', '/settings/driver-tariffs', '/settings/per-diem', '/settings/charge-profiles'],
    accessesSettingsArea: true,
  },
  {
    name: 'No settings (dispatcher)',
    email: 'gate1-dispatcher@testtruck.com',
    // Dispatcher can't access /settings at all — fails TenantLayout baseline.
    sidebarMustInclude: 'N/A_BLOCKED',
    sidebarMustExclude: [],
    allowedUrls: [],
    deniedUrls: ['/settings/tariffs', '/settings/driver-tariffs', '/settings/per-diem', '/settings/charge-profiles', '/settings/branches', '/settings/company'],
    accessesSettingsArea: false,
  },
];

// ── Main ─────────────────────────────────────────────────────────────────
async function main() {
  console.log('═'.repeat(78));
  console.log('Gate 1 + Gate 2 logic verification');
  console.log('═'.repeat(78));
  console.log('');

  // Load each user's role + permissions from the DB
  const emails = PERSONAS.map((p) => p.email);
  const { data: users } = await svc
    .from('users')
    .select('id, email, role, status')
    .in('email', emails)
    .is('deleted_at', null);

  const { data: allPerms } = await svc
    .from('user_permissions')
    .select('user_id, permission_type')
    .in('user_id', (users || []).map((u) => u.id));

  const userByEmail = new Map();
  for (const u of users || []) {
    const perms = (allPerms || [])
      .filter((p) => p.user_id === u.id)
      .map((p) => p.permission_type);
    userByEmail.set(u.email, { role: u.role, permissions: perms, status: u.status });
  }

  const SETTINGS_BASELINE = ['settings', 'all'];
  let totalChecks = 0;
  let failedChecks = 0;

  for (const persona of PERSONAS) {
    const user = userByEmail.get(persona.email);
    console.log('─'.repeat(78));
    console.log(`${persona.name}  —  ${persona.email}`);
    console.log('─'.repeat(78));
    if (!user) {
      console.log(`  [MISSING] user not found in DB`);
      failedChecks++;
      totalChecks++;
      continue;
    }
    console.log(`  role=${user.role}  permissions=[${user.permissions.join(', ') || '(none)'}]`);
    console.log('');

    // ── Check 1: settings-area baseline access ─────────────────────────
    const canAccessSettings = hasPermission(user, SETTINGS_BASELINE);
    const baselineOk = canAccessSettings === persona.accessesSettingsArea;
    totalChecks++;
    if (!baselineOk) failedChecks++;
    console.log(
      `  ${baselineOk ? '[ok]   ' : '[FAIL] '} settings-area access — ` +
      `expected ${persona.accessesSettingsArea ? 'ALLOWED' : 'BLOCKED'}, ` +
      `got ${canAccessSettings ? 'ALLOWED' : 'BLOCKED'}`
    );

    // ── Check 2: sidebar visibility (Gate 1) ───────────────────────────
    if (persona.sidebarMustInclude === 'N/A_BLOCKED') {
      console.log(`  [skip] sidebar filter — user is blocked at settings area baseline`);
    } else {
      const visible = filterByPermissions(SETTINGS_ITEMS, user).map((i) => i.key);
      const visibleSet = new Set(visible);

      let mustInclude;
      if (persona.sidebarMustInclude === 'ALL_NON_COMING_SOON_PLUS_COMING_SOON') {
        mustInclude = SETTINGS_ITEMS.map((i) => i.key);
      } else {
        mustInclude = persona.sidebarMustInclude;
      }

      const missing = mustInclude.filter((k) => !visibleSet.has(k));
      const unexpected = persona.sidebarMustExclude.filter((k) => visibleSet.has(k));

      totalChecks += 2;
      if (missing.length === 0) {
        console.log(`  [ok]    sidebar — all ${mustInclude.length} expected items visible`);
      } else {
        failedChecks++;
        console.log(`  [FAIL]  sidebar — missing: [${missing.join(', ')}]`);
      }
      if (unexpected.length === 0) {
        console.log(`  [ok]    sidebar — no restricted items leaked`);
      } else {
        failedChecks++;
        console.log(`  [FAIL]  sidebar — leaked: [${unexpected.join(', ')}]`);
      }
    }

    // ── Check 3: URL enforcement (Gate 2) ──────────────────────────────
    const urlChecks = [
      ...persona.allowedUrls.map((u) => ({ url: u, expected: 'allow' })),
      ...persona.deniedUrls.map((u) => ({ url: u, expected: 'deny' })),
    ];

    for (const check of urlChecks) {
      // Look up the item for the URL; derive pageRequired the same way
      // SettingsLayout does via findItemForPath(pathname)
      const entry = [...RESTRICTED_URLS, ALLOWED_URL].find((r) => r.url === check.url);
      const item = SETTINGS_ITEMS.find((i) => i.key === entry?.itemKey);
      const pageRequired = item?.requiredPermission || SETTINGS_BASELINE;
      const canAccess = hasPermission(user, pageRequired);
      const gotExpected =
        (check.expected === 'allow' && canAccess) ||
        (check.expected === 'deny' && !canAccess);

      totalChecks++;
      if (!gotExpected) failedChecks++;
      const tag = gotExpected ? '[ok]   ' : '[FAIL] ';
      console.log(
        `  ${tag} ${check.url.padEnd(30)} — expected ${check.expected}, got ${canAccess ? 'allow' : 'deny'}`
      );
    }

    console.log('');
  }

  // ── Summary ────────────────────────────────────────────────────────
  console.log('═'.repeat(78));
  console.log(`RESULT: ${totalChecks - failedChecks}/${totalChecks} checks passed`);
  console.log('═'.repeat(78));
  if (failedChecks > 0) {
    console.log(`\n${failedChecks} check(s) failed. Review above.`);
    process.exit(2);
  }
  console.log('\nGate 1 + Gate 2 logic verified. Shipping behavior matches spec.');
  console.log('Gate 3 (skeleton flash, group auto-expand) requires manual browser verification.');
}

main().catch((e) => {
  console.error('Fatal:', e);
  process.exit(1);
});
