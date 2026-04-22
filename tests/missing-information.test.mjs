#!/usr/bin/env node
/**
 * Unit tests for the missing_information trigger evaluator.
 *
 * Covers:
 *   1. COLUMN_ALIAS resolution for each aliased field
 *   2. REMOVED_FIELDS set matches the entries stripped from
 *      MISSING_INFO_APPLICABLE_FIELDS
 *   3. isFieldEmpty handles null/empty-string/empty-array correctly
 *   4. End-to-end: evaluate() maps resolved columns into the SELECT and
 *      produces the expected matches for a mocked `svc`
 *   5. Cutoff-time boundary semantics (notify_after)
 *   6. Already-configured trigger with a REMOVED_FIELDS value drops the
 *      offending field + still evaluates the remaining valid ones
 */

import {
  evaluate,
  COLUMN_ALIAS,
  REMOVED_FIELDS,
  resolveColumn,
  isFieldEmpty,
} from '../lib/email-dispatch/evaluators/missing-information.js';
import { MISSING_INFO_APPLICABLE_FIELDS } from '../lib/email-trigger-events.js';

let pass = 0;
let fail = 0;

function test(name, fn) {
  return (async () => {
    try {
      await fn();
      console.log(`  \u2713 ${name}`);
      pass++;
    } catch (e) {
      console.error(`  \u2717 ${name}`);
      console.error(`    ${e.message}`);
      if (e.stack) console.error(`    ${e.stack.split('\n').slice(1, 3).join('\n    ')}`);
      fail++;
    }
  })();
}

