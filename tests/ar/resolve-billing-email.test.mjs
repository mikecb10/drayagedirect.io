import { resolveBillingEmails } from '../../lib/ar/resolve-billing-email.js';

let pass = 0, fail = 0;
const check = (name, cond) => {
  if (cond) { pass++; console.log(`  \u2713 ${name}`); }
  else { fail++; console.log(`  \u2717 ${name}`); }
};

// Call-count-keyed Supabase stub.
//
// `from(table)` returns a chainable builder that records every `.eq()`
// call. For `customer_billing_emails`, awaiting the chain directly
// (array-style query — no `.maybeSingle()`) returns:
//   - call #1: `billingCalls[0]`
//   - call #2: `billingCalls[1]`
// For `customers`, `.maybeSingle()` returns `customerRow`/`customerErr`.
//
// Each slot can be either:
//   - { data: <rows|null>, error: <Error|null> } — standard shape
//   - null — sugar for `{ data: null, error: null }`
//
// The stub also exposes:
//   - `_billingCallCount()` to assert Step 2 was/wasn't reached
//   - `_lastBillingEqs()` / `_allBillingEqs()` to inspect filters applied
function makeStub({ billingCalls = [], customerRow = null, customerErr = null } = {}) {
  let billingCallCount = 0;
  const billingEqsHistory = [];

  const normalize = (slot) => {
    if (slot == null) return { data: null, error: null };
    return { data: slot.data ?? null, error: slot.error ?? null };
  };

  const api = {
    from(table) {
      const chain = {
        _table: table,
        _eqs: {},
        select: () => chain,
        eq(col, val) { chain._eqs[col] = val; return chain; },
        // Array-style await (for customer_billing_emails). We implement
        // this via `then` so `await chain` resolves.
        then(resolve, reject) {
          try {
            if (chain._table === 'customer_billing_emails') {
              const idx = billingCallCount++;
              billingEqsHistory.push({ ...chain._eqs });
              const slot = normalize(billingCalls[idx]);
              return Promise.resolve(slot).then(resolve, reject);
            }
            return Promise.resolve({ data: null, error: null }).then(resolve, reject);
          } catch (err) {
            return Promise.resolve().then(() => reject(err));
          }
        },
        maybeSingle: async () => {
          if (chain._table === 'customers') {
            return { data: customerRow, error: customerErr };
          }
          return { data: null, error: null };
        },
      };
      return chain;
    },
    _billingCallCount: () => billingCallCount,
    _lastBillingEqs: () => billingEqsHistory[billingEqsHistory.length - 1],
    _allBillingEqs: () => billingEqsHistory,
  };
  return api;
}

// Case 1: Step 1 — single active email
await (async () => {
  const svc = makeStub({
    billingCalls: [{ data: [{ email: 'rates@acme.com' }] }],
  });
  const r = await resolveBillingEmails(svc, 'tenant-1', 'cust-A', 'rate_confirmation');
  check(
    'step 1: single active rate_confirmation email',
    r.source === 'customer_billing_emails' &&
      JSON.stringify(r.to) === JSON.stringify(['rates@acme.com']),
  );
  // Sanity: is_active=true filter was applied
  check(
    'step 1: is_active=true filter applied',
    svc._lastBillingEqs().is_active === true &&
      svc._lastBillingEqs().email_type === 'rate_confirmation',
  );
})();

// Case 2: Step 1 — multiple active emails returned as array
await (async () => {
  const svc = makeStub({
    billingCalls: [{ data: [
      { email: 'rates1@acme.com' },
      { email: 'rates2@acme.com' },
    ] }],
  });
  const r = await resolveBillingEmails(svc, 'tenant-1', 'cust-A2', 'rate_confirmation');
  check(
    'step 1: multiple active emails returned as array',
    r.source === 'customer_billing_emails' &&
      JSON.stringify(r.to) ===
        JSON.stringify(['rates1@acme.com', 'rates2@acme.com']),
  );
})();

// Case 3: Step 1 — inactive rows skipped (stub returns empty; fall through)
await (async () => {
  // Supabase applies .eq('is_active', true) server-side, so from the
  // helper's perspective inactive rows just look like zero rows. We
  // assert the filter is sent AND that an empty Step 1 falls through.
  const svc = makeStub({
    billingCalls: [{ data: [] }, { data: [] }], // Step 1 and Step 2 both empty
    customerRow: { billing_email: 'legacy@acme.com' },
  });
  const r = await resolveBillingEmails(svc, 'tenant-1', 'cust-A3', 'rate_confirmation');
  check(
    'step 1: inactive rows skipped (empty Step 1 falls through)',
    r.source === 'customer.billing_email' &&
      JSON.stringify(r.to) === JSON.stringify(['legacy@acme.com']),
  );
  check(
    'step 1: is_active=true filter still sent even when no active rows',
    svc._allBillingEqs()[0].is_active === true,
  );
})();

