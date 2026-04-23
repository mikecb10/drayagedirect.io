import { transitionMoveStatus } from '../lib/routing/moves/transition.js';

let passed = 0;
let failed = 0;
function check(name, cond) {
  if (cond) { console.log(`  ✓ ${name}`); passed++; }
  else      { console.log(`  ✗ ${name}`); failed++; }
}

// Same mock shape as tests/charge-sets-transition.test.mjs — inlined here
// (not extracted because the two tests are the only callers and
// duplication is cheaper than sharing).
function makeMockClient(config) {
  const calls = { selected: [], updated: [], inserted: [], terminals: [] };
  function chain(currentTable) {
    const c = {
      _table: currentTable, _mode: null, _payload: null,
      select(..._args) { return c; },
      update(payload) { c._mode = 'update'; c._payload = payload; return c; },
      insert(payload) { c._mode = 'insert'; c._payload = payload; return c; },
      eq() { return c; },
      in() { return c; },
      async maybeSingle() {
        calls.terminals.push({ kind: 'maybeSingle', table: c._table });
        return config.fetch ?? { data: null, error: null };
      },
      async single() {
        if (c._mode === 'update') {
          calls.updated.push({ table: c._table, payload: c._payload });
          calls.terminals.push({ kind: 'update.single', table: c._table });
          return config.update ?? { data: c._payload, error: null };
        }
        calls.terminals.push({ kind: 'single', table: c._table });
        return config.fetch ?? { data: null, error: null };
      },
      then(resolve) {
        if (c._mode === 'insert') {
          calls.inserted.push({ table: c._table, payload: c._payload });
          resolve(config.insert ?? { data: null, error: null });
        } else if (c._mode === 'update') {
          calls.updated.push({ table: c._table, payload: c._payload });
          resolve(config.update ?? { data: null, error: null });
        } else {
          resolve({ data: null, error: null });
        }
      },
    };
    return c;
  }
  return { from(table) { return chain(table); }, _calls: calls };
}

console.log('transitionMoveStatus');

// Case 1: Success (status only)
{
  const svc = makeMockClient({
    fetch: { data: { id: 'm-1', status: 'pending' }, error: null },
    update: { data: { id: 'm-1', status: 'in_progress' }, error: null },
  });
  const r = await transitionMoveStatus(svc, {
    tenantId: 't-1', moveId: 'm-1', newStatus: 'in_progress', actorUserId: 'u-1',
  });
  check('oldStatus=pending', r.oldStatus === 'pending');
  check('newStatus=in_progress', r.newStatus === 'in_progress');
  check('1 UPDATE', svc._calls.updated.length === 1);
  check('1 INSERT to history', svc._calls.inserted.length === 1);
  check('history table correct',
    svc._calls.inserted[0]?.table === 'order_container_moves_status_history');
}

// Case 2: Success (status + extraFields)
{
  const svc = makeMockClient({
    fetch: { data: { id: 'm-2', status: 'in_progress' }, error: null },
    update: { data: { id: 'm-2', status: 'completed' }, error: null },
  });
  await transitionMoveStatus(svc, {
    tenantId: 't-1', moveId: 'm-2', newStatus: 'completed', actorUserId: 'u-1',
    extraFields: { completed_at: '2026-04-24T00:00:00Z' },
  });
  const payload = svc._calls.updated[0]?.payload;
  check('payload status=completed', payload?.status === 'completed');
  check('payload completed_at merged', payload?.completed_at === '2026-04-24T00:00:00Z');
  const histPayload = svc._calls.inserted[0]?.payload;
  check('history has new_status', histPayload?.new_status === 'completed');
  check('history excludes completed_at', histPayload?.completed_at === undefined);
}

// Case 3: No-op (same status, no extraFields)
{
  const svc = makeMockClient({
    fetch: { data: { id: 'm-3', status: 'completed' }, error: null },
  });
  const r = await transitionMoveStatus(svc, {
    tenantId: 't-1', moveId: 'm-3', newStatus: 'completed', actorUserId: null,
  });
  check('no-op return', r.oldStatus === 'completed' && r.newStatus === 'completed');
  check('no UPDATE', svc._calls.updated.length === 0);
  check('no INSERT', svc._calls.inserted.length === 0);
}

// Case 4: UPDATE fails → throws
{
  const svc = makeMockClient({
    fetch: { data: { id: 'm-4', status: 'pending' }, error: null },
    update: { data: null, error: { message: 'update failed' } },
  });
  let threw = false;
  try {
    await transitionMoveStatus(svc, {
      tenantId: 't-1', moveId: 'm-4', newStatus: 'in_progress', actorUserId: null,
    });
  } catch { threw = true; }
  check('UPDATE error throws', threw);
  check('no history row on UPDATE failure', svc._calls.inserted.length === 0);
}

// Case 5: History INSERT fails → does NOT throw
{
  const svc = makeMockClient({
    fetch: { data: { id: 'm-5', status: 'pending' }, error: null },
    update: { data: { id: 'm-5', status: 'in_progress' }, error: null },
    insert: { data: null, error: { message: 'history failed' } },
  });
  let threw = false;
  let result;
  try {
    result = await transitionMoveStatus(svc, {
      tenantId: 't-1', moveId: 'm-5', newStatus: 'in_progress', actorUserId: null,
    });
  } catch { threw = true; }
  check('history failure does NOT throw', !threw);
  check('UPDATE still happens', svc._calls.updated.length === 1);
  check('helper returns normally', result?.newStatus === 'in_progress');
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
