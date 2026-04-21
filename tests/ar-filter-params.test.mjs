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

console.log('\nsanitizeFilterSet (Phase B1 keys)');
check('keeps reference_number string',
  JSON.stringify(sanitizeFilterSet({ reference_number: 'PO-123' })) === '{"reference_number":"PO-123"}');
check('drops empty reference_number',
  JSON.stringify(sanitizeFilterSet({ reference_number: '' })) === '{}');
check('keeps load_types array',
  JSON.stringify(sanitizeFilterSet({ load_types: ['import','export'] })) === '{"load_types":["import","export"]}');
check('keeps container_types array',
  JSON.stringify(sanitizeFilterSet({ container_types: ['dry_van'] })) === '{"container_types":["dry_van"]}');
check('keeps container_sizes array',
  JSON.stringify(sanitizeFilterSet({ container_sizes: ['20','40HC'] })) === '{"container_sizes":["20","40HC"]}');
check('keeps flags array',
  JSON.stringify(sanitizeFilterSet({ flags: ['hazmat','overweight'] })) === '{"flags":["hazmat","overweight"]}');
check('keeps ssl_codes array',
  JSON.stringify(sanitizeFilterSet({ ssl_codes: ['MSCU','MAEU'] })) === '{"ssl_codes":["MSCU","MAEU"]}');
check('keeps driver_ids array',
  JSON.stringify(sanitizeFilterSet({ driver_ids: ['u1','u2'] })) === '{"driver_ids":["u1","u2"]}');
check('drops empty arrays (new keys)',
  JSON.stringify(sanitizeFilterSet({ load_types: [], flags: [] })) === '{}');
check('drops non-string entries (flags)',
  JSON.stringify(sanitizeFilterSet({ flags: ['hazmat', 42, null, 'overweight'] })) === '{"flags":["hazmat","overweight"]}');

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
