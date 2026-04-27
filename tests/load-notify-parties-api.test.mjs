// Note: this file tests handlers as pure functions — we import them and
// invoke with mocked req/res/svc objects. Following the pattern used in
// other API tests (see tests/contact-groups-default-swap.test.mjs).

let passed = 0;
let failed = 0;
function check(name, cond) {
  if (cond) { console.log(`  ✓ ${name}`); passed++; }
  else      { console.log(`  ✗ ${name}`); failed++; }
}

// We'll import the handler dynamically per test file to allow re-import
// after edits. For now, just inline-test the handler shape against a
// mock supabase client.
// Import the pure helper from lib (avoids loading Next.js auth deps which
// use extensionless specifiers not resolvable by bare Node ESM).
// The handler re-exports listLoadNotifyParties from the same lib file.
const handlerModule = await import('../lib/load-notify-parties-hydrator.js');
const handler = null; // default export not testable without auth mocks

function makeReq(method, query, body) {
  return { method, query, body, headers: {}, socket: { remoteAddress: '127.0.0.1' } };
}
function makeRes() {
  let statusCode = 200;
  let payload = null;
  return {
    status(code) { statusCode = code; return this; },
    json(p) { payload = p; return this; },
    end() {},
    _get() { return { statusCode, payload }; },
  };
}

function makeMockSvc(config = {}) {
  const calls = { queries: [] };
  function chain(table) {
    const c = {
      _table: table,
      _filters: {},
      select: (..._a) => c,
      eq: (col, val) => { c._filters[col] = val; return c; },
      in: (col, vals) => { c._filters[`in:${col}`] = vals; return c; },
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

const { listLoadNotifyParties } = handlerModule;

console.log('GET /api/tenant/loads/[id]/notify-parties');

// Case 1: Returns hydrated parties with names + org sublabels
{
  console.log('\nCase 1: Hydrates names + org_name + member_count');
  const svc = makeMockSvc({
    load_notify_parties: [
      { id: 'row-1', party_type: 'group', party_id: 'grp-1', source: 'customer', source_organization_id: 'org-A' },
      { id: 'row-2', party_type: 'contact', party_id: 'con-1', source: 'delivery_location', source_organization_id: 'org-B' },
    ],
    organization_groups: [
      { id: 'grp-1', name: 'Operations' },
    ],
    organization_contacts: [
      { id: 'con-1', name: 'John Smith', email: 'john@warehouse.com' },
    ],
    customers: [
      { id: 'org-A', name: 'Acme Corp' },
      { id: 'org-B', name: 'Pacific Warehouse' },
    ],
    organization_group_members: [
      { group_id: 'grp-1' },  // 1 row → member_count = 1
    ],
  });
  const result = await listLoadNotifyParties(svc, { tenantId: 't-1' }, 'load-1');
  check('returns 2 parties', result.parties.length === 2);
  const grp = result.parties.find((p) => p.party_type === 'group');
  const con = result.parties.find((p) => p.party_type === 'contact');
  check('group: name hydrated', grp?.name === 'Operations');
  check('group: source_organization_name hydrated', grp?.source_organization_name === 'Acme Corp');
  check('group: member_count present', typeof grp?.member_count === 'number');
  check('contact: name hydrated', con?.name === 'John Smith');
  check('contact: email hydrated', con?.email === 'john@warehouse.com');
  check('contact: source_organization_name hydrated', con?.source_organization_name === 'Pacific Warehouse');
}

// Case 2: Dead-ref entries returned with name=null
{
  console.log('\nCase 2: Dead-ref entries returned with name=null');
  const svc = makeMockSvc({
    load_notify_parties: [
      { id: 'row-1', party_type: 'group', party_id: 'deleted-grp', source: 'customer', source_organization_id: 'org-A' },
    ],
    organization_groups: [],   // 'deleted-grp' not present
    customers: [{ id: 'org-A', name: 'Acme' }],
    organization_group_members: [],
  });
  const result = await listLoadNotifyParties(svc, { tenantId: 't-1' }, 'load-1');
  check('dead-ref: 1 row still returned', result.parties.length === 1);
  check('dead-ref: name is null', result.parties[0].name === null);
}

// Case 3: Dead-ref contact returned with name=null
{
  console.log('\nCase 3: Dead-ref contact returned with name=null');
  const svc = makeMockSvc({
    load_notify_parties: [
      { id: 'row-1', party_type: 'contact', party_id: 'deleted-con', source: 'customer', source_organization_id: 'org-A' },
    ],
    organization_contacts: [],   // 'deleted-con' not present
    customers: [{ id: 'org-A', name: 'Acme' }],
  });
  const result = await listLoadNotifyParties(svc, { tenantId: 't-1' }, 'load-1');
  check('dead-ref contact: 1 row still returned', result.parties.length === 1);
  check('dead-ref contact: name is null', result.parties[0].name === null);
  check('dead-ref contact: email is null', result.parties[0].email === null);
}

console.log('\nPOST /api/tenant/loads/[id]/notify-parties');

const { addLoadNotifyParty } = await import('../lib/load-notify-parties-hydrator.js');

// Case 4: Successful add with group party_type
{
  console.log('\nCase 4: Successful add (group)');
  let inserted = null;
  const noopLogger = () => Promise.resolve();
  // Custom mock that supports the extra ops POST needs:
  // - .maybeSingle() on organization_groups (cross-tenant check)
  // - .insert() returning .select().single()
  const svc = {
    from: (table) => {
      const c = {
        _table: table,
        _filters: {},
        select: () => c,
        eq: (col, val) => { c._filters[col] = val; return c; },
        maybeSingle: async () => {
          if (table === 'organization_groups') return { data: { id: c._filters.id }, error: null };
          if (table === 'organization_contacts') return { data: { id: c._filters.id }, error: null };
          return { data: null, error: null };
        },
        insert: (rec) => {
          inserted = rec;
          // Insert returns a chain that ends in .select().single()
          return {
            select: () => ({
              single: async () => ({ data: { id: 'new-row', ...inserted }, error: null }),
            }),
          };
        },
      };
      return c;
    },
  };
  const result = await addLoadNotifyParty(
    svc,
    { tenantId: 't-1', userId: 'u-1' },
    'load-1',
    { party_type: 'group', party_id: 'grp-1', source: 'customer', source_organization_id: 'org-A' },
    '127.0.0.1',
    noopLogger
  );
  check('add group: returns row', result.row?.id === 'new-row');
  check('add group: tenant_id set', inserted?.tenant_id === 't-1');
  check('add group: load_id set', inserted?.load_id === 'load-1');
  check('add group: party_type set', inserted?.party_type === 'group');
}

// Case 5: Rejects unknown party_type
{
  console.log('\nCase 5: Rejects unknown party_type');
  const svc = {
    from: () => ({ select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) }) }),
  };
  const noopLogger = () => Promise.resolve();
  let threw = false;
  try {
    await addLoadNotifyParty(svc, { tenantId: 't-1', userId: 'u-1' }, 'load-1', { party_type: 'org', party_id: 'x' }, '127.0.0.1', noopLogger);
  } catch (e) {
    threw = true;
  }
  check('unknown party_type: throws', threw);
}

