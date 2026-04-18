/**
 * Create 5 test users on the "test truck company" tenant for Gate 1
 * verification of the Settings Permissions Gating feature.
 *
 * Usage:   node scripts/create-test-users.js
 * Env:     reads .env.local for NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY
 * Tenant:  auto-detected via test@testtruck.com's tenant_id
 * Safety:  idempotent — skips any email that already exists in the tenant
 *          (never overwrites). Safe to re-run.
 *
 * Password for every user: DrayageDirect2026!
 */

const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

// ── Load .env.local manually (no dotenv dependency) ──────────────────────
function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  const content = fs.readFileSync(filePath, 'utf8');
  for (const rawLine of content.split(/\r?\n/)) {
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

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error(
    'ERROR: Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local'
  );
  process.exit(1);
}

const svc = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// ── Users to create ──────────────────────────────────────────────────────
const PASSWORD = 'DrayageDirect2026!';

const USERS = [
  {
    email: 'gate1-settings@testtruck.com',
    first_name: 'Gate1',
    last_name: 'Settings-Only',
    permissions: ['settings'],
    persona: 'Persona 2: Settings-only',
  },
  {
    email: 'gate1-ar@testtruck.com',
    first_name: 'Gate1',
    last_name: 'Settings-AR',
    permissions: ['settings', 'accounts_receivable'],
    persona: 'Persona 3: Settings + AR',
  },
  {
    email: 'gate1-ap@testtruck.com',
    first_name: 'Gate1',
    last_name: 'Settings-AP',
    permissions: ['settings', 'accounts_payable'],
    persona: 'Persona 4: Settings + AP',
  },
  {
    email: 'gate1-branches@testtruck.com',
    first_name: 'Gate1',
    last_name: 'Settings-Branches',
    permissions: ['settings', 'manage_branches'],
    persona: 'Persona 5: Settings + Branches',
  },
  {
    email: 'gate1-dispatcher@testtruck.com',
    first_name: 'Gate1',
    last_name: 'Dispatcher-NoSettings',
    permissions: ['dispatching'],
    persona: 'Persona 6: No settings',
  },
];

// ── Main ─────────────────────────────────────────────────────────────────
async function main() {
  console.log('─'.repeat(70));
  console.log('Creating Gate 1 test users on the test truck tenant');
  console.log('─'.repeat(70));

  // Find tenant via existing test@testtruck.com user
  console.log('\nLooking up test truck company tenant via test@testtruck.com...');
  const { data: testUser, error: lookupErr } = await svc
    .from('users')
    .select('id, tenant_id, email')
    .eq('email', 'test@testtruck.com')
    .is('deleted_at', null)
    .maybeSingle();

  if (lookupErr) {
    console.error('Tenant lookup failed:', lookupErr.message);
    process.exit(1);
  }
  if (!testUser) {
    console.error('Could not find test@testtruck.com — is that user present?');
    process.exit(1);
  }

  const tenantId = testUser.tenant_id;
  const grantorUserId = testUser.id;
  console.log(`  tenant_id:   ${tenantId}`);
  console.log(`  grantor:     ${testUser.email} (user_id=${grantorUserId})\n`);

  // Process each user
  const results = [];
  for (const userSpec of USERS) {
    const email = userSpec.email.toLowerCase().trim();

    // Skip if already exists in this tenant
    const { data: existing } = await svc
      .from('users')
      .select('id, email')
      .eq('tenant_id', tenantId)
      .eq('email', email)
      .is('deleted_at', null)
      .maybeSingle();

    if (existing) {
      console.log(`  [skip]    ${email} — already exists (id=${existing.id})`);
      results.push({
        email,
        status: 'existed',
        permissions: userSpec.permissions,
        persona: userSpec.persona,
      });
      continue;
    }

    // 1. Create Supabase auth user
    const { data: authUser, error: authErr } = await svc.auth.admin.createUser({
      email,
      password: PASSWORD,
      email_confirm: true,
    });

    if (authErr) {
      console.error(`  [FAIL]    ${email} — auth.createUser: ${authErr.message}`);
      results.push({
        email,
        status: 'failed_auth',
        error: authErr.message,
        persona: userSpec.persona,
      });
      continue;
    }

    // 2. Set app_metadata (tenant_id + role)
    const { error: metaErr } = await svc.auth.admin.updateUserById(
      authUser.user.id,
      {
        app_metadata: { tenant_id: tenantId, role: 'user' },
      }
    );
    if (metaErr) {
      console.error(`  [warn]    ${email} — app_metadata update: ${metaErr.message}`);
    }

    // 3. Insert users row
    const { data: newUser, error: insertErr } = await svc
      .from('users')
      .insert({
        tenant_id: tenantId,
        auth_uid: authUser.user.id,
        email,
        name: `${userSpec.first_name} ${userSpec.last_name}`.trim(),
        first_name: userSpec.first_name,
        last_name: userSpec.last_name,
        phone: null,
        hire_date: null,
        role: 'user',
        system_role: 'custom',
        granular_permissions: [],
        status: 'active',
        temp_password_flag: false,
        password_change_required: false,
      })
      .select()
      .single();

    if (insertErr) {
      // Roll back auth user on users-row failure
      await svc.auth.admin.deleteUser(authUser.user.id);
      console.error(`  [FAIL]    ${email} — users.insert: ${insertErr.message}`);
      results.push({
        email,
        status: 'failed_insert',
        error: insertErr.message,
        persona: userSpec.persona,
      });
      continue;
    }

    // 4. Insert legacy permissions (one row per permission)
    const permRows = userSpec.permissions.map((p) => ({
      tenant_id: tenantId,
      user_id: newUser.id,
      permission_type: p,
      granted_by: grantorUserId,
    }));
    const { error: permErr } = await svc
      .from('user_permissions')
      .insert(permRows);

    if (permErr) {
      console.error(
        `  [WARN]    ${email} — user_permissions.insert: ${permErr.message}`
      );
      results.push({
        email,
        status: 'created_without_perms',
        permissions: userSpec.permissions,
        error: permErr.message,
        persona: userSpec.persona,
      });
      continue;
    }

    console.log(
      `  [ok]      ${email.padEnd(40)} [${userSpec.permissions.join(', ')}]`
    );
    results.push({
      email,
      status: 'created',
      permissions: userSpec.permissions,
      persona: userSpec.persona,
    });
  }

  // Summary
  console.log('\n' + '═'.repeat(70));
  console.log('SUMMARY');
  console.log('═'.repeat(70));
  console.log(`Password for ALL users: ${PASSWORD}\n`);
  for (const r of results) {
    const statusTag = {
      created: '✔ CREATED',
      existed: '· existed',
      created_without_perms: '⚠ NO-PERMS',
      failed_auth: '✗ FAIL-AUTH',
      failed_insert: '✗ FAIL-INS',
    }[r.status] || r.status;
    console.log(
      `${statusTag.padEnd(12)} ${r.email.padEnd(40)} [${(r.permissions || []).join(', ')}]`
    );
    console.log(`             → ${r.persona}`);
    if (r.error) console.log(`             → error: ${r.error}`);
  }

  const anyFail = results.some((r) => r.status.startsWith('failed'));
  console.log('');
  if (anyFail) {
    console.log('Some users failed to create. Review errors above.');
    process.exit(2);
  }
  console.log('All users ready for Gate 1 verification.');
}

main().catch((e) => {
  console.error('Fatal:', e);
  process.exit(1);
});
