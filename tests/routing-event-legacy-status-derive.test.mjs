// FU-082: legacy direct-timestamp PUT path derives event_status from
// {arrived_at, departed_at} after the EDITABLE-fields UPDATE.
//
// Two layers of coverage:
//  - Pure deriveEventStatusFromTimestamps() — table-driven truth.
//  - syncEventStatusFromTimestamps() — full DB-side effects via mock,
//    asserting UPDATE + history INSERT (or absence thereof).
//
// Run: node tests/routing-event-legacy-status-derive.test.mjs

import {
  deriveEventStatusFromTimestamps,
  syncEventStatusFromTimestamps,
} from '../lib/routing/event-status-transition.js';

let passed = 0;
let failed = 0;
function check(name, cond) {
  if (cond) { console.log(`  ✓ ${name}`); passed++; }
  else      { console.log(`  ✗ ${name}`); failed++; }
}

// Mock client — same shape as event-status-transition.test.mjs. Records
// updated/inserted calls keyed by table for assertions.
function makeMockClient(config = {}) {
  const calls = { updated: [], inserted: [] };
  function chain(currentTable) {
    const c = {
      _table: currentTable, _mode: null, _payload: null,
      select(..._args) { if (c._mode == null) c._mode = 'select'; return c; },
      update(payload) { c._mode = 'update'; c._payload = payload; return c; },
      insert(payload) {
        c._mode = 'insert';
        c._payload = payload;
        calls.inserted.push({ table: c._table, payload });
        return Promise.resolve(config.insert ?? { data: null, error: null });
      },
      eq() { return c; },
      // The legacy sync path uses bare UPDATE + .eq() (no .select().single()),
      // so the terminal is the awaited promise itself rather than a chained
      // .single(). Implement `then` to handle that.
      then(resolve) {
        if (c._mode === 'update') {
          calls.updated.push({ table: c._table, payload: c._payload });
          resolve(config.update ?? { data: c._payload, error: null });
        } else {
          resolve({ data: null, error: null });
        }
      },
    };
    return c;
  }
  return { from(table) { return chain(table); }, _calls: calls };
}

console.log('deriveEventStatusFromTimestamps — pure derivation');
{
  check('both NULL -> pending',
    deriveEventStatusFromTimestamps({ arrived_at: null, departed_at: null }) === 'pending');
  check('arrived_at set, departed_at NULL -> arrived',
    deriveEventStatusFromTimestamps({ arrived_at: '2026-04-23T08:47:00Z', departed_at: null }) === 'arrived');
  check('both set -> departed',
    deriveEventStatusFromTimestamps({ arrived_at: '2026-04-23T08:47:00Z', departed_at: '2026-04-23T09:30:00Z' }) === 'departed');
  check('only departed_at set -> departed (legacy path allows pending->departed shortcut)',
    deriveEventStatusFromTimestamps({ arrived_at: null, departed_at: '2026-04-23T09:30:00Z' }) === 'departed');
}

console.log('\nsyncEventStatusFromTimestamps — actor validation');
{
  // Mirror event-status-transition.test.mjs guards.
  let threw = false;
  try {
    await syncEventStatusFromTimestamps({
      supabase: makeMockClient(),
      tenantId: 't1', eventId: 'e1',
      priorStatus: 'pending',
      currentTimestamps: { arrived_at: '2026-04-23T08:47:00Z', departed_at: null },
      actor: null,
    });
  } catch (e) { threw = /actor is required/.test(e.message); }
  check('null actor throws', threw);

  let threw2 = false;
  try {
    await syncEventStatusFromTimestamps({
      supabase: makeMockClient(),
      tenantId: 't1', eventId: 'e1',
      priorStatus: 'pending',
      currentTimestamps: { arrived_at: '2026-04-23T08:47:00Z', departed_at: null },
      actor: { id: 'u1' }, // missing type
    });
  } catch (e) { threw2 = /actor\.type is required/.test(e.message); }
  check('missing actor.type throws', threw2);

  let threw3 = false;
  try {
    await syncEventStatusFromTimestamps({
      supabase: makeMockClient(),
      tenantId: 't1', eventId: 'e1',
      priorStatus: 'pending',
      currentTimestamps: { arrived_at: '2026-04-23T08:47:00Z', departed_at: null },
      actor: { type: 'robot' }, // not in enum
    });
  } catch (e) { threw3 = /actor\.type must be one of/.test(e.message); }
  check('invalid actor.type throws', threw3);
}

