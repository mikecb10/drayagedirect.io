/**
 * Dry Run Engine
 * --------------
 * Pure computation helpers for the Dry Run feature. These run on the server
 * (API endpoints) and are unit-tested via `tests/dry-run-engine.test.mjs`.
 *
 * Rules:
 *  - rate_source='preset' → server recomputes from the referenced profile.
 *  - rate_source='manual' → server trusts client amounts, with bounds checks.
 *  - rate_method='fixed'  → `amount_cents` is used as-is.
 *  - rate_method='per_mile' → `rate_cents_per_mile * miles`, rounded half-up.
 */

export const MAX_AMOUNT_CENTS = 10_000_000; // $100,000 sanity ceiling

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function roundHalfUp(n) {
  return Math.round(n);
}

/**
 * Compute a manually-entered amount.
 */
export function computeManualAmount(input) {
  const { rate_method } = input;

  if (rate_method === 'fixed') {
    const amount = input.amount_cents;
    assert(Number.isFinite(amount) && amount >= 0, 'amount_cents must be a non-negative number');
    assert(amount <= MAX_AMOUNT_CENTS, `amount_cents exceeds ceiling (${MAX_AMOUNT_CENTS})`);
    return amount;
  }

  if (rate_method === 'per_mile') {
    const rate = input.rate_cents_per_mile;
    const miles = input.miles;
    assert(Number.isFinite(rate) && rate > 0, 'rate_cents_per_mile must be > 0');
    assert(Number.isFinite(miles) && miles > 0, 'miles must be > 0');
    const result = roundHalfUp(rate * miles);
    assert(result <= MAX_AMOUNT_CENTS, `computed amount exceeds ceiling (${MAX_AMOUNT_CENTS})`);
    return result;
  }

  throw new Error(`unknown rate_method: ${rate_method}`);
}

/**
 * Compute an amount using a preset profile row.
 */
export function computePresetAmount(profile, context) {
  const { rate_method } = profile;

  if (rate_method === 'fixed') {
    return computeManualAmount({ rate_method: 'fixed', amount_cents: profile.amount_cents });
  }

  if (rate_method === 'per_mile') {
    return computeManualAmount({
      rate_method: 'per_mile',
      rate_cents_per_mile: profile.rate_cents_per_mile,
      miles: context.miles,
    });
  }

  throw new Error(`profile has unknown rate_method: ${rate_method}`);
}

/**
 * Validate a create/edit payload shape.
 * Returns { ok: true } or { ok: false, reason: string }.
 *
 * @param {object} payload  The payload to validate
 * @param {object} [opts]
 * @param {boolean} [opts.isEdit=false]  When editing an existing dry run, event_id
 *   may legitimately be null (detached dry runs — see two-tier leg delete). On
 *   create, event_id is always required.
 */
export function validatePayload(payload, opts = {}) {
  const { isEdit = false } = opts;
  if (!payload || typeof payload !== 'object') return { ok: false, reason: 'payload required' };
  if (!isEdit && !payload.event_id) return { ok: false, reason: 'event_id required' };
  if (!payload.driver_id) return { ok: false, reason: 'driver_id required' };

  if (!['preset', 'manual'].includes(payload.rate_source)) return { ok: false, reason: 'rate_source must be preset|manual' };
  if (!['fixed',  'per_mile'].includes(payload.rate_method)) return { ok: false, reason: 'rate_method must be fixed|per_mile' };

  if (payload.rate_source === 'preset') {
    if (!payload.charge_profile_id)        return { ok: false, reason: 'preset requires charge_profile_id' };
    if (!payload.driver_charge_profile_id) return { ok: false, reason: 'preset requires driver_charge_profile_id' };
  } else {
    if (payload.charge_profile_id || payload.driver_charge_profile_id) {
      return { ok: false, reason: 'manual must not include profile IDs' };
    }
  }

  if (payload.rate_method === 'per_mile') {
    if (!Number.isFinite(payload.miles) || payload.miles <= 0) {
      return { ok: false, reason: 'per_mile requires miles > 0' };
    }
  }

  return { ok: true };
}
