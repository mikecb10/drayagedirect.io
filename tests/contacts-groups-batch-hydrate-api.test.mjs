let passed = 0;
let failed = 0;
function check(name, cond) {
  if (cond) { console.log(`  ✓ ${name}`); passed++; }
  else      { console.log(`  ✗ ${name}`); failed++; }
}

const contactsModule = await import('../pages/api/tenant/contacts/index.js');
const { hydrateContacts } = contactsModule;

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

console.log('GET /api/tenant/contacts?ids=');

// Case 1: Returns hydrated rows for given ids
{
  console.log('\nCase 1: Returns hydrated rows');
  const svc = makeMockSvc({
    organization_contacts: [
      { id: 'c-1', first_name: 'Jane', last_name: 'Smith', email: 'jane@acme.com', organization_id: 'org-A', organization: { name: 'Acme' } },
      { id: 'c-2', first_name: 'Bob', last_name: 'Lee', email: 'bob@acme.com', organization_id: 'org-A', organization: { name: 'Acme' } },
    ],
  });
  const result = await hydrateContacts(svc, { tenantId: 't-1' }, ['c-1', 'c-2']);
  check('returns 2 contacts', result.contacts.length === 2);
  check('first_name hydrated', result.contacts.find((c) => c.id === 'c-1').first_name === 'Jane');
  check('organization_name hydrated', result.contacts[0].organization_name === 'Acme');
  check('tenant_id filter', svc._calls.queries[0].filters.tenant_id === 't-1');
  check('in() filter on id', Array.isArray(svc._calls.queries[0].filters['in:id']));
}

// Case 2: Empty ids array throws
{
  console.log('\nCase 2: Empty ids array throws');
  const svc = makeMockSvc({});
  let thrown = null;
  try { await hydrateContacts(svc, { tenantId: 't-1' }, []); }
  catch (e) { thrown = e; }
  check('throws', thrown != null);
  check('statusCode 400', thrown?.statusCode === 400);
}

// Case 3: Over-100 ids throws
{
  console.log('\nCase 3: Over-100 ids throws');
  const svc = makeMockSvc({});
  const ids = Array.from({ length: 101 }, (_, i) => `c-${i}`);
  let thrown = null;
  try { await hydrateContacts(svc, { tenantId: 't-1' }, ids); }
  catch (e) { thrown = e; }
  check('throws', thrown != null);
  check('statusCode 400', thrown?.statusCode === 400);
}

// Case 4: Missing ids silently omitted (dead-ref)
{
  console.log('\nCase 4: Missing ids silently omitted');
  const svc = makeMockSvc({
    organization_contacts: [
      { id: 'c-1', first_name: 'Jane', last_name: null, email: 'j@x.com', organization_id: 'org-A', organization: null },
    ],
  });
  const result = await hydrateContacts(svc, { tenantId: 't-1' }, ['c-1', 'c-deleted']);
  check('returns only the alive row', result.contacts.length === 1);
  check('alive row id is c-1', result.contacts[0].id === 'c-1');
}

console.log('\nGET /api/tenant/groups?ids=');

const groupsModule = await import('../pages/api/tenant/groups/index.js');
const { hydrateGroups } = groupsModule;

// Case 5: Returns hydrated group rows
{
  console.log('\nCase 5: Returns hydrated groups');
  const svc = makeMockSvc({
    organization_groups: [
      { id: 'g-1', name: 'Operations', organization_id: 'org-A', organization: { name: 'Acme' }, members: [{ count: 3 }] },
      { id: 'g-2', name: 'Billing', organization_id: 'org-A', organization: { name: 'Acme' }, members: [{ count: 2 }] },
    ],
  });
  const result = await hydrateGroups(svc, { tenantId: 't-1' }, ['g-1', 'g-2']);
  check('returns 2 groups', result.groups.length === 2);
  check('name hydrated', result.groups.find((g) => g.id === 'g-1').name === 'Operations');
  check('organization_name hydrated', result.groups[0].organization_name === 'Acme');
  check('member_count derived', result.groups.find((g) => g.id === 'g-1').member_count === 3);
}

// Case 6: Empty ids throws
{
  console.log('\nCase 6: Empty ids throws (groups)');
  const svc = makeMockSvc({});
  let thrown = null;
  try { await hydrateGroups(svc, { tenantId: 't-1' }, []); }
  catch (e) { thrown = e; }
  check('throws', thrown != null);
  check('statusCode 400', thrown?.statusCode === 400);
}

// Case 7: Over-100 ids throws (groups)
{
  console.log('\nCase 7: Over-100 ids throws (groups)');
  const svc = makeMockSvc({});
  const ids = Array.from({ length: 101 }, (_, i) => `g-${i}`);
  let thrown = null;
  try { await hydrateGroups(svc, { tenantId: 't-1' }, ids); }
  catch (e) { thrown = e; }
  check('throws', thrown != null);
}

// Case 8: Dead-ref groups silently omitted
{
  console.log('\nCase 8: Dead-ref groups omitted');
  const svc = makeMockSvc({
    organization_groups: [
      { id: 'g-alive', name: 'Alive', organization_id: 'org-A', organization: { name: 'Acme' }, members: [{ count: 1 }] },
    ],
  });
  const result = await hydrateGroups(svc, { tenantId: 't-1' }, ['g-alive', 'g-deleted']);
  check('returns only alive', result.groups.length === 1);
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
