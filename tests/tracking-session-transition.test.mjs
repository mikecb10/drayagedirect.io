import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import {
  isValidTrackingTransition,
  getAllowedNextTrackingStatuses,
  transitionTrackingSession,
} from '../lib/routing/tracking-session-transition.js';

function makeMockClient(config = {}) {
  const calls = { selected: [], updated: [], inserted: [] };
  function chain(table) {
    const c = {
      _table: table, _payload: null,
      select() { return c; },
      update(p) { c._payload = p; return c; },
      insert(p) {
        calls.inserted.push({ table: c._table, payload: p });
        return Promise.resolve(config.insert ?? { data: null, error: null });
      },
      eq() { return c; },
      async maybeSingle() {
        calls.selected.push({ table: c._table });
        return config.fetch ?? { data: null, error: null };
      },
      single() {
        if (c._payload != null) {
          calls.updated.push({ table: c._table, payload: c._payload });
          return Promise.resolve(config.update ?? { data: { ...c._payload, id: 'm1' }, error: null });
        }
        return Promise.resolve({ data: null, error: null });
      },
    };
    return c;
  }
  return { from: (t) => chain(t), __calls: calls };
}

test('isValidTrackingTransition allows idle → in_transit', () => {
  assert.equal(isValidTrackingTransition('idle', 'in_transit'), true);
});

test('isValidTrackingTransition rejects idle → on_site (must go through in_transit)', () => {
  assert.equal(isValidTrackingTransition('idle', 'on_site'), false);
});

test('getAllowedNextTrackingStatuses for completed returns []', () => {
  assert.deepEqual(getAllowedNextTrackingStatuses('completed'), []);
});

test('transitionTrackingSession throws when actor is missing', async () => {
  const svc = makeMockClient({ fetch: { data: { tracking_status: 'idle' }, error: null } });
  await assert.rejects(
    transitionTrackingSession({ supabase: svc, tenantId: 't1', moveId: 'm1', toStatus: 'in_transit' }),
    /actor is required/,
  );
});

test('transitionTrackingSession throws when actor.type missing', async () => {
  const svc = makeMockClient({ fetch: { data: { tracking_status: 'idle' }, error: null } });
  await assert.rejects(
    transitionTrackingSession({
      supabase: svc, tenantId: 't1', moveId: 'm1', toStatus: 'in_transit',
      actor: { id: 'd1' },
    }),
    /actor\.type is required/,
  );
});

test('transitionTrackingSession idle → in_transit sets session_started_at', async () => {
  const svc = makeMockClient({ fetch: { data: { tracking_status: 'idle' }, error: null } });
  await transitionTrackingSession({
    supabase: svc, tenantId: 't1', moveId: 'm1', toStatus: 'in_transit',
    actor: { id: 'd1', type: 'human' },
  });
  const upd = svc.__calls.updated.find((u) => u.table === 'order_container_moves');
  assert.ok(upd, 'expected an update on order_container_moves');
  assert.equal(upd.payload.tracking_status, 'in_transit');
  assert.ok(upd.payload.session_started_at, 'should set session_started_at on first transition out of idle');
});

test('transitionTrackingSession on_site → completed sets session_ended_at', async () => {
  const svc = makeMockClient({ fetch: { data: { tracking_status: 'on_site' }, error: null } });
  await transitionTrackingSession({
    supabase: svc, tenantId: 't1', moveId: 'm1', toStatus: 'completed',
    actor: { id: 'd1', type: 'human' },
  });
  const upd = svc.__calls.updated.find((u) => u.table === 'order_container_moves');
  assert.equal(upd.payload.tracking_status, 'completed');
  assert.ok(upd.payload.session_ended_at);
});

test('transitionTrackingSession writes history row with actor_type', async () => {
  const svc = makeMockClient({ fetch: { data: { tracking_status: 'idle' }, error: null } });
  await transitionTrackingSession({
    supabase: svc, tenantId: 't1', moveId: 'm1', toStatus: 'in_transit',
    actor: { id: 'd1', type: 'human', context: { source: 'driver_app', ping_id: 'p1' } },
    note: 'started by driver',
  });
  const hist = svc.__calls.inserted.find((i) => i.table === 'move_tracking_session_history');
  assert.ok(hist, 'expected history insert');
  assert.equal(hist.payload.from_status, 'idle');
  assert.equal(hist.payload.to_status, 'in_transit');
  assert.equal(hist.payload.actor_type, 'human');
  assert.equal(hist.payload.actor_id, 'd1');
  assert.deepEqual(hist.payload.actor_context, { source: 'driver_app', ping_id: 'p1' });
});

test('transitionTrackingSession rejects invalid transitions', async () => {
  const svc = makeMockClient({ fetch: { data: { tracking_status: 'completed' }, error: null } });
  await assert.rejects(
    transitionTrackingSession({
      supabase: svc, tenantId: 't1', moveId: 'm1', toStatus: 'in_transit',
      actor: { id: 'd1', type: 'human' },
    }),
    /Invalid transition: completed -> in_transit/,
  );
});
