import { expandRecipients } from '../lib/email-dispatch/recipient-expander.js';

let passed = 0;
let failed = 0;
function check(name, cond) {
  if (cond) { console.log(`  ✓ ${name}`); passed++; }
  else      { console.log(`  ✗ ${name}`); failed++; }
}

// Mock client supporting the three tables our resolver hits:
// 1. load_notify_parties (await terminal, returns array)
// 2. organization_group_members (await terminal, returns array of {contact:{email}})
// 3. organization_contacts (.maybeSingle() returns {email})
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
        // For maybeSingle on organization_contacts, allow per-id config
        if (table === 'organization_contacts' && cfg && cfg.byId) {
          return { data: cfg.byId[c._filters.id] || null, error: null };
        }
        return { data: cfg, error: null };
      },
      then: (resolve) => {
        calls.queries.push({ table, filters: { ...c._filters }, terminal: 'await' });
        const cfg = config[table];
        if (cfg === undefined) { resolve({ data: [], error: null }); return; }
        // For await on organization_group_members, allow per-group config
        if (table === 'organization_group_members' && cfg && cfg.byGroupId) {
          resolve({ data: cfg.byGroupId[c._filters.group_id] || [], error: null });
          return;
        }
        resolve({ data: cfg, error: null });
      },
    };
    return c;
  }
  return { from(table) { return chain(table); }, _calls: calls };
}

console.log('load_notify_parties — resolver token expansion');

// ──────────────────────────────────────────────────────────────
// Case 1: Group party expands to all member emails
{
  console.log('\nCase 1: Group party expands to all member emails');
  const svc = makeMockClient({
    load_notify_parties: [
      { party_type: 'group', party_id: 'grp-1' },
    ],
    organization_group_members: {
      byGroupId: {
        'grp-1': [
          { contact: { email: 'a@x.com' } },
          { contact: { email: 'b@x.com' } },
          { contact: { email: 'c@x.com' } },
        ],
      },
    },
  });
  const out = await expandRecipients(
    svc, 't-1',
    [{ type: 'role', value: 'load_notify_parties' }],
    { order: { id: 'ord-1' } },
    new Map()
  );
  check('group: 3 emails returned', Array.isArray(out) && out.length === 3);
  check('group: a@x.com included', out.includes('a@x.com'));
  check('group: c@x.com included', out.includes('c@x.com'));
}

// Case 2: Contact party expands to one email
{
  console.log('\nCase 2: Contact party expands to one email');
  const svc = makeMockClient({
    load_notify_parties: [
      { party_type: 'contact', party_id: 'con-1' },
    ],
    organization_contacts: {
      byId: { 'con-1': { email: 'lone@x.com' } },
    },
  });
  const out = await expandRecipients(
    svc, 't-1',
    [{ type: 'role', value: 'load_notify_parties' }],
    { order: { id: 'ord-2' } },
    new Map()
  );
  check('contact: 1 email returned', out.length === 1);
  check('contact: lone@x.com included', out.includes('lone@x.com'));
}

// Case 3: Mixed group + contact, dedupe overlap
{
  console.log('\nCase 3: Mixed group + contact, dedupe overlap');
  const svc = makeMockClient({
    load_notify_parties: [
      { party_type: 'group', party_id: 'grp-3' },
      { party_type: 'contact', party_id: 'con-3' },
    ],
    organization_group_members: {
      byGroupId: {
        'grp-3': [
          { contact: { email: 'shared@x.com' } },
          { contact: { email: 'unique@x.com' } },
        ],
      },
    },
    organization_contacts: {
      byId: { 'con-3': { email: 'shared@x.com' } },
    },
  });
  const out = await expandRecipients(
    svc, 't-1',
    [{ type: 'role', value: 'load_notify_parties' }],
    { order: { id: 'ord-3' } },
    new Map()
  );
  check('mixed dedupe: 2 unique emails (shared+unique)', out.length === 2);
}

// Case 4: Empty notify-party list returns []
{
  console.log('\nCase 4: Empty notify-party list returns []');
  const svc = makeMockClient({
    load_notify_parties: [],
  });
  const out = await expandRecipients(
    svc, 't-1',
    [{ type: 'role', value: 'load_notify_parties' }],
    { order: { id: 'ord-4' } },
    new Map()
  );
  check('empty: 0 emails returned', out.length === 0);
}

// Case 5: Missing/deleted party silently skipped
{
  console.log('\nCase 5: Missing/deleted party silently skipped');
  const svc = makeMockClient({
    load_notify_parties: [
      { party_type: 'group', party_id: 'grp-deleted' },
      { party_type: 'contact', party_id: 'con-5' },
    ],
    organization_group_members: { byGroupId: { /* grp-deleted not present */ } },
    organization_contacts: { byId: { 'con-5': { email: 'survivor@x.com' } } },
  });
  const out = await expandRecipients(
    svc, 't-1',
    [{ type: 'role', value: 'load_notify_parties' }],
    { order: { id: 'ord-5' } },
    new Map()
  );
  check('missing party skipped: 1 email returned', out.length === 1);
  check('missing party skipped: survivor@x.com included', out.includes('survivor@x.com'));
}

// Case 6: No load.id in context returns []
{
  console.log('\nCase 6: No load.id in context returns []');
  const svc = makeMockClient({});
  const out = await expandRecipients(
    svc, 't-1',
    [{ type: 'role', value: 'load_notify_parties' }],
    { /* no order/load */ },
    new Map()
  );
  check('no context: 0 emails returned', out.length === 0);
  check('no context: no DB query made', svc._calls.queries.length === 0);
}

// Case 7: Cache hit on second call
{
  console.log('\nCase 7: Cache hit on second call');
  const cache = new Map();
  const svc = makeMockClient({
    load_notify_parties: [
      { party_type: 'contact', party_id: 'con-7' },
    ],
    organization_contacts: { byId: { 'con-7': { email: 'cached@x.com' } } },
  });
  const ctx = { order: { id: 'ord-7' } };
  const out1 = await expandRecipients(svc, 't-1', [{ type: 'role', value: 'load_notify_parties' }], ctx, cache);
  const queryCount1 = svc._calls.queries.length;
  const out2 = await expandRecipients(svc, 't-1', [{ type: 'role', value: 'load_notify_parties' }], ctx, cache);
  const queryCount2 = svc._calls.queries.length;
  check('cache: out1 matches out2', out1[0] === out2[0]);
  check('cache: second call adds 0 new queries', queryCount2 === queryCount1);
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
