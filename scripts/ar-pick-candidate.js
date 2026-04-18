/**
 * Inspect the 9 draft charge sets and recommend a candidate for the
 * AR pipeline walk-through. Criteria (in priority order):
 *   1. Has at least one line item (so total > 0)
 *   2. Has a bill_to_customer_id set (required before invoicing)
 *   3. Load has a pickup + delivery location (realistic test)
 *   4. Load status prefers completed/in-progress over pending
 *
 * Usage: node scripts/ar-pick-candidate.js
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

const svc = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

async function main() {
  const { data: testUser } = await svc
    .from('users')
    .select('tenant_id')
    .eq('email', 'test@testtruck.com')
    .maybeSingle();
  const tenantId = testUser.tenant_id;

  // Fetch all draft charge sets with load + line item info
  const { data: sets } = await svc
    .from('order_charge_sets')
    .select(`
      id, order_id, bill_to_customer_id, total_cents, subtotal_cents, status, created_at,
      order:orders(id, order_number, status, customer_id, pickup_location_id, delivery_location_id, container_number)
    `)
    .eq('tenant_id', tenantId)
    .eq('status', 'draft')
    .order('created_at', { ascending: false });

  const candidates = [];
  for (const s of sets || []) {
    // Count line items (column is `name`, not `charge_name`)
    const { data: lines, error: linesErr } = await svc
      .from('order_charge_set_line_items')
      .select('id, name, total_cents')
      .eq('charge_set_id', s.id)
      .eq('tenant_id', tenantId);
    if (linesErr) console.warn(`  line items query error for ${s.id}: ${linesErr.message}`);

    const billToName = s.bill_to_customer_id ? '(set)' : '(missing)';
    const score = (lines?.length > 0 ? 2 : 0) +
                  (s.bill_to_customer_id ? 2 : 0) +
                  (s.order?.pickup_location_id && s.order?.delivery_location_id ? 1 : 0) +
                  (s.order?.status === 'completed' ? 2 : s.order?.status === 'in_progress' ? 1 : 0);

    candidates.push({
      score,
      chargeSetId: s.id,
      loadId: s.order_id,
      loadNumber: s.order?.order_number,
      loadStatus: s.order?.status,
      billTo: billToName,
      container: s.order?.container_number || '(none)',
      lineItemCount: lines?.length || 0,
      total: `$${((s.total_cents || 0) / 100).toFixed(2)}`,
      sampleCharges: (lines || []).slice(0, 3).map((l) => `${l.name || '?'}=$${(l.total_cents / 100).toFixed(2)}`).join(', '),
    });
  }

  candidates.sort((a, b) => b.score - a.score);

  console.log('═'.repeat(100));
  console.log('Draft Charge Set Candidates (sorted by readiness)');
  console.log('═'.repeat(100));
  console.log('');

  for (const c of candidates) {
    console.log(`[score=${c.score}] load #${c.loadNumber || '?'}  (status=${c.loadStatus || '?'})`);
    console.log(`    charge_set:  ${c.chargeSetId}`);
    console.log(`    load_id:     ${c.loadId}`);
    console.log(`    bill_to:     ${c.billTo}`);
    console.log(`    container:   ${c.container}`);
    console.log(`    lines:       ${c.lineItemCount}  total=${c.total}`);
    if (c.sampleCharges) console.log(`    sample:      ${c.sampleCharges}`);
    console.log('');
  }

  if (candidates.length === 0) {
    console.log('No draft charge sets found.');
    return;
  }

  const top = candidates[0];
  console.log('═'.repeat(100));
  console.log('RECOMMENDED CANDIDATE');
  console.log('═'.repeat(100));
  console.log(`Load #${top.loadNumber} — charge set ${top.chargeSetId}`);
  console.log(`  bill_to: ${top.billTo}  lines: ${top.lineItemCount}  total: ${top.total}`);
  if (top.score < 4) {
    console.log('');
    console.log('⚠️  Top candidate is below ideal (score < 4). May need manual setup first:');
    if (top.billTo === '(missing)') console.log('   - Set bill_to_customer_id on the charge set');
    if (top.lineItemCount === 0) console.log('   - Add at least one line item');
  }
}

main().catch((e) => { console.error('Fatal:', e); process.exit(1); });
