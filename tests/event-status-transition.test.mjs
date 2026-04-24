import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import {
  isValidTransition,
  getAllowedNextStatuses,
  transitionEventStatus,
} from '../lib/routing/event-status-transition.js';

// Mock client — same shape/spirit as tests/routing-moves-transition.test.mjs
// makeMockClient (duplicated rather than imported because the two tests
// exercise different tables and chains). Returns a Supabase-like builder
// that records selected/updated/inserted calls for assertions.
function makeMockClient(config = {}) {
  const calls = { selected: [], updated: [], inserted: [] };
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
      async maybeSingle() {
        calls.selected.push({ table: c._table, kind: 'maybeSingle' });
        return config.fetch ?? { data: null, error: null };
      },
      async single() {
        if (c._mode === 'update') {
          calls.updated.push({ table: c._table, payload: c._payload });
          return config.update ?? { data: c._payload, error: null };
        }
        calls.selected.push({ table: c._table, kind: 'single' });
        return config.fetch ?? { data: null, error: null };
      },
    };
    return c;
  }
  return { from(table) { return chain(table); }, _calls: calls };
}

test('isValidTransition — pending can go to arrived or skipped', () => {
  assert.equal(isValidTransition('pending', 'arrived'), true);
  assert.equal(isValidTransition('pending', 'skipped'), true);
  assert.equal(isValidTransition('pending', 'departed'), false); // must pass through arrived
});

test('isValidTransition — arrived can go to departed or skipped', () => {
  assert.equal(isValidTransition('arrived', 'departed'), true);
  assert.equal(isValidTransition('arrived', 'skipped'), true);
  assert.equal(isValidTransition('arrived', 'pending'), false);
});

test('isValidTransition — departed is terminal', () => {
  assert.equal(isValidTransition('departed', 'arrived'), false);
  assert.equal(isValidTransition('departed', 'pending'), false);
  assert.equal(isValidTransition('departed', 'skipped'), false);
});

test('isValidTransition — skipped is terminal', () => {
  assert.equal(isValidTransition('skipped', 'arrived'), false);
  assert.equal(isValidTransition('skipped', 'departed'), false);
});

test('getAllowedNextStatuses', () => {
  assert.deepEqual(getAllowedNextStatuses('pending'), ['arrived', 'skipped']);
  assert.deepEqual(getAllowedNextStatuses('arrived'), ['departed', 'skipped']);
  assert.deepEqual(getAllowedNextStatuses('departed'), []);
  assert.deepEqual(getAllowedNextStatuses('skipped'), []);
});

test('transitionEventStatus rejects invalid transition', async () => {
  const svc = makeMockClient({
    fetch: { data: { id: 'e1', event_status: 'departed' }, error: null },
  });
  await assert.rejects(
    transitionEventStatus({
      supabase: svc, tenantId: 't1', eventId: 'e1', toStatus: 'arrived',
      actor: { id: 'u1', type: 'human' },
    }),
    /Invalid transition/,
  );
});

test('transitionEventStatus requires actor.type', async () => {
  const svc = makeMockClient({
    fetch: { data: { id: 'e1', event_status: 'pending' }, error: null },
  });
  await assert.rejects(
    transitionEventStatus({
      supabase: svc, tenantId: 't1', eventId: 'e1', toStatus: 'arrived',
      actor: { id: 'u1' }, // missing type
    }),
    /actor\.type is required/,
  );
});

test('transitionEventStatus rejects actor.type outside the enum', async () => {
  const svc = makeMockClient({
    fetch: { data: { id: 'e1', event_status: 'pending' }, error: null },
  });
  await assert.rejects(
    transitionEventStatus({
      supabase: svc, tenantId: 't1', eventId: 'e1', toStatus: 'arrived',
      actor: { id: 'u1', type: 'robot' }, // not in enum
    }),
    /actor\.type must be one of/,
  );
});

// M-2: Happy-path tests covering the 3 timestamp branches + history-failure.

