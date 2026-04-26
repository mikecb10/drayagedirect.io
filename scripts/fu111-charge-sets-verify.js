/**
 * FU-111 verification: confirm the FK from order_charge_sets.invoice_id
 * to invoices(id) (added in migration 106) lets PostgREST resolve the
 * `invoice:invoices!invoice_id(...)` nested join the Load Detail
 * Billing tab endpoint relies on.
 *
 * Mirrors the EXACT select clause from
 * pages/api/tenant/loads/[id]/charge-sets/index.js so we're testing
 * the shipped query against the live schema cache, not a stand-in.
 *
 * Picks a tenant_id that has at least one order_charge_sets row with
 * invoice_id IS NOT NULL when possible (so we exercise the join);
 * falls back to any tenant with any charge set (asserts only that
 * the query itself doesn't 500 with a schema-cache error).
 *
 * Usage: node scripts/fu111-charge-sets-verify.js
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
  const svc = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );

  console.log('═'.repeat(78));
  console.log('FU-111 charge-sets nested-join live-verify');
  console.log('═'.repeat(78));

  // 1) Try to find a tenant_id with at least one charge set having
  //    invoice_id IS NOT NULL — that's the case that exercises the FK
  //    join most usefully.
  let tenantId = null;
  let orderId = null;
  let exercisesInvoiceJoin = false;

  const { data: withInvoice, error: withInvoiceErr } = await svc
    .from('order_charge_sets')
    .select('tenant_id, order_id, invoice_id')
    .not('invoice_id', 'is', null)
    .limit(1);
  if (withInvoiceErr) {
    console.error('Lookup (invoice_id NOT NULL) failed:', withInvoiceErr);
    process.exit(1);
  }
  if (withInvoice && withInvoice.length > 0) {
    tenantId = withInvoice[0].tenant_id;
    orderId = withInvoice[0].order_id;
    exercisesInvoiceJoin = true;
    console.log(`Found a charge set with invoice_id set:`);
    console.log(`  tenant_id  = ${tenantId}`);
    console.log(`  order_id   = ${orderId}`);
    console.log(`  invoice_id = ${withInvoice[0].invoice_id}`);
  } else {
    console.log('No charge sets with invoice_id set — falling back to any tenant.');
    const { data: anyRow, error: anyErr } = await svc
      .from('order_charge_sets')
      .select('tenant_id, order_id')
      .limit(1);
    if (anyErr) {
      console.error('Lookup (any row) failed:', anyErr);
      process.exit(1);
    }
    if (!anyRow || anyRow.length === 0) {
      console.log('No order_charge_sets rows exist at all — verifying schema-cache resolution against an empty result set on an arbitrary tenant.');
      const { data: tenantsRows, error: tenantsErr } = await svc
        .from('tenants')
        .select('id')
        .limit(1);
      if (tenantsErr || !tenantsRows || tenantsRows.length === 0) {
        console.error('Could not even find a tenant to probe with:', tenantsErr);
        process.exit(1);
      }
      tenantId = tenantsRows[0].id;
      orderId = null;
    } else {
      tenantId = anyRow[0].tenant_id;
      orderId = anyRow[0].order_id;
      console.log(`  tenant_id = ${tenantId}`);
      console.log(`  order_id  = ${orderId}`);
    }
  }

  // 2) Run the EXACT query from pages/api/tenant/loads/[id]/charge-sets/index.js
  //    (GET handler), copied verbatim. This is what would 500 if the FK
  //    were missing or the schema cache hadn't reloaded.
  console.log('\nRunning shipped GET-endpoint query…');
  let query = svc
    .from('order_charge_sets')
    .select(
      `*,
       bill_to:customers!order_charge_sets_bill_to_customer_id_fkey(id, name),
       line_items:order_charge_set_line_items(*),
       invoice:invoices!invoice_id(
         id,
         invoice_number,
         status,
         applied_credits:credit_memos!applied_to_invoice_id(id, status, amount_cents),
         payment_applications:payment_applications(id, amount_cents)
       )`
    )
    .eq('tenant_id', tenantId);
  if (orderId) query = query.eq('order_id', orderId);
  query = query.order('created_at', { ascending: true });

  const { data, error } = await query;

  if (error) {
    console.log('\n─── PostgREST error ───');
    console.log(JSON.stringify(error, null, 2));
    if (
      typeof error.message === 'string' &&
      /Could not find a relationship/i.test(error.message)
    ) {
      console.error(
        '\nFAIL — schema cache still does not see the FK. Either migration 106 ' +
          "was not applied, or PostgREST hasn't reloaded yet (NOTIFY pgrst, 'reload schema'). " +
          'Try: SELECT pg_notify(\'pgrst\', \'reload schema\'); on the DB.'
      );
    } else {
      console.error('\nFAIL — query returned a non-schema-cache error:', error.message);
    }
    process.exit(1);
  }

  if (!Array.isArray(data)) {
    console.error('\nFAIL — data is not an array:', typeof data);
    process.exit(1);
  }

  console.log(`\n─── Query succeeded ───`);
  console.log(`  rows returned: ${data.length}`);
  if (data.length > 0) {
    const first = data[0];
    console.log(`  first row keys: ${Object.keys(first).join(', ')}`);
    console.log(`  first row.id = ${first.id}`);
    console.log(`  first row.charge_set_number = ${first.charge_set_number}`);
    console.log(`  first row.invoice_id = ${first.invoice_id ?? 'null'}`);
    console.log(
      `  first row.bill_to = ${first.bill_to ? JSON.stringify(first.bill_to) : 'null'}`
    );
    console.log(
      `  first row.line_items count = ${Array.isArray(first.line_items) ? first.line_items.length : 'n/a'}`
    );
    console.log(
      `  first row.invoice = ${first.invoice ? JSON.stringify({ id: first.invoice.id, invoice_number: first.invoice.invoice_number, status: first.invoice.status }) : 'null'}`
    );
  }

  // 3) Assertions
  let pass = true;
  const reasons = [];

  if (exercisesInvoiceJoin) {
    // We picked this row precisely because invoice_id IS NOT NULL — the
    // joined `invoice` sub-object should resolve.
    const seedInvoiceId = withInvoice[0].invoice_id;
    const matched = (data || []).find(
      (cs) => cs.invoice_id === seedInvoiceId && cs.invoice && cs.invoice.id === seedInvoiceId
    );
    if (!matched) {
      pass = false;
      reasons.push(
        `Expected the seed charge set (invoice_id=${seedInvoiceId}) to resolve invoice via the FK join, but it did not (data has ${data.length} rows; none had matching invoice sub-object).`
      );
    } else {
      console.log(
        `\n  ✓ FK join resolved: charge_set.invoice_id ${seedInvoiceId} → invoice.id ${matched.invoice.id}, invoice_number=${matched.invoice.invoice_number}`
      );
    }
  } else {
    console.log(
      `\n  (no row had invoice_id set — only verified that the nested-join query itself does not 500 on schema cache)`
    );
  }

  if (pass) {
    console.log(`\nVerdict: PASS — FU-111 fix is live (FK + schema cache both healthy).`);
    process.exit(0);
  } else {
    console.error(`\nVerdict: FAIL`);
    for (const r of reasons) console.error(`  - ${r}`);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
