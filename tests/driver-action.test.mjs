// tests/driver-action.test.mjs
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { applyDriverAction } from '../lib/routing/driver-action.js';

function makeMockClient(state) {
  const calls = { inserts: [], updates: [], selects: [] };
  function chain(table) {
    const c = {
      _table: table, _filters: {}, _payload: null,
      select() { return c; },
      insert(p) {
        calls.inserts.push({ table, payload: p });
        // For pings: return inserted row with synthetic id
        if (table === 'driver_location_pings') {
          return {
            select: () => ({
              single: () => Promise.resolve({ data: { ...p, id: 'ping-id-1' }, error: null }),
            }),
          };
        }
        return Promise.resolve({ data: null, error: null });
      },
      update(p) {
        c._payload = p;
        calls.updates.push({ table, payload: p });
        return c;
      },
      eq(col, val) { c._filters[col] = val; return c; },
      maybeSingle() {
        calls.selects.push({ table, filters: { ...c._filters } });
        if (table === 'order_container_moves') {
          return Promise.resolve({ data: state.move, error: null });
        }
        if (table === 'order_routing_events') {
          if (c._filters.id) {
            return Promise.resolve({ data: state.events.find((e) => e.id === c._filters.id) ?? null, error: null });
          }
          return Promise.resolve({ data: null, error: null });
        }
        return Promise.resolve({ data: null, error: null });
      },
      single() {
        if (c._payload != null) {
          return Promise.resolve({ data: { ...c._payload, id: c._filters.id ?? 'mock' }, error: null });
        }
        return Promise.resolve({ data: null, error: null });
      },
    };
    return c;
  }
  return { from: (t) => chain(t), __calls: calls };
}

test('applyDriverAction(start) inserts ping into driver_location_pings + flips tracking_status idle→in_transit', async () => {
  const svc = makeMockClient({
    move: { id: 'm1', tenant_id: 't1', driver_id: 'd1', tracking_status: 'idle', ping_count: 0 },
    events: [],
  });
  await applyDriverAction({
    supabase: svc, tenantId: 't1', moveId: 'm1', actionType: 'start',
    driverId: 'd1',
    gpsPing: { latitude: 37.1, longitude: -122.5, recorded_at: '2026-04-24T12:00:00Z' },
  });
  const pingInsert = svc.__calls.inserts.find((i) => i.table === 'driver_location_pings');
  assert.ok(pingInsert, 'expected ping insert into driver_location_pings');
  assert.equal(pingInsert.payload.move_id, 'm1');
  assert.equal(pingInsert.payload.driver_id, 'd1');
  assert.equal(pingInsert.payload.source, 'mobile_app', 'driver-app pings always use mobile_app source');
  assert.equal(pingInsert.payload.latitude, 37.1);
  assert.equal(pingInsert.payload.longitude, -122.5);

  const trackingUpdate = svc.__calls.updates.find(
    (u) => u.table === 'order_container_moves' && u.payload.tracking_status === 'in_transit',
  );
  assert.ok(trackingUpdate, 'expected tracking_status update to in_transit');
});

test('applyDriverAction(start) updates drivers.last_* denorm columns', async () => {
  const svc = makeMockClient({
    move: { id: 'm1', tenant_id: 't1', driver_id: 'd1', tracking_status: 'idle', ping_count: 0 },
    events: [],
  });
  await applyDriverAction({
    supabase: svc, tenantId: 't1', moveId: 'm1', actionType: 'start',
    driverId: 'd1',
    gpsPing: { latitude: 37.1, longitude: -122.5, recorded_at: '2026-04-24T12:00:00Z', speed_mph: 35.5, heading: 180 },
  });
  const driverDenormUpdate = svc.__calls.updates.find(
    (u) => u.table === 'drivers' && u.payload.last_latitude === 37.1,
  );
  assert.ok(driverDenormUpdate, 'expected drivers.last_* denorm update');
  assert.equal(driverDenormUpdate.payload.last_longitude, -122.5);
  assert.equal(driverDenormUpdate.payload.last_location_source, 'mobile_app');
  assert.ok(driverDenormUpdate.payload.last_location_at);
});

