import {
  buildTriggerContext,
  buildMoveTriggerContext,
  buildChargeSetTriggerContext,
} from '../lib/email-dispatch/context-builder.js';

let passed = 0;
let failed = 0;
function check(name, cond) {
  if (cond) { console.log(`  \u2713 ${name}`); passed++; }
  else      { console.log(`  \u2717 ${name}`); failed++; }
}

// Mock Supabase client. Returns configured rows per table.
// Supports: select().eq().eq().maybeSingle()/.single()
//           select().in().eq() -> thenable (list)
function makeMockClient(config) {
  const calls = { queries: [] };
  function chain(currentTable) {
    const c = {
      _table: currentTable,
      _filters: {},
      select(..._args) { return c; },
      eq(col, val) { c._filters[col] = val; return c; },
      in(col, vals) { c._filters[col] = vals; return c; },
      is() { return c; },
      order() { return c; },
      maybeSingle: async () => {
        calls.queries.push({ table: c._table, filters: { ...c._filters } });
        return config[c._table] !== undefined
          ? { data: config[c._table], error: null }
          : { data: null, error: null };
      },
      single: async () => {
        calls.queries.push({ table: c._table, filters: { ...c._filters } });
        return config[c._table] !== undefined
          ? { data: config[c._table], error: null }
          : { data: null, error: null };
      },
      then(resolve) {
        calls.queries.push({ table: c._table, filters: { ...c._filters } });
        const listKey = c._table + '_list';
        if (config[listKey] !== undefined) {
          resolve({ data: config[listKey], error: null });
        } else {
          resolve({ data: [], error: null });
        }
      },
    };
    return c;
  }
  return { from(table) { return chain(table); }, _calls: calls };
}

console.log('buildTriggerContext (entity-aware)');

// Case 1: Object-arg form, entityType='order'
{
  const svc = makeMockClient({
    orders: {
      id: 'ord-1', tenant_id: 't-1', load_number: 'LD-12345',
      customer: { id: 'cust-1', name: 'Acme Corp' },
      driver: { id: 'drv-1', first_name: 'Jane', last_name: 'Doe', name: 'Jane Doe' },
      pickup_org: null, delivery_org: null, return_org: null, final_delivery_org: null, container_owner: null,
    },
    tenants: { id: 't-1', name: 'TestCorp', timezone: 'America/New_York' },
    tenant_format_preferences: { tenant_id: 't-1' },
  });
  const result = await buildTriggerContext(svc, {
    tenantId: 't-1',
    entityType: 'order',
    entityId: 'ord-1',
    userId: null,
  });
  check('order (object-arg): returns variables', result && typeof result.variables === 'object');
  check('order (object-arg): variables.load is populated (nested tree)',
    result?.variables?.load && typeof result?.variables?.load === 'object');
  check('order (object-arg): orderId === entityId', result?.orderId === 'ord-1');
}

console.log('');
console.log('buildMoveTriggerContext');

// Case 3: Move context with parent order inheritance
{
  const svc = makeMockClient({
    order_container_moves: {
      id: 'm-1',
      tenant_id: 't-1',
      order_id: 'ord-1',
      move_type: 'delivery',
      status: 'completed',
      scheduled_date: '2026-04-24',
      started_at: '2026-04-24T10:15:00Z',
      completed_at: '2026-04-24T11:30:00Z',
    },
    orders: {
      id: 'ord-1',
      tenant_id: 't-1',
      load_number: 'LD-12345',
      customer_id: 'cust-1',
      driver_id: 'drv-1',
      customer: { id: 'cust-1', name: 'Acme Corp' },
      driver: { id: 'drv-1', first_name: 'Jane', last_name: 'Doe', name: 'Jane Doe' },
    },
    tenants: { id: 't-1', name: 'TestCorp', timezone: 'America/New_York' },
    tenant_format_preferences: { tenant_id: 't-1' },
    users: null,
  });

  const result = await buildMoveTriggerContext(svc, {
    tenantId: 't-1',
    moveId: 'm-1',
    userId: null,
  });

  check('move: returns variables object', result && typeof result.variables === 'object');
  check('move: move_id populated', result?.variables?.move_id === 'm-1');
  check('move: move_type populated', result?.variables?.move_type === 'delivery');
  check('move: move_status populated', result?.variables?.move_status === 'completed');
  check('move: inherits load_number via parent order', result?.variables?.load_number === 'LD-12345');
  check('move: inherits customer_name via parent order', result?.variables?.customer_name === 'Acme Corp');
  check('move: inherits driver_name via parent order', result?.variables?.driver_name === 'Jane Doe');
  check('move: orderId returned for log-keying', result?.orderId === 'ord-1');
}

console.log('\nbuildChargeSetTriggerContext');

// Case 2: Charge_set context with parent order inheritance
{
  const svc = makeMockClient({
    order_charge_sets: {
      id: 'cs-1',
      tenant_id: 't-1',
      order_id: 'ord-1',
      status: 'invoiced',
      total_cents: 15000,
      charge_set_number: 'CS-5001',
    },
    orders: {
      id: 'ord-1',
      tenant_id: 't-1',
      load_number: 'LD-12345',
      customer_id: 'cust-1',
      customer: { id: 'cust-1', name: 'Acme Corp' },
      driver: { id: 'drv-1', first_name: 'Jane', last_name: 'Doe', name: 'Jane Doe' },
    },
    tenants: { id: 't-1', name: 'TestCorp', timezone: 'America/New_York' },
    tenant_format_preferences: { tenant_id: 't-1' },
  });

  const result = await buildChargeSetTriggerContext(svc, {
    tenantId: 't-1',
    chargeSetId: 'cs-1',
    userId: null,
  });

  check('charge_set: returns variables object', result && typeof result.variables === 'object');
  check('charge_set: charge_set_id populated', result?.variables?.charge_set_id === 'cs-1');
  check('charge_set: charge_set_status populated', result?.variables?.charge_set_status === 'invoiced');
  check('charge_set: charge_set_total populated (dollars)', result?.variables?.charge_set_total === '150.00');
  check('charge_set: inherits load_number', result?.variables?.load_number === 'LD-12345');
  check('charge_set: inherits customer_name', result?.variables?.customer_name === 'Acme Corp');
  check('charge_set: orderId returned', result?.orderId === 'ord-1');
}

console.log('\nbuildTriggerContext (positional-shim)');

// Case 4: Positional-shim — legacy orders callers (svc, tenantId, loadId, userId)
{
  const svc = makeMockClient({
    orders: {
      id: 'ord-1', tenant_id: 't-1', load_number: 'LD-LEGACY',
      customer: { id: 'cust-1', name: 'Legacy Co' },
      driver: null, pickup_org: null, delivery_org: null, return_org: null, final_delivery_org: null, container_owner: null,
    },
    tenants: { id: 't-1', name: 'TestCorp' },
    tenant_format_preferences: { tenant_id: 't-1' },
  });
  // Legacy positional invocation: (svc, tenantId, loadId, userId)
  const result = await buildTriggerContext(svc, 't-1', 'ord-1', null);
  check('positional-shim: returns variables', result && typeof result.variables === 'object');
  check('positional-shim: orderId === loadId', result?.orderId === 'ord-1');
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
