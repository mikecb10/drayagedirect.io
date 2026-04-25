import { strict as assert } from 'node:assert';
import { test } from 'node:test';

// Track calls to fireRoutingEventTriggers via a module mock.
const fireCalls = [];

// Need to import after we've set up a way to intercept the trigger fire.
// Approach: monkey-patch module via a setter the helper exposes for tests.
import { transitionEventStatus, __setFireRoutingEventTriggersForTesting } from '../lib/routing/event-status-transition.js';

__setFireRoutingEventTriggersForTesting(async (svc, args) => {
  fireCalls.push(args);
});

function makeMockClient({ event }) {
  function chain(table) {
    const c = {
      _table: table, _payload: null,
      select() { return c; },
      update(p) { c._payload = p; return c; },
      insert() { return Promise.resolve({ data: null, error: null }); },
      eq() { return c; },
      async maybeSingle() { return { data: event, error: null }; },
      single() { return Promise.resolve({ data: { ...event, ...c._payload }, error: null }); },
    };
    return c;
  }
  return { from: chain };
}

test('transitionEventStatus pending → arrived fires arrived trigger', async () => {
  fireCalls.length = 0;
  const svc = makeMockClient({
    event: {
      id: 'e1', tenant_id: 't1', order_id: 'o1',
      event_type: 'pull', event_status: 'pending',
      arrived_at: null, departed_at: null,
    },
  });
  await transitionEventStatus({
    supabase: svc, tenantId: 't1', eventId: 'e1', toStatus: 'arrived',
    actor: { id: 'd1', type: 'human', context: { source: 'driver_app' } },
  });
  assert.equal(fireCalls.length, 1, 'expected one trigger fire');
  assert.equal(fireCalls[0].eventType, 'pull');
  assert.equal(fireCalls[0].timestampField, 'arrived_at');
  assert.equal(fireCalls[0].loadId, 'o1');
});

test('transitionEventStatus arrived → departed fires departed trigger', async () => {
  fireCalls.length = 0;
  const svc = makeMockClient({
    event: {
      id: 'e1', tenant_id: 't1', order_id: 'o1',
      event_type: 'deliver', event_status: 'arrived',
      arrived_at: '2026-04-24T12:00:00Z', departed_at: null,
    },
  });
  await transitionEventStatus({
    supabase: svc, tenantId: 't1', eventId: 'e1', toStatus: 'departed',
    actor: { type: 'human' },
  });
  assert.equal(fireCalls.length, 1);
  assert.equal(fireCalls[0].timestampField, 'departed_at');
});

test('transitionEventStatus pending → skipped does NOT fire trigger (no timestamp)', async () => {
  fireCalls.length = 0;
  const svc = makeMockClient({
    event: {
      id: 'e1', tenant_id: 't1', order_id: 'o1',
      event_type: 'stop_off', event_status: 'pending',
      arrived_at: null, departed_at: null,
    },
  });
  await transitionEventStatus({
    supabase: svc, tenantId: 't1', eventId: 'e1', toStatus: 'skipped',
    actor: { type: 'human' },
  });
  assert.equal(fireCalls.length, 0, 'skip does not fire triggers');
});

test('transitionEventStatus departed with forgotten arrival fires BOTH arrived + departed triggers', async () => {
  // Edge case: event was somehow set to 'arrived' status without a timestamp
  // (race, raw SQL bypass, or upstream bug). The departed transition auto-fills
  // arrived_at, which means BOTH triggers should fire — same physical moment,
  // two semantic events for the dispatcher's email pipeline.
  fireCalls.length = 0;
  const svc = makeMockClient({
    event: {
      id: 'e1', tenant_id: 't1', order_id: 'o1',
      event_type: 'deliver', event_status: 'arrived',
      arrived_at: null, departed_at: null,
    },
  });
  await transitionEventStatus({
    supabase: svc, tenantId: 't1', eventId: 'e1', toStatus: 'departed',
    actor: { type: 'human' },
  });
  assert.equal(fireCalls.length, 2, 'expected both arrived + departed triggers to fire');
  assert.equal(fireCalls[0].timestampField, 'arrived_at', 'arrived fires first');
  assert.equal(fireCalls[1].timestampField, 'departed_at', 'departed fires second');
  assert.equal(fireCalls[0].eventType, 'deliver');
  assert.equal(fireCalls[1].eventType, 'deliver');
});
