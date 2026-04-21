import { parseCsvParam, sanitizeFilterSet } from '../lib/ar-filter-params.js';

let passed = 0;
let failed = 0;
function check(name, cond) {
  if (cond) { console.log(`  ✓ ${name}`); passed++; }
  else      { console.log(`  ✗ ${name}`); failed++; }
}

console.log('parseCsvParam');
check('undefined → []', JSON.stringify(parseCsvParam(undefined)) === '[]');
check('empty string → []', JSON.stringify(parseCsvParam('')) === '[]');
check('single id → [id]', JSON.stringify(parseCsvParam('abc')) === '["abc"]');
check('csv → [a,b,c]', JSON.stringify(parseCsvParam('a,b,c')) === '["a","b","c"]');
check('trims whitespace', JSON.stringify(parseCsvParam(' a , b , c ')) === '["a","b","c"]');
check('drops empty segments', JSON.stringify(parseCsvParam('a,,b,')) === '["a","b"]');
check('non-string → []', JSON.stringify(parseCsvParam(['a'])) === '[]');

console.log('\nsanitizeFilterSet');
check('empty object → {}', JSON.stringify(sanitizeFilterSet({})) === '{}');
check('drops empty arrays', JSON.stringify(sanitizeFilterSet({ customer_ids: [], branch_ids: ['b1'] })) === '{"branch_ids":["b1"]}');
check('drops null dates', JSON.stringify(sanitizeFilterSet({ from: null, to: '2026-01-01' })) === '{"to":"2026-01-01"}');
check('keeps populated fields', JSON.stringify(sanitizeFilterSet({ customer_ids: ['c1'], from: '2026-01-01', to: '2026-02-01' })) === '{"customer_ids":["c1"],"from":"2026-01-01","to":"2026-02-01"}');
check('ignores unknown keys', JSON.stringify(sanitizeFilterSet({ customer_ids: ['c1'], garbage: 'x' })) === '{"customer_ids":["c1"]}');

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
