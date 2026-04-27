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

// Case 4: Trailing backslash is normalized so it can't escape the closing %
// wildcard. groups/search.js uses single-column .ilike() (not .or()), so
// PostgREST comma/paren parsing isn't an issue here, but the same escape
// chain is applied for consistency with contacts/search.js and the
// dispatcher planner.
{
  console.log('\nCase 4: Trailing backslash normalized');
  let capturedIlike = null;
  const svc = {
    from: (table) => {
      const c = {
        _table: table,
        _filters: { tenant_id: null },
        select: () => c,
        eq: (col, val) => { c._filters[col] = val; return c; },
        ilike: (col, val) => { capturedIlike = { col, val }; return c; },
        order: () => c,
        limit: () => c,
        then: (resolve) => resolve({ data: [], error: null }),
      };
      return c;
    },
  };
  // user types 'abc\' (one trailing backslash); JS source needs 'abc\\'
  await searchGroups(svc, { tenantId: 't-1' }, 'abc\\');
  // After normalization, the pattern should be '%abc\\%' (literal: %,a,b,c,\,\,%)
  // → JS source string '%abc\\\\%'. Without normalization it would be '%abc\%'.
  check(
    'trailing backslash doubled to prevent escaping closing %',
    capturedIlike != null && capturedIlike.val === '%abc\\\\%'
  );
}

// Case 5: Comma/parens in query are stripped (consistency with contacts).
// Single-column .ilike() doesn't suffer the .or() parser issue, but the
// same sanitization is applied so the behavior is uniform across helpers.
{
  console.log('\nCase 5: Comma + parens stripped from query');
  let capturedIlike = null;
  const svc = {
    from: () => {
      const c = {
        select: () => c,
        eq: () => c,
        ilike: (col, val) => { capturedIlike = { col, val }; return c; },
        order: () => c,
        limit: () => c,
        then: (resolve) => resolve({ data: [], error: null }),
      };
      return c;
    },
  };
  await searchGroups(svc, { tenantId: 't-1' }, 'A, B (C)');
  check('no comma in pattern', capturedIlike != null && !capturedIlike.val.includes(','));
  check('no parens in pattern', !capturedIlike.val.includes('(') && !capturedIlike.val.includes(')'));
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
