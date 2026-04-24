import {
  fireStatusChangeTriggers,
  fireOrderStatusChangeTriggers,
} from '../lib/email-dispatch/status-change-fire.js';

let passed = 0;
let failed = 0;
function check(name, cond) {
  if (cond) { console.log(`  \u2713 ${name}`); passed++; }
  else      { console.log(`  \u2717 ${name}`); failed++; }
}

// Mock Supabase client. Captures inserts, update, select queries + filters
// and returns configured responses per table.
function makeMockClient(config) {
  const calls = {
    inserted: [],
    selected: [],
    selectFilters: [],
  };
  function chain(currentTable) {
    const filters = {};
    const c = {
      _table: currentTable,
      _mode: null,
      _payload: null,
      _filters: filters,
      select(..._args) { c._mode = 'select'; return c; },
      insert(payload) { c._mode = 'insert'; c._payload = payload; return c; },
      eq(col, val) { filters[col] = val; return c; },
      lte() { return c; },
      async then(resolve) {
        if (c._mode === 'insert') {
          calls.inserted.push({ table: c._table, payload: c._payload });
          resolve(config.insert?.[c._table] ?? { data: null, error: null });
        } else if (c._mode === 'select') {
          calls.selected.push({ table: c._table, filters: { ...c._filters } });
          calls.selectFilters.push({ table: c._table, filters: { ...c._filters } });
          resolve(config.select?.[c._table] ?? { data: [], error: null });
        } else {
          resolve({ data: null, error: null });
        }
      },
    };
    return c;
  }
  return { from(table) { return chain(table); }, _calls: calls };
}

// -----------------------------------------------------------

console.log('fireStatusChangeTriggers (generalized)');

// Case 1: entity_type='order' routes to order_status_history + filter entity_type='order'
{
  const svc = makeMockClient({
    insert: { order_status_history: { data: null, error: null } },
    select: { email_template_triggers: { data: [], error: null } },
  });
  await fireStatusChangeTriggers(svc, {
    tenantId: 't-1',
    entityType: 'order',
    entityId: 'ord-1',
    oldStatus: 'pending',
    newStatus: 'completed',
    userId: 'u-1',
  });
  check('order: writes to order_status_history',
    svc._calls.inserted.some(c => c.table === 'order_status_history'));
  check('order: does NOT write to charge_set history',
    !svc._calls.inserted.some(c => c.table === 'order_charge_sets_status_history'));
  const triggerQuery = svc._calls.selectFilters.find(f => f.table === 'email_template_triggers');
  check('order: trigger query filters entity_type=order',
    triggerQuery?.filters?.entity_type === 'order');
}

// Case 2: entity_type='charge_set' routes correctly
{
  const svc = makeMockClient({
    insert: { order_charge_sets_status_history: { data: null, error: null } },
    select: { email_template_triggers: { data: [], error: null } },
  });
  await fireStatusChangeTriggers(svc, {
    tenantId: 't-1',
    entityType: 'charge_set',
    entityId: 'cs-1',
    oldStatus: 'draft',
    newStatus: 'invoiced',
    userId: null,
  });
  check('charge_set: writes to order_charge_sets_status_history',
    svc._calls.inserted.some(c => c.table === 'order_charge_sets_status_history'));
  const triggerQuery = svc._calls.selectFilters.find(f => f.table === 'email_template_triggers');
  check('charge_set: trigger query filters entity_type=charge_set',
    triggerQuery?.filters?.entity_type === 'charge_set');
  const historyPayload = svc._calls.inserted.find(c => c.table === 'order_charge_sets_status_history')?.payload;
  check('charge_set: history payload uses charge_set_id column',
    historyPayload?.charge_set_id === 'cs-1');
}

// Case 3: entity_type='move' routes correctly
{
  const svc = makeMockClient({
    insert: { order_container_moves_status_history: { data: null, error: null } },
    select: { email_template_triggers: { data: [], error: null } },
  });
  await fireStatusChangeTriggers(svc, {
    tenantId: 't-1',
    entityType: 'move',
    entityId: 'm-1',
    oldStatus: 'pending',
    newStatus: 'in_progress',
    userId: null,
  });
  check('move: writes to order_container_moves_status_history',
    svc._calls.inserted.some(c => c.table === 'order_container_moves_status_history'));
  const historyPayload = svc._calls.inserted.find(c => c.table === 'order_container_moves_status_history')?.payload;
  check('move: history payload uses move_id column',
    historyPayload?.move_id === 'm-1');
}

