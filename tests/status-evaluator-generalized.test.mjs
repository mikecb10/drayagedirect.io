import { evaluate } from '../lib/email-dispatch/evaluators/status.js';

let passed = 0;
let failed = 0;
function check(name, cond) {
  if (cond) { console.log(`  \u2713 ${name}`); passed++; }
  else      { console.log(`  \u2717 ${name}`); failed++; }
}

// Mock captures which table was queried + select args.
function makeMockClient(config) {
  const calls = { queriedTables: [], selectArgs: [] };
  function chain(currentTable) {
    const c = {
      _table: currentTable,
      select(args) { c._selectArgs = args; calls.selectArgs.push({ table: c._table, args }); return c; },
      eq() { return c; },
      in() { return c; },
      lte() { return c; },
      async then(resolve) {
        calls.queriedTables.push(c._table);
        resolve(config.select?.[c._table] ?? { data: [], error: null });
      },
    };
    return c;
  }
  return { from(table) { return chain(table); }, _calls: calls };
}

console.log('evaluate (generalized status evaluator)');

// Case 1: entity_type='order' trigger reads order_status_history
{
  const svc = makeMockClient({
    select: { order_status_history: { data: [], error: null } },
  });
  await evaluate(svc, 't-1', {
    id: 'trig-1',
    event_name: 'completed',
    entity_type: 'order',
    conditions: { notify_after: { days: 0, hours: 1, minutes: 0 } },
  });
  check('order: queries order_status_history',
    svc._calls.queriedTables.includes('order_status_history'));
  check('order: selects order_id column',
    svc._calls.selectArgs.some(a => a.args?.includes('order_id')));
}

// Case 2: entity_type='charge_set' reads correct history table
{
  const svc = makeMockClient({
    select: { order_charge_sets_status_history: { data: [], error: null } },
  });
  await evaluate(svc, 't-1', {
    id: 'trig-2',
    event_name: 'invoiced',
    entity_type: 'charge_set',
    conditions: { notify_after: { days: 1, hours: 0, minutes: 0 } },
  });
  check('charge_set: queries order_charge_sets_status_history',
    svc._calls.queriedTables.includes('order_charge_sets_status_history'));
  check('charge_set: selects charge_set_id column',
    svc._calls.selectArgs.some(a => a.args?.includes('charge_set_id')));
}

// Case 3: entity_type='move' reads correct history table
{
  const svc = makeMockClient({
    select: { order_container_moves_status_history: { data: [], error: null } },
  });
  await evaluate(svc, 't-1', {
    id: 'trig-3',
    event_name: 'completed',
    entity_type: 'move',
    conditions: { notify_after: { days: 0, hours: 2, minutes: 0 } },
  });
  check('move: queries order_container_moves_status_history',
    svc._calls.queriedTables.includes('order_container_moves_status_history'));
  check('move: selects move_id column',
    svc._calls.selectArgs.some(a => a.args?.includes('move_id')));
}

// Case 4: Order with current status matching targetStatus → candidate returned
{
  const svc = makeMockClient({
    select: {
      order_status_history: {
        data: [{ order_id: 'ord-1', created_at: '2026-04-20T00:00:00Z' }],
        error: null,
      },
      orders: {
        // Live-status verification: load is still in target status, not soft-deleted
        data: [{ id: 'ord-1', status: 'completed', deleted_at: null }],
        error: null,
      },
    },
  });
  const candidates = await evaluate(svc, 't-1', {
    id: 'trig-4',
    event_name: 'completed',
    entity_type: 'order',
    conditions: { notify_after: { days: 0, hours: 1, minutes: 0 } },
  });
  check('order branch: queries both order_status_history AND orders',
    svc._calls.queriedTables.includes('order_status_history') &&
    svc._calls.queriedTables.includes('orders'));
  check('order branch: returns candidate when status still matches',
    candidates.length === 1 && candidates[0]?.load_id === 'ord-1');
}

// Case 5: Order with stale history (current status no longer matches) → filtered out
{
  const svc = makeMockClient({
    select: {
      order_status_history: {
        data: [{ order_id: 'ord-2', created_at: '2026-04-20T00:00:00Z' }],
        error: null,
      },
      orders: {
        // Live-status verification: load HAS moved on — 'completed' → 'voided', say
        data: [{ id: 'ord-2', status: 'voided', deleted_at: null }],
        error: null,
      },
    },
  });
  const candidates = await evaluate(svc, 't-1', {
    id: 'trig-5',
    event_name: 'completed',
    entity_type: 'order',
    conditions: { notify_after: { days: 0, hours: 1, minutes: 0 } },
  });
  check('order branch: filters out loads whose current status no longer matches',
    candidates.length === 0);
}

// Case 6: Order that is soft-deleted → filtered out
{
  const svc = makeMockClient({
    select: {
      order_status_history: {
        data: [{ order_id: 'ord-3', created_at: '2026-04-20T00:00:00Z' }],
        error: null,
      },
      orders: {
        data: [], // soft-deleted loads filtered by `.is('deleted_at', null)` → empty
        error: null,
      },
    },
  });
  const candidates = await evaluate(svc, 't-1', {
    id: 'trig-6',
    event_name: 'completed',
    entity_type: 'order',
    conditions: { notify_after: { days: 0, hours: 1, minutes: 0 } },
  });
  check('order branch: filters out soft-deleted loads',
    candidates.length === 0);
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