test('applyDriverAction(start) updates order_container_moves.last_ping_at + ping_count (NOT current_lat/lng)', async () => {
  const svc = makeMockClient({
    move: { id: 'm1', tenant_id: 't1', driver_id: 'd1', tracking_status: 'idle', ping_count: 5 },
    events: [],
  });
  await applyDriverAction({
    supabase: svc, tenantId: 't1', moveId: 'm1', actionType: 'start',
    driverId: 'd1',
    gpsPing: { latitude: 37.1, longitude: -122.5, recorded_at: '2026-04-24T12:00:00Z' },
  });
  // Find the move-counter update (the one with ping_count, NOT the tracking_status-only update)
  const moveCounterUpdate = svc.__calls.updates.find(
    (u) => u.table === 'order_container_moves' && u.payload.ping_count != null,
  );
  assert.ok(moveCounterUpdate, 'expected counter update on move row');
  assert.equal(moveCounterUpdate.payload.ping_count, 6, 'incremented from 5');
  assert.equal(moveCounterUpdate.payload.last_ping_at, '2026-04-24T12:00:00Z');
  // CRITICAL: must NOT write current_lat/lng (those columns don't exist)
  assert.equal(moveCounterUpdate.payload.current_lat, undefined, 'must NOT write current_lat');
  assert.equal(moveCounterUpdate.payload.current_lng, undefined, 'must NOT write current_lng');
});

test('applyDriverAction(arrive) flips event pending→arrived AND tracking in_transit→on_site', async () => {
  const svc = makeMockClient({
    move: { id: 'm1', tenant_id: 't1', driver_id: 'd1', tracking_status: 'in_transit', ping_count: 5 },
    events: [{
      id: 'e1', tenant_id: 't1', order_id: 'o1',
      event_type: 'pull', event_status: 'pending',
      arrived_at: null, departed_at: null,
    }],
  });
  await applyDriverAction({
    supabase: svc, tenantId: 't1', moveId: 'm1', actionType: 'arrive',
    driverId: 'd1',
    targetEventId: 'e1',
    gpsPing: { latitude: 37.1, longitude: -122.5, recorded_at: '2026-04-24T12:30:00Z' },
  });
  const eventUpdate = svc.__calls.updates.find(
    (u) => u.table === 'order_routing_events' && u.payload.event_status === 'arrived',
  );
  assert.ok(eventUpdate, 'expected event_status update to arrived');
  const trackingUpdate = svc.__calls.updates.find(
    (u) => u.table === 'order_container_moves' && u.payload.tracking_status === 'on_site',
  );
  assert.ok(trackingUpdate, 'expected tracking_status update to on_site');
});

test('applyDriverAction rejects start when tracking_status is not idle', async () => {
  const svc = makeMockClient({
    move: { id: 'm1', tenant_id: 't1', driver_id: 'd1', tracking_status: 'in_transit', ping_count: 5 },
    events: [],
  });
  await assert.rejects(
    applyDriverAction({
      supabase: svc, tenantId: 't1', moveId: 'm1', actionType: 'start',
      driverId: 'd1',
      gpsPing: { latitude: 37.1, longitude: -122.5, recorded_at: '2026-04-24T12:00:00Z' },
    }),
    /Invalid transition: in_transit -> in_transit/,
  );
});

test('applyDriverAction rejects ping over 40-cap', async () => {
  const svc = makeMockClient({
    move: { id: 'm1', tenant_id: 't1', driver_id: 'd1', tracking_status: 'in_transit', ping_count: 40 },
    events: [],
  });
  await assert.rejects(
    applyDriverAction({
      supabase: svc, tenantId: 't1', moveId: 'm1', actionType: 'start',
      driverId: 'd1',
      gpsPing: { latitude: 37.1, longitude: -122.5, recorded_at: '2026-04-24T12:00:00Z' },
    }),
    /ping_cap_reached/,
  );
});

test('applyDriverAction rejects when driver does not own the move', async () => {
  const svc = makeMockClient({
    move: { id: 'm1', tenant_id: 't1', driver_id: 'OTHER_DRIVER', tracking_status: 'idle', ping_count: 0 },
    events: [],
  });
  await assert.rejects(
    applyDriverAction({
      supabase: svc, tenantId: 't1', moveId: 'm1', actionType: 'start',
      driverId: 'd1',
      gpsPing: { latitude: 37.1, longitude: -122.5, recorded_at: '2026-04-24T12:00:00Z' },
    }),
    /forbidden/,
  );
});
