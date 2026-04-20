import { resolveBillingEmail } from '../../lib/ar/resolve-billing-email.js';

let pass = 0, fail = 0;
const check = (name, cond) => {
  if (cond) { pass++; console.log(`  \u2713 ${name}`); }
  else { fail++; console.log(`  \u2717 ${name}`); }
};

// Stub Supabase client. `from(table)` returns a chain that captures the
// query parameters; the `await`able `maybeSingle()` returns whatever the
// stub maker set up for that (table, type) pair.
//
// `typedRow` is the result for the FIRST customer_billing_emails query
// (Step 1, matching the requested emailType). `invoiceRow` is the result
// for a SECOND customer_billing_emails query (Step 2 fallback to
// email_type='invoice'). Keying off call order rather than email_type
// string is what makes Case 5 meaningful — when emailType='invoice',
// Step 1 queries email_type='invoice' and we want `typedRow` to apply
// there, not `invoiceRow`. `invoiceRow` must NOT be observable when
// Step 2 is correctly short-circuited.
function makeStub({ typedRow = null, invoiceRow = null, customerRow = null } = {}) {
  let billingEmailCalls = 0;
  return {
    from(table) {
      const chain = {
        _table: table,
        _eqs: {},
        select: () => chain,
        eq(col, val) { chain._eqs[col] = val; return chain; },
        maybeSingle: async () => {
          if (chain._table === 'customer_billing_emails') {
            billingEmailCalls++;
            if (billingEmailCalls === 1) {
              return { data: typedRow, error: null };
            }
            return { data: invoiceRow, error: null };
          }
          if (chain._table === 'customers') {
            return { data: customerRow, error: null };
          }
          return { data: null, error: null };
        },
      };
      return chain;
    },
  };
}

// Case 1: rate_confirmation email set → returns it (step 1 wins)
await (async () => {
  const svc = makeStub({ typedRow: { email: 'rates@acme.com' } });
  const r = await resolveBillingEmail(svc, 'tenant-1', 'cust-A', 'rate_confirmation');
  check('step 1: rate_confirmation set wins', r === 'rates@acme.com');
})();

// Case 2: only invoice set → falls back to step 2
await (async () => {
  const svc = makeStub({
    typedRow: null,
    invoiceRow: { email: 'ar@acme.com' },
  });
  const r = await resolveBillingEmail(svc, 'tenant-1', 'cust-B', 'rate_confirmation');
  check('step 2: falls back to invoice-typed email', r === 'ar@acme.com');
})();

// Case 3: only legacy billing_email → step 3
await (async () => {
  const svc = makeStub({
    typedRow: null,
    invoiceRow: null,
    customerRow: { billing_email: 'legacy@acme.com' },
  });
  const r = await resolveBillingEmail(svc, 'tenant-1', 'cust-C', 'rate_confirmation');
  check('step 3: legacy customers.billing_email fallback', r === 'legacy@acme.com');
})();

// Case 4: none set → null
await (async () => {
  const svc = makeStub({});
  const r = await resolveBillingEmail(svc, 'tenant-1', 'cust-D', 'rate_confirmation');
  check('step 4: returns null when nothing resolvable', r === null);
})();

// Case 5: emailType='invoice' does NOT redundantly fall back to invoice
await (async () => {
  const svc = makeStub({
    typedRow: null,
    invoiceRow: { email: 'should-not-use@acme.com' },
    customerRow: { billing_email: 'legacy@acme.com' },
  });
  const r = await resolveBillingEmail(svc, 'tenant-1', 'cust-E', 'invoice');
  check('step 2 skipped when emailType=invoice (would be redundant)',
    r === 'legacy@acme.com');
})();

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