// Case 4: Unknown entityType throws
{
  const svc = makeMockClient({});
  let threw = false;
  try {
    await fireStatusChangeTriggers(svc, {
      tenantId: 't-1',
      entityType: 'driver', // not supported
      entityId: 'd-1',
      oldStatus: 'a',
      newStatus: 'b',
      userId: null,
    });
  } catch (e) {
    threw = e.message.includes('unknown entityType');
  }
  check('unknown entityType throws with clear error', threw);
  check('unknown entityType: no history write', svc._calls.inserted.length === 0);
}

// Case 5: No-op on same status
{
  const svc = makeMockClient({});
  const r = await fireStatusChangeTriggers(svc, {
    tenantId: 't-1',
    entityType: 'order',
    entityId: 'ord-5',
    oldStatus: 'completed',
    newStatus: 'completed',
    userId: null,
  });
  check('same-status: returns firesAttempted=0', r.firesAttempted === 0);
  check('same-status: no history write', svc._calls.inserted.length === 0);
  check('same-status: no trigger fetch', svc._calls.selected.length === 0);
}

// Case 6: Backward-compat wrapper forwards to generalized with entityType=order
{
  const svc = makeMockClient({
    insert: { order_status_history: { data: null, error: null } },
    select: { email_template_triggers: { data: [], error: null } },
  });
  await fireOrderStatusChangeTriggers(svc, {
    tenantId: 't-1',
    loadId: 'ord-42',
    oldStatus: 'pending',
    newStatus: 'accepted',
    userId: 'u-1',
  });
  check('wrapper: writes to order_status_history',
    svc._calls.inserted.some(c => c.table === 'order_status_history'));
  const triggerQuery = svc._calls.selectFilters.find(f => f.table === 'email_template_triggers');
  check('wrapper: trigger query filters entity_type=order',
    triggerQuery?.filters?.entity_type === 'order');
  const historyPayload = svc._calls.inserted.find(c => c.table === 'order_status_history')?.payload;
  check('wrapper: history payload uses order_id column',
    historyPayload?.order_id === 'ord-42');
}

// Case 7: Charge_set immediate fire — now actually attempts (B.1c removes the skip)
{
  const svc = makeMockClient({
    insert: { order_charge_sets_status_history: { data: null, error: null } },
    select: {
      email_template_triggers: {
        data: [{
          id: 'trig-cs-1',
          tenant_id: 't-1',
          event_name: 'invoiced',
          entity_type: 'charge_set',
          is_active: true,
          conditions: { notify_after: { days: 0, hours: 0, minutes: 0 } },
        }],
        error: null,
      },
    },
  });
  const r = await fireStatusChangeTriggers(svc, {
    tenantId: 't-1',
    entityType: 'charge_set',
    entityId: 'cs-1',
    oldStatus: 'draft',
    newStatus: 'invoiced',
    userId: 'u-1',
  });
  // firesAttempted should be 1 for the matched trigger (was 0 pre-B.1c due to skip)
  check('charge_set immediate: firesAttempted >= 1', (r?.firesAttempted ?? 0) >= 1);
}

// Case 8: Move immediate fire — same as above but for move
{
  const svc = makeMockClient({
    insert: { order_container_moves_status_history: { data: null, error: null } },
    select: {
      email_template_triggers: {
        data: [{
          id: 'trig-m-1',
          tenant_id: 't-1',
          event_name: 'completed',
          entity_type: 'move',
          is_active: true,
          conditions: { notify_after: { days: 0, hours: 0, minutes: 0 } },
        }],
        error: null,
      },
    },
  });
  const r = await fireStatusChangeTriggers(svc, {
    tenantId: 't-1',
    entityType: 'move',
    entityId: 'm-1',
    oldStatus: 'in_progress',
    newStatus: 'completed',
    userId: 'u-1',
  });
  check('move immediate: firesAttempted >= 1', (r?.firesAttempted ?? 0) >= 1);
}

// Case 9: fireStatusChangeTriggers stamps actor_type: 'system' on history insert
{
  const svc = makeMockClient({
    insert: { order_status_history: { data: null, error: null } },
    select: { email_template_triggers: { data: [], error: null } },
  });
  await fireStatusChangeTriggers(svc, {
    tenantId: 't-1', entityType: 'order', entityId: 'ord-sys',
    oldStatus: 'pending', newStatus: 'completed', userId: 'u-1',
  });
  const histInsert = svc._calls.inserted.find(c => c.table === 'order_status_history');
  check('fire stamps actor_type=system on history insert',
    histInsert?.payload?.actor_type === 'system');
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
