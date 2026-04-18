/**
 * Verify the 5 Gate 1 test users have the expected permissions.
 * Read-only — never modifies data.
 *
 * Usage: node scripts/verify-test-users.js
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
  const emails = Object.keys(EXPECTED);
  const { data: users } = await svc
    .from('users')
    .select('id, email, status')
    .in('email', emails)
    .is('deleted_at', null);

  const { data: allPerms } = await svc
    .from('user_permissions')
    .select('user_id, permission_type')
    .in('user_id', (users || []).map((u) => u.id));

  console.log('═'.repeat(70));
  console.log('Gate 1 test user verification');
  console.log('═'.repeat(70));
  console.log('');

  let anyDrift = false;
  for (const email of emails) {
    const u = (users || []).find((u) => u.email === email);
    const expected = EXPECTED[email].sort();
    if (!u) {
      console.log(`  [MISSING] ${email}`);
      anyDrift = true;
      continue;
    }
    const actual = (allPerms || [])
      .filter((p) => p.user_id === u.id)
      .map((p) => p.permission_type)
      .sort();

    const match =
      actual.length === expected.length &&
      actual.every((p, i) => p === expected[i]);

    const tag = match ? '[ok]      ' : '[DRIFT]   ';
    if (!match) anyDrift = true;

    console.log(`  ${tag}${email.padEnd(40)} status=${u.status}`);
    console.log(`             expected: [${expected.join(', ')}]`);
    console.log(`             actual:   [${actual.join(', ') || '(none)'}]`);
  }

  console.log('');
  if (anyDrift) {
    console.log(
      'One or more users drifted from expected. Fix manually before running Gate 1.'
    );
    process.exit(2);
  }
  console.log('All users match expected permissions. Good to run Gate 1.');
}

main().catch((e) => {
  console.error('Fatal:', e);
  process.exit(1);
});
