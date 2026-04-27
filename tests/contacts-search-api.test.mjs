let passed = 0;
let failed = 0;
function check(name, cond) {
  if (cond) { console.log(`  ✓ ${name}`); passed++; }
  else      { console.log(`  ✗ ${name}`); failed++; }
}

const handlerModule = await import('../pages/api/tenant/contacts/search.js');
const { searchContacts } = handlerModule;

function makeMockSvc(config = {}) {
  const calls = { queries: [] };
  function chain(table) {
    const c = {
      _table: table,
      _filters: {},
      _ilike: null,
      _limit: null,
      _order: null,
      select: (..._a) => c,
      eq: (col, val) => { c._filters[col] = val; return c; },
      ilike: (col, val) => { c._ilike = { col, val }; return c; },
      or: (expr) => { c._filters.or = expr; return c; },
      limit: (n) => { c._limit = n; return c; },
      order: (col, opts) => { c._order = { col, opts }; return c; },
      then: (resolve) => {
        calls.queries.push({ table, filters: { ...c._filters }, ilike: c._ilike, limit: c._limit, order: c._order, terminal: 'await' });
        if (config[table] !== undefined) resolve({ data: config[table], error: null });
        else resolve({ data: [], error: null });
      },
    };
    return c;
  }
  return { from(table) { return chain(table); }, _calls: calls };
}

console.log('GET /api/tenant/contacts/search');

// Case 1: Basic match returns hydrated rows
{
  console.log('\nCase 1: Basic match returns hydrated rows');
  const svc = makeMockSvc({
    organization_contacts: [
      {
        id: 'c-1',
        first_name: 'Jane',
        last_name: 'Smith',
        email: 'jane@acme.com',
        organization_id: 'org-A',
        organization: { name: 'Acme Corp' },
      },
    ],
  });
  const result = await searchContacts(svc, { tenantId: 't-1' }, 'jane');
  check('returns 1 contact', result.contacts.length === 1);
  check('first_name hydrated', result.contacts[0].first_name === 'Jane');
  check('email hydrated', result.contacts[0].email === 'jane@acme.com');
  check('organization_name hydrated', result.contacts[0].organization_name === 'Acme Corp');
  check('tenant_id filter applied', svc._calls.queries[0].filters.tenant_id === 't-1');
  check('limit 25 applied', svc._calls.queries[0].limit === 25);
}

// Case 2: Empty query throws
{
  console.log('\nCase 2: Empty query throws');
  const svc = makeMockSvc({});
  let thrown = null;
  try { await searchContacts(svc, { tenantId: 't-1' }, ''); }
  catch (e) { thrown = e; }
  check('empty q throws', thrown != null);
  check('empty q statusCode 400', thrown?.statusCode === 400);
}

// Case 3: Whitespace-only query throws
{
  console.log('\nCase 3: Whitespace-only query throws');
  const svc = makeMockSvc({});
  let thrown = null;
  try { await searchContacts(svc, { tenantId: 't-1' }, '   '); }
  catch (e) { thrown = e; }
  check('whitespace q throws', thrown != null);
}

// Case 4: Cross-tenant isolation
{
  console.log('\nCase 4: Cross-tenant isolation');
  const svc = makeMockSvc({ organization_contacts: [] });
  await searchContacts(svc, { tenantId: 't-A' }, 'jane');
  check('queries with tenant_id filter', svc._calls.queries[0].filters.tenant_id === 't-A');
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