console.log('\nsyncEventStatusFromTimestamps — scenario 1: arrived_at only set');
// Dispatcher backfills arrived_at on a previously-pending event.
// Expected: event_status moves pending -> arrived; one history row written.
{
  const svc = makeMockClient();
  const result = await syncEventStatusFromTimestamps({
    supabase: svc,
    tenantId: 't1',
    eventId: 'ev-1',
    priorStatus: 'pending',
    currentTimestamps: {
      arrived_at: '2026-04-23T08:47:00Z',
      departed_at: null,
    },
    actor: { id: 'u-1', type: 'human', context: { reason: 'legacy_timestamp_path' } },
  });
  check('returns derivedStatus=arrived', result.derivedStatus === 'arrived');
  check('returns changed=true', result.changed === true);
  check('exactly 1 UPDATE on order_routing_events', svc._calls.updated.length === 1);
  check('UPDATE table is order_routing_events',
    svc._calls.updated[0]?.table === 'order_routing_events');
  check('UPDATE payload contains event_status=arrived',
    svc._calls.updated[0]?.payload?.event_status === 'arrived');
  check('UPDATE payload does NOT touch timestamps',
    svc._calls.updated[0]?.payload?.arrived_at === undefined
    && svc._calls.updated[0]?.payload?.departed_at === undefined);
  const hist = svc._calls.inserted.find((x) => x.table === 'order_routing_event_status_history');
  check('history row written', !!hist);
  check('history from_status=pending', hist?.payload?.from_status === 'pending');
  check('history to_status=arrived', hist?.payload?.to_status === 'arrived');
  check('history actor_type=human', hist?.payload?.actor_type === 'human');
  check('history actor_id=u-1', hist?.payload?.actor_id === 'u-1');
  check('history note correct',
    hist?.payload?.note === 'derived from direct timestamp edit');
  check('history actor_context contains reason=legacy_timestamp_path',
    hist?.payload?.actor_context?.reason === 'legacy_timestamp_path');
}

console.log('\nsyncEventStatusFromTimestamps — scenario 2: forgotten-arrival backfill (both set)');
// Dispatcher writes both arrived_at + departed_at in a single PUT to
// backfill a forgotten arrival. Expected: pending -> departed; 1 history row.
{
  const svc = makeMockClient();
  const result = await syncEventStatusFromTimestamps({
    supabase: svc,
    tenantId: 't1',
    eventId: 'ev-2',
    priorStatus: 'pending',
    currentTimestamps: {
      arrived_at: '2026-04-23T08:47:00Z',
      departed_at: '2026-04-23T09:30:00Z',
    },
    actor: { id: 'u-1', type: 'human', context: { reason: 'legacy_timestamp_path' } },
  });
  check('returns derivedStatus=departed', result.derivedStatus === 'departed');
  check('returns changed=true', result.changed === true);
  check('1 UPDATE fired', svc._calls.updated.length === 1);
  check('UPDATE event_status=departed',
    svc._calls.updated[0]?.payload?.event_status === 'departed');
  const hist = svc._calls.inserted.find((x) => x.table === 'order_routing_event_status_history');
  check('history row from pending->departed',
    hist?.payload?.from_status === 'pending' && hist?.payload?.to_status === 'departed');
  check('history note correct',
    hist?.payload?.note === 'derived from direct timestamp edit');
}

console.log('\nsyncEventStatusFromTimestamps — scenario 3: departed_at only on a pending event (legacy shortcut)');
// Dispatcher writes ONLY departed_at on a pending event. The strict state
// machine would reject pending->departed; the legacy path must allow it.
{
  const svc = makeMockClient();
  const result = await syncEventStatusFromTimestamps({
    supabase: svc,
    tenantId: 't1',
    eventId: 'ev-3',
    priorStatus: 'pending',
    currentTimestamps: {
      arrived_at: null,
      departed_at: '2026-04-23T09:30:00Z',
    },
    actor: { id: 'u-1', type: 'human' },
  });
  check('returns derivedStatus=departed', result.derivedStatus === 'departed');
  check('returns changed=true', result.changed === true);
  check('UPDATE event_status=departed (state-machine bypass)',
    svc._calls.updated[0]?.payload?.event_status === 'departed');
  const hist = svc._calls.inserted.find((x) => x.table === 'order_routing_event_status_history');
  check('history pending->departed (illegal in strict machine, allowed here)',
    hist?.payload?.from_status === 'pending' && hist?.payload?.to_status === 'departed');
}

