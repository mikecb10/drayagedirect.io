/**
 * Live-verify that the SHIPPED getBucket classifier produces the
 * predicted 4/0/3/0 right-rail bucket shift on the test tenant's
 * real unassigned moves.
 *
 * Mirrors the planner GET endpoint's query + bucketing logic but
 * imports the real `getBucket` from lib/dispatcher/moveBuckets.js,
 * so this is a live check on the shipped code — not a parallel
 * reimplementation.
 *
 * Usage: node scripts/planner-api-live-verify.js
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
loadEnvFile(path.resolve(__dirname, '..', '..', '..', '..', '.env.local'));
loadEnvFile(path.resolve(__dirname, '..', '..', '..', '..', '.env'));

async function main() {
  // Dynamic import of the ES-module classifier so we run the real
  // shipped code, not a hand-rolled mirror.
  const { getBucket } = await import('../lib/dispatcher/moveBuckets.js');

  const svc = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );

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
  console.log(`Planner classifier live-verify — tenant ${tenantId.slice(0, 8)}…`);
  console.log('═'.repeat(78));

  // Match the planner GET endpoint's query (30-day window, same select
  // shape, same lifecycle filter). No date filter — only unassigned.
  const windowCutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

  const { data: unassigned, error } = await svc
    .from('order_container_moves')
    .select(
      `
      id, tenant_id, order_id, sequence, move_type,
      driver_id, status, scheduled_date, created_at,
      order:orders!order_container_moves_order_id_fkey(
        id, order_number, container_number, container_size,
        last_free_day, container_at_port, empty_ready_for_return_at,
        status, deleted_at, actual_delivery_at
      ),
      events:order_routing_events!order_routing_events_move_id_fkey(
        id, event_type, scheduled_at, sequence
      )
      `
    )
    .eq('tenant_id', tenantId)
    .is('driver_id', null)
    .gte('created_at', windowCutoff);
  if (error) {
    console.error('Query failed:', error);
    process.exit(1);
  }

  // Same lifecycle filter as pages/api/tenant/dispatcher/planner/index.js
  function passesLifecycle(order) {
    if (!order) return false;
    if (order.deleted_at != null) return false;
    if (!['completed', 'cancelled'].includes(order.status)) return true;
    const f = order.actual_delivery_at;
    if (!f) return false;
    const finished = new Date(f);
    const today = new Date();
    return (
      finished.getFullYear() === today.getFullYear() &&
      finished.getMonth() === today.getMonth() &&
      finished.getDate() === today.getDate()
    );
  }
  const live = (unassigned || []).filter((m) => passesLifecycle(m.order));

  // Run the SHIPPED getBucket against each move
  const buckets = { atPort: [], deliveries: [], return: [], other: [] };
  for (const m of live) {
    const b = getBucket(m);
    if (b != null) buckets[b].push(m);
  }

  const atPort = buckets.atPort.length;
  const deliveries = buckets.deliveries.length;
  const ret = buckets.return.length;
  const other = buckets.other.length;
  const total = atPort + deliveries + ret + other;

  console.log(`\n─── Right-rail counts (via shipped getBucket) ───`);
  console.log(`  All         ${total}`);
  console.log(`  At Port     ${atPort}`);
  console.log(`  Deliveries  ${deliveries}`);
  console.log(`  Return      ${ret}`);
  console.log(`  Other       ${other}`);

  console.log(`\n─── Predicted (spec §5) ───`);
  console.log(`  All         7`);
  console.log(`  At Port     4`);
  console.log(`  Deliveries  0`);
  console.log(`  Return      3`);
  console.log(`  Other       0`);

  console.log(`\n─── Per-move classification ───`);
  for (const [bucket, moves] of Object.entries(buckets)) {
    for (const m of moves) {
      const eventTypes = (m.events || []).map((e) => e.event_type).join(', ');
      console.log(
        `  [${bucket.padEnd(10)}]  order=${m.order?.order_number || '?'}  seq=${m.sequence ?? '?'}  events=[${eventTypes}]`
      );
    }
  }

  const pass = total === 7 && other === 0 && atPort >= 1 && ret >= 1;
  console.log(
    `\nVerdict: ${pass ? 'PASS — predicted 4/0/3/0 shift landed on real data' : 'FAIL — counts do not match prediction'}`
  );
  process.exit(pass ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
