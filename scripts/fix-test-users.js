/**
 * Sync each Gate 1 test user's permissions to the expected set.
 *
 * Usage: node scripts/fix-test-users.js
 * Safety: idempotent — inserts missing, deletes extras. Safe to re-run.
 *
 * Expected permissions for each user match the Settings Permissions Gating
 * spec (docs/superpowers/specs/2026-04-17-settings-permissions-gating-design.md).
 *
 * REQUIRES: migration 076_manage_branches_permission.sql applied first.
 * Without it, inserting 'manage_branches' will fail with
 * `invalid input value for enum permission_type_enum`.
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
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
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

const EXPECTED = {
  'gate1-settings@testtruck.com': ['settings'],
  'gate1-ar@testtruck.com': ['settings', 'accounts_receivable'],
  'gate1-ap@testtruck.com': ['settings', 'accounts_payable'],
  'gate1-branches@testtruck.com': ['settings', 'manage_branches'],
  'gate1-dispatcher@testtruck.com': ['dispatching'],
};

async function main() {
  console.log('═'.repeat(70));
  console.log('Syncing Gate 1 test user permissions');
  console.log('═'.repeat(70));
  console.log('');

  // Get the grantor (test@testtruck.com) for granted_by
  const { data: grantor } = await svc
    .from('users')
    .select('id, tenant_id')
    .eq('email', 'test@testtruck.com')
    .is('deleted_at', null)
    .maybeSingle();

  if (!grantor) {
    console.error('Could not find test@testtruck.com as grantor. Aborting.');
    process.exit(1);
  }

  const tenantId = grantor.tenant_id;
  const grantorId = grantor.id;

  // Fetch all target users in one query
  const emails = Object.keys(EXPECTED);
  const { data: users } = await svc
    .from('users')
    .select('id, email')
    .eq('tenant_id', tenantId)
    .in('email', emails)
    .is('deleted_at', null);

  let anyFailed = false;

  for (const email of emails) {
    const user = (users || []).find((u) => u.email === email);
    if (!user) {
      console.log(`  [MISSING]  ${email} — run create-test-users.js first`);
      anyFailed = true;
      continue;
    }

    const expected = new Set(EXPECTED[email]);

    // Current perms
    const { data: currentPerms } = await svc
      .from('user_permissions')
      .select('id, permission_type')
      .eq('user_id', user.id)
      .eq('tenant_id', tenantId);

    const current = new Set((currentPerms || []).map((p) => p.permission_type));

    const toAdd = [...expected].filter((p) => !current.has(p));
    const toRemove = (currentPerms || []).filter(
      (p) => !expected.has(p.permission_type)
    );

    if (toAdd.length === 0 && toRemove.length === 0) {
      console.log(`  [ok]       ${email}`);
      continue;
    }

    const changes = [];

    // Remove extras
    if (toRemove.length > 0) {
      const { error: delErr } = await svc
        .from('user_permissions')
        .delete()
        .in('id', toRemove.map((p) => p.id));
      if (delErr) {
        console.log(`  [FAIL]     ${email} — delete: ${delErr.message}`);
        anyFailed = true;
        continue;
      }
      changes.push(`-[${toRemove.map((p) => p.permission_type).join(', ')}]`);
    }

    // Add missing
    if (toAdd.length > 0) {
      const rows = toAdd.map((p) => ({
        tenant_id: tenantId,
        user_id: user.id,
        permission_type: p,
        granted_by: grantorId,
      }));
      const { error: insErr } = await svc
        .from('user_permissions')
        .insert(rows);
      if (insErr) {
        console.log(`  [FAIL]     ${email} — insert: ${insErr.message}`);
        if (insErr.message.includes('permission_type_enum')) {
          console.log(
            `             → This usually means migration 076 hasn't been applied.`
          );
          console.log(
            `             → Apply supabase/migrations/076_manage_branches_permission.sql first.`
          );
        }
        anyFailed = true;
        continue;
      }
      changes.push(`+[${toAdd.join(', ')}]`);
    }

    console.log(`  [fixed]    ${email.padEnd(40)} ${changes.join(' ')}`);
  }

  console.log('');
  if (anyFailed) {
    console.log('One or more users could not be synced. See errors above.');
    process.exit(2);
  }
  console.log('All Gate 1 test users synced.');
  console.log('');
  console.log('Next: node scripts/verify-test-users.js');
}

main().catch((e) => {
  console.error('Fatal:', e);
  process.exit(1);
});
