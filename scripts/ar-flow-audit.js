/**
 * AR Flow Audit — checks whether any charge sets have moved through
 * the full pipeline in real data.
 *
 * Reports:
 *   - Count of charge sets at each status
 *   - Count of invoices that exist
 *   - Count of payments recorded
 *   - Count of credit memos
 *   - Count of payment_applications (payment applied to invoice)
 *   - Names the farthest-progressed charge set in the tenant
 *
 * Usage: node scripts/ar-flow-audit.js
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
  // Find test truck tenant
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
  console.log(`AR Flow Audit — tenant: ${tenantId}`);
  console.log('═'.repeat(78));
  console.log('');

  // Charge set status distribution
  const { data: allSets } = await svc
    .from('order_charge_sets')
    .select('id, order_id, status, total_cents, invoice_number_base, invoice_id, created_at')
    .eq('tenant_id', tenantId);

  const byStatus = {};
  for (const s of allSets || []) {
    byStatus[s.status] = (byStatus[s.status] || 0) + 1;
  }

  console.log('─── Charge Sets by Status ───');
  const STATUSES = ['draft', 'rate_con_sent', 'unapproved', 'approved', 'invoiced', 'billed', 'rebilling', 'void'];
  for (const status of STATUSES) {
    console.log(`  ${status.padEnd(16)} ${byStatus[status] || 0}`);
  }
  console.log(`  TOTAL            ${allSets?.length || 0}`);
  console.log('');

  // Invoices
  const { data: invoices } = await svc
    .from('invoices')
    .select('id, invoice_number, total_amount_cents, status, created_at')
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: false });
  console.log('─── Invoices ───');
  console.log(`  Total invoices:  ${invoices?.length || 0}`);
  if (invoices?.length) {
    console.log(`  Latest: ${invoices[0].invoice_number} (${invoices[0].status}) — $${(invoices[0].total_amount_cents / 100).toFixed(2)}`);
  }
  console.log('');

  // Payments — table is `payments_received`, not `payments`
  const { data: payments } = await svc
    .from('payments_received')
    .select('id, amount_cents, unapplied_cents, payment_method, payment_date')
    .eq('tenant_id', tenantId)
    .order('payment_date', { ascending: false });
  console.log('─── Payments (payments_received) ───');
  console.log(`  Total payments:  ${payments?.length || 0}`);
  if (payments?.length) {
    const p = payments[0];
    const applied = (p.amount_cents - (p.unapplied_cents || 0)) / 100;
    console.log(`  Latest: ${p.payment_date} — $${(p.amount_cents / 100).toFixed(2)} ${p.payment_method || ''} (applied $${applied.toFixed(2)})`);
  }
  console.log('');

  // Payment applications
  const { data: paymentApps } = await svc
    .from('payment_applications')
    .select('id, amount_cents, payment_id, invoice_id')
    .eq('tenant_id', tenantId);
  console.log('─── Payment Applications (payment → invoice links) ───');
  console.log(`  Total applications: ${paymentApps?.length || 0}`);
  console.log('');

  // Credit memos
  const { data: creditMemos } = await svc
    .from('credit_memos')
    .select('id, amount_cents, status, memo_number')
    .eq('tenant_id', tenantId);
  console.log('─── Credit Memos ───');
  console.log(`  Total credit memos: ${creditMemos?.length || 0}`);
  console.log('');

  // Assess: has the full pipeline been exercised?
  console.log('═'.repeat(78));
  console.log('PIPELINE COMPLETENESS');
  console.log('═'.repeat(78));
  const hasInvoice = (invoices?.length || 0) > 0;
  const hasPayment = (payments?.length || 0) > 0;
  const hasApplication = (paymentApps?.length || 0) > 0;
  const hasCredit = (creditMemos?.length || 0) > 0;

  console.log(`  Charge set reached 'approved':  ${(byStatus['approved'] || 0) > 0 ? 'YES' : 'no'}`);
  console.log(`  Charge set reached 'invoiced':  ${(byStatus['invoiced'] || 0) > 0 ? 'YES' : 'no'}`);
  console.log(`  Invoice record created:         ${hasInvoice ? 'YES' : 'no'}`);
  console.log(`  Payment recorded:               ${hasPayment ? 'YES' : 'no'}`);
  console.log(`  Payment applied to invoice:     ${hasApplication ? 'YES' : 'no'}`);
  console.log(`  Credit memo created:            ${hasCredit ? 'YES' : 'no'}`);
  console.log('');

  if (!hasInvoice && !hasPayment && !hasApplication && !hasCredit) {
    console.log('⚠️  AR pipeline has NOT been exercised end-to-end yet in this tenant.');
    console.log('   Building a Payments tab now would point at empty tables.');
  } else if (hasInvoice && !hasPayment) {
    console.log('🟡 Invoices exist but no payments recorded — Payments tab would work');
    console.log('   but has nothing to display until a payment is logged.');
  } else if (hasPayment && !hasApplication) {
    console.log('🟡 Payments exist but not applied to any invoice — need to test apply flow.');
  } else {
    console.log('✅ AR pipeline appears exercised end-to-end.');
  }
}

main().catch((e) => {
  console.error('Fatal:', e);
  process.exit(1);
});
