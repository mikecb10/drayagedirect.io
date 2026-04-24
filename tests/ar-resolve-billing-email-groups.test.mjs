import { resolveBillingEmails } from '../lib/ar/resolve-billing-email.js';

let passed = 0;
let failed = 0;
function check(name, cond) {
  if (cond) { console.log(`  ✓ ${name}`); passed++; }
  else      { console.log(`  ✗ ${name}`); failed++; }
}

// Minimal mock Supabase client. The resolver uses two distinct query shapes:
//   (a) organization_groups: .select(...).eq().eq().eq().eq().maybeSingle()
//   (b) customer_billing_emails: .select(...).eq().eq().eq().eq()  (terminated as awaited promise — no .maybeSingle())
//   (c) customers: .select(...).eq().eq().maybeSingle()
//
// The chain returns `c` on every method. The terminal is either .maybeSingle()
// (which returns { data, error }) or the chain itself being awaited (via .then).
function makeMockClient(config = {}) {
  const calls = { queries: [] };
  function chain(table) {
    const c = {
      _table: table,
      _filters: {},
      select: (..._a) => c,
      eq: (col, val) => { c._filters[col] = val; return c; },
      neq: (col, val) => { c._filters[`neq:${col}`] = val; return c; },
      maybeSingle: async () => {
        calls.queries.push({ table, filters: { ...c._filters }, terminal: 'maybeSingle' });
        if (config[table] !== undefined) return { data: config[table], error: null };
        return { data: null, error: null };
      },
      then: (resolve) => {
        calls.queries.push({ table, filters: { ...c._filters }, terminal: 'await' });
        if (config[table] !== undefined) resolve({ data: config[table], error: null });
        else resolve({ data: [], error: null });
      },
    };
    return c;
  }
  return { from(table) { return chain(table); }, _calls: calls };
}

console.log('resolveBillingEmails — Step 0 (group-aware)');

// Case 1: Group with members wins
{
  console.log('\nCase 1: Group with members wins');
  const svc = makeMockClient({
    organization_groups: {
      id: 'grp-1',
      members: [
        { contact: { email: 'jane@acme.com', is_active: true } },
        { contact: { email: 'billing@acme.com', is_active: true } },
      ],
    },
  });
  const result = await resolveBillingEmails(svc, 't-1', 'cust-1', 'invoice');
  check('group wins: 2 emails', Array.isArray(result?.to) && result.to.length === 2);
  check('group wins: jane@ present', result?.to?.includes('jane@acme.com'));
  check('group wins: billing@ present', result?.to?.includes('billing@acme.com'));
  check('group wins: source=organization_groups', result?.source === 'organization_groups');
}

// Case 2: Empty group falls through
{
  console.log('\nCase 2: Empty group falls through');
  const svc = makeMockClient({
    // Group exists but has no members
    organization_groups: { id: 'grp-2', members: [] },
    // Fallback Step 1: customer_billing_emails returns 1 match
    customer_billing_emails: [{ email: 'fallback@acme.com' }],
  });
  const result = await resolveBillingEmails(svc, 't-1', 'cust-2', 'invoice');
  check('empty group: falls through', result?.source !== 'organization_groups');
  check('empty group: source is legacy', result?.source === 'customer_billing_emails');
  check('empty group: returns fallback email', result?.to?.includes('fallback@acme.com'));
}

// Case 3: Members with null emails fall through
{
  console.log('\nCase 3: Members with null emails fall through');
  const svc = makeMockClient({
    organization_groups: {
      id: 'grp-3',
      members: [
        { contact: { email: null, is_active: true } },
        { contact: { email: '', is_active: true } },
      ],
    },
    customer_billing_emails: [{ email: 'fallback2@acme.com' }],
  });
  const result = await resolveBillingEmails(svc, 't-1', 'cust-3', 'invoice');
  check('null emails: falls through', result?.source !== 'organization_groups');
}

// Case 4: No default group falls through
{
  console.log('\nCase 4: No default group falls through');
  const svc = makeMockClient({
    // organization_groups lookup returns null (no default configured)
    organization_groups: null,
    customer_billing_emails: [{ email: 'nogroup@acme.com' }],
  });
  const result = await resolveBillingEmails(svc, 't-1', 'cust-4', 'invoice');
  check('no default group: falls through', result?.source !== 'organization_groups');
  check('no default group: returns customer_billing_emails', result?.to?.includes('nogroup@acme.com'));
}

// Case 5: rate_confirmation maps to rate_confirmation group
{
  console.log('\nCase 5: rate_confirmation maps to rate_confirmation group');
  const svc = makeMockClient({
    organization_groups: {
      id: 'grp-5',
      members: [{ contact: { email: 'ratecon@acme.com', is_active: true } }],
    },
  });
  const result = await resolveBillingEmails(svc, 't-1', 'cust-5', 'rate_confirmation');
  check('rate_confirmation: group wins', result?.source === 'organization_groups');
  check('rate_confirmation: email returned', result?.to?.includes('ratecon@acme.com'));
}

// Case 6: statement maps to billing group (shares billing purpose)
{
  console.log('\nCase 6: statement maps to billing group');
  const svc = makeMockClient({
    organization_groups: {
      id: 'grp-6',
      members: [{ contact: { email: 'statement-to-billing@acme.com', is_active: true } }],
    },
  });
  const result = await resolveBillingEmails(svc, 't-1', 'cust-6', 'statement');
  check('statement: resolves via billing group', result?.source === 'organization_groups');
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