function assertEq(actual, expected, msg) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${msg || 'assertEq'}: expected ${e}, got ${a}`);
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'assertion failed');
}

// ──────────────────────────────────────────────────────────────
// Test: COLUMN_ALIAS resolves every expected public alias
// ──────────────────────────────────────────────────────────────
console.log('Test: COLUMN_ALIAS resolution');
await test('reference_number → customer_reference', () => {
  assertEq(resolveColumn('reference_number'), 'customer_reference');
});
await test('cutoff → cutoff_date', () => {
  assertEq(resolveColumn('cutoff'), 'cutoff_date');
});
await test('discharged_date → discharge_date', () => {
  assertEq(resolveColumn('discharged_date'), 'discharge_date');
});
await test('voyage → voyage_number', () => {
  assertEq(resolveColumn('voyage'), 'voyage_number');
});
await test('master_bill_of_lading → bill_of_lading', () => {
  assertEq(resolveColumn('master_bill_of_lading'), 'bill_of_lading');
});
await test('house_bill_of_lading → house_bol', () => {
  assertEq(resolveColumn('house_bill_of_lading'), 'house_bol');
});
await test('purchase_order_number → po_numbers', () => {
  assertEq(resolveColumn('purchase_order_number'), 'po_numbers');
});
await test('temperature → genset_temperature', () => {
  assertEq(resolveColumn('temperature'), 'genset_temperature');
});
await test('scac → steamship_line_scac', () => {
  assertEq(resolveColumn('scac'), 'steamship_line_scac');
});
await test('return_location → return_location_id', () => {
  assertEq(resolveColumn('return_location'), 'return_location_id');
});
await test('hook_chassis_location → hook_chassis_location_id', () => {
  assertEq(resolveColumn('hook_chassis_location'), 'hook_chassis_location_id');
});
await test('terminate_chassis_location → terminate_chassis_location_id', () => {
  assertEq(resolveColumn('terminate_chassis_location'), 'terminate_chassis_location_id');
});
await test('trailer → trailer_id', () => {
  assertEq(resolveColumn('trailer'), 'trailer_id');
});
await test('unaliased values pass through unchanged', () => {
  assertEq(resolveColumn('container_number'), 'container_number');
  assertEq(resolveColumn('last_free_day'), 'last_free_day');
  assertEq(resolveColumn('gray_container_number'), 'gray_container_number');
});
await test('COLUMN_ALIAS is frozen (immutable)', () => {
  let threw = false;
  try {
    COLUMN_ALIAS.new_key = 'x';
  } catch {
    threw = true;
  }
  // Even in non-strict mode, Object.freeze causes the write to silently
  // fail instead of adding the key.
  assert(!('new_key' in COLUMN_ALIAS), 'COLUMN_ALIAS must be frozen');
});

// ──────────────────────────────────────────────────────────────
// Test: REMOVED_FIELDS
// ──────────────────────────────────────────────────────────────
console.log('\nTest: REMOVED_FIELDS');
await test('contains all 11 known-bogus entries', () => {
  const expected = [
    'erd', 'freight_hold', 'customs_hold', 'return_date',
    'trailer_type', 'trailer_size',
    'gray_container_size', 'gray_container_type',
    'gray_chassis_size', 'gray_chassis_type', 'gray_chassis_owner',
  ];
  for (const e of expected) {
    assert(REMOVED_FIELDS.has(e), `REMOVED_FIELDS missing '${e}'`);
  }
  assertEq(REMOVED_FIELDS.size, expected.length, 'REMOVED_FIELDS should contain exactly these 11 entries');
});
await test('no REMOVED_FIELDS entry appears in MISSING_INFO_APPLICABLE_FIELDS', () => {
  const catalogValues = new Set(MISSING_INFO_APPLICABLE_FIELDS.map((f) => f.value));
  for (const removed of REMOVED_FIELDS) {
    assert(!catalogValues.has(removed), `'${removed}' is in REMOVED_FIELDS but still in catalog`);
  }
});
await test('no catalog entry is also in REMOVED_FIELDS', () => {
  for (const { value } of MISSING_INFO_APPLICABLE_FIELDS) {
    assert(!REMOVED_FIELDS.has(value), `catalog '${value}' also in REMOVED_FIELDS`);
  }
});
await test('every catalog value either has an alias or is a pass-through', () => {
  // No catalog value should be in REMOVED_FIELDS (already tested above).
  // This test is structural: it just confirms the catalog covers a
  // non-empty set so future reviewers see the shape.
  assert(MISSING_INFO_APPLICABLE_FIELDS.length > 0, 'catalog is empty');
  assert(MISSING_INFO_APPLICABLE_FIELDS.length >= 30, `catalog shrunk below 30 entries: ${MISSING_INFO_APPLICABLE_FIELDS.length}`);
});

// ──────────────────────────────────────────────────────────────
// Test: isFieldEmpty
// ──────────────────────────────────────────────────────────────
console.log('\nTest: isFieldEmpty');
await test('null is empty', () => {
  assert(isFieldEmpty(null));
});
await test('undefined is empty', () => {
  assert(isFieldEmpty(undefined));
});
await test('empty string is empty', () => {
  assert(isFieldEmpty(''));
});
await test('non-empty string is NOT empty', () => {
  assert(!isFieldEmpty('foo'));
  assert(!isFieldEmpty(' '));  // whitespace counts as non-empty (intentional)
});
await test('empty array is empty (po_numbers edge case)', () => {
  assert(isFieldEmpty([]));
});
await test('non-empty array is NOT empty', () => {
  assert(!isFieldEmpty(['PO-1']));
  assert(!isFieldEmpty(['PO-1', 'PO-2']));
});
await test('zero is NOT empty (numeric 0 is a valid value)', () => {
  assert(!isFieldEmpty(0));
});
await test('false is NOT empty (boolean false is a valid value)', () => {
  assert(!isFieldEmpty(false));
});

// ──────────────────────────────────────────────────────────────
// Test: evaluate() end-to-end with mocked Supabase client
// ──────────────────────────────────────────────────────────────
console.log('\nTest: evaluate() end-to-end');

/**
 * Build a mock svc that records which tables + selects were called.
 * Returns:
 *   - `history` rows for order_status_history
 *   - `loads` rows for orders
 */
function makeMockSvc({ history = [], loads = [], historyError = null, loadsError = null } = {}) {
  const calls = {
    orderStatusHistorySelect: null,
    ordersSelect: null,
  };

  const chainable = {
    from(table) {
      if (table === 'order_status_history') {
        return {
          select(cols) {
            calls.orderStatusHistorySelect = cols;
            const q = {};
            for (const m of ['eq', 'lte', 'in']) q[m] = () => q;
            q.then = (onFulfilled) => onFulfilled({ data: history, error: historyError });
            return q;
          },
        };
      }
      if (table === 'orders') {
        return {
          select(cols) {
            calls.ordersSelect = cols;
            const q = {};
            for (const m of ['eq', 'lte', 'in']) q[m] = () => q;
            q.then = (onFulfilled) => onFulfilled({ data: loads, error: loadsError });
            return q;
          },
        };
      }
      throw new Error(`unexpected table: ${table}`);
    },
  };

  return { svc: chainable, calls };
}

await test('empty applicable_fields → returns []', async () => {
  const { svc } = makeMockSvc();
  const res = await evaluate(svc, 't1', {
    conditions: { load_status: 'dispatched', applicable_fields: [] },
  });
  assertEq(res, []);
});
await test('no required status → returns []', async () => {
  const { svc } = makeMockSvc();
  const res = await evaluate(svc, 't1', {
    conditions: { applicable_fields: ['container_number'] },
  });
  assertEq(res, []);
});
await test('alias present in SELECT, not public name', async () => {
  const { svc, calls } = makeMockSvc({
    history: [{ order_id: 'o1', created_at: new Date(Date.now() - 10_000_000).toISOString() }],
    loads: [{ id: 'o1', status: 'dispatched', deleted_at: null, customer_reference: null }],
  });
  await evaluate(svc, 't1', {
    conditions: {
      load_status: 'dispatched',
      notify_after: { minutes: 1 },
      applicable_fields: ['reference_number'],
    },
  });
  assert(
    calls.ordersSelect.includes('customer_reference'),
    `SELECT should use resolved column. got: ${calls.ordersSelect}`
  );
  assert(
    !calls.ordersSelect.split(',').map((s) => s.trim()).includes('reference_number'),
    `SELECT should NOT include raw alias 'reference_number'. got: ${calls.ordersSelect}`
  );
});
await test('match fires when aliased column is null', async () => {
  const { svc } = makeMockSvc({
    history: [{ order_id: 'o1', created_at: new Date(Date.now() - 10_000_000).toISOString() }],
    loads: [{ id: 'o1', status: 'dispatched', deleted_at: null, customer_reference: null }],
  });
  const res = await evaluate(svc, 't1', {
    conditions: {
      load_status: 'dispatched',
      notify_after: { minutes: 1 },
      applicable_fields: ['reference_number'],
    },
  });
  assertEq(res.length, 1);
  assertEq(res[0].load_id, 'o1');
  assert(res[0].reason.includes('reference_number'), 'reason should use public alias in message');
});
await test('no match when aliased column is populated', async () => {
  const { svc } = makeMockSvc({
    history: [{ order_id: 'o1', created_at: new Date(Date.now() - 10_000_000).toISOString() }],
    loads: [{ id: 'o1', status: 'dispatched', deleted_at: null, customer_reference: 'PO-12345' }],
  });
  const res = await evaluate(svc, 't1', {
    conditions: {
      load_status: 'dispatched',
      notify_after: { minutes: 1 },
      applicable_fields: ['reference_number'],
    },
  });
  assertEq(res, []);
});
await test('po_numbers empty array triggers match (array-aware isEmpty)', async () => {
  const { svc } = makeMockSvc({
    history: [{ order_id: 'o1', created_at: new Date(Date.now() - 10_000_000).toISOString() }],
    loads: [{ id: 'o1', status: 'dispatched', deleted_at: null, po_numbers: [] }],
  });
  const res = await evaluate(svc, 't1', {
    conditions: {
      load_status: 'dispatched',
      notify_after: { minutes: 1 },
      applicable_fields: ['purchase_order_number'],
    },
  });
  assertEq(res.length, 1, 'empty po_numbers[] should count as missing');
});
await test('po_numbers with entries does NOT trigger match', async () => {
  const { svc } = makeMockSvc({
    history: [{ order_id: 'o1', created_at: new Date(Date.now() - 10_000_000).toISOString() }],
    loads: [{ id: 'o1', status: 'dispatched', deleted_at: null, po_numbers: ['PO-1'] }],
  });
  const res = await evaluate(svc, 't1', {
    conditions: {
      load_status: 'dispatched',
      notify_after: { minutes: 1 },
      applicable_fields: ['purchase_order_number'],
    },
  });
  assertEq(res, []);
});
await test('REMOVED_FIELDS are filtered out before query', async () => {
  const origWarn = console.warn;
  const warnings = [];
  console.warn = (msg) => warnings.push(msg);
  try {
    const { svc, calls } = makeMockSvc({
      history: [{ order_id: 'o1', created_at: new Date(Date.now() - 10_000_000).toISOString() }],
      loads: [{ id: 'o1', status: 'dispatched', deleted_at: null, container_number: null }],
    });
    const res = await evaluate(svc, 't1', {
      conditions: {
        load_status: 'dispatched',
        notify_after: { minutes: 1 },
        applicable_fields: ['erd', 'container_number', 'freight_hold'],
      },
    });
    // 1 match (container_number is null), erd + freight_hold silently dropped
    assertEq(res.length, 1);
    assertEq(res[0].reason, 'missing: container_number');
    assert(
      !calls.ordersSelect.includes('erd'),
      `SELECT must not include removed field 'erd'. got: ${calls.ordersSelect}`
    );
    assert(
      !calls.ordersSelect.includes('freight_hold'),
      `SELECT must not include removed field 'freight_hold'. got: ${calls.ordersSelect}`
    );
    assert(warnings.length === 2, `expected 2 warn calls, got ${warnings.length}`);
    assert(warnings.some((w) => w.includes("'erd'")), 'erd not warned');
    assert(warnings.some((w) => w.includes("'freight_hold'")), 'freight_hold not warned');
  } finally {
    console.warn = origWarn;
  }
});
await test('only REMOVED fields → evaluator returns [] gracefully', async () => {
  const origWarn = console.warn;
  console.warn = () => {};
  try {
    const { svc } = makeMockSvc({
      history: [{ order_id: 'o1', created_at: new Date(Date.now() - 10_000_000).toISOString() }],
    });
    const res = await evaluate(svc, 't1', {
      conditions: {
        load_status: 'dispatched',
        notify_after: { minutes: 1 },
        applicable_fields: ['erd', 'freight_hold'],
      },
    });
    assertEq(res, []);
  } finally {
    console.warn = origWarn;
  }
});
await test('cutoff time boundary: history older than notify_after still considered', async () => {
  // order entered status 10_000_000ms ago, notify_after = 1 minute
  // => history.created_at <= cutoff, so the load SHOULD be considered
  const { svc } = makeMockSvc({
    history: [{ order_id: 'o1', created_at: new Date(Date.now() - 10_000_000).toISOString() }],
    loads: [{ id: 'o1', status: 'dispatched', deleted_at: null, container_number: null }],
  });
  const res = await evaluate(svc, 't1', {
    conditions: {
      load_status: 'dispatched',
      notify_after: { minutes: 1 },
      applicable_fields: ['container_number'],
    },
  });
  assertEq(res.length, 1, 'load in status past notify_after should fire');
});
await test('dedupe: same load with multiple history rows → 1 candidate', async () => {
  const { svc } = makeMockSvc({
    history: [
      { order_id: 'o1', created_at: new Date(Date.now() - 20_000_000).toISOString() },
      { order_id: 'o1', created_at: new Date(Date.now() - 10_000_000).toISOString() },
    ],
    loads: [{ id: 'o1', status: 'dispatched', deleted_at: null, container_number: null }],
  });
  const res = await evaluate(svc, 't1', {
    conditions: {
      load_status: 'dispatched',
      notify_after: { minutes: 1 },
      applicable_fields: ['container_number'],
    },
  });
  assertEq(res.length, 1);
});
await test('soft-deleted load is skipped', async () => {
  const { svc } = makeMockSvc({
    history: [{ order_id: 'o1', created_at: new Date(Date.now() - 10_000_000).toISOString() }],
    loads: [{ id: 'o1', status: 'dispatched', deleted_at: '2026-01-01', container_number: null }],
  });
  const res = await evaluate(svc, 't1', {
    conditions: {
      load_status: 'dispatched',
      notify_after: { minutes: 1 },
      applicable_fields: ['container_number'],
    },
  });
  assertEq(res, []);
});
await test('load that moved out of target status is skipped', async () => {
  const { svc } = makeMockSvc({
    history: [{ order_id: 'o1', created_at: new Date(Date.now() - 10_000_000).toISOString() }],
    loads: [{ id: 'o1', status: 'completed', deleted_at: null, container_number: null }],
  });
  const res = await evaluate(svc, 't1', {
    conditions: {
      load_status: 'dispatched',
      notify_after: { minutes: 1 },
      applicable_fields: ['container_number'],
    },
  });
  assertEq(res, []);
});
await test('multi-field: empty list aggregated in reason', async () => {
  const { svc } = makeMockSvc({
    history: [{ order_id: 'o1', created_at: new Date(Date.now() - 10_000_000).toISOString() }],
    loads: [{
      id: 'o1',
      status: 'dispatched',
      deleted_at: null,
      container_number: null,
      customer_reference: '',
      voyage_number: 'V123',
    }],
  });
  const res = await evaluate(svc, 't1', {
    conditions: {
      load_status: 'dispatched',
      notify_after: { minutes: 1 },
      applicable_fields: ['container_number', 'reference_number', 'voyage'],
    },
  });
  assertEq(res.length, 1);
  // Two of three missing; reason uses public alias names, not resolved columns.
  assertEq(res[0].reason, 'missing: container_number, reference_number');
});

// ──────────────────────────────────────────────────────────────
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
