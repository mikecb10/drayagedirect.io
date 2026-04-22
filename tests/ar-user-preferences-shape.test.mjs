// Integration-lite: exercises normalizeTab indirectly via sanitizeFilterSet,
// the atomic helper shared with the endpoint. Keeps the test hermetic
// (no Next boot, no DB connection).
import { sanitizeFilterSet } from '../lib/ar-filter-params.js';

let passed = 0;
let failed = 0;
function check(name, cond) {
  if (cond) { console.log(`  ✓ ${name}`); passed++; }
  else      { console.log(`  ✗ ${name}`); failed++; }
}

console.log('tab filter sanitization');
check('customer_ids stays when populated',
  JSON.stringify(sanitizeFilterSet({ customer_ids: ['c1', 'c2'] })) === '{"customer_ids":["c1","c2"]}');
check('both date bounds stay',
  JSON.stringify(sanitizeFilterSet({ from: '2026-01-01', to: '2026-02-01' })) === '{"from":"2026-01-01","to":"2026-02-01"}');
check('empty arrays dropped',
  JSON.stringify(sanitizeFilterSet({ customer_ids: [], branch_ids: [] })) === '{}');
check('garbage keys stripped',
  JSON.stringify(sanitizeFilterSet({ customer_ids: ['c1'], xss: '<script>' })) === '{"customer_ids":["c1"]}');

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
