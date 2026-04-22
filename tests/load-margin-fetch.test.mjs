import { fetchLoadMarginInputs } from '../lib/load-margin.js';

let passed = 0;
let failed = 0;
function check(name, cond, detail) {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else      { failed++; console.log(`  ✗ ${name}${detail ? `\n    ${detail}` : ''}`); }
}

// Minimal mock of the Supabase query chain used by fetchLoadMarginInputs.
// The production code uses: .from(table).select(...).eq(...).in(...)[.is(...)]
// then awaits the chain which yields { data, error }.
function mockSvc({ chargeSets = [], lineItems = [], payLines = [] }) {
  return {
    from(table) {
      const state = { table, filters: { in: {}, eq: {}, is: {} } };
      const chain = {
        select: () => chain,
        eq: (col, val) => { state.filters.eq[col] = val; return chain; },
        in: (col, vals) => { state.filters.in[col] = vals; return chain; },
        is: (col, val) => { state.filters.is[col] = val; return chain; },
        then: (resolve) => {
          let data;
          if (table === 'order_charge_sets') {
            data = chargeSets.filter(cs =>
              state.filters.eq.tenant_id === cs.tenant_id &&
              state.filters.in.order_id?.includes(cs.order_id));
          } else if (table === 'order_charge_set_line_items') {
            data = lineItems.filter(li =>
              state.filters.eq.tenant_id === li.tenant_id &&
              state.filters.in.charge_set_id?.includes(li.charge_set_id) &&
              (!('dry_run_attempt_id' in state.filters.is) || li.dry_run_attempt_id === null));
          } else if (table === 'order_driver_pay_lines') {
            data = payLines.filter(pl =>
              state.filters.eq.tenant_id === pl.tenant_id &&
              state.filters.in.order_id?.includes(pl.order_id) &&
              (!('dry_run_attempt_id' in state.filters.is) || pl.dry_run_attempt_id === null));
          } else {
            data = [];
          }
          return Promise.resolve({ data, error: null }).then(resolve);
        },
      };
      return chain;
    },
  };
}

console.log('fetchLoadMarginInputs');

// Fixture shared across scenarios
const T = 'tenant-1';
const O1 = 'order-1';
const O2 = 'order-2';
const CS1 = 'cs-1';
const CS2 = 'cs-2';
const DR1 = 'dry-run-1';

const fixture = {
  chargeSets: [
    { tenant_id: T, id: CS1, order_id: O1 },
    { tenant_id: T, id: CS2, order_id: O2 },
  ],
  lineItems: [
    { tenant_id: T, charge_set_id: CS1, total_cents: 10000, dry_run_attempt_id: null },
    { tenant_id: T, charge_set_id: CS1, total_cents:  2500, dry_run_attempt_id: DR1 }, // dry-run revenue
    { tenant_id: T, charge_set_id: CS2, total_cents:  8000, dry_run_attempt_id: null },
  ],
  payLines: [
    { tenant_id: T, order_id: O1, amount_cents: 5000, dry_run_attempt_id: null },
    { tenant_id: T, order_id: O1, amount_cents: 1500, dry_run_attempt_id: DR1 }, // dry-run cost
    { tenant_id: T, order_id: O2, amount_cents: 4000, dry_run_attempt_id: null },
  ],
};

// F1: includeDryRuns=true picks up dry-run line items and pay lines
{
  const svc = mockSvc(fixture);
  const result = await fetchLoadMarginInputs(svc, { tenantId: T, orderIds: [O1, O2], includeDryRuns: true });
  const o1 = result.get(O1);
  const o2 = result.get(O2);
  check('F1  includeDryRuns=true  O1 revenue = 12500', o1.revenueCents === 12500);
  check('F1  includeDryRuns=true  O1 cost    = 6500',  o1.costCents    === 6500);
  check('F1  includeDryRuns=true  O2 revenue = 8000',  o2.revenueCents === 8000);
  check('F1  includeDryRuns=true  O2 cost    = 4000',  o2.costCents    === 4000);
}

// F2: includeDryRuns=false excludes dry-run line items and pay lines
{
  const svc = mockSvc(fixture);
  const result = await fetchLoadMarginInputs(svc, { tenantId: T, orderIds: [O1, O2], includeDryRuns: false });
  const o1 = result.get(O1);
  check('F2  includeDryRuns=false Q1 revenue = 10000 (dry-run LI excluded)', o1.revenueCents === 10000);
  check('F2  includeDryRuns=false O1 cost    = 5000 (dry-run PL excluded)',  o1.costCents    === 5000);
}

// F3: empty orderIds returns empty Map
{
  const svc = mockSvc(fixture);
  const result = await fetchLoadMarginInputs(svc, { tenantId: T, orderIds: [], includeDryRuns: true });
  check('F3  empty orderIds → empty map', result.size === 0);
}

// F4: unknown order (no charge sets, no pay lines) returns zero sums
{
  const svc = mockSvc(fixture);
  const result = await fetchLoadMarginInputs(svc, { tenantId: T, orderIds: ['order-missing'], includeDryRuns: true });
  const row = result.get('order-missing');
  check('F4  unknown order → { revenueCents:0, costCents:0 }', row && row.revenueCents === 0 && row.costCents === 0);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