// Case 4: Step 2 — rate_confirmation empty but invoice rows exist
await (async () => {
  const svc = makeStub({
    billingCalls: [
      { data: [] }, // Step 1: no rate_confirmation rows
      { data: [{ email: 'ar@acme.com' }] }, // Step 2: one active invoice row
    ],
  });
  const r = await resolveBillingEmails(svc, 'tenant-1', 'cust-B', 'rate_confirmation');
  check(
    'step 2: falls back to invoice-typed email',
    r.source === 'customer_billing_emails' &&
      JSON.stringify(r.to) === JSON.stringify(['ar@acme.com']),
  );
  check(
    'step 2: invoice fallback also filters is_active=true',
    svc._allBillingEqs()[1].is_active === true &&
      svc._allBillingEqs()[1].email_type === 'invoice',
  );
})();

// Case 5: Step 2 short-circuit when emailType='invoice' — only one
// customer_billing_emails call should fire, and `invoiceRow` in slot 1
// (which WOULD be returned if Step 2 ran) must NOT be observable.
await (async () => {
  const svc = makeStub({
    billingCalls: [
      { data: [] }, // Step 1: no invoice rows
      { data: [{ email: 'should-not-use@acme.com' }] }, // only reachable if Step 2 ran
    ],
    customerRow: { billing_email: 'legacy@c.com' },
  });
  const r = await resolveBillingEmails(svc, 'tenant-1', 'cust-E', 'invoice');
  check(
    'step 2 short-circuit when emailType=invoice: legacy fallback wins',
    r.source === 'customer.billing_email' &&
      JSON.stringify(r.to) === JSON.stringify(['legacy@c.com']),
  );
  check(
    'step 2 short-circuit: only 1 customer_billing_emails call made',
    svc._billingCallCount() === 1,
  );
})();

// Case 6: Step 3 — legacy customers.billing_email column
await (async () => {
  const svc = makeStub({
    billingCalls: [{ data: [] }, { data: [] }],
    customerRow: { billing_email: 'legacy@c.com' },
  });
  const r = await resolveBillingEmails(svc, 'tenant-1', 'cust-C', 'rate_confirmation');
  check(
    'step 3: legacy customers.billing_email fallback',
    r.source === 'customer.billing_email' &&
      JSON.stringify(r.to) === JSON.stringify(['legacy@c.com']),
  );
})();

// Case 7: Step 4 — nothing resolvable
await (async () => {
  const svc = makeStub({
    billingCalls: [{ data: [] }, { data: [] }],
    customerRow: null,
  });
  const r = await resolveBillingEmails(svc, 'tenant-1', 'cust-D', 'rate_confirmation');
  check(
    'step 4: returns { to: [], source: none } when nothing resolvable',
    r.source === 'none' && JSON.stringify(r.to) === JSON.stringify([]),
  );
})();

// Case 8: Empty customerId — early return, no DB calls
await (async () => {
  const svc = makeStub({
    billingCalls: [{ data: [{ email: 'should-never-fetch@acme.com' }] }],
    customerRow: { billing_email: 'should-never-fetch-legacy@c.com' },
  });
  const r = await resolveBillingEmails(svc, 'tenant-1', null, 'invoice');
  check(
    'empty customerId: returns { to: [], source: none }',
    r.source === 'none' && JSON.stringify(r.to) === JSON.stringify([]),
  );
  check(
    'empty customerId: zero DB calls',
    svc._billingCallCount() === 0,
  );
})();

// Case 9: Error propagation on customer_billing_emails query
await (async () => {
  const svc = makeStub({
    billingCalls: [{ data: null, error: { message: 'boom' } }],
  });
  let threw = null;
  try {
    await resolveBillingEmails(svc, 'tenant-1', 'cust-X', 'rate_confirmation');
  } catch (err) {
    threw = err;
  }
  check(
    'error propagation: customer_billing_emails query error throws with context',
    threw instanceof Error &&
      /customer_billing_emails lookup failed: boom/.test(threw.message),
  );
})();

// Case 10: Error propagation on customers query
await (async () => {
  const svc = makeStub({
    billingCalls: [{ data: [] }, { data: [] }],
    customerRow: null,
    customerErr: { message: 'customers-boom' },
  });
  let threw = null;
  try {
    await resolveBillingEmails(svc, 'tenant-1', 'cust-Y', 'rate_confirmation');
  } catch (err) {
    threw = err;
  }
  check(
    'error propagation: customers query error throws with context',
    threw instanceof Error &&
      /customer fallback lookup failed:/.test(threw.message) &&
      /customers-boom/.test(threw.message),
  );
})();

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
