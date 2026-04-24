import { transitionChargeSetStatus } from '../lib/charge-sets/transition.js';

let passed = 0;
let failed = 0;
function check(name, cond) {
  if (cond) { console.log(`  ✓ ${name}`); passed++; }
  else      { console.log(`  ✗ ${name}`); failed++; }
}

// Minimal chainable Supabase-client mock. Each test constructs one per-call-tree.
// The mock captures .from/.select/.update/.insert/.eq/.in/.maybeSingle/.single
// and returns the configured terminal result.
function makeMockClient(config) {
  const calls = {
    selected: [],
    updated: [],
    inserted: [],
    terminals: [],
  };
  function chain(currentTable) {
    const c = {
      _table: currentTable,
      _mode: null,
      _payload: null,
      select(..._args) { if (c._mode == null) c._mode = 'select'; return c; },
      update(payload) { c._mode = 'update'; c._payload = payload; return c; },
      insert(payload) { c._mode = 'insert'; c._payload = payload; return c; },
      eq(_col, _val) { return c; },
      in(_col, _vals) { return c; },
      async maybeSingle() {
        const r = config.fetch ?? { data: null, error: null };
        calls.terminals.push({ kind: 'maybeSingle', table: c._table });
        return r;
      },
      async single() {
        if (c._mode === 'update') {
          calls.updated.push({ table: c._table, payload: c._payload });
          const r = config.update ?? { data: c._payload, error: null };
          calls.terminals.push({ kind: 'update.single', table: c._table });
          return r;
        }
        const r = config.fetch ?? { data: null, error: null };
        calls.terminals.push({ kind: 'single', table: c._table });
        return r;
      },
      then(resolve) {
        // If the chain ends without .single() / .maybeSingle() (e.g., plain insert,
        // or a .select().eq().eq() chain awaited directly), this thenable resolves
        // based on mode.
        if (c._mode === 'insert') {
          calls.inserted.push({ table: c._table, payload: c._payload });
          resolve(config.insert ?? { data: null, error: null });
        } else if (c._mode === 'update') {
          calls.updated.push({ table: c._table, payload: c._payload });
          resolve(config.update ?? { data: null, error: null });
        } else if (c._mode === 'select') {
          calls.selected.push({ table: c._table });
          const tableSelect = config.select && config.select[c._table];
          resolve(tableSelect ?? { data: [], error: null });
        } else {
          resolve({ data: null, error: null });
        }
      },
    };
    return c;
  }
  return {
    from(table) { return chain(table); },
    _calls: calls,
  };
}

// --------- Test cases ---------

console.log('transitionChargeSetStatus');

// Case 1: Success (status only)
{
  const svc = makeMockClient({
    fetch: { data: { id: 'cs-1', status: 'draft' }, error: null },
    update: { data: { id: 'cs-1', status: 'invoiced' }, error: null },
    insert: { data: null, error: null },
  });
  const result = await transitionChargeSetStatus(svc, {
    tenantId: 't-1',
    chargeSetId: 'cs-1',
    newStatus: 'invoiced',
    actorUserId: 'u-1',
  });
  check('returns oldStatus=draft', result.oldStatus === 'draft');
  check('returns newStatus=invoiced', result.newStatus === 'invoiced');
  check('writes 1 update', svc._calls.updated.length === 1);
  check('update payload has status', svc._calls.updated[0]?.payload?.status === 'invoiced');
  check('update targets order_charge_sets', svc._calls.updated[0]?.table === 'order_charge_sets');
  // After Stream B.1b, fireStatusChangeTriggers also writes a history row,
  // producing 2 inserts per transition (FU-074 tracks unification).
  check('writes >= 1 history insert (helper + fire = 2)', svc._calls.inserted.length >= 1);
  check('history table is order_charge_sets_status_history',
    svc._calls.inserted[0]?.table === 'order_charge_sets_status_history');
}

// Case 2: Success (status + extraFields)
{
  const svc = makeMockClient({
    fetch: { data: { id: 'cs-2', status: 'approved' }, error: null },
    update: { data: { id: 'cs-2', status: 'invoiced' }, error: null },
    insert: { data: null, error: null },
  });
  await transitionChargeSetStatus(svc, {
    tenantId: 't-1',
    chargeSetId: 'cs-2',
    newStatus: 'invoiced',
    actorUserId: 'u-1',
    extraFields: { invoice_id: 'inv-99', invoiced_at: '2026-04-24T00:00:00Z' },
  });
  const payload = svc._calls.updated[0]?.payload;
  check('extraFields: status merged', payload?.status === 'invoiced');
  check('extraFields: invoice_id merged', payload?.invoice_id === 'inv-99');
  check('extraFields: invoiced_at merged', payload?.invoiced_at === '2026-04-24T00:00:00Z');
  const histPayload = svc._calls.inserted[0]?.payload;
  check('history has new_status', histPayload?.new_status === 'invoiced');
  check('history does NOT include extraFields', histPayload?.invoice_id === undefined);
}

