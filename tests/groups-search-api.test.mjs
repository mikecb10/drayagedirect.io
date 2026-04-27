let passed = 0;
let failed = 0;
function check(name, cond) {
  if (cond) { console.log(`  ✓ ${name}`); passed++; }
  else      { console.log(`  ✗ ${name}`); failed++; }
}

const handlerModule = await import('../pages/api/tenant/groups/search.js');
const { searchGroups } = handlerModule;

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
      limit: (n) => { c._limit = n; return c; },
      order: (col, opts) => { c._order = { col, opts }; return c; },
      then: (resolve) => {
        calls.queries.push({ table, filters: { ...c._filters }, ilike: c._ilike, limit: c._limit, terminal: 'await' });
        if (config[table] !== undefined) resolve({ data: config[table], error: null });
        else resolve({ data: [], error: null });
      },
    };
    return c;
  }
  return { from(table) { return chain(table); }, _calls: calls };
}

console.log('GET /api/tenant/groups/search');

// Case 1: Basic match
{
  console.log('\nCase 1: Basic match');
  const svc = makeMockSvc({
    organization_groups: [
      {
        id: 'g-1',
        name: 'Operations',
        organization_id: 'org-A',
        organization: { name: 'Acme Corp' },
        members: [{ count: 4 }],
      },
    ],
  });
  const result = await searchGroups(svc, { tenantId: 't-1' }, 'ops');
  check('returns 1 group', result.groups.length === 1);
  check('name hydrated', result.groups[0].name === 'Operations');
  check('organization_name hydrated', result.groups[0].organization_name === 'Acme Corp');
  check('member_count derived', result.groups[0].member_count === 4);
  check('tenant_id filter applied', svc._calls.queries[0].filters.tenant_id === 't-1');
  check('limit 25 applied', svc._calls.queries[0].limit === 25);
}

// Case 2: Empty query throws
{
  console.log('\nCase 2: Empty query throws');
  const svc = makeMockSvc({});
  let thrown = null;
  try { await searchGroups(svc, { tenantId: 't-1' }, ''); }
  catch (e) { thrown = e; }
  check('empty q throws', thrown != null);
  check('statusCode 400', thrown?.statusCode === 400);
}

// Case 3: Group with zero members returns member_count=0
{
  console.log('\nCase 3: Group with zero members');
  const svc = makeMockSvc({
    organization_groups: [
      {
        id: 'g-empty',
        name: 'Empty Group',
        organization_id: 'org-A',
        organization: { name: 'Acme' },
        members: [],
      },
    ],
  });
  const result = await searchGroups(svc, { tenantId: 't-1' }, 'empty');
  check('member_count is 0', result.groups[0].member_count === 0);
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
