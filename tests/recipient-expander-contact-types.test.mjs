import { expandRecipients } from '../lib/email-dispatch/recipient-expander.js';

let passed = 0;
let failed = 0;
function check(name, cond) {
  if (cond) { console.log(`  ✓ ${name}`); passed++; }
  else      { console.log(`  ✗ ${name}`); failed++; }
}

// Mock client tracking which tables were queried.
function makeMockClient(config = {}) {
  const calls = { queries: [] };
  function chain(table) {
    const c = {
      _table: table,
      _filters: {},
      select: (..._a) => c,
      eq: (col, val) => { c._filters[col] = val; return c; },
      maybeSingle: async () => {
        calls.queries.push({ table, filters: { ...c._filters }, terminal: 'maybeSingle' });
        const cfg = config[table];
        if (cfg === undefined) return { data: null, error: null };
        return { data: cfg, error: null };
      },
      then: (resolve) => {
        calls.queries.push({ table, filters: { ...c._filters }, terminal: 'await' });
        const cfg = config[table];
        if (cfg === undefined) { resolve({ data: [], error: null }); return; }
        resolve({ data: cfg, error: null });
      },
    };
    return c;
  }
  return { from(table) { return chain(table); }, _calls: calls };
}

console.log("recipient-expander — contact + contact_group migrated to organization_* tables (FU-113)");

// ──────────────────────────────────────────────────────────────
// Case 1: type:'contact' queries organization_contacts (NOT customer_contacts)
{
  console.log('\nCase 1: contact queries organization_contacts');
  const svc = makeMockClient({
    organization_contacts: { email: 'jane@acme.com' },
  });
  const out = await expandRecipients(
    svc, 't-1',
    [{ type: 'contact', value: 'con-1' }],
    {},
    new Map()
  );
  check('contact: 1 email returned', out.length === 1);
  check('contact: jane@acme.com included', out.includes('jane@acme.com'));
  check('contact: queried organization_contacts (not customer_contacts)',
    svc._calls.queries.some((q) => q.table === 'organization_contacts'));
  check('contact: did NOT query customer_contacts',
    !svc._calls.queries.some((q) => q.table === 'customer_contacts'));
  check('contact: filtered by tenant_id', svc._calls.queries[0].filters.tenant_id === 't-1');
}

// ──────────────────────────────────────────────────────────────
// Case 2: type:'contact_group' queries organization_group_members
{
  console.log('\nCase 2: contact_group queries organization_group_members');
  const svc = makeMockClient({
    organization_group_members: [
      { contact: { email: 'a@x.com' } },
      { contact: { email: 'b@x.com' } },
    ],
  });
  const out = await expandRecipients(
    svc, 't-1',
    [{ type: 'contact_group', value: 'grp-1' }],
    {},
    new Map()
  );
  check('contact_group: 2 emails returned', out.length === 2);
  check('contact_group: a@x.com included', out.includes('a@x.com'));
  check('contact_group: b@x.com included', out.includes('b@x.com'));
  check('contact_group: queried organization_group_members',
    svc._calls.queries.some((q) => q.table === 'organization_group_members'));
  check('contact_group: did NOT query customer_contact_group_members',
    !svc._calls.queries.some((q) => q.table === 'customer_contact_group_members'));
  check('contact_group: did NOT filter by tenant_id (org_group_members has no tenant_id column)',
    !('tenant_id' in (svc._calls.queries[0].filters || {})));
  check('contact_group: filtered by group_id', svc._calls.queries[0].filters.group_id === 'grp-1');
}

// ──────────────────────────────────────────────────────────────
// Case 3: contact returns [] when no row found (cache + invalid email)
{
  console.log('\nCase 3: contact returns [] when no row');
  const svc = makeMockClient({});
  const out = await expandRecipients(
    svc, 't-1',
    [{ type: 'contact', value: 'missing-id' }],
    {},
    new Map()
  );
  check('contact missing: 0 emails', out.length === 0);
}

// ──────────────────────────────────────────────────────────────
// Case 4: contact_group returns [] when no members
{
  console.log('\nCase 4: contact_group returns [] when no members');
  const svc = makeMockClient({ organization_group_members: [] });
  const out = await expandRecipients(
    svc, 't-1',
    [{ type: 'contact_group', value: 'empty-group' }],
    {},
    new Map()
  );
  check('contact_group empty: 0 emails', out.length === 0);
}

// ──────────────────────────────────────────────────────────────
// Case 5: cache hit on second call (contact)
{
  console.log('\nCase 5: contact cache hit on second call');
  const cache = new Map();
  const svc = makeMockClient({ organization_contacts: { email: 'cached@x.com' } });
  const entry = [{ type: 'contact', value: 'con-cache' }];
  const out1 = await expandRecipients(svc, 't-1', entry, {}, cache);
  const queryCount1 = svc._calls.queries.length;
  const out2 = await expandRecipients(svc, 't-1', entry, {}, cache);
  const queryCount2 = svc._calls.queries.length;
  check('contact cache: out1 matches out2', out1[0] === out2[0]);
  check('contact cache: second call adds 0 queries', queryCount2 === queryCount1);
}

// ──────────────────────────────────────────────────────────────
// Case 6: cache hit on second call (contact_group)
{
  console.log('\nCase 6: contact_group cache hit on second call');
  const cache = new Map();
  const svc = makeMockClient({
    organization_group_members: [{ contact: { email: 'gcached@x.com' } }],
  });
  const entry = [{ type: 'contact_group', value: 'grp-cache' }];
  const out1 = await expandRecipients(svc, 't-1', entry, {}, cache);
  const queryCount1 = svc._calls.queries.length;
  const out2 = await expandRecipients(svc, 't-1', entry, {}, cache);
  const queryCount2 = svc._calls.queries.length;
  check('contact_group cache: out1 matches out2', out1[0] === out2[0]);
  check('contact_group cache: second call adds 0 queries', queryCount2 === queryCount1);
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