console.log('\nsyncEventStatusFromTimestamps — scenario 4: no-op when derived equals prior');
// Equivalent to "PUT that does not touch timestamps" — the API handler
// itself gates this branch on 'arrived_at' in updates || 'departed_at' in
// updates; this test asserts the helper itself is a no-op when called with
// a status that already matches.
{
  const svc = makeMockClient();
  // Event is already 'arrived'; timestamps still imply 'arrived'. Helper
  // must NOT write anything.
  const result = await syncEventStatusFromTimestamps({
    supabase: svc,
    tenantId: 't1',
    eventId: 'ev-4',
    priorStatus: 'arrived',
    currentTimestamps: {
      arrived_at: '2026-04-23T08:47:00Z',
      departed_at: null,
    },
    actor: { id: 'u-1', type: 'human' },
  });
  check('returns derivedStatus=arrived', result.derivedStatus === 'arrived');
  check('returns changed=false', result.changed === false);
  check('NO UPDATE written', svc._calls.updated.length === 0);
  check('NO history row written', svc._calls.inserted.length === 0);
}

console.log('\nsyncEventStatusFromTimestamps — scenario 5: clearing both timestamps -> pending');
// Dispatcher clears both arrived_at and departed_at to undo a touched event.
{
  const svc = makeMockClient();
  const result = await syncEventStatusFromTimestamps({
    supabase: svc,
    tenantId: 't1',
    eventId: 'ev-5',
    priorStatus: 'departed',
    currentTimestamps: {
      arrived_at: null,
      departed_at: null,
    },
    actor: { id: 'u-1', type: 'human' },
  });
  check('returns derivedStatus=pending', result.derivedStatus === 'pending');
  check('returns changed=true', result.changed === true);
  check('UPDATE event_status=pending',
    svc._calls.updated[0]?.payload?.event_status === 'pending');
  const hist = svc._calls.inserted.find((x) => x.table === 'order_routing_event_status_history');
  check('history departed->pending',
    hist?.payload?.from_status === 'departed' && hist?.payload?.to_status === 'pending');
}

console.log('\nsyncEventStatusFromTimestamps — bonus: history insert failure does NOT throw');
// Mirrors transitionEventStatus log-and-continue contract.
{
  const svc = makeMockClient({
    insert: { data: null, error: { message: 'history write failed' } },
  });
  const originalErr = console.error;
  const errors = [];
  console.error = (...args) => { errors.push(args.join(' ')); };
  let threw = false;
  let result;
  try {
    result = await syncEventStatusFromTimestamps({
      supabase: svc,
      tenantId: 't1',
      eventId: 'ev-6',
      priorStatus: 'pending',
      currentTimestamps: { arrived_at: '2026-04-23T08:47:00Z', departed_at: null },
      actor: { id: 'u-1', type: 'human' },
    });
  } catch { threw = true; } finally { console.error = originalErr; }
  check('history failure does NOT throw', !threw);
  check('result.changed=true (UPDATE still ran)', result?.changed === true);
  check('UPDATE fired before history failure', svc._calls.updated.length === 1);
  check('history failure was logged',
    errors.some((m) => m.includes('history insert failed')));
}

console.log('\nsyncEventStatusFromTimestamps — bonus: UPDATE failure DOES throw');
// UPDATE failure is fatal — a desync in event_status is the very thing this
// helper exists to prevent. If we cannot write event_status, callers must
// know.
{
  const svc = makeMockClient({
    update: { data: null, error: { message: 'update failed' } },
  });
  let threw = false;
  let errMsg = '';
  try {
    await syncEventStatusFromTimestamps({
      supabase: svc,
      tenantId: 't1',
      eventId: 'ev-7',
      priorStatus: 'pending',
      currentTimestamps: { arrived_at: '2026-04-23T08:47:00Z', departed_at: null },
      actor: { id: 'u-1', type: 'human' },
    });
  } catch (e) { threw = true; errMsg = e.message; }
  check('UPDATE failure throws', threw);
  check('error message references sync update',
    /event_status sync update failed/.test(errMsg));
  check('NO history row attempted after UPDATE failure',
    svc._calls.inserted.length === 0);
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
