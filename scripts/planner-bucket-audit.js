/**
 * Driver Planner Bucket Audit
 *
 * Goal: understand why all unassigned moves on the test tenant are falling
 * into the "Other" bucket on the right rail. Surfaces the actual `move_type`
 * values present on unassigned moves, whether the order-level classification
 * flags (`container_at_port`, `last_free_day`, `empty_ready_for_return_at`)
 * are populated, and what routing events exist with `scheduled_at`.
 *
 * Usage: node scripts/planner-bucket-audit.js
 */

const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  for (const rawLine of fs.readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = value;
  }
}
loadEnvFile(path.join(__dirname, '..', '.env.local'));
loadEnvFile(path.join(__dirname, '..', '.env'));
// Worktree fallback: the main-repo root holds .env.local when running inside
// a .claude/worktrees/<name>/ checkout.
loadEnvFile(path.resolve(__dirname, '..', '..', '..', '..', '.env.local'));
loadEnvFile(path.resolve(__dirname, '..', '..', '..', '..', '.env'));

const svc = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

async function main() {
  const { data: testUser } = await svc
    .from('users')
    .select('tenant_id, email')
    .eq('email', 'test@testtruck.com')
    .is('deleted_at', null)
    .maybeSingle();
  const tenantId = testUser?.tenant_id;
  if (!tenantId) {
    console.error('Could not resolve test truck tenant');
    process.exit(1);
  }

  console.log('═'.repeat(78));
  console.log(`Driver Planner Bucket Audit — tenant: ${tenantId}`);
  console.log('═'.repeat(78));

  // 30-day recency window — matches planner GET endpoint
  const windowCutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

  // 1. All unassigned moves within the 30-day window ─────────────────────
  const { data: unassigned, error: unErr } = await svc
    .from('order_container_moves')
    .select(
      `
      id, order_id, sequence, move_type, driver_id, status, scheduled_date, created_at,
      order:orders!order_container_moves_order_id_fkey(
        id, order_number, container_number, container_size,
        last_free_day, container_at_port, empty_ready_for_return_at,
        status, deleted_at, actual_delivery_at
      ),
      events:order_routing_events!order_routing_events_move_id_fkey(
        id, event_type, scheduled_at, arrived_at, departed_at, location_name, sequence
      )
      `
    )
    .eq('tenant_id', tenantId)
    .is('driver_id', null)
    .gte('created_at', windowCutoff);
  if (unErr) {
    console.error('Unassigned move fetch failed:', unErr);
    process.exit(1);
  }

  // Apply the same lifecycle filter the API uses
  function passesLifecycle(order) {
    if (!order) return false;
    if (order.deleted_at != null) return false;
    if (!['completed', 'cancelled'].includes(order.status)) return true;
    const finishedAt = order.actual_delivery_at;
    if (!finishedAt) return false;
    const finished = new Date(finishedAt);
    const today = new Date();
    return (
      finished.getFullYear() === today.getFullYear() &&
      finished.getMonth() === today.getMonth() &&
      finished.getDate() === today.getDate()
    );
  }

  const liveUnassigned = (unassigned || []).filter((m) => passesLifecycle(m.order));

  console.log(`\n─── Unassigned moves (within 30-day window, post-lifecycle filter) ───`);
  console.log(`  raw rows:          ${unassigned?.length || 0}`);
  console.log(`  after lifecycle:   ${liveUnassigned.length}`);

  if (!liveUnassigned.length) {
    console.log('\nNo unassigned moves on the test tenant right now.');
    process.exit(0);
  }

  // 2. move_type distribution ────────────────────────────────────────────
  const byMoveType = {};
  for (const m of liveUnassigned) {
    const t = m.move_type ?? '<null>';
    byMoveType[t] = (byMoveType[t] || 0) + 1;
  }
  console.log(`\n─── move_type distribution ───`);
  for (const [t, n] of Object.entries(byMoveType).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(t).padEnd(36)} ${n}`);
  }

  // 3. order-level flag population ───────────────────────────────────────
  let flagStats = {
    container_at_port_true: 0,
    container_at_port_false: 0,
    container_at_port_null: 0,
    lfd_populated: 0,
    lfd_null: 0,
    empty_ready_populated: 0,
    empty_ready_null: 0,
  };
  for (const m of liveUnassigned) {
    const o = m.order || {};
    if (o.container_at_port === true) flagStats.container_at_port_true++;
    else if (o.container_at_port === false) flagStats.container_at_port_false++;
    else flagStats.container_at_port_null++;
    if (o.last_free_day) flagStats.lfd_populated++;
    else flagStats.lfd_null++;
    if (o.empty_ready_for_return_at) flagStats.empty_ready_populated++;
    else flagStats.empty_ready_null++;
  }
  console.log(`\n─── Parent-order classification flags ───`);
  console.log(
    `  container_at_port   true=${flagStats.container_at_port_true}  false=${flagStats.container_at_port_false}  null=${flagStats.container_at_port_null}`
  );
  console.log(
    `  last_free_day       set=${flagStats.lfd_populated}  null=${flagStats.lfd_null}`
  );
  console.log(
    `  empty_ready_for_return_at  set=${flagStats.empty_ready_populated}  null=${flagStats.empty_ready_null}`
  );

  // 4. event_type + scheduled_at distribution ────────────────────────────
  const eventStats = {};
  let totalEvents = 0;
  for (const m of liveUnassigned) {
    for (const e of m.events || []) {
      totalEvents++;
      const key = `${e.event_type || '<null>'}${e.scheduled_at ? ' (scheduled)' : ' (no sched)'}`;
      eventStats[key] = (eventStats[key] || 0) + 1;
    }
  }
  console.log(`\n─── Routing event distribution (total=${totalEvents}) ───`);
  for (const [k, n] of Object.entries(eventStats).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${k.padEnd(36)} ${n}`);
  }

  // 5. Per-move detailed dump ────────────────────────────────────────────
  console.log(`\n─── Per-move detail (${liveUnassigned.length} rows) ───`);
  for (const m of liveUnassigned) {
    const o = m.order || {};
    const eventSummary = (m.events || [])
      .map((e) => `${e.event_type}${e.scheduled_at ? '*' : ''}`)
      .join(', ') || '(no events)';
    console.log(
      `  [${(m.id || '').slice(0, 8)}] order=${o.order_number || '?'}  ctr=${o.container_number || '?'}  size=${o.container_size || '?'}`
    );
    console.log(
      `    move_type="${m.move_type}"  status=${m.status}  seq=${m.sequence}`
    );
    console.log(
      `    cap=${o.container_at_port}  lfd=${o.last_free_day}  emptyReady=${o.empty_ready_for_return_at}`
    );
    console.log(`    events: ${eventSummary}`);
  }

  // 6. Manual classification prediction using events ─────────────────────
  console.log(`\n─── What the buckets WOULD be if we used event-based classification ───`);
  const predicted = { atPort: 0, deliveries: 0, return: 0, other: 0 };
  for (const m of liveUnassigned) {
    const events = m.events || [];
    const hasPickup = events.some((e) => e.event_type === 'pickup' && e.scheduled_at);
    const hasDeliver = events.some((e) => e.event_type === 'deliver' && e.scheduled_at);
    const hasReturn = events.some((e) => e.event_type === 'return' && e.scheduled_at);
    // Rough predicted classification: status-agnostic event-type precedence
    if (hasReturn) predicted.return++;
    else if (hasDeliver) predicted.deliveries++;
    else if (hasPickup) predicted.atPort++;
    else predicted.other++;
  }
  console.log(`  atPort     ${predicted.atPort}`);
  console.log(`  deliveries ${predicted.deliveries}`);
  console.log(`  return     ${predicted.return}`);
  console.log(`  other      ${predicted.other}`);

  console.log('\nDone.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