test('transitionEventStatus pending→arrived sets arrived_at but NOT departed_at', async () => {
  const svc = makeMockClient({
    fetch: {
      data: { id: 'e-a', event_status: 'pending', arrived_at: null, departed_at: null },
      error: null,
    },
    update: {
      data: { id: 'e-a', event_status: 'arrived', arrived_at: '2026-04-24T00:00:00Z', departed_at: null },
      error: null,
    },
  });
  const result = await transitionEventStatus({
    supabase: svc, tenantId: 't1', eventId: 'e-a', toStatus: 'arrived',
    actor: { id: 'u1', type: 'human', context: { source: 'dispatcher' } },
    note: 'arrived on-site',
  });
  const updatePayload = svc._calls.updated[0]?.payload;
  assert.equal(updatePayload.event_status, 'arrived');
  assert.ok(updatePayload.arrived_at, 'arrived_at should be set');
  assert.equal(updatePayload.departed_at, undefined, 'departed_at should NOT be in update payload');
  assert.equal(result.event_status, 'arrived');

  // History row asserts (actor threading)
  const hist = svc._calls.inserted.find((x) => x.table === 'order_routing_event_status_history');
  assert.ok(hist, 'history row should be written');
  assert.equal(hist.payload.from_status, 'pending');
  assert.equal(hist.payload.to_status, 'arrived');
  assert.equal(hist.payload.actor_id, 'u1');
  assert.equal(hist.payload.actor_type, 'human');
  assert.deepEqual(hist.payload.actor_context, { source: 'dispatcher' });
  assert.equal(hist.payload.note, 'arrived on-site');
});

test('transitionEventStatus pending→departed sets BOTH arrived_at AND departed_at (forgotten-arrival UX)', async () => {
  // pending → departed is NOT a valid transition per the state machine,
  // so the forgotten-arrival branch is exercised via arrived→departed when
  // arrived_at is somehow null. Use that as the realistic trigger.
  // (Confirmed by re-reading isValidTransition: pending can only go to
  // arrived or skipped.) The code still defensively fills arrived_at on
  // any departed transition where arrived_at is null — cover that here.
  const svc = makeMockClient({
    fetch: {
      data: { id: 'e-b', event_status: 'arrived', arrived_at: null, departed_at: null },
      error: null,
    },
    update: { data: { id: 'e-b', event_status: 'departed' }, error: null },
  });
  await transitionEventStatus({
    supabase: svc, tenantId: 't1', eventId: 'e-b', toStatus: 'departed',
    actor: { id: 'u1', type: 'human' },
  });
  const updatePayload = svc._calls.updated[0]?.payload;
  assert.equal(updatePayload.event_status, 'departed');
  assert.ok(updatePayload.arrived_at, 'arrived_at should be backfilled (forgotten-arrival)');
  assert.ok(updatePayload.departed_at, 'departed_at should be set');
});

test('transitionEventStatus arrived→departed sets departed_at but preserves arrived_at', async () => {
  const existingArrivedAt = '2026-04-20T08:00:00.000Z';
  const svc = makeMockClient({
    fetch: {
      data: { id: 'e-c', event_status: 'arrived', arrived_at: existingArrivedAt, departed_at: null },
      error: null,
    },
    update: { data: { id: 'e-c', event_status: 'departed' }, error: null },
  });
  await transitionEventStatus({
    supabase: svc, tenantId: 't1', eventId: 'e-c', toStatus: 'departed',
    actor: { id: 'u1', type: 'system' },
  });
  const updatePayload = svc._calls.updated[0]?.payload;
  assert.equal(updatePayload.event_status, 'departed');
  assert.ok(updatePayload.departed_at, 'departed_at should be set');
  assert.equal(
    updatePayload.arrived_at, undefined,
    'arrived_at must NOT be in update payload when already present on row',
  );
});

test('transitionEventStatus does NOT throw when history insert fails (log-and-continue)', async () => {
  const svc = makeMockClient({
    fetch: {
      data: { id: 'e-d', event_status: 'pending', arrived_at: null, departed_at: null },
      error: null,
    },
    update: { data: { id: 'e-d', event_status: 'arrived' }, error: null },
    insert: { data: null, error: { message: 'history write failed' } },
  });

  // Swallow the console.error from log-and-continue so test output stays clean.
  const originalErr = console.error;
  console.error = () => {};
  try {
    const result = await transitionEventStatus({
      supabase: svc, tenantId: 't1', eventId: 'e-d', toStatus: 'arrived',
      actor: { id: 'u1', type: 'human' },
    });
    assert.equal(result.event_status, 'arrived', 'transition should still succeed');
    assert.equal(svc._calls.updated.length, 1, 'UPDATE should have fired');
    assert.equal(
      svc._calls.inserted.filter((x) => x.table === 'order_routing_event_status_history').length,
      1,
      'history INSERT should have been attempted',
    );
  } finally {
    console.error = originalErr;
  }
});
