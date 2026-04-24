import { transitionMoveStatus } from '../lib/routing/moves/transition.js';

let passed = 0;
let failed = 0;
function check(name, cond) {
  if (cond) { console.log(`  ✓ ${name}`); passed++; }
  else      { console.log(`  ✗ ${name}`); failed++; }
}

// Same mock shape as tests/charge-sets-transition.test.mjs — inlined here
// (not extracted because the two tests are the only callers and
// duplication is cheaper than sharing).
function makeMockClient(config) {
  const calls = { selected: [], updated: [], inserted: [], terminals: [] };
  function chain(currentTable) {
    const c = {
      _table: currentTable, _mode: null, _payload: null,
      select(..._args) { if (c._mode == null) c._mode = 'select'; return c; },
      update(payload) { c._mode = 'update'; c._payload = payload; return c; },
      insert(payload) { c._mode = 'insert'; c._payload = payload; return c; },
      eq() { return c; },
      in() { return c; },
      async maybeSingle() {
        calls.terminals.push({ kind: 'maybeSingle', table: c._table });
        return config.fetch ?? { data: null, error: null };
      },
      async single() {
        if (c._mode === 'update') {
          calls.updated.push({ table: c._table, payload: c._payload });
          calls.terminals.push({ kind: 'update.single', table: c._table });
          return config.update ?? { data: c._payload, error: null };
        }
        calls.terminals.push({ kind: 'single', table: c._table });
        return config.fetch ?? { data: null, error: null };
      },
      then(resolve) {
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
  return { from(table) { return chain(table); }, _calls: calls };
}

console.log('transitionMoveStatus');

// Case 1: Success (status only)
{
  const svc = makeMockClient({
    fetch: { data: { id: 'm-1', status: 'pending' }, error: null },
    update: { data: { id: 'm-1', status: 'in_progress' }, error: null },
  });
  const r = await transitionMoveStatus(svc, {
    tenantId: 't-1', moveId: 'm-1', newStatus: 'in_progress', actorUserId: 'u-1',
  });
  check('oldStatus=pending', r.oldStatus === 'pending');
  check('newStatus=in_progress', r.newStatus === 'in_progress');
  check('1 UPDATE', svc._calls.updated.length === 1);
  check('update targets order_container_moves', svc._calls.updated[0]?.table === 'order_container_moves');
  // After Stream B.1b, fireStatusChangeTriggers also writes a history row,
  // producing 2 inserts per transition (FU-074 tracks unification).
  check('>= 1 INSERT to history (helper + fire = 2)', svc._calls.inserted.length >= 1);
  check('history table correct',
    svc._calls.inserted.some(x => x.table === 'order_container_moves_status_history'));
}

// Case 2: Success (status + extraFields)
{
  const svc = makeMockClient({
    fetch: { data: { id: 'm-2', status: 'in_progress' }, error: null },
    update: { data: { id: 'm-2', status: 'completed' }, error: null },
  });
  await transitionMoveStatus(svc, {
    tenantId: 't-1', moveId: 'm-2', newStatus: 'completed', actorUserId: 'u-1',
    extraFields: { completed_at: '2026-04-24T00:00:00Z' },
  });
  const payload = svc._calls.updated[0]?.payload;
  check('payload status=completed', payload?.status === 'completed');
  check('payload completed_at merged', payload?.completed_at === '2026-04-24T00:00:00Z');
  const histPayload = svc._calls.inserted[0]?.payload;
  check('history has new_status', histPayload?.new_status === 'completed');
  check('history excludes completed_at', histPayload?.completed_at === undefined);
}

// Case 3: No-op (same status, no extraFields)
{
  const svc = makeMockClient({
    fetch: { data: { id: 'm-3', status: 'completed' }, error: null },
  });
  const r = await transitionMoveStatus(svc, {
    tenantId: 't-1', moveId: 'm-3', newStatus: 'completed', actorUserId: null,
  });
  check('no-op return', r.oldStatus === 'completed' && r.newStatus === 'completed');
  check('no UPDATE', svc._calls.updated.length === 0);
  check('no INSERT', svc._calls.inserted.length === 0);
}

// Case 4: UPDATE fails → throws
{
  const svc = makeMockClient({
    fetch: { data: { id: 'm-4', status: 'pending' }, error: null },
    update: { data: null, error: { message: 'update failed' } },
  });
  let threw = false;
  try {
    await transitionMoveStatus(svc, {
      tenantId: 't-1', moveId: 'm-4', newStatus: 'in_progress', actorUserId: null,
    });
  } catch { threw = true; }
  check('UPDATE error throws', threw);
  check('no history row on UPDATE failure', svc._calls.inserted.length === 0);
}

// Case 5: History INSERT fails → does NOT throw
{
  const svc = makeMockClient({
    fetch: { data: { id: 'm-5', status: 'pending' }, error: null },
    update: { data: { id: 'm-5', status: 'in_progress' }, error: null },
    insert: { data: null, error: { message: 'history failed' } },
  });
  let threw = false;
  let result;
  try {
    result = await transitionMoveStatus(svc, {
      tenantId: 't-1', moveId: 'm-5', newStatus: 'in_progress', actorUserId: null,
    });
  } catch { threw = true; }
  check('history failure does NOT throw', !threw);
  check('UPDATE still happens', svc._calls.updated.length === 1);
  check('helper returns normally', result?.newStatus === 'in_progress');
}

// Case 6: extraFields: null is treated as absent
{
  const svc = makeMockClient({
    fetch: { data: { id: 'm-6', status: 'pending' }, error: null },
    update: { data: { id: 'm-6', status: 'in_progress' }, error: null },
    insert: { data: null, error: null },
  });
  const r = await transitionMoveStatus(svc, {
    tenantId: 't-1',
    moveId: 'm-6',
    newStatus: 'in_progress',
    actorUserId: null,
    extraFields: null,
  });
  check('null extraFields: helper returns normally', r.newStatus === 'in_progress');
  check('null extraFields: UPDATE fires', svc._calls.updated.length === 1);
  check('null extraFields: UPDATE payload has only status',
    Object.keys(svc._calls.updated[0]?.payload || {}).length === 1);
}

// Case 7: Same status + extraFields → UPDATE fires, history does NOT write
{
  const svc = makeMockClient({
    fetch: { data: { id: 'm-7', status: 'in_progress' }, error: null },
    update: { data: { id: 'm-7', status: 'in_progress' }, error: null },
    insert: { data: null, error: null },
  });
  await transitionMoveStatus(svc, {
    tenantId: 't-1',
    moveId: 'm-7',
    newStatus: 'in_progress', // same as current
    actorUserId: null,
    extraFields: { started_at: '2026-04-24T00:00:00Z' },
  });
  check('same-status + extraFields: UPDATE fires', svc._calls.updated.length === 1);
  check('same-status + extraFields: UPDATE payload has extraFields',
    svc._calls.updated[0]?.payload?.started_at === '2026-04-24T00:00:00Z');
  check('same-status + extraFields: NO history row written', svc._calls.inserted.length === 0);
}

// Case 8: Fires status-change triggers on successful transition.
{
  const svc = makeMockClient({
    fetch: { data: { id: 'm-8', status: 'pending' }, error: null },
    update: { data: { id: 'm-8', status: 'in_progress' }, error: null },
    insert: { data: null, error: null },
    select: { email_template_triggers: { data: [], error: null } },
  });
  await transitionMoveStatus(svc, {
    tenantId: 't-1',
    moveId: 'm-8',
    newStatus: 'in_progress',
    actorUserId: 'u-1',
  });
  check('fires: UPDATE ran', svc._calls.updated.length === 1);
  check('fires: history INSERT ran (+ a 2nd history INSERT from fire — FU-074)',
    svc._calls.inserted.filter(x => x.table === 'order_container_moves_status_history').length >= 1);
  check('fires: email_template_triggers queried after transition',
    svc._calls.selected.some(c => c.table === 'email_template_triggers'));
}

// Case 9: Does NOT fire on noop (same status, no extraFields).
{
  const svc = makeMockClient({
    fetch: { data: { id: 'm-9', status: 'in_progress' }, error: null },
    select: { email_template_triggers: { data: [], error: null } },
  });
  await transitionMoveStatus(svc, {
    tenantId: 't-1',
    moveId: 'm-9',
    newStatus: 'in_progress',
    actorUserId: null,
  });
  check('noop: no email_template_triggers query',
    !svc._calls.selected.some(c => c.table === 'email_template_triggers'));
  check('noop: no UPDATE', svc._calls.updated.length === 0);
  check('noop: no INSERT', svc._calls.inserted.length === 0);
}

// Case 10: actorType defaults to 'human' when not provided
{
  const svc = makeMockClient({
    fetch: { data: { id: 'm-default', status: 'pending' }, error: null },
    update: { data: { id: 'm-default', status: 'in_progress' }, error: null },
    insert: { data: null, error: null },
  });
  await transitionMoveStatus(svc, {
    tenantId: 't-1', moveId: 'm-default', newStatus: 'in_progress', actorUserId: 'u-1',
  });
  const histInsert = svc._calls.inserted.find(i => i.table === 'order_container_moves_status_history');
  check('default actorType: human stamped on history row',
    histInsert?.payload?.actor_type === 'human');
}

// Case 11: explicit actorType: 'system' passes through
{
  const svc = makeMockClient({
    fetch: { data: { id: 'm-sys', status: 'pending' }, error: null },
    update: { data: { id: 'm-sys', status: 'in_progress' }, error: null },
    insert: { data: null, error: null },
  });
  await transitionMoveStatus(svc, {
    tenantId: 't-1', moveId: 'm-sys', newStatus: 'in_progress', actorUserId: null,
    actorType: 'system',
  });
  const histInsert = svc._calls.inserted.find(i => i.table === 'order_container_moves_status_history');
  check('explicit system actorType: stamped on history row',
    histInsert?.payload?.actor_type === 'system');
}

// ---------------------------------------------------------------------------
// B.1e Task 11 — Cascade pending/arrived events to departed on move completion
// ---------------------------------------------------------------------------
//
// These tests exercise the move→events cascade. They need a richer mock
// because transitionEventStatus (called from the cascade loop) reads +
// updates + appends history per-event, and the existing `config.fetch`
// is a single global value. This mock supports:
//   - per-table, per-row `fetch` lookups (keyed by id filter via .eq)
//   - mutable event state so a 2nd maybeSingle after the 1st update
//     returns the updated row
//   - per-table captured selected/updated/inserted
// The existing simpler mock remains for cases 1–11.

function makeCascadeMockClient(initial) {
  // initial: { moves: [{ id, status }], events: [{ id, event_status, arrived_at, departed_at }] }
  const state = {
    order_container_moves: [...(initial.moves ?? [])].map((m) => ({ ...m })),
    order_routing_events: [...(initial.events ?? [])].map((e) => ({ ...e })),
  };
  const calls = {
    moveUpdates: [],
    eventUpdates: [],
    moveHistory: [],
    eventHistory: [],
    stuckEventFetches: [],
  };

  function chain(table) {
    const c = {
      _table: table,
      _mode: null,
      _payload: null,
      _filters: {},
      _inFilter: null,
      select(..._args) { if (c._mode == null) c._mode = 'select'; return c; },
      update(payload) { c._mode = 'update'; c._payload = payload; return c; },
      insert(payload) { c._mode = 'insert'; c._payload = payload; return c; },
      eq(col, val) { c._filters[col] = val; return c; },
      in(col, vals) { c._inFilter = { col, vals }; return c; },

      async maybeSingle() {
        const rows = state[table] ?? [];
        const match = rows.find((r) =>
          Object.entries(c._filters).every(([k, v]) => r[k] === v),
        );
        return { data: match ? { ...match } : null, error: null };
      },
      async single() {
        if (c._mode === 'update') {
          return applyUpdate(c);
        }
        const rows = state[table] ?? [];
        const match = rows.find((r) =>
          Object.entries(c._filters).every(([k, v]) => r[k] === v),
        );
        return { data: match ? { ...match } : null, error: null };
      },
      then(resolve) {
        if (c._mode === 'insert') {
          if (table === 'order_container_moves_status_history') {
            calls.moveHistory.push({ payload: c._payload });
          } else if (table === 'order_routing_event_status_history') {
            calls.eventHistory.push({ payload: c._payload });
          }
          resolve({ data: null, error: null });
          return;
        }
        if (c._mode === 'update') {
          const res = applyUpdateSync(c);
          resolve(res);
          return;
        }
        if (c._mode === 'select') {
          // Handles the cascade's stuck-events query:
          //   .select('id, event_status').eq(tenant).eq(move_id).in('event_status', [...])
          const rows = state[table] ?? [];
          const matched = rows.filter((r) => {
            const eqOk = Object.entries(c._filters).every(([k, v]) => r[k] === v);
            const inOk = c._inFilter
              ? c._inFilter.vals.includes(r[c._inFilter.col])
              : true;
            return eqOk && inOk;
          });
          if (table === 'order_routing_events' && c._inFilter) {
            calls.stuckEventFetches.push({
              filters: { ...c._filters },
              inFilter: { ...c._inFilter },
              count: matched.length,
            });
          }
          resolve({ data: matched.map((r) => ({ ...r })), error: null });
          return;
        }
        resolve({ data: null, error: null });
      },
    };
    return c;
  }

  function applyUpdateSync(c) {
    const rows = state[c._table];
    const match = rows?.find((r) =>
      Object.entries(c._filters).every(([k, v]) => r[k] === v),
    );
    if (!match) return { data: null, error: null };
    Object.assign(match, c._payload);
    if (c._table === 'order_container_moves') {
      calls.moveUpdates.push({ payload: { ...c._payload }, row: { ...match } });
    } else if (c._table === 'order_routing_events') {
      calls.eventUpdates.push({
        eventId: match.id,
        payload: { ...c._payload },
        row: { ...match },
      });
    }
    return { data: { ...match }, error: null };
  }
  function applyUpdate(c) { return applyUpdateSync(c); }

  return { from(table) { return chain(table); }, _calls: calls, _state: state };
}

console.log('\ntransitionMoveStatus — B.1e cascade');

// Case C1: completed with 2 pending events → both become departed (actor=system)
{
  const svc = makeCascadeMockClient({
    moves: [{ id: 'm-C1', tenant_id: 't-1', status: 'in_progress' }],
    events: [
      { id: 'ev-1', tenant_id: 't-1', move_id: 'm-C1', event_status: 'pending',
        arrived_at: null, departed_at: null },
      { id: 'ev-2', tenant_id: 't-1', move_id: 'm-C1', event_status: 'pending',
        arrived_at: null, departed_at: null },
    ],
  });
  await transitionMoveStatus(svc, {
    tenantId: 't-1', moveId: 'm-C1', newStatus: 'completed', actorUserId: 'u-1',
  });
  const eventsById = svc._state.order_routing_events.reduce(
    (acc, e) => { acc[e.id] = e; return acc; }, {},
  );
  check('C1: ev-1 ended at departed', eventsById['ev-1'].event_status === 'departed');
  check('C1: ev-2 ended at departed', eventsById['ev-2'].event_status === 'departed');
  check('C1: stuck-event fetch fired exactly once', svc._calls.stuckEventFetches.length === 1);
  // pending → arrived → departed = 2 history rows per event × 2 events = 4 event-history rows
  check('C1: 4 event-history rows written (2 per pending event)',
    svc._calls.eventHistory.length === 4);
  check('C1: all event-history rows actor_type=system',
    svc._calls.eventHistory.every((h) => h.payload.actor_type === 'system'));
  check('C1: all event-history rows have cascade note',
    svc._calls.eventHistory.every((h) => h.payload.note === 'cascaded from parent move completion'));
  check('C1: all event-history rows include moveId in actor_context',
    svc._calls.eventHistory.every((h) => h.payload.actor_context?.moveId === 'm-C1'));
}

// Case C2: completed with 1 pending + 1 arrived → pending gets 2 history rows,
// arrived gets 1 history row; both end departed.
{
  const svc = makeCascadeMockClient({
    moves: [{ id: 'm-C2', tenant_id: 't-1', status: 'in_progress' }],
    events: [
      { id: 'ev-p', tenant_id: 't-1', move_id: 'm-C2', event_status: 'pending',
        arrived_at: null, departed_at: null },
      { id: 'ev-a', tenant_id: 't-1', move_id: 'm-C2', event_status: 'arrived',
        arrived_at: '2026-04-24T08:00:00Z', departed_at: null },
    ],
  });
  await transitionMoveStatus(svc, {
    tenantId: 't-1', moveId: 'm-C2', newStatus: 'completed', actorUserId: 'u-1',
  });
  const eventsById = svc._state.order_routing_events.reduce(
    (acc, e) => { acc[e.id] = e; return acc; }, {},
  );
  check('C2: pending event ended at departed', eventsById['ev-p'].event_status === 'departed');
  check('C2: arrived event ended at departed', eventsById['ev-a'].event_status === 'departed');
  const pendingHist = svc._calls.eventHistory.filter((h) => h.payload.event_id === 'ev-p');
  const arrivedHist = svc._calls.eventHistory.filter((h) => h.payload.event_id === 'ev-a');
  check('C2: pending event has 2 history rows (pending→arrived, arrived→departed)',
    pendingHist.length === 2);
  check('C2: arrived event has 1 history row (arrived→departed)',
    arrivedHist.length === 1);
  check('C2: pending history row 1 is pending→arrived',
    pendingHist[0]?.payload.from_status === 'pending' && pendingHist[0]?.payload.to_status === 'arrived');
  check('C2: pending history row 2 is arrived→departed',
    pendingHist[1]?.payload.from_status === 'arrived' && pendingHist[1]?.payload.to_status === 'departed');
  check('C2: arrived history row is arrived→departed',
    arrivedHist[0]?.payload.from_status === 'arrived' && arrivedHist[0]?.payload.to_status === 'departed');
}

// Case C3: completed with 0 stuck events → cascade fetch fires but no transitions
{
  const svc = makeCascadeMockClient({
    moves: [{ id: 'm-C3', tenant_id: 't-1', status: 'in_progress' }],
    events: [
      { id: 'ev-d1', tenant_id: 't-1', move_id: 'm-C3', event_status: 'departed',
        arrived_at: '2026-04-24T07:00:00Z', departed_at: '2026-04-24T07:30:00Z' },
    ],
  });
  let threw = false;
  try {
    await transitionMoveStatus(svc, {
      tenantId: 't-1', moveId: 'm-C3', newStatus: 'completed', actorUserId: 'u-1',
    });
  } catch { threw = true; }
  check('C3: no-stuck cascade does not throw', !threw);
  check('C3: stuck-event fetch still fired', svc._calls.stuckEventFetches.length === 1);
  check('C3: no event updates fired', svc._calls.eventUpdates.length === 0);
  check('C3: no event-history rows written', svc._calls.eventHistory.length === 0);
}

// Case C4: move → in_progress (NOT completed) → cascade does NOT fire
{
  const svc = makeCascadeMockClient({
    moves: [{ id: 'm-C4', tenant_id: 't-1', status: 'pending' }],
    events: [
      { id: 'ev-i1', tenant_id: 't-1', move_id: 'm-C4', event_status: 'pending',
        arrived_at: null, departed_at: null },
    ],
  });
  await transitionMoveStatus(svc, {
    tenantId: 't-1', moveId: 'm-C4', newStatus: 'in_progress', actorUserId: 'u-1',
  });
  check('C4: no stuck-event fetch fired for non-completed transition',
    svc._calls.stuckEventFetches.length === 0);
  check('C4: no event updates fired', svc._calls.eventUpdates.length === 0);
  check('C4: no event-history rows written', svc._calls.eventHistory.length === 0);
  // event remains pending
  const ev = svc._state.order_routing_events[0];
  check('C4: event remained pending', ev.event_status === 'pending');
}

// Case C5: individual cascade failure is logged-and-continued (does not abort
// the move transition nor the sibling cascades).
{
  const svc = makeCascadeMockClient({
    moves: [{ id: 'm-C5', tenant_id: 't-1', status: 'in_progress' }],
    events: [
      { id: 'ev-ok-1', tenant_id: 't-1', move_id: 'm-C5', event_status: 'arrived',
        arrived_at: '2026-04-24T08:00:00Z', departed_at: null },
      // Poison event: inject a status the state machine cannot advance.
      // Mutated after initial fetch filter matches ('arrived'): we
      // instead simulate the failure by marking it with an invalid
      // status *already stored as arrived* then letting the helper's
      // re-read catch state mismatch. Easier approach: stub the row
      // post-fetch so transitionEventStatus rejects. Simpler still:
      // leave both valid and instead assert best-effort ordering.
      { id: 'ev-ok-2', tenant_id: 't-1', move_id: 'm-C5', event_status: 'arrived',
        arrived_at: '2026-04-24T08:05:00Z', departed_at: null },
    ],
  });
  // Swallow console.error so test output stays clean — log-and-continue
  // is expected to write at least one error for the forced failure.
  const originalErr = console.error;
  const errors = [];
  console.error = (...args) => { errors.push(args.join(' ')); };
  try {
    // Force a failure on the 2nd event by mutating its status between
    // the stuck-event fetch and the first transitionEventStatus read.
    // Approach: wrap the client so the 2nd event's maybeSingle returns
    // a status that isValidTransition rejects ('departed' → 'departed').
    const origFrom = svc.from.bind(svc);
    let eventReadCount = 0;
    svc.from = function wrappedFrom(table) {
      const c = origFrom(table);
      if (table === 'order_routing_events') {
        const origMaybeSingle = c.maybeSingle.bind(c);
        c.maybeSingle = async () => {
          const result = await origMaybeSingle();
          if (result.data && result.data.id === 'ev-ok-2' && eventReadCount === 0) {
            eventReadCount++;
            // Corrupt: pretend this event is already departed (terminal),
            // so transitionEventStatus will throw 'Invalid transition'.
            return { data: { ...result.data, event_status: 'departed' }, error: null };
          }
          return result;
        };
      }
      return c;
    };
    let threw = false;
    try {
      await transitionMoveStatus(svc, {
        tenantId: 't-1', moveId: 'm-C5', newStatus: 'completed', actorUserId: 'u-1',
      });
    } catch { threw = true; }
    check('C5: cascade failure does NOT bubble up', !threw);
    check('C5: failure was logged via console.error',
      errors.some((msg) => msg.includes('cascade failed for event ev-ok-2')));
    // ev-ok-1 should still have transitioned normally
    const ev1 = svc._state.order_routing_events.find((e) => e.id === 'ev-ok-1');
    check('C5: healthy sibling event still cascaded to departed',
      ev1?.event_status === 'departed');
  } finally {
    console.error = originalErr;
  }
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
