let passed = 0;
let failed = 0;
function check(name, cond) {
  if (cond) { console.log(`  ✓ ${name}`); passed++; }
  else      { console.log(`  ✗ ${name}`); failed++; }
}

const orgPatchModule = await import('../lib/notify-parties-validator.js');
const { validateDefaultNotifyParties } = orgPatchModule;

console.log('validateDefaultNotifyParties — input shape validation');

// Case 1: Valid array passes
{
  console.log('\nCase 1: Valid array passes');
  const out = validateDefaultNotifyParties([
    { type: 'group', id: '11111111-1111-1111-1111-111111111111', source_organization_id: '22222222-2222-2222-2222-222222222222' },
    { type: 'contact', id: '33333333-3333-3333-3333-333333333333' },
  ]);
  check('valid: returns array of length 2', Array.isArray(out) && out.length === 2);
}

// Case 2: Empty array passes
{
  console.log('\nCase 2: Empty array passes');
  const out = validateDefaultNotifyParties([]);
  check('empty: returns []', Array.isArray(out) && out.length === 0);
}

// Case 3: Missing type rejected
{
  console.log('\nCase 3: Entry missing type is rejected');
  let threw = false;
  try { validateDefaultNotifyParties([{ id: 'x' }]); } catch { threw = true; }
  check('missing type: throws', threw);
}

// Case 4: Missing id rejected
{
  console.log('\nCase 4: Entry missing id is rejected');
  let threw = false;
  try { validateDefaultNotifyParties([{ type: 'group' }]); } catch { threw = true; }
  check('missing id: throws', threw);
}

// Case 5: Bad type value rejected
{
  console.log('\nCase 5: Bad type value rejected');
  let threw = false;
  try { validateDefaultNotifyParties([{ type: 'org', id: '11111111-1111-1111-1111-111111111111' }]); } catch { threw = true; }
  check('bad type: throws', threw);
}

// Case 6: Non-array rejected
{
  console.log('\nCase 6: Non-array rejected');
  let threw = false;
  try { validateDefaultNotifyParties({ type: 'group', id: 'x' }); } catch { threw = true; }
  check('non-array: throws', threw);
}

console.log('\ncopyDefaultNotifyParties — default-copy logic');

const { copyDefaultNotifyParties } = await import('../lib/load-notify-parties-hydrator.js');

// Case 7: Copies all defaults to load_notify_parties rows
{
  console.log('\nCase 7: Copies all defaults');
  let inserted = null;
  const svc = {
    from: (table) => {
      const c = {
        _table: table,
        _filters: {},
        select: () => c,
        eq: (col, val) => { c._filters[col] = val; return c; },
        in: (col, vals) => { c._filters[`in:${col}`] = vals; return c; },
        maybeSingle: async () => {
          if (table === 'customers') {
            return {
              data: {
                default_notify_parties: [
                  { type: 'group', id: '11111111-1111-1111-1111-111111111111', source_organization_id: '22222222-2222-2222-2222-222222222222' },
                  { type: 'contact', id: '33333333-3333-3333-3333-333333333333' },
                ],
              },
              error: null,
            };
          }
          return { data: null, error: null };
        },
        then: (resolve) => {
          if (table === 'organization_groups') resolve({ data: [{ id: '11111111-1111-1111-1111-111111111111' }], error: null });
          else if (table === 'organization_contacts') resolve({ data: [{ id: '33333333-3333-3333-3333-333333333333' }], error: null });
          else resolve({ data: [], error: null });
        },
        insert: (recs) => { inserted = recs; return { error: null }; },
      };
      return c;
    },
  };
  const count = await copyDefaultNotifyParties(svc, { tenantId: 't-1', userId: 'u-1' }, 'load-1', 'cust-1');
  check('copy: 2 rows inserted', count === 2);
  check('copy: rows have source=default', Array.isArray(inserted) && inserted.every((r) => r.source === 'default'));
  check('copy: rows have load_id', inserted.every((r) => r.load_id === 'load-1'));
  check('copy: rows have tenant_id', inserted.every((r) => r.tenant_id === 't-1'));
}

// Case 8: Empty defaults inserts nothing
{
  console.log('\nCase 8: Empty defaults inserts nothing');
  let insertedCount = 0;
  const svc = {
    from: (table) => {
      const c = {
        _table: table,
        _filters: {},
        select: () => c,
        eq: () => c,
        in: () => c,
        maybeSingle: async () => ({ data: { default_notify_parties: [] }, error: null }),
        insert: () => { insertedCount++; return { error: null }; },
      };
      return c;
    },
  };
  const count = await copyDefaultNotifyParties(svc, { tenantId: 't-1', userId: 'u-1' }, 'load-1', 'cust-1');
  check('empty: 0 rows', count === 0);
  check('empty: insert not called', insertedCount === 0);
}

// Case 9: Filters dead refs (group exists, contact deleted)
{
  console.log('\nCase 9: Filters dead refs');
  let inserted = null;
  const svc = {
    from: (table) => {
      const c = {
        _table: table,
        _filters: {},
        select: () => c,
        eq: () => c,
        in: () => c,
        maybeSingle: async () => {
          if (table === 'customers') {
            return {
              data: {
                default_notify_parties: [
                  { type: 'group', id: 'grp-alive' },
                  { type: 'contact', id: 'con-deleted' },
                ],
              },
              error: null,
            };
          }
          return { data: null, error: null };
        },
        then: (resolve) => {
          if (table === 'organization_groups') resolve({ data: [{ id: 'grp-alive' }], error: null });
          else if (table === 'organization_contacts') resolve({ data: [], error: null });  // con-deleted not present
          else resolve({ data: [], error: null });
        },
        insert: (recs) => { inserted = recs; return { error: null }; },
      };
      return c;
    },
  };
  const count = await copyDefaultNotifyParties(svc, { tenantId: 't-1', userId: 'u-1' }, 'load-1', 'cust-1');
  check('dead-ref: 1 row inserted (group only)', count === 1);
  check('dead-ref: row is the group', inserted?.length === 1 && inserted[0].party_type === 'group');
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
