import { ALL_B2_KEYS, SECTION_KEYS } from '../lib/ar-filter-schema.js';
import { sanitizeFilterSet } from '../lib/ar-filter-params.js';

let passed = 0;
let failed = 0;
function check(name, cond) {
  if (cond) { console.log(`  ✓ ${name}`); passed++; }
  else       { console.log(`  ✗ ${name}`); failed++; }
}

// ── Load Margin % filter keys ──

console.log('ALL_B2_KEYS membership');
check('margin_from in ALL_B2_KEYS', ALL_B2_KEYS.includes('margin_from'));
check('margin_to   in ALL_B2_KEYS', ALL_B2_KEYS.includes('margin_to'));

console.log('\nSECTION_KEYS.billing');
check('margin_from in SECTION_KEYS.billing',  SECTION_KEYS.billing.includes('margin_from'));
check('margin_to   in SECTION_KEYS.billing',  SECTION_KEYS.billing.includes('margin_to'));

console.log('\nSECTION_KEYS.invoices');
check('margin_from in SECTION_KEYS.invoices', SECTION_KEYS.invoices.includes('margin_from'));
check('margin_to   in SECTION_KEYS.invoices', SECTION_KEYS.invoices.includes('margin_to'));

console.log('\nSECTION_KEYS — margin NOT in aging/payments/credit_memos');
check('margin_from NOT in SECTION_KEYS.aging',         !(SECTION_KEYS.aging         ?? []).includes('margin_from'));
check('margin_from NOT in SECTION_KEYS.payments',      !(SECTION_KEYS.payments      ?? []).includes('margin_from'));
check('margin_from NOT in SECTION_KEYS.credit_memos',  !(SECTION_KEYS.credit_memos  ?? []).includes('margin_from'));
check('margin_to   NOT in SECTION_KEYS.aging',         !(SECTION_KEYS.aging         ?? []).includes('margin_to'));
check('margin_to   NOT in SECTION_KEYS.payments',      !(SECTION_KEYS.payments      ?? []).includes('margin_to'));
check('margin_to   NOT in SECTION_KEYS.credit_memos',  !(SECTION_KEYS.credit_memos  ?? []).includes('margin_to'));

console.log('\nsanitizeFilterSet — margin keys (numeric strings)');
{
  const s = sanitizeFilterSet({ margin_from: '15', margin_to: '30' });
  check('sanitizer keeps margin_from "15"', s.margin_from === '15');
  check('sanitizer keeps margin_to   "30"', s.margin_to   === '30');
}
{
  const s = sanitizeFilterSet({ margin_from: '', margin_to: '' });
  check('sanitizer drops empty margin_from', !('margin_from' in s));
  check('sanitizer drops empty margin_to',   !('margin_to'   in s));
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