// Case 3: No-op (same status, no extraFields)
{
  const svc = makeMockClient({
    fetch: { data: { id: 'cs-3', status: 'invoiced' }, error: null },
  });
  const result = await transitionChargeSetStatus(svc, {
    tenantId: 't-1',
    chargeSetId: 'cs-3',
    newStatus: 'invoiced',
    actorUserId: 'u-1',
  });
  check('no-op: returns oldStatus=newStatus=invoiced',
    result.oldStatus === 'invoiced' && result.newStatus === 'invoiced');
  check('no-op: no UPDATE call', svc._calls.updated.length === 0);
  check('no-op: no INSERT call', svc._calls.inserted.length === 0);
}

// Case 4: UPDATE fails → throws
{
  const svc = makeMockClient({
    fetch: { data: { id: 'cs-4', status: 'draft' }, error: null },
    update: { data: null, error: { message: 'update failed' } },
  });
  let threw = false;
  try {
    await transitionChargeSetStatus(svc, {
      tenantId: 't-1', chargeSetId: 'cs-4', newStatus: 'invoiced', actorUserId: null,
    });
  } catch { threw = true; }
  check('UPDATE error throws', threw);
  check('no history row on UPDATE failure', svc._calls.inserted.length === 0);
}

// Case 5: History INSERT fails → does NOT throw (log-and-continue)
{
  const svc = makeMockClient({
    fetch: { data: { id: 'cs-5', status: 'draft' }, error: null },
    update: { data: { id: 'cs-5', status: 'invoiced' }, error: null },
    insert: { data: null, error: { message: 'history failed' } },
  });
  let threw = false;
  let result;
  try {
    result = await transitionChargeSetStatus(svc, {
      tenantId: 't-1', chargeSetId: 'cs-5', newStatus: 'invoiced', actorUserId: null,
    });
  } catch { threw = true; }
  check('history failure does NOT throw', !threw);
  check('UPDATE still happens', svc._calls.updated.length === 1);
  check('helper returns normally', result?.newStatus === 'invoiced');
}

// Case 6: extraFields: null is treated as absent
{
  const svc = makeMockClient({
    fetch: { data: { id: 'cs-6', status: 'draft' }, error: null },
    update: { data: { id: 'cs-6', status: 'invoiced' }, error: null },
    insert: { data: null, error: null },
  });
  const r = await transitionChargeSetStatus(svc, {
    tenantId: 't-1',
    chargeSetId: 'cs-6',
    newStatus: 'invoiced',
    actorUserId: null,
    extraFields: null,
  });
  check('null extraFields: helper returns normally', r.newStatus === 'invoiced');
  check('null extraFields: UPDATE fires', svc._calls.updated.length === 1);
  check('null extraFields: UPDATE payload has only status',
    Object.keys(svc._calls.updated[0]?.payload || {}).length === 1);
}

// Case 7: Same status + extraFields → UPDATE fires, history does NOT write
{
  const svc = makeMockClient({
    fetch: { data: { id: 'cs-7', status: 'approved' }, error: null },
    update: { data: { id: 'cs-7', status: 'approved' }, error: null },
    insert: { data: null, error: null },
  });
  await transitionChargeSetStatus(svc, {
    tenantId: 't-1',
    chargeSetId: 'cs-7',
    newStatus: 'approved', // same as current
    actorUserId: null,
    extraFields: { notes: 'updated note' },
  });
  check('same-status + extraFields: UPDATE fires', svc._calls.updated.length === 1);
  check('same-status + extraFields: UPDATE payload has extraFields',
    svc._calls.updated[0]?.payload?.notes === 'updated note');
  check('same-status + extraFields: NO history row written', svc._calls.inserted.length === 0);
}

// Case 8: Fires status-change triggers on successful transition.
// fireStatusChangeTriggers queries email_template_triggers as part of its
// firing flow. Asserting the mock saw that SELECT confirms the fire path
// was reached after the UPDATE + helper's history INSERT.
{
  const svc = makeMockClient({
    fetch: { data: { id: 'cs-8', status: 'draft' }, error: null },
    update: { data: { id: 'cs-8', status: 'invoiced' }, error: null },
    insert: { data: null, error: null },
    select: { email_template_triggers: { data: [], error: null } },
  });
  await transitionChargeSetStatus(svc, {
    tenantId: 't-1',
    chargeSetId: 'cs-8',
    newStatus: 'invoiced',
    actorUserId: 'u-1',
  });
  check('fires: UPDATE ran', svc._calls.updated.length === 1);
  check('fires: history INSERT ran (+ a 2nd history INSERT from fire — FU-074)',
    svc._calls.inserted.filter(x => x.table === 'order_charge_sets_status_history').length >= 1);
  check('fires: email_template_triggers queried after transition',
    svc._calls.selected.some(c => c.table === 'email_template_triggers'));
}

// Case 9: Does NOT fire triggers on noop (same status, no extraFields).
{
  const svc = makeMockClient({
    fetch: { data: { id: 'cs-9', status: 'invoiced' }, error: null },
    select: { email_template_triggers: { data: [], error: null } },
  });
  await transitionChargeSetStatus(svc, {
    tenantId: 't-1',
    chargeSetId: 'cs-9',
    newStatus: 'invoiced',
    actorUserId: 'u-1',
  });
  check('noop: no email_template_triggers query',
    !svc._calls.selected.some(c => c.table === 'email_template_triggers'));
  check('noop: no UPDATE', svc._calls.updated.length === 0);
  check('noop: no INSERT', svc._calls.inserted.length === 0);
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
