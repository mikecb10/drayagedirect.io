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

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
