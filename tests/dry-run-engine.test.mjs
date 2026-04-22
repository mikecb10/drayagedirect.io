import {
  computeManualAmount,
  computePresetAmount,
  validatePayload,
  MAX_AMOUNT_CENTS,
} from '../lib/dry-run-engine.js';

let passed = 0;
let failed = 0;
function check(name, cond) {
  if (cond) { console.log(`  ✓ ${name}`); passed++; }
  else      { console.log(`  ✗ ${name}`); failed++; }
}

console.log('computeManualAmount — fixed method');
check('returns amount as-is', computeManualAmount({ rate_method: 'fixed', amount_cents: 12500 }) === 12500);
check('ignores miles when fixed', computeManualAmount({ rate_method: 'fixed', amount_cents: 500, miles: 99 }) === 500);
check('rejects negative', (() => { try { computeManualAmount({ rate_method: 'fixed', amount_cents: -1 }); return false; } catch { return true; } })());
check('rejects over-ceiling', (() => { try { computeManualAmount({ rate_method: 'fixed', amount_cents: MAX_AMOUNT_CENTS + 1 }); return false; } catch { return true; } })());

console.log('\ncomputeManualAmount — per_mile method');
check('rate × miles', computeManualAmount({ rate_method: 'per_mile', rate_cents_per_mile: 250, miles: 42 }) === 10500);
check('decimal miles rounded', computeManualAmount({ rate_method: 'per_mile', rate_cents_per_mile: 100, miles: 42.5 }) === 4250);
check('rejects zero miles', (() => { try { computeManualAmount({ rate_method: 'per_mile', rate_cents_per_mile: 100, miles: 0 }); return false; } catch { return true; } })());
check('rejects negative rate', (() => { try { computeManualAmount({ rate_method: 'per_mile', rate_cents_per_mile: -1, miles: 10 }); return false; } catch { return true; } })());

console.log('\ncomputePresetAmount');
const fakeProfile = { rate_method: 'fixed', amount_cents: 15000, name: 'Flat Dry Run' };
check('fixed profile', computePresetAmount(fakeProfile, { miles: null }) === 15000);
const pmProfile = { rate_method: 'per_mile', rate_cents_per_mile: 300, name: 'Per-mile Dry Run' };
check('per_mile profile × 20mi', computePresetAmount(pmProfile, { miles: 20 }) === 6000);
check('per_mile profile rejects null miles', (() => { try { computePresetAmount(pmProfile, { miles: null }); return false; } catch { return true; } })());

console.log('\nvalidatePayload');
const validManual = {
  event_id: 'e1', driver_id: 'd1',
  rate_source: 'manual', rate_method: 'fixed',
  ar_amount_cents: 500, ap_amount_cents: 300,
};
check('valid manual payload', validatePayload(validManual).ok === true);
check('manual rejects profile_id', validatePayload({ ...validManual, charge_profile_id: 'p1' }).ok === false);

const validPreset = {
  event_id: 'e1', driver_id: 'd1',
  rate_source: 'preset', rate_method: 'per_mile',
  charge_profile_id: 'p1', driver_charge_profile_id: 'dp1',
  miles: 42,
  ar_amount_cents: 0, ap_amount_cents: 0,
};
check('valid preset payload', validatePayload(validPreset).ok === true);
check('preset rejects missing charge_profile', validatePayload({ ...validPreset, charge_profile_id: null }).ok === false);
check('preset rejects missing driver_charge_profile', validatePayload({ ...validPreset, driver_charge_profile_id: null }).ok === false);
check('per_mile rejects null miles', validatePayload({ ...validPreset, miles: null }).ok === false);
check('per_mile rejects zero miles', validatePayload({ ...validPreset, miles: 0 }).ok === false);
check('rejects missing event_id on create', validatePayload({ ...validManual, event_id: null }).ok === false);
check('accepts null event_id on edit (detached)', validatePayload({ ...validManual, event_id: null }, { isEdit: true }).ok === true);
check('rejects missing driver_id', validatePayload({ ...validManual, driver_id: null }).ok === false);
check('rejects invalid rate_source', validatePayload({ ...validManual, rate_source: 'wild' }).ok === false);
check('rejects invalid rate_method', validatePayload({ ...validManual, rate_method: 'wild' }).ok === false);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
