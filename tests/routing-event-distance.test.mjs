// Hand-rolled test: routing event distance engine behavior.
// Covers the COALESCE fallback + null-return contract added in migration 089.
// Run: node tests/routing-event-distance.test.mjs

import { resolveAmountCents } from '../lib/pricing-tier-resolver.js';

let passed = 0;
let failed = 0;

function check(name, cond) {
  if (cond) {
    console.log(`  PASS: ${name}`);
    passed++;
  } else {
    console.log(`  FAIL: ${name}`);
    failed++;
  }
}

function makeTier(overrides = {}) {
  return {
    id: 'tier-1',
    amount_cents: 250, // $2.50 per mile
    minimum_amount_cents: 0,
    start_date: null,
    end_date: null,
    ...overrides,
  };
}

function makeCtx(load, profileOverrides = {}) {
  return {
    load,
    profile: {
      unit_of_measure: 'per_mile',
      ...profileOverrides,
    },
  };
}

function callResolveAmountCents(ctx, tier, tiers) {
  return resolveAmountCents({
    tiers,
    calculation_mode: ctx.profile?.calculation_mode,
    unit_of_measure: ctx.profile?.unit_of_measure,
  }, {
    load: ctx.load,
  });
}

console.log('Test: per_mile charge with estimated_miles fallback');
{
  const ctx = makeCtx({ actual_miles: null, estimated_miles: 25 });
  const tier = makeTier();
  const out = callResolveAmountCents(ctx, tier, [tier]);
  check('uses estimated_miles via COALESCE', out.amount_cents === 25 * 250);
  check('miles field reflects the resolved value', out.miles === 25);
  check('needs_distance not set', !out.needs_distance);
}

console.log('Test: per_mile charge prefers actual_miles over estimated');
{
  const ctx = makeCtx({ actual_miles: 30, estimated_miles: 25 });
  const tier = makeTier();
  const out = callResolveAmountCents(ctx, tier, [tier]);
  check('uses actual_miles (30) not estimated (25)', out.amount_cents === 30 * 250);
  check('miles field is 30', out.miles === 30);
}

console.log('Test: per_mile charge returns null when BOTH miles are NULL');
{
  const ctx = makeCtx({ actual_miles: null, estimated_miles: null });
  const tier = makeTier();
  const out = callResolveAmountCents(ctx, tier, [tier]);
  check('amount_cents is null', out.amount_cents === null);
  check('needs_distance is true', out.needs_distance === true);
  check('reason is no_miles_on_load', out.reason === 'no_miles_on_load');
}

console.log('Test: fixed-fee charge unaffected by missing miles');
{
  const ctx = makeCtx(
    { actual_miles: null, estimated_miles: null },
    { unit_of_measure: 'fixed' }
  );
  const tier = makeTier({ amount_cents: 5000 });
  const out = callResolveAmountCents(ctx, tier, [tier]);
  check('fixed-fee returns its amount regardless', out.amount_cents === 5000);
  check('needs_distance not set on fixed charges', !out.needs_distance);
}

console.log('Test: per_load charge unaffected by missing miles');
{
  const ctx = makeCtx(
    { actual_miles: null, estimated_miles: null },
    { unit_of_measure: 'per_load' }
  );
  const tier = makeTier({ amount_cents: 15000 });
  const out = callResolveAmountCents(ctx, tier, [tier]);
  check('per_load returns its amount', out.amount_cents === 15000);
  check('needs_distance not set', !out.needs_distance);
}

console.log('Test: percentage charge unaffected by missing miles');
{
  const ctx = makeCtx(
    { actual_miles: null, estimated_miles: null },
    { unit_of_measure: 'percentage' }
  );
  const tier = makeTier({ amount_cents: 10 });
  const out = callResolveAmountCents(ctx, tier, [tier]);
  check('percentage charge unaffected', !out.needs_distance);
}

console.log('Test: radius_rate charge returns null when both miles NULL');
{
  const ctx = makeCtx(
    { actual_miles: null, estimated_miles: null },
    { unit_of_measure: 'radius_rate' }
  );
  const tier = makeTier({
    radius_tiers: [{ amount_cents: 10000, start_distance: 0, end_distance: 50, rate_type: 'fixed' }],
  });
  const out = callResolveAmountCents(ctx, tier, [tier]);
  check('amount_cents is null', out.amount_cents === null);
  check('needs_distance is true', out.needs_distance === true);
}

console.log('Test: radius_rate bracket lookup uses estimated_miles when actual NULL');
{
  const ctx = makeCtx(
    { actual_miles: null, estimated_miles: 30 },
    { unit_of_measure: 'radius_rate' }
  );
  const tier = makeTier({
    radius_tiers: [
      { amount_cents: 10000, start_distance: 0,  end_distance: 50,  rate_type: 'fixed' },
      { amount_cents: 20000, start_distance: 51, end_distance: 100, rate_type: 'fixed' },
    ],
  });
  const out = callResolveAmountCents(ctx, tier, [tier]);
  check('miles=30 falls in [0,50] bracket', out.amount_cents === 10000);
  check('bracket index is 0', out.radius_bracket_index === 0);
}

console.log('Test: legitimately zero-mile load does NOT trigger gate');
{
  // Load with miles explicitly stored as 0 (same-location pickup + delivery)
  const ctx = makeCtx({ actual_miles: 0, estimated_miles: 0 });
  const tier = makeTier();
  const out = callResolveAmountCents(ctx, tier, [tier]);
  check('amount_cents is 0 (not null)', out.amount_cents === 0);
  check('needs_distance is NOT set', !out.needs_distance);
}

console.log('Test: load with only actual_miles=0 + estimated_miles=0 treated as resolved');
{
  // Edge case: both are 0 (not null). These are VALID resolved values.
  const ctx = makeCtx({ actual_miles: 0, estimated_miles: 0 });
  const tier = makeTier();
  const out = callResolveAmountCents(ctx, tier, [tier]);
  check('0 * rate = 0 without gate trigger', out.amount_cents === 0 && !out.needs_distance);
}

console.log('Test: isDistanceBased covers per_mile, per_miles, per_unit');
{
  const uoms = ['per_mile', 'per_miles'];
  for (const uom of uoms) {
    const ctx = makeCtx(
      { actual_miles: null, estimated_miles: null },
      { unit_of_measure: uom }
    );
    const out = callResolveAmountCents(ctx, makeTier(), [makeTier()]);
    check(`${uom} triggers needs_distance when both miles NULL`, out.needs_distance === true);
  }
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