// Case 6: Rejects cross-tenant party_id (group)
{
  console.log('\nCase 6: Rejects cross-tenant party_id');
  const svc = {
    from: () => {
      const c = {
        select: () => c,
        eq: () => c,
        maybeSingle: async () => ({ data: null, error: null }),  // not found in our tenant
      };
      return c;
    },
  };
  const noopLogger = () => Promise.resolve();
  let threw = false;
  try {
    await addLoadNotifyParty(svc, { tenantId: 't-1', userId: 'u-1' }, 'load-1', { party_type: 'group', party_id: 'grp-other-tenant' }, '127.0.0.1', noopLogger);
  } catch (e) {
    threw = true;
  }
  check('cross-tenant: throws', threw);
}

// Case 7: Returns 409 on duplicate (Postgres unique violation)
{
  console.log('\nCase 7: 409 on duplicate party');
  let attempts = 0;
  const svc = {
    from: (table) => {
      const c = {
        _table: table,
        _filters: {},
        select: () => c,
        eq: (col, val) => { c._filters[col] = val; return c; },
        maybeSingle: async () => {
          if (table === 'organization_groups') return { data: { id: c._filters.id }, error: null };
          return { data: null, error: null };
        },
        insert: () => ({
          select: () => ({
            single: async () => {
              attempts++;
              return { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint' } };
            },
          }),
        }),
      };
      return c;
    },
  };
  const noopLogger = () => Promise.resolve();
  let thrownError = null;
  try {
    await addLoadNotifyParty(
      svc,
      { tenantId: 't-1', userId: 'u-1' },
      'load-1',
      { party_type: 'group', party_id: 'grp-1' },
      '127.0.0.1',
      noopLogger
    );
  } catch (e) {
    thrownError = e;
  }
  check('duplicate: throws', thrownError != null);
  check('duplicate: statusCode === 409', thrownError?.statusCode === 409);
  check('duplicate: insert was attempted', attempts === 1);
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
