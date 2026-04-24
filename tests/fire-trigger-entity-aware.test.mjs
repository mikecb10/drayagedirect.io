import { fireTrigger } from '../lib/email-dispatch/dispatcher.js';

let passed = 0;
let failed = 0;
function check(name, cond) {
  if (cond) { console.log(`  \u2713 ${name}`); passed++; }
  else      { console.log(`  \u2717 ${name}`); failed++; }
}

// Minimal mock for fireTrigger's surface. Captures what was queried +
// what was inserted. Returns configured row data or null.
//
// fireTrigger has many DB query sites — we only configure the ones needed
// to observe routing decisions. For un-configured queries the mock returns
// null/[] which is generally safe (fireTrigger handles null-returns by
// short-circuiting with a terminal-log write).
function makeMockClient(config = {}) {
  const calls = { queries: [], inserts: [] };
  function chain(table) {
    const c = {
      _table: table, _filters: {}, _mode: null, _payload: null,
      select: (..._a) => c,
      eq: (col, val) => { c._filters[col] = val; return c; },
      in: (col, vals) => { c._filters[col] = vals; return c; },
      is: () => c,
      gte: () => c,
      order: () => c,
      limit: () => c,
      insert(payload) {
        c._mode = 'insert';
        c._payload = payload;
        calls.inserts.push({ table, payload });
        return {
          select: () => ({
            single: async () => ({ data: { id: `log-${calls.inserts.length}` }, error: null }),
            maybeSingle: async () => ({ data: { id: `log-${calls.inserts.length}` }, error: null }),
          }),
        };
      },
      update: (payload) => {
        calls.inserts.push({ table, payload, mode: 'update' });
        return {
          eq: () => c,
          select: () => ({
            single: async () => ({ data: null, error: null }),
            maybeSingle: async () => ({ data: null, error: null }),
          }),
        };
      },
      maybeSingle: async () => {
        calls.queries.push({ table, filters: { ...c._filters } });
        return config[table] !== undefined
          ? { data: config[table], error: null }
          : { data: null, error: null };
      },
      single: async () => {
        calls.queries.push({ table, filters: { ...c._filters } });
        return config[table] !== undefined
          ? { data: config[table], error: null }
          : { data: null, error: null };
      },
      then(resolve) {
        calls.queries.push({ table, filters: { ...c._filters } });
        const listKey = table + '_list';
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

console.log('fireTrigger (entity-aware)');

// Case 1: Order entity — direct entityId, no parent lookup
{
  const svc = makeMockClient({
    email_template_triggers: {
      id: 'trig-1',
      tenant_id: 't-1',
      event_name: 'completed',
      entity_type: 'order',
      is_active: true,
      conditions: {},
      template: { id: 'tmpl-1', is_active: true, subject: 'x', body_html: 'y', body_text: 'z' },
    },
    orders: {
      id: 'ord-1', tenant_id: 't-1', load_number: 'LD-1',
      customer: null, driver: null,
      pickup_org: null, delivery_org: null, return_org: null,
      final_delivery_org: null, container_owner: null,
    },
    tenants: { id: 't-1', name: 'TestCorp' },
    tenant_format_preferences: { tenant_id: 't-1' },
  });
  const result = await fireTrigger(svc, {
    tenantId: 't-1', triggerId: 'trig-1',
    entityType: 'order', entityId: 'ord-1',
    fireKey: 'key-1', userId: null, eventName: 'completed',
  });
  check('order: fireTrigger resolves without crashing', !!result);
  check('order: no charge_set lookup (entity IS order)',
    !svc._calls.queries.some(q => q.table === 'order_charge_sets'));
  check('order: no moves lookup (entity IS order)',
    !svc._calls.queries.some(q => q.table === 'order_container_moves'));
}

// Case 2: Charge_set — parent-order lookup resolves load_id
{
  const svc = makeMockClient({
    email_template_triggers: {
      id: 'trig-2',
      tenant_id: 't-1',
      event_name: 'invoiced',
      entity_type: 'charge_set',
      is_active: true,
      conditions: {},
      template: { id: 'tmpl-2', is_active: true, subject: 'x', body_html: 'y', body_text: 'z' },
    },
    order_charge_sets: {
      id: 'cs-1', tenant_id: 't-1', order_id: 'ord-parent-1',
      status: 'invoiced', total_cents: 10000, charge_set_number: 'CS-1',
    },
    orders: {
      id: 'ord-parent-1', tenant_id: 't-1', load_number: 'LD-PARENT',
      customer: null, driver: null,
      pickup_org: null, delivery_org: null, return_org: null,
      final_delivery_org: null, container_owner: null,
    },
    tenants: { id: 't-1', name: 'TestCorp' },
    tenant_format_preferences: { tenant_id: 't-1' },
  });
  const result = await fireTrigger(svc, {
    tenantId: 't-1', triggerId: 'trig-2',
    entityType: 'charge_set', entityId: 'cs-1',
    fireKey: 'key-2', userId: null, eventName: 'invoiced',
  });
  check('charge_set: fireTrigger resolves without crashing', !!result);
  check('charge_set: parent-order query happened on order_charge_sets',
    svc._calls.queries.some(q => q.table === 'order_charge_sets' && q.filters.id === 'cs-1'));
}

// Case 3: Move — parent-order lookup resolves load_id
{
  const svc = makeMockClient({
    email_template_triggers: {
      id: 'trig-3',
      tenant_id: 't-1',
      event_name: 'completed',
      entity_type: 'move',
      is_active: true,
      conditions: {},
      template: { id: 'tmpl-3', is_active: true, subject: 'x', body_html: 'y', body_text: 'z' },
    },
    order_container_moves: {
      id: 'm-1', tenant_id: 't-1', order_id: 'ord-parent-2',
      move_type: 'delivery', status: 'completed',
      scheduled_date: null, started_at: null,
      completed_at: '2026-04-24T00:00:00Z',
    },
    orders: {
      id: 'ord-parent-2', tenant_id: 't-1', load_number: 'LD-MOVE',
      customer: null, driver: null,
      pickup_org: null, delivery_org: null, return_org: null,
      final_delivery_org: null, container_owner: null,
    },
    tenants: { id: 't-1', name: 'TestCorp' },
    tenant_format_preferences: { tenant_id: 't-1' },
  });
  const result = await fireTrigger(svc, {
    tenantId: 't-1', triggerId: 'trig-3',
    entityType: 'move', entityId: 'm-1',
    fireKey: 'key-3', userId: null, eventName: 'completed',
  });
  check('move: fireTrigger resolves without crashing', !!result);
  check('move: parent-order query happened on order_container_moves',
    svc._calls.queries.some(q => q.table === 'order_container_moves' && q.filters.id === 'm-1'));
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
