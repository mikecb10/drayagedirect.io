import {
  transitionMoveStatus,
  revertCascadedEventsForMove,
} from '../lib/routing/moves/transition.js';

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
  // FU-074 closed: the transition helper is the sole history-writer for
  // move transitions. fireStatusChangeTriggers is called with
  // skipHistoryWrite: true, so exactly 1 history row lands per transition.
  check('1 INSERT to history (helper only)', svc._calls.inserted.length === 1);
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
  check('fires: history INSERT ran (helper-only after FU-074)',
    svc._calls.inserted.filter(x => x.table === 'order_container_moves_status_history').length === 1);
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
  // initial: { moves, events, eventHistory? }
  //   eventHistory (optional) seeds order_routing_event_status_history rows for
  //   FU-081 revert tests. Each row: { event_id, from_status, to_status, note, transitioned_at }
  const state = {
    order_container_moves: [...(initial.moves ?? [])].map((m) => ({ ...m })),
    order_routing_events: [...(initial.events ?? [])].map((e) => ({ ...e })),
    order_container_moves_status_history: [],
    order_routing_event_status_history: [...(initial.eventHistory ?? [])].map((h) => ({ ...h })),
  };
  // Clock for generating transitioned_at timestamps on inserted history rows.
  // Uses a monotonically increasing counter so insert-order matches sort-order
  // when tests later read history with .order('transitioned_at', desc).
  let historyClock = (initial.historyClockStart ?? 1_000_000);
  const calls = {
    moveUpdates: [],
    eventUpdates: [],
    moveHistory: [],
    eventHistory: [],
    stuckEventFetches: [],
    // FU-081: track the departed-event scan + history reads + revert updates
    departedEventFetches: [],
    eventHistoryReads: [],
  };

  function chain(table) {
    const c = {
      _table: table,
      _mode: null,
      _payload: null,
      _filters: {},
      _inFilter: null,
      _orderBy: null,
      select(..._args) { if (c._mode == null) c._mode = 'select'; return c; },
      update(payload) { c._mode = 'update'; c._payload = payload; return c; },
      insert(payload) { c._mode = 'insert'; c._payload = payload; return c; },
      eq(col, val) { c._filters[col] = val; return c; },
      in(col, vals) { c._inFilter = { col, vals }; return c; },
      order(col, opts) { c._orderBy = { col, ascending: opts?.ascending !== false }; return c; },

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
            state.order_container_moves_status_history.push({ ...c._payload });
          } else if (table === 'order_routing_event_status_history') {
            // Stamp a monotonic transitioned_at so later history reads can
            // order them (matches the real DB DEFAULT now() semantics for
            // insert-order = time-order purposes of these tests).
            const stamped = { ...c._payload, transitioned_at: c._payload.transitioned_at ?? String(historyClock++) };
            calls.eventHistory.push({ payload: stamped });
            state.order_routing_event_status_history.push(stamped);
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
          // Handles two cascade-related queries:
          //   1. cascade's stuck-events query:
          //      .select('id, event_status').eq(tenant).eq(move_id).in('event_status', [...])
          //   2. FU-081 revert's departed-events query:
          //      .select('id, event_status').eq(tenant).eq(move_id).eq('event_status', 'departed')
          //   3. FU-081 revert's history read:
          //      .select(...).eq(tenant).eq(event_id).order('transitioned_at', desc)
          const rows = state[table] ?? [];
          let matched = rows.filter((r) => {
            const eqOk = Object.entries(c._filters).every(([k, v]) => r[k] === v);
            const inOk = c._inFilter
              ? c._inFilter.vals.includes(r[c._inFilter.col])
              : true;
            return eqOk && inOk;
          });

          if (c._orderBy) {
            const { col, ascending } = c._orderBy;
            matched = [...matched].sort((a, b) => {
              const av = a[col]; const bv = b[col];
              if (av === bv) return 0;
              if (av == null) return ascending ? -1 : 1;
              if (bv == null) return ascending ? 1 : -1;
              return ascending ? (av < bv ? -1 : 1) : (av < bv ? 1 : -1);
            });
          }

          if (table === 'order_routing_events' && c._inFilter) {
            calls.stuckEventFetches.push({
              filters: { ...c._filters },
              inFilter: { ...c._inFilter },
              count: matched.length,
            });
          }
          if (
            table === 'order_routing_events'
            && !c._inFilter
            && c._filters.event_status === 'departed'
          ) {
            calls.departedEventFetches.push({
              filters: { ...c._filters },
              count: matched.length,
            });
          }
          if (table === 'order_routing_event_status_history' && c._orderBy) {
            calls.eventHistoryReads.push({
              filters: { ...c._filters },
              orderBy: { ...c._orderBy },
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

// ---------------------------------------------------------------------------
// FU-081 — revertCascadedEventsForMove: reverses the complete_load cascade
// when uncomplete_load fires. Event state machine treats 'departed' as
// terminal (correctly, for manual actions), so the helper BYPASSES it
// via raw supabase calls for this system-only reverse path.
// ---------------------------------------------------------------------------

console.log('\nrevertCascadedEventsForMove — FU-081');

// Case R1: Cascade then revert — 2 pending events cascaded to departed, then
// reverted. Both should end back at 'pending'. Expected totals:
//   - Cascade wrote 4 event-history rows (pending→arrived, arrived→departed × 2 events)
//   - Revert writes 2 event-history rows (one per event, departed→pending)
//   - All 6 tagged actor_type='system'
{
  const svc = makeCascadeMockClient({
    moves: [{ id: 'm-R1', tenant_id: 't-1', status: 'in_progress' }],
    events: [
      { id: 'ev-R1a', tenant_id: 't-1', move_id: 'm-R1', event_status: 'pending',
        arrived_at: null, departed_at: null },
      { id: 'ev-R1b', tenant_id: 't-1', move_id: 'm-R1', event_status: 'pending',
        arrived_at: null, departed_at: null },
    ],
  });
  // Step 1: Cascade via complete_load path
  await transitionMoveStatus(svc, {
    tenantId: 't-1', moveId: 'm-R1', newStatus: 'completed', actorUserId: 'u-1',
  });
  const cascadeHistCount = svc._calls.eventHistory.length;
  check('R1: cascade wrote 4 event-history rows', cascadeHistCount === 4);
  // Step 2: Revert
  const result = await revertCascadedEventsForMove({
    supabase: svc, tenantId: 't-1', moveId: 'm-R1',
    actor: { id: 'u-1', type: 'system', context: { reason: 'uncomplete_load', loadId: 'order-R1' } },
  });
  const eventsById = svc._state.order_routing_events.reduce(
    (acc, e) => { acc[e.id] = e; return acc; }, {},
  );
  check('R1: ev-R1a reverted to pending', eventsById['ev-R1a'].event_status === 'pending');
  check('R1: ev-R1b reverted to pending', eventsById['ev-R1b'].event_status === 'pending');
  check('R1: ev-R1a departed_at cleared', eventsById['ev-R1a'].departed_at === null);
  check('R1: ev-R1a arrived_at cleared', eventsById['ev-R1a'].arrived_at === null);
  check('R1: revertedCount=2', result.revertedCount === 2);
  check('R1: skippedCount=0', result.skippedCount === 0);
  // 4 cascade + 2 revert = 6 total event-history rows
  check('R1: total event-history rows = 6', svc._calls.eventHistory.length === 6);
  const revertRows = svc._calls.eventHistory.filter(
    (h) => h.payload.note === 'reverted from uncomplete_load',
  );
  check('R1: 2 revert-tagged history rows', revertRows.length === 2);
  check('R1: all revert rows actor_type=system',
    revertRows.every((h) => h.payload.actor_type === 'system'));
  check('R1: all revert rows from_status=departed',
    revertRows.every((h) => h.payload.from_status === 'departed'));
  check('R1: all revert rows to_status=pending',
    revertRows.every((h) => h.payload.to_status === 'pending'));
  check('R1: all revert rows have moveId in actor_context',
    revertRows.every((h) => h.payload.actor_context?.moveId === 'm-R1'));
  // All 6 event-history rows must be actor_type=system (cascade + revert both system-driven)
  check('R1: all 6 event-history rows actor_type=system',
    svc._calls.eventHistory.every((h) => h.payload.actor_type === 'system'));
}

// Case R2: Mixed pre-state — 1 pending event (cascaded) + 1 already-departed
// event (dispatcher-marked before cascade). Revert should touch ONLY the
// cascaded event; the pre-existing departed event stays put.
{
  // Pre-seed history for ev-R2b: a dispatcher-driven arrived→departed row
  // exists BEFORE any cascade. The revert must see the lack of cascade rows
  // for this event and skip it.
  const svc = makeCascadeMockClient({
    moves: [{ id: 'm-R2', tenant_id: 't-1', status: 'in_progress' }],
    events: [
      { id: 'ev-R2a', tenant_id: 't-1', move_id: 'm-R2', event_status: 'pending',
        arrived_at: null, departed_at: null },
      // ev-R2b is already departed (dispatcher marked it before complete_load).
      { id: 'ev-R2b', tenant_id: 't-1', move_id: 'm-R2', event_status: 'departed',
        arrived_at: '2026-04-24T07:00:00Z', departed_at: '2026-04-24T07:30:00Z' },
    ],
    // Seed ev-R2b's prior dispatcher history (no cascade note).
    eventHistory: [
      { tenant_id: 't-1', event_id: 'ev-R2b', from_status: 'pending', to_status: 'arrived',
        actor_type: 'human', note: null, transitioned_at: '500000' },
      { tenant_id: 't-1', event_id: 'ev-R2b', from_status: 'arrived', to_status: 'departed',
        actor_type: 'human', note: null, transitioned_at: '500001' },
    ],
    historyClockStart: 1_000_000,
  });
  // Cascade: only ev-R2a is pending, so only it gets cascaded (ev-R2b already departed).
  await transitionMoveStatus(svc, {
    tenantId: 't-1', moveId: 'm-R2', newStatus: 'completed', actorUserId: 'u-1',
  });
  // Revert
  const result = await revertCascadedEventsForMove({
    supabase: svc, tenantId: 't-1', moveId: 'm-R2',
    actor: { type: 'system', context: { reason: 'uncomplete_load', loadId: 'order-R2' } },
  });
  const eventsById = svc._state.order_routing_events.reduce(
    (acc, e) => { acc[e.id] = e; return acc; }, {},
  );
  check('R2: cascaded event (ev-R2a) reverted to pending',
    eventsById['ev-R2a'].event_status === 'pending');
  check('R2: pre-existing departed event (ev-R2b) UNCHANGED',
    eventsById['ev-R2b'].event_status === 'departed');
  check('R2: ev-R2b arrived_at preserved',
    eventsById['ev-R2b'].arrived_at === '2026-04-24T07:00:00Z');
  check('R2: ev-R2b departed_at preserved',
    eventsById['ev-R2b'].departed_at === '2026-04-24T07:30:00Z');
  check('R2: revertedCount=1 (only cascaded event)', result.revertedCount === 1);
  check('R2: skippedCount=1 (pre-existing departed skipped)', result.skippedCount === 1);
  // Only 1 revert-tagged history row written
  const revertRows = svc._calls.eventHistory.filter(
    (h) => h.payload.note === 'reverted from uncomplete_load',
  );
  check('R2: exactly 1 revert history row', revertRows.length === 1);
  check('R2: revert row is for ev-R2a',
    revertRows[0]?.payload.event_id === 'ev-R2a');
}

// Case R3: No cascade history — event is at 'departed' but has no rows
// tagged as cascade. Revert must leave it alone (skippedCount=1).
{
  const svc = makeCascadeMockClient({
    moves: [{ id: 'm-R3', tenant_id: 't-1', status: 'in_progress' }],
    events: [
      { id: 'ev-R3', tenant_id: 't-1', move_id: 'm-R3', event_status: 'departed',
        arrived_at: '2026-04-24T06:00:00Z', departed_at: '2026-04-24T06:30:00Z' },
    ],
    eventHistory: [
      { tenant_id: 't-1', event_id: 'ev-R3', from_status: 'pending', to_status: 'arrived',
        actor_type: 'human', note: null, transitioned_at: '500000' },
      { tenant_id: 't-1', event_id: 'ev-R3', from_status: 'arrived', to_status: 'departed',
        actor_type: 'human', note: 'driver marked done via app', transitioned_at: '500001' },
    ],
  });
  const result = await revertCascadedEventsForMove({
    supabase: svc, tenantId: 't-1', moveId: 'm-R3',
    actor: { type: 'system' },
  });
  const ev = svc._state.order_routing_events[0];
  check('R3: event status unchanged (still departed)', ev.event_status === 'departed');
  check('R3: event timestamps unchanged', ev.arrived_at === '2026-04-24T06:00:00Z');
  check('R3: revertedCount=0', result.revertedCount === 0);
  check('R3: skippedCount=1', result.skippedCount === 1);
  check('R3: no revert history rows written',
    svc._calls.eventHistory.filter((h) => h.payload.note === 'reverted from uncomplete_load').length === 0);
  check('R3: no event updates',
    svc._calls.eventUpdates.filter((u) => u.eventId === 'ev-R3').length === 0);
}

// Case R4: Authority guard — actor.type !== 'system' must throw
{
  const svc = makeCascadeMockClient({
    moves: [{ id: 'm-R4', tenant_id: 't-1', status: 'in_progress' }],
    events: [],
  });
  let threwHuman = false;
  try {
    await revertCascadedEventsForMove({
      supabase: svc, tenantId: 't-1', moveId: 'm-R4',
      actor: { type: 'human' },
    });
  } catch (e) {
    threwHuman = /actor\.type=system/.test(e.message);
  }
  check('R4: actor.type=human throws', threwHuman);

  let threwAgent = false;
  try {
    await revertCascadedEventsForMove({
      supabase: svc, tenantId: 't-1', moveId: 'm-R4',
      actor: { type: 'agent' },
    });
  } catch (e) {
    threwAgent = /actor\.type=system/.test(e.message);
  }
  check('R4: actor.type=agent throws', threwAgent);

  let threwMissing = false;
  try {
    await revertCascadedEventsForMove({
      supabase: svc, tenantId: 't-1', moveId: 'm-R4',
      actor: null,
    });
  } catch (e) {
    threwMissing = /actor\.type=system/.test(e.message);
  }
  check('R4: missing actor throws', threwMissing);

  // System actor with empty events is a valid no-op (returns counts=0).
  const ok = await revertCascadedEventsForMove({
    supabase: svc, tenantId: 't-1', moveId: 'm-R4',
    actor: { type: 'system' },
  });
  check('R4: system actor with no events returns {0,0}',
    ok.revertedCount === 0 && ok.skippedCount === 0);
}

// Case R5: Mixed pre-state, arrived→cascade→revert. Event was 'arrived'
// (dispatcher had marked arrival) before cascade pushed it to 'departed'.
// Revert target should be 'arrived' — NOT 'pending' — per algorithm step 3:
// "first non-cascade row's to_status is the revert target".
{
  const svc = makeCascadeMockClient({
    moves: [{ id: 'm-R5', tenant_id: 't-1', status: 'in_progress' }],
    events: [
      { id: 'ev-R5', tenant_id: 't-1', move_id: 'm-R5', event_status: 'arrived',
        arrived_at: '2026-04-24T08:00:00Z', departed_at: null },
    ],
    eventHistory: [
      // Dispatcher marked arrival before any cascade.
      { tenant_id: 't-1', event_id: 'ev-R5', from_status: 'pending', to_status: 'arrived',
        actor_type: 'human', note: null, transitioned_at: '500000' },
    ],
  });
  // Complete triggers cascade (arrived → departed, 1 row).
  await transitionMoveStatus(svc, {
    tenantId: 't-1', moveId: 'm-R5', newStatus: 'completed', actorUserId: 'u-1',
  });
  const cascadeEventHist = svc._calls.eventHistory.filter(
    (h) => h.payload.event_id === 'ev-R5',
  );
  check('R5: 1 cascade history row (arrived→departed)',
    cascadeEventHist.length === 1 && cascadeEventHist[0].payload.from_status === 'arrived');
  // Revert
  const result = await revertCascadedEventsForMove({
    supabase: svc, tenantId: 't-1', moveId: 'm-R5',
    actor: { type: 'system', context: { reason: 'uncomplete_load', loadId: 'order-R5' } },
  });
  const ev = svc._state.order_routing_events[0];
  check('R5: reverted to arrived (pre-cascade dispatcher state)',
    ev.event_status === 'arrived');
  check('R5: arrived_at preserved', ev.arrived_at === '2026-04-24T08:00:00Z');
  check('R5: departed_at cleared on revert', ev.departed_at === null);
  check('R5: revertedCount=1', result.revertedCount === 1);
  const revertRows = svc._calls.eventHistory.filter(
    (h) => h.payload.note === 'reverted from uncomplete_load',
  );
  check('R5: revert row records departed→arrived',
    revertRows.length === 1
    && revertRows[0].payload.from_status === 'departed'
    && revertRows[0].payload.to_status === 'arrived');
}

// Case R6: All-cascade history fallback — event has ONLY cascade rows
// (created and immediately cascaded, no prior dispatcher state). Algorithm
// step 4: revert target = oldest cascade row's from_status (== 'pending'
// for a freshly-created event).
{
  const svc = makeCascadeMockClient({
    moves: [{ id: 'm-R6', tenant_id: 't-1', status: 'completed' }],
    events: [
      { id: 'ev-R6', tenant_id: 't-1', move_id: 'm-R6', event_status: 'departed',
        arrived_at: '2026-04-24T09:00:00Z', departed_at: '2026-04-24T09:00:00Z' },
    ],
    eventHistory: [
      // Only cascade rows exist for this event.
      { tenant_id: 't-1', event_id: 'ev-R6', from_status: 'pending', to_status: 'arrived',
        actor_type: 'system', note: 'cascaded from parent move completion', transitioned_at: '500000' },
      { tenant_id: 't-1', event_id: 'ev-R6', from_status: 'arrived', to_status: 'departed',
        actor_type: 'system', note: 'cascaded from parent move completion', transitioned_at: '500001' },
    ],
  });
  const result = await revertCascadedEventsForMove({
    supabase: svc, tenantId: 't-1', moveId: 'm-R6',
    actor: { type: 'system' },
  });
  const ev = svc._state.order_routing_events[0];
  check('R6: all-cascade fallback reverts to pending (oldest cascade from_status)',
    ev.event_status === 'pending');
  check('R6: revertedCount=1', result.revertedCount === 1);
  check('R6: arrived_at cleared when reverting to pending', ev.arrived_at === null);
  check('R6: departed_at cleared when reverting to pending', ev.departed_at === null);
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
