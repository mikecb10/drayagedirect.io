import { swapDefaultGroup } from '../lib/organizations/default-group-swap.js';

let passed = 0;
let failed = 0;
function check(name, cond) {
  if (cond) { console.log(`  ✓ ${name}`); passed++; }
  else      { console.log(`  ✗ ${name}`); failed++; }
}

// Mock Supabase chain — captures the update statement built via chained
// .update().eq().eq().eq().eq().neq() calls.
function makeMockClient(config = {}) {
  const calls = { updates: [] };
  function chain(table) {
    const c = {
      _table: table,
      _mode: null,
      _payload: null,
      _filters: {},
      _exclusions: [],
      update(payload) { c._mode = 'update'; c._payload = payload; return c; },
      eq(col, val) { c._filters[col] = val; return c; },
      neq(col, val) { c._exclusions.push({ col, val }); return c; },
      then(resolve) {
        if (c._mode === 'update') {
          calls.updates.push({
            table: c._table,
            payload: c._payload,
            filters: { ...c._filters },
            exclusions: [...c._exclusions],
          });
          resolve(config.updateResult ?? { data: null, error: null });
        } else {
          resolve({ data: null, error: null });
        }
      },
    };
    return c;
  }
  return { from(table) { return chain(table); }, _calls: calls };
}

console.log('swapDefaultGroup');

// Case 1: POST use case — swap without excludeGroupId
{
  const svc = makeMockClient();
  const result = await swapDefaultGroup(svc, {
    tenantId: 't-1',
    organizationId: 'org-1',
    purpose: 'billing',
  });
  check('no error on success', result?.error === null || result?.error === undefined);
  check('one UPDATE call was made', svc._calls.updates.length === 1);
  const upd = svc._calls.updates[0];
  check('update targets organization_groups', upd?.table === 'organization_groups');
  check('update payload sets is_default_for_purpose=false',
    upd?.payload?.is_default_for_purpose === false);
  check('filter: tenant_id', upd?.filters?.tenant_id === 't-1');
  check('filter: organization_id', upd?.filters?.organization_id === 'org-1');
  check('filter: purpose', upd?.filters?.purpose === 'billing');
  check('filter: is_default_for_purpose=true', upd?.filters?.is_default_for_purpose === true);
  check('no excludeGroupId → no .neq() applied', upd?.exclusions?.length === 0);
}

// Case 2: PUT use case — swap WITH excludeGroupId (don't unset the group being updated)
{
  const svc = makeMockClient();
  await swapDefaultGroup(svc, {
    tenantId: 't-1',
    organizationId: 'org-2',
    purpose: 'rate_confirmation',
    excludeGroupId: 'grp-2',
  });
  const upd = svc._calls.updates[0];
  check('PUT: excludeGroupId adds .neq exclusion', upd?.exclusions?.length === 1);
  check('PUT: exclusion excludes id=grp-2',
    upd?.exclusions?.[0]?.col === 'id' && upd?.exclusions?.[0]?.val === 'grp-2');
}

// Case 3: No purpose rejected (guard)
{
  const svc = makeMockClient();
  const result = await swapDefaultGroup(svc, {
    tenantId: 't-1',
    organizationId: 'org-3',
    purpose: null,
  });
  check('null purpose returns error', result?.error instanceof Error);
  check('null purpose: no UPDATE called', svc._calls.updates.length === 0);
}

// Case 4: Empty string purpose rejected
{
  const svc = makeMockClient();
  const result = await swapDefaultGroup(svc, {
    tenantId: 't-1',
    organizationId: 'org-4',
    purpose: '',
  });
  check('empty purpose returns error', result?.error instanceof Error);
  check('empty purpose: no UPDATE called', svc._calls.updates.length === 0);
}

// Case 5: DB error propagates
{
  const svc = makeMockClient({ updateResult: { data: null, error: { message: 'db connection lost' } } });
  const result = await swapDefaultGroup(svc, {
    tenantId: 't-1',
    organizationId: 'org-5',
    purpose: 'billing',
  });
  check('DB error propagates as result.error', result?.error?.message === 'db connection lost');
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
